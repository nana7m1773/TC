#include <jni.h>
#include "whisper.h"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr int MAX_SAMPLES = 16000 * 120;
std::atomic<bool> cancelled{false};
std::mutex inferenceMutex;
std::once_flag logging;

std::string utf8(JNIEnv * env, jstring value) {
    if (!value) throw std::runtime_error("Speech model path and language are required");
    jclass cls = env->FindClass("java/lang/String");
    auto method = env->GetMethodID(cls, "getBytes", "(Ljava/lang/String;)[B");
    jstring charset = env->NewStringUTF("UTF-8");
    auto bytes = static_cast<jbyteArray>(env->CallObjectMethod(value, method, charset));
    if (!bytes || env->ExceptionCheck()) throw std::runtime_error("Unable to read speech argument");
    std::string result(env->GetArrayLength(bytes), '\0');
    env->GetByteArrayRegion(bytes, 0, result.size(), reinterpret_cast<jbyte *>(result.data()));
    env->DeleteLocalRef(bytes); env->DeleteLocalRef(charset); env->DeleteLocalRef(cls);
    return result;
}
jstring javaString(JNIEnv * env, const std::string & source) {
    // NewStringUTF uses modified UTF-8 and cannot represent supplementary Unicode reliably.
    jclass cls = env->FindClass("java/lang/String");
    auto constructor = env->GetMethodID(cls, "<init>", "([BLjava/lang/String;)V");
    jbyteArray bytes = env->NewByteArray(source.size());
    if (!bytes) return nullptr;
    env->SetByteArrayRegion(bytes, 0, source.size(), reinterpret_cast<const jbyte *>(source.data()));
    jstring charset = env->NewStringUTF("UTF-8");
    auto result = static_cast<jstring>(env->NewObject(cls, constructor, bytes, charset));
    env->DeleteLocalRef(bytes); env->DeleteLocalRef(charset); env->DeleteLocalRef(cls);
    return result;
}
std::string escaped(const std::string & text) {
    std::string result;
    for (unsigned char ch : text) {
        if (ch == '"' || ch == '\\') { result += '\\'; result += ch; }
        else if (ch < 0x20) {
            constexpr char digits[] = "0123456789abcdef";
            result += "\\u00"; result += digits[ch >> 4]; result += digits[ch & 15];
        } else result += ch;
    }
    return result;
}
bool abortDecode(void *) { return cancelled.load(std::memory_order_relaxed); }
bool beginEncoder(whisper_context *, whisper_state *, void *) { return !abortDecode(nullptr); }
void checkCancelled() {
    if (abortDecode(nullptr)) throw std::runtime_error("本地语音转写已停止");
}
}

