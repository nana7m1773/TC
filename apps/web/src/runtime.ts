import { Capacitor, registerPlugin } from "@capacitor/core";

export type ApiConfig = {
  id: string;
  name: string;
  protocol: "openai";
  baseUrl: string;
  modelId: string;
  contextSize: number;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  stream: boolean;
  headers: Record<string, string>;
  extra: Record<string, unknown>;
  capabilities: { text: boolean; image: boolean; audio: boolean };
};
export type NativeResult = Record<string, unknown>;
export interface NativeBridge {
  loadState(): Promise<{ state: string | null }>;
  saveState(args: { state: string }): Promise<unknown>;
  saveApiKey(args: { id: string; key: string }): Promise<unknown>;
  hasApiKey(args: { id: string }): Promise<{ present: boolean }>;
  deleteApiKey(args: { id: string }): Promise<unknown>;
  request(args: {
    config: ApiConfig;
    messages?: unknown[];
    operation?: string;
    allowExternalData: boolean;
    image?: unknown;
    audio?: unknown;
  }): Promise<NativeResult>;
  listModels(): Promise<NativeResult>;
  modelStatus(): Promise<NativeResult>;
  installDefault(): Promise<NativeResult>;
  importModel(): Promise<NativeResult>;
  loadModel(args: {
    modelPath?: string;
    contextSize: number;
  }): Promise<NativeResult>;
  stop(): Promise<NativeResult>;
  deleteModel(args: { modelPath?: string }): Promise<NativeResult>;
  infer(args: {
    modelPath?: string;
    prompt: string;
    contextSize: number;
    maxTokens: number;
    temperature: number;
  }): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    tokensPerSecond: number;
    contextSize: number;
  }>;
  tokenize(args: {
    modelPath?: string;
    text: string;
  }): Promise<{ count: number }>;
  deviceInfo(): Promise<NativeResult>;
  onPause?(callback: () => void): () => void;
  installVision?(): Promise<NativeResult>;
  analyzeImage?(args: {
    image: { data: string; name?: string };
    prompt: string;
    contextSize: number;
    maxTokens: number;
    temperature: number;
  }): Promise<NativeResult>;
  installSpeech?(): Promise<NativeResult>;
  transcribeLocal?(args: {
    audio: { data: string; base64?: string; mime?: string; name: string };
  }): Promise<NativeResult>;
  setAutostart?(args: { enabled: boolean }): Promise<{ enabled: boolean }>;
  getAutostart?(): Promise<{ enabled: boolean }>;
  listSocialWindows?(): Promise<NativeResult>;
  readSocialWindow?(args: {selection:string;consent:boolean;expectedTitle:string}): Promise<NativeResult>;
  captureSocialWindow?(args: {selection:string;consent:boolean;expectedTitle:string}): Promise<NativeResult>;
  prepareSocialReply?(args: {selection:string;consent:boolean;expectedTitle:string;text:string;expectedSnapshot:string}): Promise<NativeResult>;
  commitSocialReply?(args: {ticket:string;consent:boolean}): Promise<NativeResult>;
  clearCache?(): Promise<NativeResult>;
  exportFile?(args: {
    data: string;
    filename: string;
    mimeType: "application/json";
  }): Promise<{ saved: boolean }>;
}
declare global {
  interface Window {
    assistant?: NativeBridge;
  }
}
const androidPlugin = registerPlugin<
  NativeBridge & {
    addListener(
      name: string,
      callback: () => void,
    ): Promise<{ remove(): Promise<void> }>;
  }
>("NativeAssistant");
const android = new Proxy(androidPlugin, {
  get(target, property, receiver) {
    if (property === "onPause")
      return (callback: () => void) => {
        const listener = target.addListener("appSuspended", callback);
        return () => {
          void listener.then((handle) => handle.remove()).catch(() => {});
        };
      };
    return Reflect.get(target, property, receiver);
  },
});
export const runtime: NativeBridge | undefined = Capacitor.isNativePlatform()
  ? android
  : window.assistant;
export const runtimeTarget = Capacitor.isNativePlatform()
  ? "android"
  : runtime
    ? "desktop"
    : "browser";
export const runtimeName = Capacitor.isNativePlatform()
  ? "Android 原生应用"
  : runtime
    ? "桌面原生应用"
    : "浏览器演示 · 仅内存保存";
export function requireRuntime() {
  if (!runtime)
    throw new Error(
      "请在 Android 或 Windows 原生应用中使用模型和 API。浏览器演示只验证界面与规则，不会伪装模型推理。",
    );
  return runtime;
}

// Protected exports never contain API keys. WebCrypto works offline on the device.
export async function encryptExport(
  state: unknown,
  password: string,
): Promise<string> {
  if (password.length < 12) throw new Error("导出口令至少需要 12 个字符。");
  const plain = new TextEncoder().encode(JSON.stringify(state));
  if (plain.byteLength > 16 * 1024 * 1024)
    throw new Error("配置超过16 MiB，请先清理历史或缩小示例后再导出。");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await exportKey(password, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plain,
  );
  return JSON.stringify({
    format: "tc-protected-config",
    version: 1,
    salt: b64(salt),
    iv: b64(iv),
    data: b64(new Uint8Array(cipher)),
  });
}
export async function decryptExport(
  content: string,
  password: string,
): Promise<unknown> {
  if (content.length > 32 * 1024 * 1024)
    throw new Error("加密配置超过32 MiB，未修改现有数据。");
  const e = JSON.parse(content);
  if (e.format !== "tc-protected-config" || e.version !== 1)
    throw new Error("文件格式不受支持。");
  const salt = unb64(e.salt),
    iv = unb64(e.iv),
    data = unb64(e.data);
  if (salt.length !== 16 || iv.length !== 12) throw new Error("文件损坏。");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await exportKey(password, salt),
      data,
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error("口令不正确，或文件已经损坏。");
  }
}
async function exportKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations: 310000, salt },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
function b64(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (x) => String.fromCharCode(x)).join(""));
}
function unb64(str: string) {
  if (typeof str !== "string") throw new Error("文件损坏。");
  return Uint8Array.from(atob(str), (x) => x.charCodeAt(0));
}
