#include <jni.h>
#include "llama.h"
#include "chat.h"
#include "mtmd.h"
#include "mtmd-helper.h"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
llama_model * model = nullptr;
llama_context * context = nullptr;
std::atomic<bool> cancelled{false};
bool initialized = false;
common_chat_templates_ptr templates;

std::string utf8(JNIEnv * env, jstring value) {
    jclass stringClass = env->FindClass("java/lang/String");
    jmethodID getBytes = env->GetMethodID(stringClass, "getBytes", "(Ljava/lang/String;)[B");
    jstring charset = env->NewStringUTF("UTF-8");
    auto bytes = static_cast<jbyteArray>(env->CallObjectMethod(value, getBytes, charset));
    std::string result(env->GetArrayLength(bytes), '\0');
    env->GetByteArrayRegion(bytes, 0, result.size(), reinterpret_cast<jbyte *>(result.data()));
    env->DeleteLocalRef(bytes); env->DeleteLocalRef(charset); env->DeleteLocalRef(stringClass);
    return result;
}
jstring javaString(JNIEnv * env, const std::string & source) {
    jclass stringClass = env->FindClass("java/lang/String");
    jmethodID constructor = env->GetMethodID(stringClass, "<init>", "([BLjava/lang/String;)V");
    jbyteArray bytes = env->NewByteArray(source.size());
    env->SetByteArrayRegion(bytes, 0, source.size(), reinterpret_cast<const jbyte *>(source.data()));
    jstring charset = env->NewStringUTF("UTF-8");
    auto result = static_cast<jstring>(env->NewObject(stringClass, constructor, bytes, charset));
    env->DeleteLocalRef(bytes); env->DeleteLocalRef(charset); env->DeleteLocalRef(stringClass);
    return result;
}
void fail(JNIEnv * env, const std::exception & error) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error.what());
}
void release() {
    templates.reset();
    if (context) llama_free(context);
    if (model) llama_model_free(model);
    context = nullptr;
    model = nullptr;
}
bool abortDecode(void *) { return cancelled.load(); }
bool loadProgress(float, void *) { return !cancelled.load(); }
std::vector<llama_token> tokens(const std::string & text) {
    if (!model) throw std::runtime_error("Please load a compatible GGUF model first");
    const auto vocab = llama_model_get_vocab(model);
    const int count = llama_tokenize(vocab, text.data(), text.size(), nullptr, 0, true, true);
    std::vector<llama_token> result(static_cast<size_t>(std::abs(count)));
    const int actual = llama_tokenize(vocab, text.data(), text.size(), result.data(), result.size(), true, true);
    if (actual < 0) throw std::runtime_error("Model tokenizer failed");
    result.resize(actual);
    return result;
}
std::string chatPrompt(const std::string & text) {
    if (!model) throw std::runtime_error("Please load a model first");
    if (!templates) throw std::runtime_error("Model chat template is unavailable");
    common_chat_templates_inputs input;
    common_chat_msg message; message.role = "user"; message.content = text;
    input.messages.push_back(message);
    input.add_generation_prompt = true;
    input.use_jinja = true;
    input.enable_thinking = false;
    input.chat_template_kwargs["enable_thinking"] = "false";
    return common_chat_templates_apply(templates.get(), input).prompt;
}
std::string jsonEscape(const std::string & value) {
    std::string escaped;
    for (unsigned char c : value) {
        if (c == '"' || c == '\\') { escaped += '\\'; escaped += c; }
        else if (c == '\n') escaped += "\\n";
        else if (c == '\r') escaped += "\\r";
        else if (c == '\t') escaped += "\\t";
        else if (c < 0x20) {
            const char * h = "0123456789abcdef";
            escaped += "\\u00"; escaped += h[c >> 4]; escaped += h[c & 15];
        } else escaped += c;
    }
    return escaped;
}
jstring generateResult(JNIEnv * env, size_t inputTokens, int maxTokens, float temperature, std::chrono::steady_clock::time_point started, size_t visionTokens = 0) {
    auto * sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
    std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)> owned(sampler, llama_sampler_free);
    if (temperature <= 0) llama_sampler_chain_add(sampler, llama_sampler_init_greedy());
    else {
        llama_sampler_chain_add(sampler, llama_sampler_init_top_k(20));
        llama_sampler_chain_add(sampler, llama_sampler_init_top_p(0.95f, 1));
        llama_sampler_chain_add(sampler, llama_sampler_init_temp(temperature));
        llama_sampler_chain_add(sampler, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    }
    std::string output;
    int generated = 0;
    double firstTokenMs = 0;
    const auto prefillEnd = std::chrono::steady_clock::now();
    for (int i = 0; i < maxTokens; ++i) {
        if (cancelled) throw std::runtime_error("Local inference cancelled");
        const llama_token token = llama_sampler_sample(sampler, context, -1);
        if (llama_vocab_is_eog(llama_model_get_vocab(model), token)) break;
        if (generated == 0) firstTokenMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
        std::vector<char> piece(128);
        int n = llama_token_to_piece(llama_model_get_vocab(model), token, piece.data(), piece.size(), 0, true);
        if (n < 0) {
            piece.resize(-n);
            n = llama_token_to_piece(llama_model_get_vocab(model), token, piece.data(), piece.size(), 0, true);
        }
        if (n < 0) throw std::runtime_error("Failed to decode model token");
        output.append(piece.data(), n);
        ++generated;
        if (i + 1 < maxTokens) {
            auto next = token;
            if (llama_decode(context, llama_batch_get_one(&next, 1)) != 0)
                throw std::runtime_error("Token generation failed or cancelled");
        }
    }
    const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - prefillEnd).count();
    std::ostringstream result;
    result << "{\"text\":\"" << jsonEscape(output) << "\",\"inputTokens\":" << inputTokens
           << ",\"outputTokens\":" << generated << ",\"tokensPerSecond\":" << (seconds > 0 ? generated / seconds : 0)
           << ",\"firstTokenMs\":" << firstTokenMs << ",\"contextSize\":" << llama_n_ctx(context)
           << ",\"visionTokens\":" << visionTokens << ",\"backend\":\"CPU\",\"kvCache\":\"f16\"}";
    llama_memory_clear(llama_get_memory(context), true);
    return javaString(env, result.str());
}

}

