package cn.muyu.assistant;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.util.Base64;
import android.util.Base64InputStream;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/** On-device audio decoding and multilingual Whisper inference. Never opens a network connection. */
public final class LocalSpeech {
    public static final long MAX_AUDIO_BYTES = 20L * 1024 * 1024;
    public static final int MAX_AUDIO_SECONDS = 120;
    private static final int SAMPLE_RATE = 16000;
    private static final AtomicBoolean cancelled = new AtomicBoolean(false);
    static { System.loadLibrary("muyu-speech"); }

    private LocalSpeech() {}
    private static native String nativeTranscribe(String modelPath, float[] pcm16kMono, String language);
    private static native void nativeCancel();
    private static native void nativeReset();

    public static void cancel() {
        cancelled.set(true);
        nativeCancel();
    }

    /** Caller runs this on its serial model executor after unloading the language/vision model. */
    public static synchronized JSONObject transcribe(Context context, File model, String dataURL,
                                                      String name, String language) throws Exception {
        begin(model, language);
        if (dataURL == null || dataURL.length() > ((MAX_AUDIO_BYTES + 2) / 3) * 4 + 256)
            throw new IOException("音频文件不能超过 20 MiB");
        int comma = dataURL.indexOf(',');
        if (comma < 0 || comma > 255 || !dataURL.startsWith("data:"))
            throw new IOException("需要有效的音频数据");
        String header = dataURL.substring(5, comma).toLowerCase(Locale.ROOT);
        String mime = header.split(";", 2)[0];
        if (!header.endsWith(";base64") || !(mime.startsWith("audio/") ||
                mime.equals("video/mp4") || mime.equals("application/octet-stream")))
            throw new IOException("需要 Base64 编码的音频文件");
        File temporary = File.createTempFile("muyu-local-audio-", ".audio", context.getCacheDir());
        try {
            // Decode from the existing string without making another 28 MiB Base64 byte array.
            try (InputStream decoded = new Base64InputStream(new AsciiSlice(dataURL, comma + 1), Base64.DEFAULT);
                 FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[8192];
                long bytes = 0;
                for (int n; (n = decoded.read(buffer)) != -1;) {
                    checkCancelled();
                    bytes += n;
                    if (bytes > MAX_AUDIO_BYTES) throw new IOException("音频文件不能超过 20 MiB");
                    output.write(buffer, 0, n);
                }
                if (bytes == 0) throw new IOException("音频文件为空");
            } catch (IllegalArgumentException error) {
                throw new IOException("音频 Base64 数据损坏", error);
            }
            return recognize(model, temporary, language);
        } finally {
            if (!temporary.delete()) temporary.deleteOnExit();
        }
    }

    /** Used by the foreground microphone recorder or a user-selected app-private audio file. */
    public static synchronized JSONObject transcribe(Context context, File model, File audio,
                                                      String language) throws Exception {
        begin(model, language);
        return recognize(model, audio, language);
    }

    private static void begin(File model, String language) throws IOException {
        if (model == null || !model.isFile() || !model.canRead())
            throw new IOException("请先在模型管理中安装并校验多语言 Whisper 语音模型");
        if (!("auto".equals(language) || "zh".equals(language) || "en".equals(language)))
            throw new IOException("请选择自动识别、中文或英文");
        cancelled.set(false);
        nativeReset();
    }

    private static JSONObject recognize(File model, File audio, String language) throws Exception {
        if (audio == null || !audio.isFile() || !audio.canRead() || audio.length() < 1)
            throw new IOException("无法读取音频文件");
        if (audio.length() > MAX_AUDIO_BYTES) throw new IOException("音频文件不能超过 20 MiB");
        checkCancelled();
        float[] pcm;
        try (RandomAccessFile input = new RandomAccessFile(audio, "r")) {
            boolean wave = input.length() >= 12 && readTag(input).equals("RIFF");
            if (wave) { input.seek(8); wave = readTag(input).equals("WAVE"); }
            pcm = wave ? decodeWave(input) : decodeMedia(audio);
        }
        checkCancelled();
        if (pcm.length < SAMPLE_RATE / 10) throw new IOException("音频过短，至少需要 0.1 秒");
        String result = nativeTranscribe(model.getAbsolutePath(), pcm, language);
        checkCancelled();
        if (result == null) throw new IOException("语音识别未返回结果");
        JSONObject json = new JSONObject(result);
        // Token probabilities are model diagnostics, not a reliable statement of transcript correctness.
        json.put("requiresReview", true);
        json.put("modelId", "whisper-base-multilingual");
        return json;
    }