extern "C" JNIEXPORT void JNICALL Java_cn_muyu_assistant_LocalSpeech_nativeCancel(JNIEnv *, jclass) {
    cancelled.store(true, std::memory_order_relaxed);
}
extern "C" JNIEXPORT void JNICALL Java_cn_muyu_assistant_LocalSpeech_nativeReset(JNIEnv *, jclass) {
    cancelled.store(false, std::memory_order_relaxed);
}
extern "C" JNIEXPORT jstring JNICALL Java_cn_muyu_assistant_LocalSpeech_nativeTranscribe(
    JNIEnv * env, jclass, jstring modelPath, jfloatArray audio, jstring language) {
    try {
        std::lock_guard<std::mutex> lock(inferenceMutex);
        checkCancelled();
        if (!audio) throw std::runtime_error("没有可转写的音频");
        const int count = env->GetArrayLength(audio);
        if (count < 1600 || count > MAX_SAMPLES) throw std::runtime_error("音频长度必须介于 0.1 秒与 120 秒之间");
        std::vector<float> samples(count);
        env->GetFloatArrayRegion(audio, 0, count, samples.data());
        if (env->ExceptionCheck()) return nullptr;
        if (std::any_of(samples.begin(), samples.end(), [](float s) { return !std::isfinite(s) || std::abs(s) > 1.01f; }))
            throw std::runtime_error("音频 PCM 数据无效");
        const auto lang = utf8(env, language);
        if (lang != "auto" && lang != "zh" && lang != "en") throw std::runtime_error("当前支持中文、英文或自动识别语言");
        const auto path = utf8(env, modelPath);
        std::call_once(logging, [] { whisper_log_set([](ggml_log_level, const char *, void *) {}, nullptr); });
        const auto start = std::chrono::steady_clock::now();
        auto contextParams = whisper_context_default_params();
        contextParams.use_gpu = false;
        contextParams.flash_attn = false;
        using OwnedContext = std::unique_ptr<whisper_context, decltype(&whisper_free)>;
        OwnedContext context(whisper_init_from_file_with_params(path.c_str(), contextParams), whisper_free);
        if (!context) throw std::runtime_error("语音模型加载失败：请校验 Whisper 模型文件并确认可用内存");
        // The context and its compute buffers are destroyed before returning to text generation.
        checkCancelled();
        if (!whisper_is_multilingual(context.get())) throw std::runtime_error("请安装多语言 Whisper 模型；英语专用模型不能满足中文识别要求");
        auto params = whisper_full_default_params(WHISPER_SAMPLING_BEAM_SEARCH);
        // A small beam improved the verified Mandarin sample while keeping decoder concurrency bounded.
        params.beam_search.beam_size = 3;
        params.n_threads = 4;
        params.language = lang.c_str();
        params.translate = false;
        params.detect_language = false;
        params.no_context = true;
        params.print_special = false;
        params.print_progress = false;
        params.print_realtime = false;
        params.print_timestamps = false;
        params.suppress_blank = true;
        params.suppress_nst = true;
        params.temperature = 0;
        params.abort_callback = abortDecode;
        params.encoder_begin_callback = beginEncoder;
        const int status = whisper_full(context.get(), params, samples.data(), count);
        checkCancelled();
        if (status != 0) throw std::runtime_error("本地语音识别失败：音频不受支持或设备内存不足");
        std::string text;
        std::ostringstream segments;
        const int segmentCount = whisper_full_n_segments(context.get());
        segments << '[';
        for (int i = 0; i < segmentCount; ++i) {
            if (i) segments << ',';
            const auto segmentText = std::string(whisper_full_get_segment_text(context.get(), i));
            text += segmentText;
            double probability = 0;
            const int tokenCount = whisper_full_n_tokens(context.get(), i);
            for (int j = 0; j < tokenCount; ++j) probability += whisper_full_get_token_p(context.get(), i, j);
            segments << "{\"text\":\"" << escaped(segmentText) << "\",\"startMs\":"
                     << whisper_full_get_segment_t0(context.get(), i) * 10
                     << ",\"endMs\":" << std::min<int64_t>(count * 1000LL / 16000, whisper_full_get_segment_t1(context.get(), i) * 10)
                     << ",\"averageTokenProbability\":" << (tokenCount ? probability / tokenCount : 0)
                     << ",\"noSpeechProbability\":" << whisper_full_get_segment_no_speech_prob(context.get(), i) << '}';
        }
        segments << ']';
        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
        const auto * detected = whisper_lang_str(whisper_full_lang_id(context.get()));
        std::ostringstream result;
        result << "{\"text\":\"" << escaped(text) << "\",\"language\":\"" << escaped(detected ? detected : lang)
               << "\",\"durationMs\":" << count * 1000LL / 16000 << ",\"elapsedMs\":" << elapsed
               << ",\"processingLocation\":\"device\",\"engine\":\"whisper.cpp\",\"engineVersion\":\"v1.8.7\""
               << ",\"requiresReview\":true,\"segments\":" << segments.str() << '}';
        return javaString(env, result.str());
    } catch (const std::exception & error) {
        if (!env->ExceptionCheck()) {
            jclass cls = env->FindClass("java/lang/IllegalStateException");
            // ThrowNew also expects modified UTF-8; construct the Java exception from standard UTF-8.
            auto constructor = env->GetMethodID(cls, "<init>", "(Ljava/lang/String;)V");
            auto message = javaString(env, error.what());
            auto exception = static_cast<jthrowable>(env->NewObject(cls, constructor, message));
            if (exception) env->Throw(exception);
            env->DeleteLocalRef(message); env->DeleteLocalRef(cls);
        }
        return nullptr;
    }
}