extern "C" JNIEXPORT void JNICALL Java_cn_muyu_assistant_NativeInference_load(JNIEnv * env, jclass, jstring path, jint size, jint threads) {
    try {
        cancelled = false;
        release();
        if (!initialized) {
            llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
            llama_backend_init();
            initialized = true;
        }
        auto params = llama_model_default_params();
        params.n_gpu_layers = 0;
        params.load_mode = LLAMA_LOAD_MODE_MMAP;
        params.progress_callback = loadProgress;
        model = llama_model_load_from_file(utf8(env, path).c_str(), params);
        if (!model) throw std::runtime_error("GGUF loading failed: unsupported architecture, damaged file or insufficient memory");
        if (!llama_model_chat_template(model, nullptr)) throw std::runtime_error("Model has no chat template; use a chat/instruct GGUF");
        templates = common_chat_templates_init(model, "");
        if (llama_model_n_ctx_train(model) < size) throw std::runtime_error("Requested context exceeds native model context; model cannot meet 12800-token requirement");
        auto cp = llama_context_default_params();
        cp.n_ctx = size;
        cp.n_batch = 256;
        cp.n_ubatch = 128;
        cp.n_threads = std::max(1, std::min(threads, 4));
        cp.n_threads_batch = cp.n_threads;
        cp.type_k = GGML_TYPE_F16;
        cp.type_v = GGML_TYPE_F16;
        cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
        cp.offload_kqv = false;
        cp.abort_callback = abortDecode;
        context = llama_init_from_model(model, cp);
        if (!context) throw std::runtime_error("Context allocation failed: insufficient memory or unsupported model");
        if (llama_n_ctx(context) < static_cast<uint32_t>(size)) throw std::runtime_error("Engine effective context is lower than requested");
    } catch (const std::exception & error) { release(); fail(env, error); }
}

extern "C" JNIEXPORT jint JNICALL Java_cn_muyu_assistant_NativeInference_tokenize(JNIEnv * env, jclass, jstring text) {
    try { return static_cast<jint>(tokens(chatPrompt(utf8(env, text))).size()); }
    catch (const std::exception & error) { fail(env, error); return -1; }
}

extern "C" JNIEXPORT jstring JNICALL Java_cn_muyu_assistant_NativeInference_infer(JNIEnv * env, jclass, jstring prompt, jint maxTokens, jfloat temperature) {
    try {
        if (!context || !model) throw std::runtime_error("No local model loaded");
        cancelled = false;
        auto input = tokens(chatPrompt(utf8(env, prompt)));
        if (input.empty() || maxTokens < 1 || input.size() + maxTokens > llama_n_ctx(context))
            throw std::runtime_error("Prompt plus reserved output exceeds effective context; trim older history with the engine tokenizer");
        llama_memory_clear(llama_get_memory(context), true);
        const auto started = std::chrono::steady_clock::now();
        for (size_t offset = 0; offset < input.size(); offset += 256) {
            if (cancelled) throw std::runtime_error("Local inference cancelled");
            auto batch = llama_batch_get_one(input.data() + offset, static_cast<int>(std::min<size_t>(256, input.size() - offset)));
            if (llama_decode(context, batch) != 0) throw std::runtime_error("Prompt processing failed or cancelled; memory/context unavailable");
        }
        return generateResult(env, input.size(), maxTokens, temperature, started);
    } catch (const std::exception & error) {
        if (context) llama_memory_clear(llama_get_memory(context), true);
        fail(env, error);
        return nullptr;
    }
}

