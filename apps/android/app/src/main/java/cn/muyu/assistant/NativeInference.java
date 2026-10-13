package cn.muyu.assistant;

final class NativeInference {
    static { System.loadLibrary("muyu-inference"); }
    static native void load(String path, int contextSize, int threads);
    static native String infer(String prompt, int maxTokens, float temperature);
    static native int tokenize(String text);
    static native String analyzeImage(String projector, byte[] rgb, int width, int height, String prompt, int maxTokens, float temperature);
    static native void cancel();
    static native void unload();
}