    private static float[] decodeWave(RandomAccessFile input) throws IOException {
        int format = 0, channels = 0, rate = 0, bits = 0, alignment = 0;
        long dataOffset = -1, dataLength = 0;
        input.seek(12);
        while (input.getFilePointer() + 8 <= input.length()) {
            String tag = readTag(input);
            long length = Integer.toUnsignedLong(readLE32(input));
            long start = input.getFilePointer();
            if (length > input.length() - start) throw new IOException("WAV 文件不完整");
            if (tag.equals("fmt ")) {
                if (length < 16) throw new IOException("WAV 格式头损坏");
                format = readLE16(input); channels = readLE16(input); rate = readLE32(input);
                readLE32(input); alignment = readLE16(input); bits = readLE16(input);
            } else if (tag.equals("data") && dataOffset < 0) {
                dataOffset = start; dataLength = length;
            }
            input.seek(start + length + (length & 1));
        }
        validateAudioFormat(rate, channels);
        if (dataOffset < 0 || !(format == 1 && (bits == 8 || bits == 16 || bits == 24 || bits == 32) ||
                format == 3 && bits == 32))
            throw new IOException("WAV 仅支持 PCM 8/16/24/32 位或 32 位浮点；请使用标准 WAV、MP3 或 M4A");
        if (alignment != channels * (bits / 8) || dataLength % alignment != 0)
            throw new IOException("WAV 音频帧损坏");
        long frames = dataLength / alignment;
        if (frames > (long) rate * MAX_AUDIO_SECONDS)
            throw new IOException("音频不能超过 120 秒，请先分段");
        Resampler resampler = new Resampler(rate);
        input.seek(dataOffset);
        byte[] chunk = new byte[alignment * Math.max(1, 8192 / alignment)];
        for (long remaining = dataLength; remaining > 0;) {
            checkCancelled();
            int n = (int) Math.min(chunk.length, remaining);
            input.readFully(chunk, 0, n);
            ByteBuffer buffer = ByteBuffer.wrap(chunk, 0, n).order(ByteOrder.LITTLE_ENDIAN);
            for (int frame = 0; frame < n / alignment; frame++) {
                float value = 0;
                for (int channel = 0; channel < channels; channel++) {
                    if (format == 3) value += sanitize(buffer.getFloat());
                    else if (bits == 8) value += ((buffer.get() & 255) - 128) / 128f;
                    else if (bits == 16) value += buffer.getShort() / 32768f;
                    else if (bits == 24) {
                        int sample = (buffer.get() & 255) | ((buffer.get() & 255) << 8) | (buffer.get() << 16);
                        value += sample / 8388608f;
                    } else value += buffer.getInt() / 2147483648f;
                }
                resampler.add(value / channels);
            }
            remaining -= n;
        }
        return resampler.finish();
    }