extern "C" JNIEXPORT void JNICALL Java_cn_muyu_assistant_NativeInference_cancel(JNIEnv *, jclass) { cancelled = true; }
extern "C" JNIEXPORT void JNICALL Java_cn_muyu_assistant_NativeInference_unload(JNIEnv *, jclass) { release(); }

extern "C" JNIEXPORT jstring JNICALL Java_cn_muyu_assistant_NativeInference_analyzeImage(
    JNIEnv * env, jclass, jstring projector, jbyteArray rgb, jint width, jint height, jstring prompt, jint maxTokens, jfloat temperature) {
    try {
        if (!model || !context) throw std::runtime_error("No local text model loaded");
        if (width < 1 || height < 1 || width > 1280 || height > 1280 || env->GetArrayLength(rgb) != width * height * 3)
            throw std::runtime_error("Image must be RGB and at most 1280 pixels per dimension");
        cancelled = false;
        const auto started = std::chrono::steady_clock::now();
        mtmd_helper_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
        auto params = mtmd_context_params_default();
        params.use_gpu = false;
        params.n_threads = 4;
        params.warmup = false;
        params.print_timings = false;
        params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
        params.image_min_tokens = 64;
        params.image_max_tokens = 1024;
        params.progress_callback = loadProgress;
        params.cb_eval = [](ggml_tensor *, bool ask, void *) { return ask || !cancelled.load(); };
        std::unique_ptr<mtmd_context, decltype(&mtmd_free)> vision(mtmd_init_from_file(utf8(env, projector).c_str(), model, params), mtmd_free);
        if (!vision || !mtmd_support_vision(vision.get())) throw std::runtime_error("Vision projector is incompatible with selected text model or memory is insufficient");
        if (cancelled) throw std::runtime_error("Image analysis cancelled");
        std::vector<unsigned char> pixels(env->GetArrayLength(rgb));
        env->GetByteArrayRegion(rgb, 0, pixels.size(), reinterpret_cast<jbyte *>(pixels.data()));
        std::unique_ptr<mtmd_bitmap, decltype(&mtmd_bitmap_free)> bitmap(mtmd_bitmap_init(width, height, pixels.data()), mtmd_bitmap_free);
        if (!bitmap) throw std::runtime_error("Image preprocessing failed");
        auto rendered = chatPrompt(std::string(mtmd_default_marker()) + "\n" + utf8(env, prompt));
        mtmd_input_text text{rendered.data(), rendered.size(), true, true};
        std::unique_ptr<mtmd_input_chunks, decltype(&mtmd_input_chunks_free)> chunks(mtmd_input_chunks_init(), mtmd_input_chunks_free);
        const mtmd_bitmap * input[] = {bitmap.get()};
        if (mtmd_tokenize(vision.get(), chunks.get(), &text, input, 1) != 0) throw std::runtime_error("Vision model tokenizer or image preprocessing failed");
        size_t tokenCount = mtmd_helper_get_n_tokens(chunks.get());
        size_t visionTokens = 0;
        for (size_t i = 0; i < mtmd_input_chunks_size(chunks.get()); ++i) {
            const auto chunk = mtmd_input_chunks_get(chunks.get(), i);
            if (mtmd_input_chunk_get_type(chunk) == MTMD_INPUT_CHUNK_TYPE_IMAGE) visionTokens += mtmd_input_chunk_get_n_tokens(chunk);
        }
        if (visionTokens > 1024 || maxTokens < 1 || tokenCount + maxTokens > llama_n_ctx(context))
            throw std::runtime_error("Image/text plus output exceeds 12800-token context or 1024 visual-token limit");
        llama_memory_clear(llama_get_memory(context), true);
        llama_pos past = 0;
        if (mtmd_helper_eval_chunks(vision.get(), context, chunks.get(), 0, 0, 256, true, &past) != 0 || cancelled)
            throw std::runtime_error("Image encoding failed or cancelled; check memory and matching projector");
        // Image embeddings are now in the language context. Release vision weights before text decoding.
        chunks.reset(); bitmap.reset(); vision.reset(); pixels.clear(); pixels.shrink_to_fit();
        return generateResult(env, tokenCount, maxTokens, temperature, started, visionTokens);
    } catch (const std::exception & error) {
        if (context) llama_memory_clear(llama_get_memory(context), true);
        fail(env, error); return nullptr;
    }
}
