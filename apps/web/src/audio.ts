/** Decode locally and send only bounded mono 16 kHz PCM WAV to either native engine. */
export async function normalizeAudio(
  file: File,
  captured = false,
): Promise<File> {
  if (!captured) {
    const duration = await mediaDuration(file);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60)
      throw new Error(
        "音频需有可确认的时长且不超过60秒；请先剪裁或转换为 WAV。",
      );
  }
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > 60 || decoded.numberOfChannels > 8)
      throw new Error("音频超过60秒或声道过多，已停止本地处理。");
    const count = Math.ceil(decoded.duration * 16000);
    const offline = new OfflineAudioContext(1, count, 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const mono = (await offline.startRendering()).getChannelData(0);
    const bytes = new ArrayBuffer(44 + mono.length * 2),
      view = new DataView(bytes);
    const chars = (at: number, text: string) =>
      [...text].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
    chars(0, "RIFF");
    view.setUint32(4, 36 + mono.length * 2, true);
    chars(8, "WAVE");
    chars(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    chars(36, "data");
    view.setUint32(40, mono.length * 2, true);
    mono.forEach((sample, i) => {
      const value = Math.max(-1, Math.min(1, sample));
      view.setInt16(
        44 + i * 2,
        value < 0 ? value * 32768 : value * 32767,
        true,
      );
    });
    return new File([bytes], file.name.replace(/\.[^.]*$/, "") + ".wav", {
      type: "audio/wav",
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("音频")) throw e;
    throw new Error(
      "此音频编码无法在本机解码，请转换为 WAV 或 MP3 后导入；未上传音频。",
    );
  } finally {
    await context.close();
  }
}
function mediaDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio"),
      url = URL.createObjectURL(file);
    const done = (duration?: number) => {
      clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      duration !== undefined
        ? resolve(duration)
        : reject(new Error("无法确认音频时长，请转换为标准 WAV 再导入。"));
    };
    const timer = setTimeout(() => done(), 5000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done();
    audio.src = url;
  });
}