    private static float[] decodeMedia(File audio) throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec decoder = null;
        try {
            extractor.setDataSource(audio.getAbsolutePath());
            MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat candidate = extractor.getTrackFormat(i);
                String mime = candidate.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    format = candidate; extractor.selectTrack(i); break;
                }
            }
            if (format == null) throw new IOException("文件没有受 Android 支持的音轨");
            if (format.containsKey(MediaFormat.KEY_DURATION) &&
                    format.getLong(MediaFormat.KEY_DURATION) > MAX_AUDIO_SECONDS * 1_000_000L)
                throw new IOException("音频不能超过 120 秒，请先分段");
            int rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            validateAudioFormat(rate, channels);
            format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
            decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            decoder.configure(format, null, null, 0);
            decoder.start();
            int encoding = AudioFormat.ENCODING_PCM_16BIT;
            Resampler resampler = new Resampler(rate);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputEnded = false, outputEnded = false;
            long lastProgress = System.nanoTime();
            while (!outputEnded) {
                checkCancelled();
                if (System.nanoTime() - lastProgress > 30_000_000_000L)
                    throw new IOException("Android 音频解码超时，请转换为标准 WAV 或 M4A 后重试");
                if (!inputEnded) {
                    int index = decoder.dequeueInputBuffer(10_000);
                    if (index >= 0) {
                        ByteBuffer buffer = decoder.getInputBuffer(index);
                        if (buffer == null) throw new IOException("Android 音频输入缓冲区不可用");
                        buffer.clear();
                        int n = extractor.readSampleData(buffer, 0);
                        if (n < 0) {
                            decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputEnded = true;
                        } else {
                            decoder.queueInputBuffer(index, 0, n, Math.max(0, extractor.getSampleTime()), 0);
                            extractor.advance();
                        }
                        lastProgress = System.nanoTime();
                    }
                }
                int index = decoder.dequeueOutputBuffer(info, 10_000);
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat output = decoder.getOutputFormat();
                    int outputRate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    int outputChannels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    validateAudioFormat(outputRate, outputChannels);
                    if (outputRate != rate) {
                        if (resampler.frames != 0) throw new IOException("不支持音频采样率在文件中变化");
                        rate = outputRate; resampler = new Resampler(rate);
                    }
                    channels = outputChannels;
                    encoding = output.containsKey(MediaFormat.KEY_PCM_ENCODING)
                            ? output.getInteger(MediaFormat.KEY_PCM_ENCODING) : AudioFormat.ENCODING_PCM_16BIT;
                    if (encoding != AudioFormat.ENCODING_PCM_16BIT && encoding != AudioFormat.ENCODING_PCM_FLOAT)
                        throw new IOException("Android 解码器返回不支持的 PCM 格式");
                    lastProgress = System.nanoTime();
                } else if (index >= 0) {
                    try {
                        if (info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                            ByteBuffer buffer = decoder.getOutputBuffer(index);
                            if (buffer == null) throw new IOException("Android 音频输出缓冲区不可用");
                            buffer.position(info.offset); buffer.limit(info.offset + info.size);
                            buffer.order(ByteOrder.LITTLE_ENDIAN);
                            int sampleBytes = encoding == AudioFormat.ENCODING_PCM_FLOAT ? 4 : 2;
                            if (info.size % (sampleBytes * channels) != 0)
                                throw new IOException("解码后的音频帧不完整");
                            while (buffer.remaining() >= sampleBytes * channels) {
                                float value = 0;
                                for (int channel = 0; channel < channels; channel++)
                                    value += sampleBytes == 4 ? sanitize(buffer.getFloat()) : buffer.getShort() / 32768f;
                                resampler.add(value / channels);
                            }
                        }
                        outputEnded = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                        lastProgress = System.nanoTime();
                    } finally { decoder.releaseOutputBuffer(index, false); }
                }
            }
            return resampler.finish();
        } catch (IllegalArgumentException | IllegalStateException error) {
            throw new IOException("Android 无法解码此音频格式，请尝试标准 WAV、MP3、M4A 或 OGG", error);
        } finally {
            if (decoder != null) {
                try { decoder.stop(); } catch (IllegalStateException ignored) {}
                decoder.release();
            }
            extractor.release();
        }
    }

    private static void validateAudioFormat(int rate, int channels) throws IOException {
        if (rate < 8000 || rate > 192000 || channels < 1 || channels > 8)
            throw new IOException("音频采样率或声道数不受支持");
    }
    private static void checkCancelled() throws IOException {
        if (cancelled.get() || Thread.currentThread().isInterrupted()) throw new IOException("本地语音转写已停止");
    }
    private static float sanitize(float value) throws IOException {
        if (!Float.isFinite(value)) throw new IOException("音频包含无效的浮点采样");
        return Math.max(-1f, Math.min(1f, value));
    }
    private static int readLE16(RandomAccessFile input) throws IOException {
        return input.readUnsignedByte() | (input.readUnsignedByte() << 8);
    }
    private static int readLE32(RandomAccessFile input) throws IOException {
        return input.readUnsignedByte() | (input.readUnsignedByte() << 8) |
                (input.readUnsignedByte() << 16) | (input.readUnsignedByte() << 24);
    }
    private static String readTag(RandomAccessFile input) throws IOException {
        byte[] bytes = new byte[4]; input.readFully(bytes);
        return new String(bytes, java.nio.charset.StandardCharsets.US_ASCII);
    }

    /** Bounded, stateful mono resampling; only the 16 kHz result is retained in memory. */
    private static final class Resampler {
        final int rate;
        float[] samples = new float[SAMPLE_RATE * MAX_AUDIO_SECONDS];
        int size = 0;
        long frames = 0;
        double nextPosition = 0;
        float previous = 0;
        // One-pole anti-alias filter reduces frequencies above the target Nyquist limit.
        final float alpha;
        float filtered = 0;
        Resampler(int rate) {
            this.rate = rate;
            alpha = (float) (1 - Math.exp(-2 * Math.PI * 7200 / rate));
        }
        void add(float sample) throws IOException {
            if (frames >= (long) rate * MAX_AUDIO_SECONDS) throw new IOException("音频不能超过 120 秒，请先分段");
            if (rate > SAMPLE_RATE) {
                filtered += alpha * (sample - filtered); sample = filtered;
            }
            if (frames == 0) { previous = sample; append(sample); nextPosition = rate / (double) SAMPLE_RATE; }
            else {
                while (nextPosition <= frames && size < samples.length) {
                    double fraction = nextPosition - (frames - 1);
                    append((float) (previous + (sample - previous) * fraction));
                    nextPosition += rate / (double) SAMPLE_RATE;
                }
                previous = sample;
            }
            frames++;
        }
        private void append(float sample) throws IOException {
            if (size >= samples.length) throw new IOException("音频不能超过 120 秒，请先分段");
            samples[size++] = sample;
        }
        float[] finish() {
            float[] result = Arrays.copyOf(samples, size);
            samples = null;
            return result;
        }
    }

    private static final class AsciiSlice extends InputStream {
        private final String source;
        private int offset;
        AsciiSlice(String source, int offset) { this.source = source; this.offset = offset; }
        @Override public int read() throws IOException {
            if (offset >= source.length()) return -1;
            char ch = source.charAt(offset++);
            if (ch > 127) throw new IOException("音频 Base64 数据含非法字符");
            return ch;
        }
        @Override public int read(byte[] buffer, int start, int length) throws IOException {
            if (length == 0) return 0;
            if (offset >= source.length()) return -1;
            int count = Math.min(length, source.length() - offset);
            for (int i = 0; i < count; i++) {
                char ch = source.charAt(offset++);
                if (ch > 127) throw new IOException("音频 Base64 数据含非法字符");
                buffer[start + i] = (byte) ch;
            }
            return count;
        }
    }
}
