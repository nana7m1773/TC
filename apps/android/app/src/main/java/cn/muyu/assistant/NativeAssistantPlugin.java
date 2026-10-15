package cn.muyu.assistant;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.StatFs;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "NativeAssistant")
public class NativeAssistantPlugin extends Plugin {
    private final ExecutorService serial = Executors.newSingleThreadExecutor();
    private final ExecutorService storage = Executors.newSingleThreadExecutor();
    private final ExecutorService network = Executors.newFixedThreadPool(2);
    private final ScheduledExecutorService safetyMonitor = Executors.newSingleThreadScheduledExecutor();
    private final AtomicInteger taskGeneration = new AtomicInteger();
    private final Set<HttpURLConnection> activeRequests = Collections.newSetFromMap(new ConcurrentHashMap<HttpURLConnection, Boolean>());
    private volatile boolean cancelled = false;
    private volatile boolean busy = false;
    private volatile String loadedPath = null;
    private volatile String modelStage = "未加载";
    private volatile int effectiveContext = 12800;
    private volatile boolean stateReadable = true;
    private final AtomicBoolean exportInFlight = new AtomicBoolean(false);
    private volatile byte[] pendingExportBytes;
    private volatile String pendingExportFilename;
    private static final long MAX_MODEL_BYTES = 5L * 1024 * 1024 * 1024;

    interface Work { JSObject run() throws Exception; }
    private void run(PluginCall call, ExecutorService executor, Work work) {
        executor.execute(() -> {
            try { call.resolve(work.run()); }
            catch (Throwable e) {
                String message = e.getMessage();
                if (e instanceof OutOfMemoryError) {
                    NativeInference.cancel(); LocalSpeech.cancel();
                    serial.execute(() -> { NativeInference.unload(); loadedPath = null; busy = false; modelStage = "内存不足，已停止"; });
                    message = "可用内存不足，本地任务已停止；请关闭其他应用或降低实际上下文后重试。12800 tokens 验收仍需按原配置测试。";
                }
                if (message != null) {
                    if (message.contains("cancelled")) message = "本地任务已停止";
                    else if (message.contains("GGUF loading failed")) message = "模型加载失败：架构不兼容、文件损坏或可用内存不足";
                    else if (message.contains("Vision projector")) message = "视觉组件与当前模型不匹配，或可用内存不足";
                    else if (message.contains("exceeds") && message.contains("context")) message = "输入与预留输出超过当前完整上下文预算，请减少历史或附件";
                    else if (message.contains("No local") || message.contains("Please load")) message = "请先安装并加载本地模型";
                    else if (message.contains("chat template")) message = "模型聊天模板不兼容，请选择具有有效模板的 GGUF 聊天模型";
                }
                call.reject(message == null ? "原生操作失败：" + e.getClass().getSimpleName() : message);
            }
        });
    }
    private JSObject result(JSONObject source) throws Exception { return new JSObject(source.toString()); }
    private File dataDir() { return getContext().getFilesDir(); }
    private File modelsDir() { File f = new File(dataDir(), "models"); f.mkdirs(); return f; }
    private JSONObject defaultManifest() throws Exception {
        try (InputStream in = getContext().getAssets().open("default-model.json")) {
            return new JSONObject(new String(readLimited(in, 65536), StandardCharsets.UTF_8));
        }
    }
    private JSONObject speechManifest() throws Exception {
        try (InputStream in = getContext().getAssets().open("local-speech.json")) {
            return new JSONObject(new String(readLimited(in, 65536), StandardCharsets.UTF_8));
        }
    }
    private File componentFile(JSONObject manifest) throws Exception {
        String filename = manifest.getString("filename");
        if (!filename.matches("[a-zA-Z0-9._-]+")) throw new IOException("组件文件名无效");
        File folder = new File(modelsDir(), "components"); folder.mkdirs(); return new File(folder, filename);
    }
    private boolean componentInstalled(JSONObject manifest) throws Exception {
        File file = componentFile(manifest); File record = new File(file.getPath() + ".json");
        if (!file.isFile() || file.length() != manifest.getLong("sizeBytes") || !record.exists()) return false;
        JSONObject actual = new JSONObject(new String(readLimited(new FileInputStream(record), 65536), StandardCharsets.UTF_8));
        return actual.optBoolean("verified") && actual.optString("sha256").equalsIgnoreCase(manifest.getString("sha256"));
    }
    private String hex(byte[] value) {
        StringBuilder out = new StringBuilder();
        for (byte b : value) out.append(String.format(Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    private String hashId(String id) throws Exception {
        if (blank(id)) throw new IOException("配置 ID 不能为空");
        return hex(MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8)));
    }
    private static boolean blank(String value) {
        if (value == null) return true;
        for (int i = 0; i < value.length(); i++) if (!Character.isWhitespace(value.charAt(i))) return false;
        return true;
    }
    private SecretKey storageKey() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        String alias = "muyu_local_storage_v1";
        if (keys.containsAlias(alias)) return (SecretKey)keys.getKey(alias, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    private synchronized void encrypt(File target, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, storageKey());
        byte[] iv = cipher.getIV();
        File temporary = new File(target.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temporary)) {
            out.write(iv.length); out.write(iv); out.write(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)));
            out.getFD().sync();
        }
        if (!temporary.renameTo(target)) throw new IOException("无法提交加密数据");
    }
    private synchronized String decrypt(File target) throws Exception {
        if (!target.exists()) return null;
        byte[] payload = readLimited(new FileInputStream(target), 32 * 1024 * 1024);
        if (payload.length < 29 || (payload[0] & 255) != 12) throw new IOException("加密数据损坏");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, storageKey(), new GCMParameterSpec(128, Arrays.copyOfRange(payload, 1, 13)));
        return new String(cipher.doFinal(Arrays.copyOfRange(payload, 13, payload.length)), StandardCharsets.UTF_8);
    }
    private byte[] readLimited(InputStream input, int limit) throws Exception {
        if (input == null) return new byte[0];
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = in.read(buffer)) >= 0) {
                if (out.size() + n > limit) throw new IOException("响应或数据体积超出安全上限");
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }
    @PluginMethod public void getSocialStatus(PluginCall call) {
        run(call, storage, () -> SocialNotificationService.status(getContext()));
    }
    @PluginMethod public void requestSocialAccess(PluginCall call) {
        // Only an explicit UI action invokes this method. Android, rather than this app, grants access.
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(SocialNotificationService.accessSettings(getContext()));
                call.resolve(new JSObject().put("opened", true).put("notificationAccess", SocialNotificationService.hasAccess(getContext())));
            } catch (Exception e) { call.reject("无法打开系统通知使用权设置，请在系统设置中为 L-BOT 开启通知使用权"); }
        });
    }
    @PluginMethod public void openSocialApp(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String platform = call.getString("platform");
                Intent intent = SocialNotificationService.launchIntent(getContext(), platform);
                getActivity().startActivity(intent);
                call.resolve(new JSObject().put("opened", true).put("platform", platform).put("packageName", intent.getComponent() == null ? intent.getPackage() : intent.getComponent().getPackageName()));
            } catch (Exception e) { call.reject(e.getMessage() == null ? "无法打开官方社交应用" : e.getMessage()); }
        });
    }
    @PluginMethod public void getSocialNotifications(PluginCall call) {
        int limit = Math.max(1, Math.min(100, call.getInt("limit", 50)));
        run(call, storage, () -> SocialNotificationService.notifications(getContext(), limit));
    }
    @PluginMethod public void replySocialNotification(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { call.resolve(SocialNotificationService.reply(getContext(), call.getString("eventId"), call.getString("text"), Boolean.TRUE.equals(call.getBoolean("consent")))); }
            catch (Exception e) { call.reject(e.getMessage() == null ? "系统通知回复失败，请打开官方应用确认" : e.getMessage()); }
        });
    }
    @PluginMethod public void loadState(PluginCall call) {
        run(call, storage, () -> {
            try {
                String state = decrypt(new File(dataDir(), "state.enc")); stateReadable = true;
                return new JSObject().put("state", state == null ? JSONObject.NULL : state);
            } catch (Exception e) { stateReadable = false; throw e; }
        });
    }
    @PluginMethod public void saveState(PluginCall call) {
        run(call, storage, () -> {
            if (!stateReadable) throw new IOException("原有加密数据无法读取，为避免覆盖已暂停保存；请先恢复或在系统设置中明确清除应用数据");
            String state = call.getString("state");
            if (state == null || state.getBytes(StandardCharsets.UTF_8).length > 16 * 1024 * 1024) throw new IOException("状态数据无效或超过 16MiB，请先导出或清理旧历史");
            encrypt(new File(dataDir(), "state.enc"), state); return new JSObject().put("saved", true);
        });
    }
    @PluginMethod public void saveApiKey(PluginCall call) {
        run(call, storage, () -> {
            String key = call.getString("key"); if (key == null || key.length() > 16384) throw new IOException("API Key 无效或长度超过限制");
            encrypt(new File(dataDir(), "key-" + hashId(call.getString("id")) + ".enc"), key);
            return new JSObject().put("saved", true);
        });
    }
    @PluginMethod public void hasApiKey(PluginCall call) {
        run(call, storage, () -> new JSObject().put("present", new File(dataDir(), "key-" + hashId(call.getString("id")) + ".enc").exists()));
    }
    @PluginMethod public void deleteApiKey(PluginCall call) {
        run(call, storage, () -> {
            File file = new File(dataDir(), "key-" + hashId(call.getString("id")) + ".enc");
            if (file.exists() && !file.delete()) throw new IOException("删除 API Key 失败");
            return new JSObject().put("deleted", true);
        });
    }
    @PluginMethod public void exportFile(PluginCall call) {
        if (!exportInFlight.compareAndSet(false, true)) { call.reject("已有配置导出正在进行"); return; }
        storage.execute(() -> {
            try {
                String filename = call.getString("filename");
                String mime = call.getString("mimeType");
                String data = call.getString("data");
                if (!"application/json".equals(mime)) throw new IOException("配置导出只支持 application/json");
                if (filename == null || filename.length() > 120 || !filename.matches("[\\p{L}\\p{N} _.-]+\\.(tcconfig|json)")
                        || filename.startsWith(".") || filename.contains("..")) throw new IOException("导出文件名无效，请使用不含路径的 .tcconfig 或 .json 文件名");
                if (data == null || data.length() > 32 * 1024 * 1024) throw new IOException("导出文件超过 32MiB");
                byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 32 * 1024 * 1024) throw new IOException("导出文件超过 32MiB");
                JSONObject envelope = new JSONObject(data);
                if (envelope.length() != 5 || !"tc-protected-config".equals(envelope.optString("format")) || envelope.optInt("version") != 1
                        || Base64.decode(envelope.getString("salt"), Base64.DEFAULT).length != 16
                        || Base64.decode(envelope.getString("iv"), Base64.DEFAULT).length != 12
                        || Base64.decode(envelope.getString("data"), Base64.DEFAULT).length < 16)
                    throw new IOException("只能导出有效的加密配置封装；不接受明文聊天或密钥");
                pendingExportBytes = bytes; pendingExportFilename = filename;
                // Android may save pending activity calls in a Bundle. Keep large ciphertext out of that Binder payload.
                call.getData().remove("data");
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("application/json"); intent.putExtra(Intent.EXTRA_TITLE, filename);
                getActivity().runOnUiThread(() -> {
                    try { startActivityForResult(call, intent, "exportPicked"); }
                    catch (Exception e) { clearPendingExport(); call.reject("无法打开系统文件保存窗口"); }
                });
            } catch (Exception e) { clearPendingExport(); call.reject(e.getMessage() == null ? "加密配置导出失败" : e.getMessage()); }
        });
    }
    private void clearPendingExport() { pendingExportBytes = null; pendingExportFilename = null; exportInFlight.set(false); }
    @ActivityCallback private void exportPicked(PluginCall call, ActivityResult result) {
        if (call == null) { clearPendingExport(); return; }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            clearPendingExport(); call.resolve(new JSObject().put("saved", false)); return;
        }
        Uri uri = result.getData().getData();
        byte[] bytes = pendingExportBytes; String filename = pendingExportFilename;
        storage.execute(() -> {
            try {
                if (uri == null || !"content".equals(uri.getScheme()) || bytes == null) throw new IOException("导出内容已失效，请重新导出并选择保存位置");
                try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (out == null) throw new IOException("无法写入所选保存位置");
                    out.write(bytes); out.flush();
                }
                call.resolve(new JSObject().put("saved", true).put("filename", filename));
            } catch (Exception e) { call.reject(e.getMessage() == null ? "写入加密配置失败" : e.getMessage()); }
            finally { clearPendingExport(); }
        });
    }
    private long deleteTemporaryFiles(File directory, boolean partialOnly) throws Exception {
        long bytes = 0; File[] files = directory.listFiles(); if (files == null) return 0;
        for (File file : files) {
            if (file.isDirectory()) bytes += deleteTemporaryFiles(file, partialOnly);
            else if (!partialOnly || file.getName().endsWith(".part")) {
                long size = file.length(); if (!file.delete()) throw new IOException("临时文件清理失败"); bytes += size;
            }
        }
        return bytes;
    }
    @PluginMethod public void clearCache(PluginCall call) {
        cancelled = true; taskGeneration.incrementAndGet();
        NativeInference.cancel(); LocalSpeech.cancel();
        for (HttpURLConnection request : activeRequests) request.disconnect();
        run(call, serial, () -> {
            NativeInference.unload(); loadedPath = null; modelStage = "已停止";
            long bytes = deleteTemporaryFiles(getContext().getCacheDir(), false) + deleteTemporaryFiles(modelsDir(), true);
            getActivity().runOnUiThread(() -> bridge.getWebView().clearCache(true));
            return new JSObject().put("deletedBytes", bytes).put("installedModelsPreserved", true).put("encryptedDataPreserved", true);
        });
    }
    private ActivityManager.MemoryInfo memory() {
        ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
        ((ActivityManager)getContext().getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(info); return info;
    }
    private Intent battery() { return getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED)); }
    @PluginMethod public void deviceInfo(PluginCall call) {
        run(call, network, () -> {
            ActivityManager.MemoryInfo info = memory(); Intent battery = battery();
            android.os.Debug.MemoryInfo process = new android.os.Debug.MemoryInfo(); android.os.Debug.getMemoryInfo(process);
            JSObject out = new JSObject();
            out.put("platform", "android"); out.put("manufacturer", Build.MANUFACTURER); out.put("model", Build.MODEL);
            out.put("androidVersion", Build.VERSION.RELEASE); out.put("apiLevel", Build.VERSION.SDK_INT);
            out.put("processor", Build.VERSION.SDK_INT >= 31 ? Build.SOC_MANUFACTURER + " " + Build.SOC_MODEL : Build.HARDWARE);
            out.put("totalMemoryBytes", info.totalMem); out.put("availableMemoryBytes", info.availMem); out.put("lowMemory", info.lowMemory);
            out.put("processPssBytes", process.getTotalPss() * 1024L); out.put("availableStorageBytes", new StatFs(dataDir().getPath()).getAvailableBytes());
            if (battery != null) {
                out.put("batteryTemperatureC", battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0);
                out.put("batteryPercent", 100.0 * battery.getIntExtra(BatteryManager.EXTRA_LEVEL, 0) / Math.max(1,battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100)));
                out.put("charging", battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0);
            }
            PowerManager power = (PowerManager)getContext().getSystemService(Context.POWER_SERVICE);
            out.put("powerSave", power.isPowerSaveMode());
            out.put("thermalStatus", Build.VERSION.SDK_INT >= 29 ? power.getCurrentThermalStatus() : -1);
            out.put("realDeviceAcceptance", "待 8GB 实机验证");
            try { out.put("localVisionInstalled", componentInstalled(defaultManifest().getJSONObject("visionProjector"))); }
            catch (Exception ignored) { out.put("localVisionInstalled", false); }
            try { out.put("localSpeechInstalled", componentInstalled(speechManifest())); }
            catch (Exception ignored) { out.put("localSpeechInstalled", false); }
            return out;
        });
    }
    private void thermalCheck() throws Exception {
        PowerManager power = (PowerManager)getContext().getSystemService(Context.POWER_SERVICE);
        if (Build.VERSION.SDK_INT >= 29 && power.getCurrentThermalStatus() >= PowerManager.THERMAL_STATUS_SEVERE)
            throw new IOException("设备温度过高，已暂停本地推理，请冷却后重试");
        Intent battery = battery();
        if (battery != null && battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) >= 450)
            throw new IOException("电池温度达到 45℃，已暂停本地推理");
        if (memory().lowMemory) throw new IOException("系统可用内存不足，请关闭其他应用后重试");
    }
    private ScheduledFuture<?> monitorSafety(AtomicReference<String> reason, int generation) {
        return safetyMonitor.scheduleAtFixedRate(() -> {
            try {
                if (generation != taskGeneration.get()) throw new IOException("旧任务已取消");
                thermalCheck();
            }
            catch (Exception e) {
                reason.set(e.getMessage());
                NativeInference.cancel(); LocalSpeech.cancel();
            }
        }, 2, 2, TimeUnit.SECONDS);
    }
    private File modelFile(String path) throws Exception {
        File f = blank(path) ? new File(modelsDir(), defaultManifest().getString("filename")) : new File(path);
        if (!f.getCanonicalPath().startsWith(modelsDir().getCanonicalPath() + File.separator)) throw new IOException("只允许访问应用模型目录中的 GGUF 文件");
        if (!f.isFile() || !f.getName().toLowerCase(Locale.ROOT).endsWith(".gguf")) throw new IOException("请先下载或导入 GGUF 模型");
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] magic = new byte[4]; if (in.read(magic) != 4 || !Arrays.equals(magic, new byte[]{'G','G','U','F'}))
                throw new IOException("文件不是 GGUF；此版本仅支持 llama.cpp b11429 可加载的 GGUF 架构");
        }
        return f;
    }
    private JSObject status() {
        JSObject out = new JSObject(); out.put("loaded", loadedPath != null); out.put("running", busy); out.put("stage", modelStage);
        out.put("modelPath", loadedPath); out.put("contextSize", effectiveContext); out.put("backend", "CPU"); out.put("kvCache", "f16");
        try { out.put("localVisionInstalled", componentInstalled(defaultManifest().getJSONObject("visionProjector"))); }
        catch (Exception ignored) { out.put("localVisionInstalled", false); }
        try { out.put("localSpeechInstalled", componentInstalled(speechManifest())); }
        catch (Exception ignored) { out.put("localSpeechInstalled", false); }
        out.put("engineVersion", "llama.cpp b11429");
        out.put("localVisionSupported", true); out.put("localSpeechSupported", true);
        try { out.put("defaultModel", defaultManifest()); }
        catch (Exception ignored) { out.put("defaultModel", JSONObject.NULL); out.put("defaultModelError", "Android 默认模型元数据不可用"); }
        return out;
    }
    @PluginMethod public void modelStatus(PluginCall call) { call.resolve(status()); }
    @PluginMethod public void listModels(PluginCall call) {
        run(call, network, () -> {
            JSArray models = new JSArray(); File[] files = modelsDir().listFiles();
            if (files != null) for (File f : files) {
                if (!f.getName().endsWith(".gguf")) continue;
                File metadata = new File(f.getPath() + ".json");
                JSObject entry = metadata.exists() ? new JSObject(new String(readLimited(new FileInputStream(metadata), 65536), StandardCharsets.UTF_8)) : new JSObject();
                entry.put("path", f.getAbsolutePath()); entry.put("modelPath", f.getAbsolutePath()); entry.put("filename", f.getName()); entry.put("sizeBytes", f.length());
                entry.put("loaded", f.getAbsolutePath().equals(loadedPath)); entry.put("contextSize", effectiveContext); models.put(entry);
            }
            return new JSObject().put("models", models);
        });
    }
    private void ensureLoaded(String path, int contextSize) throws Exception {
        // An omitted path means the owner's currently loaded model, even when the default model is absent.
        File model = modelFile(blank(path) ? loadedPath : path); thermalCheck();
        if (loadedPath != null && loadedPath.equals(model.getAbsolutePath()) && effectiveContext == contextSize) return;
        if (contextSize < 512 || contextSize > 32768) throw new IOException("有效上下文范围为 512–32768；默认模型验收值为 12800");
        long required = model.length() + 1400L * 1024 * 1024;
        if (memory().availMem < required) throw new IOException("可用内存不足：模型与上下文建议至少预留 " + (required / 1024 / 1024) + " MiB；当前 " + memory().availMem / 1024 / 1024 + " MiB");
        loadedPath = null; modelStage = "正在加载";
        try {
            boolean customModel = true;
            try { customModel = !model.getCanonicalFile().equals(new File(modelsDir(), defaultManifest().getString("filename")).getCanonicalFile()); }
            catch (Exception ignored) { /* An explicitly imported GGUF needs no default manifest. */ }
            NativeInference.load(model.getAbsolutePath(), contextSize, Math.min(4, Runtime.getRuntime().availableProcessors()), customModel);
            int actualContext = NativeInference.contextSize();
            if (actualContext < 512) { NativeInference.unload(); throw new IOException("模型未返回有效的实际上下文"); }
            loadedPath = model.getAbsolutePath(); effectiveContext = actualContext; modelStage = "已加载";
        } catch (Throwable e) { modelStage = "加载失败"; throw e; }
    }
    private int requestedContext(PluginCall call) {
        String path = call.getString("modelPath");
        boolean current = loadedPath != null && (blank(path) || loadedPath.equals(path));
        return call.getInt("contextSize", current ? effectiveContext : 12800);
    }
    @PluginMethod public void loadModel(PluginCall call) {
        int generation = taskGeneration.get();
        run(call, serial, () -> {
            if (generation != taskGeneration.get()) throw new IOException("已取消旧加载任务");
            ensureLoaded(call.getString("modelPath"), requestedContext(call));
            if (generation != taskGeneration.get()) { NativeInference.unload(); loadedPath = null; throw new IOException("加载已停止"); }
            return status();
        });
    }
    @PluginMethod public void tokenize(PluginCall call) {
        run(call, serial, () -> {
            ensureLoaded(call.getString("modelPath"), requestedContext(call));
            String text = call.getString("text"); if (text == null) throw new IOException("缺少待计数文本");
            return new JSObject().put("count", NativeInference.tokenize(text)).put("exact", true).put("contextSize", effectiveContext);
        });
    }
    @PluginMethod public void infer(PluginCall call) {
        int generation = taskGeneration.get();
        run(call, serial, () -> {
            if (generation != taskGeneration.get()) throw new IOException("已取消旧推理任务");
            if (busy) throw new IOException("已有本地任务正在运行");
            ensureLoaded(call.getString("modelPath"), requestedContext(call)); thermalCheck();
            if (generation != taskGeneration.get()) throw new IOException("推理已停止");
            String prompt = call.getString("prompt"); if (prompt == null) throw new IOException("缺少提示词");
            busy = true; modelStage = "正在推理";
            String[] safetyReason = new String[1];
            ScheduledFuture<?> monitor = safetyMonitor.scheduleAtFixedRate(() -> {
                try { if (generation != taskGeneration.get()) throw new IOException("旧任务已取消"); thermalCheck(); }
                catch (Exception e) { safetyReason[0] = e.getMessage(); NativeInference.cancel(); }
            }, 2, 2, TimeUnit.SECONDS);
            try {
                JSObject response = new JSObject(NativeInference.infer(prompt, call.getInt("maxTokens", 512), call.getFloat("temperature", 0.6f)));
                if (generation != taskGeneration.get()) throw new IOException("旧任务已取消");
                return response;
            }
            catch (Exception e) { if (safetyReason[0] != null) throw new IOException(safetyReason[0]); throw e; }
            finally { monitor.cancel(false); busy = false; modelStage = loadedPath == null ? "未加载" : "已加载"; }
        });
    }
    @PluginMethod public void stop(PluginCall call) {
        taskGeneration.incrementAndGet();
        cancelled = true;
        for (HttpURLConnection request : activeRequests) request.disconnect();
        try { NativeInference.cancel(); } catch (Throwable ignored) {}
        try { LocalSpeech.cancel(); } catch (Throwable ignored) {}
        run(call, serial, () -> { NativeInference.unload(); loadedPath = null; busy = false; modelStage = "已停止"; return status(); });
    }
    @PluginMethod public void deleteModel(PluginCall call) {
        run(call, serial, () -> {
            File f = modelFile(call.getString("modelPath", call.getString("path")));
            if (f.getAbsolutePath().equals(loadedPath)) { NativeInference.unload(); loadedPath = null; modelStage = "未加载"; }
            if (!f.delete()) throw new IOException("删除模型失败");
            new File(f.getPath() + ".json").delete(); return new JSObject().put("deleted", true);
        });
    }
    @PluginMethod public void importModel(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT); intent.setType("*/*"); intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(call, intent, "modelPicked");
    }
    @ActivityCallback private void modelPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.reject("已取消模型导入"); return; }
        Uri uri = result.getData().getData();
        run(call, serial, () -> {
            if (uri == null) throw new IOException("没有选中文件");
            String name = "imported-model.gguf";
            try (android.database.Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
            }
            if (name == null || !name.toLowerCase(Locale.ROOT).endsWith(".gguf")) throw new IOException("只允许导入 GGUF 格式模型");
            name = name.replaceAll("[^\\p{L}\\p{N}._-]", "_");
            File target = new File(modelsDir(), name); if (target.exists()) throw new IOException("同名模型已存在，请先删除或重命名文件");
            File temporary = new File(target.getPath() + ".part");
            MessageDigest digest = MessageDigest.getInstance("SHA-256"); long total = 0;
            try (InputStream in = getContext().getContentResolver().openInputStream(uri); FileOutputStream out = new FileOutputStream(temporary)) {
                if (in == null) throw new IOException("无法读取所选文件");
                byte[] buffer = new byte[1024 * 1024]; int n;
                while ((n = in.read(buffer)) >= 0) {
                    total += n; if (total > MAX_MODEL_BYTES) throw new IOException("文件超过 5GB；请选择约 2B–4B 的量化 GGUF");
                    if (new StatFs(dataDir().getPath()).getAvailableBytes() < n + 256L * 1024 * 1024) throw new IOException("存储空间不足，保留至少 256MiB");
                    digest.update(buffer, 0, n); out.write(buffer, 0, n);
                }
                out.getFD().sync();
            } catch (Throwable e) { temporary.delete(); throw e; }
            if (!temporary.renameTo(target)) throw new IOException("保存导入模型失败");
            try { modelFile(target.getAbsolutePath()); }
            catch (Throwable e) { target.delete(); throw e; }
            JSONObject meta = new JSONObject().put("name", name).put("sha256", hex(digest.digest())).put("sizeBytes", total)
                    .put("source", "用户导入").put("verified", false).put("compatibility", "等待 llama.cpp 实际加载验证").put("quantization", "由 GGUF 决定");
            try (FileOutputStream out = new FileOutputStream(target.getPath() + ".json")) { out.write(meta.toString().getBytes(StandardCharsets.UTF_8)); }
            meta.put("modelPath", target.getAbsolutePath()); meta.put("path", target.getAbsolutePath()); return result(meta);
        });
    }
    @PluginMethod public void installDefault(PluginCall call) {
        int generation = taskGeneration.get();
        run(call, serial, () -> {
            if (generation != taskGeneration.get()) throw new IOException("已取消旧下载任务");
            JSONObject manifest;
            try (InputStream in = getContext().getAssets().open("default-model.json")) { manifest = new JSONObject(new String(readLimited(in, 65536), StandardCharsets.UTF_8)); }
            String expected = manifest.optString("sha256"); long size = manifest.optLong("sizeBytes");
            if (!expected.matches("[a-fA-F0-9]{64}") || size < 1) throw new IOException("默认模型尚缺发布者校验值，暂时不能安全下载；可导入兼容 GGUF");
            URL url = new URL(manifest.getString("url")); if (!url.getProtocol().equals("https")) throw new IOException("模型下载必须使用 HTTPS");
            String name = manifest.getString("filename");
            if (!name.matches("[a-zA-Z0-9._-]+\\.gguf")) throw new IOException("默认模型文件名无效");
            File target = new File(modelsDir(), name); File part = new File(target.getPath() + ".part");
            if (target.exists() && target.length() == size && expected.equalsIgnoreCase(fileHash(target)))
                return new JSObject().put("modelPath", target.getAbsolutePath()).put("path", target.getAbsolutePath()).put("verified", true);
            if (part.length() > size) part.delete();
            if (part.length() == size) {
                if (expected.equalsIgnoreCase(fileHash(part))) {
                    if (!part.renameTo(target)) throw new IOException("已校验模型无法保存");
                    return new JSObject().put("modelPath", target.getAbsolutePath()).put("path", target.getAbsolutePath()).put("verified", true);
                }
                part.delete();
            }
            if (new StatFs(dataDir().getPath()).getAvailableBytes() < Math.max(0, size - part.length()) + 512L * 1024 * 1024)
                throw new IOException("下载需要剩余模型体积加 512MiB 预留空间");
            cancelled = false; modelStage = "正在下载"; long offset = part.length();
            HttpURLConnection connection = (HttpURLConnection)url.openConnection(); connection.setConnectTimeout(30000); connection.setReadTimeout(30000);
            if (offset > 0) connection.setRequestProperty("Range", "bytes=" + offset + "-");
            activeRequests.add(connection);
            try {
                int code = connection.getResponseCode();
                if (code == 200) offset = 0;
                else if (code == 206) {
                    String range = connection.getHeaderField("Content-Range");
                    if (range == null || !range.startsWith("bytes " + offset + "-")) throw new IOException("服务器断点范围不匹配");
                } else throw new IOException("模型下载失败 HTTP " + code);
                long done = offset;
                try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(part, offset > 0)) {
                    byte[] buffer = new byte[1024 * 1024]; int n;
                    while ((n = in.read(buffer)) >= 0) {
                        if (cancelled) throw new IOException("下载已停止，可稍后继续");
                        done += n; if (done > size) throw new IOException("下载体积超过发布者声明，拒绝使用");
                        out.write(buffer, 0, n);
                        notifyListeners("modelDownloadProgress", new JSObject().put("receivedBytes", done).put("totalBytes", size));
                    }
                    out.getFD().sync();
                }
            } finally { activeRequests.remove(connection); connection.disconnect(); modelStage = loadedPath == null ? "未加载" : "已加载"; }
            if (part.length() != size || !expected.equalsIgnoreCase(fileHash(part))) { part.delete(); throw new IOException("SHA-256 或体积校验失败，已删除不可信模型"); }
            if (!part.renameTo(target)) throw new IOException("模型校验成功，但保存失败");
            manifest.put("verified", true).put("source", "发布者 SHA-256 校验");
            try (FileOutputStream out = new FileOutputStream(target.getPath() + ".json")) { out.write(manifest.toString().getBytes(StandardCharsets.UTF_8)); }
            return new JSObject().put("modelPath", target.getAbsolutePath()).put("path", target.getAbsolutePath()).put("verified", true).put("sha256", expected);
        });
    }
    private String fileHash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) { byte[] b = new byte[1024 * 1024]; int n; while ((n = in.read(b)) >= 0) digest.update(b, 0, n); }
        return hex(digest.digest());
    }
    private JSObject installComponent(JSONObject manifest, String kind) throws Exception {
        File file = componentFile(manifest); File part = new File(file.getPath() + ".part");
        String expected = manifest.getString("sha256"); long total = manifest.getLong("sizeBytes");
        if (!expected.matches("[a-fA-F0-9]{64}") || total < 1) throw new IOException("组件缺少发布者 SHA-256，不能安全下载");
        if (file.isFile() && file.length() == total && expected.equalsIgnoreCase(fileHash(file))) {
            manifest.put("verified", true); writeComponentRecord(file, manifest);
            return new JSObject().put("status", "installed").put("path", file.getAbsolutePath()).put("component", manifest);
        }
        if (part.length() > total) part.delete();
        if (part.length() == total && expected.equalsIgnoreCase(fileHash(part))) {
            if (!part.renameTo(file)) throw new IOException("组件保存失败");
            manifest.put("verified", true); writeComponentRecord(file, manifest);
            return new JSObject().put("status", "installed").put("path", file.getAbsolutePath()).put("component", manifest);
        }
        if (part.length() == total) part.delete();
        if (new StatFs(dataDir().getPath()).getAvailableBytes() < total - part.length() + 512L * 1024 * 1024)
            throw new IOException("存储不足：需要组件剩余体积及至少 512MiB 预留空间");
        URL url = new URL(manifest.getString("url"));
        if (!url.getProtocol().equals("https")) throw new IOException("组件下载仅允许 HTTPS");
        HttpURLConnection connection = (HttpURLConnection)url.openConnection();
        connection.setConnectTimeout(30000); connection.setReadTimeout(30000);
        long offset = part.length(); if (offset > 0) connection.setRequestProperty("Range", "bytes=" + offset + "-");
        cancelled = false; activeRequests.add(connection); modelStage = "下载" + kind + "组件";
        try {
            int code = connection.getResponseCode();
            if (code == 200) offset = 0;
            else if (code == 206) {
                String range = connection.getHeaderField("Content-Range");
                if (range == null || !range.startsWith("bytes " + offset + "-")) throw new IOException("断点续传范围不匹配");
            } else throw new IOException("组件下载失败 HTTP " + code + "；保留断点，请检查网络与发布者地址");
            long received = offset;
            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(part, offset > 0)) {
                byte[] buffer = new byte[1024 * 1024]; int n;
                while ((n = in.read(buffer)) >= 0) {
                    if (cancelled) throw new IOException("组件下载已停止，可继续断点下载");
                    received += n; if (received > total) throw new IOException("组件体积超过发布者声明");
                    out.write(buffer, 0, n);
                    notifyListeners("modelDownloadProgress", new JSObject().put("component", kind).put("receivedBytes", received).put("totalBytes", total));
                }
                out.getFD().sync();
            }
        } finally { activeRequests.remove(connection); connection.disconnect(); modelStage = loadedPath == null ? "未加载" : "已加载"; }
        if (part.length() != total || !expected.equalsIgnoreCase(fileHash(part))) { part.delete(); throw new IOException("组件完整性校验失败，已删除不可信文件"); }
        if (!part.renameTo(file)) throw new IOException("组件已校验，但保存失败");
        manifest.put("verified", true); writeComponentRecord(file, manifest);
        return new JSObject().put("status", "installed").put("path", file.getAbsolutePath()).put("component", manifest);
    }
    private void writeComponentRecord(File file, JSONObject manifest) throws Exception {
        try (FileOutputStream out = new FileOutputStream(file.getPath() + ".json")) {
            out.write(manifest.toString().getBytes(StandardCharsets.UTF_8)); out.getFD().sync();
        }
    }
    @PluginMethod public void installVision(PluginCall call) {
        int generation = taskGeneration.get();
        run(call, serial, () -> {
            if (generation != taskGeneration.get()) throw new IOException("已取消旧组件安装任务");
            return installComponent(defaultManifest().getJSONObject("visionProjector"), "视觉");
        });
    }
    @PluginMethod public void installSpeech(PluginCall call) {
        int generation = taskGeneration.get();
        run(call, serial, () -> {
            if (generation != taskGeneration.get()) throw new IOException("已取消旧组件安装任务");
            return installComponent(speechManifest(), "语音");
        });
    }
    @PluginMethod public void analyzeImage(PluginCall call) {
        int generation = taskGeneration.get();
        run(call, serial, () -> {
            if (generation != taskGeneration.get()) throw new IOException("图片分析已取消");
            JSONObject projector = defaultManifest().getJSONObject("visionProjector");
            if (!componentInstalled(projector)) throw new IOException("请先安装匹配的本地视觉组件；图片不会上传");
            ensureLoaded(call.getString("modelPath"), requestedContext(call)); thermalCheck();
            if (memory().availMem < projector.getLong("sizeBytes") + 600L * 1024 * 1024)
                throw new IOException("视觉分析可用内存不足，请关闭其他应用；不会自动调用外部 API");
            JSObject image = call.getObject("image"); if (image == null) throw new IOException("缺少图片");
            String data = image.optString("data", image.optString("base64"));
            if (data.contains(",")) data = data.substring(data.indexOf(',') + 1);
            if (data.length() > 7 * 1024 * 1024) throw new IOException("单张图片应小于 5MiB");
            byte[] compressed = Base64.decode(data, Base64.DEFAULT); if (compressed.length > 5 * 1024 * 1024) throw new IOException("图片超过 5MiB");
            BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(compressed, 0, compressed.length, bounds);
            if (bounds.outWidth < 1 || bounds.outHeight < 1 || (long)bounds.outWidth * bounds.outHeight > 100_000_000)
                throw new IOException("图片格式无效或尺寸过大");
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inPreferredConfig = Bitmap.Config.ARGB_8888;
            options.inSampleSize = 1;
            while (Math.max(bounds.outWidth / options.inSampleSize, bounds.outHeight / options.inSampleSize) > 1280) options.inSampleSize *= 2;
            Bitmap bitmap = BitmapFactory.decodeByteArray(compressed, 0, compressed.length, options);
            if (bitmap == null) throw new IOException("图片解码失败");
            AtomicReference<String> safetyReason = new AtomicReference<>();
            ScheduledFuture<?> monitor = monitorSafety(safetyReason, generation);
            try {
                int width = bitmap.getWidth(), height = bitmap.getHeight();
                if (width > 1280 || height > 1280 || (long)width * height > 4_000_000) throw new IOException("缩放后图片超过限制");
                int[] pixels = new int[width * height]; bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
                byte[] rgb = new byte[pixels.length * 3];
                for (int i = 0; i < pixels.length; i++) {
                    int alpha = pixels[i] >>> 24;
                    rgb[i * 3] = (byte)((((pixels[i] >> 16) & 255) * alpha + 255 * (255 - alpha)) / 255);
                    rgb[i * 3 + 1] = (byte)((((pixels[i] >> 8) & 255) * alpha + 255 * (255 - alpha)) / 255);
                    rgb[i * 3 + 2] = (byte)(((pixels[i] & 255) * alpha + 255 * (255 - alpha)) / 255);
                }
                bitmap.recycle();
                if (generation != taskGeneration.get()) throw new IOException("图片分析已取消");
                busy = true; modelStage = "本地图片分析";
                JSObject response = new JSObject(NativeInference.analyzeImage(componentFile(projector).getAbsolutePath(), rgb, width, height,
                        call.getString("prompt", "请如实描述图片中的可见内容及文字；模糊之处注明不确定，不要编造。"), call.getInt("maxTokens", 256), call.getFloat("temperature", 0.2f)));
                if (generation != taskGeneration.get()) throw new IOException("旧图片分析已取消");
                response.put("processingLocation", "本机"); response.put("width", width); response.put("height", height);
                response.put("visionWeightsReleased", true); return response;
            } catch (Exception e) { if (safetyReason.get() != null) throw new IOException(safetyReason.get()); throw e; }
            finally { monitor.cancel(false); if (!bitmap.isRecycled()) bitmap.recycle(); busy = false; modelStage = loadedPath == null ? "未加载" : "已加载"; }
        });
    }
    @PluginMethod public void transcribeLocal(PluginCall call) {
        int generation = taskGeneration.get();
        run(call, serial, () -> {
            if (generation != taskGeneration.get()) throw new IOException("本地转写已取消");
            JSONObject manifest = speechManifest();
            if (!componentInstalled(manifest)) throw new IOException("请先安装本地中文/英文语音组件；音频不会上传");
            NativeInference.unload(); loadedPath = null; thermalCheck();
            if (memory().availMem < 600L * 1024 * 1024) throw new IOException("语音转写需至少 600MiB 可用内存，请关闭其他应用");
            JSObject audio = call.getObject("audio"); if (audio == null) throw new IOException("缺少音频");
            String data = audio.optString("data", audio.optString("base64"));
            if (!data.startsWith("data:")) data = "data:" + audio.optString("mime", audio.optString("mimeType", "audio/webm")) + ";base64," + data;
            busy = true; modelStage = "本地语音转写";
            AtomicReference<String> safetyReason = new AtomicReference<>();
            ScheduledFuture<?> monitor = monitorSafety(safetyReason, generation);
            try {
                JSObject response = result(LocalSpeech.transcribe(getContext(), componentFile(manifest), data, audio.optString("name", "recording.webm"), call.getString("language", "auto")));
                if (generation != taskGeneration.get()) throw new IOException("旧语音转写已取消");
                response.put("processingLocation", "本机"); response.put("speechWeightsReleased", true); return response;
            } catch (Exception e) { if (safetyReason.get() != null) throw new IOException(safetyReason.get()); throw e; }
            finally { monitor.cancel(false); busy = false; modelStage = "未加载"; }
        });
    }
    private URL apiUrl(JSONObject config, String path) throws Exception {
        String base = config.optString("baseUrl", config.optString("baseURL"));
        if (blank(base)) throw new IOException("请填写 Base URL，例如 https://服务地址/v1");
        URL url = new URL(base.replaceAll("/+$", "") + path);
        if (url.getUserInfo() != null) throw new IOException("URL 不应包含鉴权信息，请使用安全密钥设置");
        if (!url.getProtocol().equals("https")) {
            if (!url.getProtocol().equals("http")) throw new IOException("API 地址只支持 HTTP 或 HTTPS");
            InetAddress address = InetAddress.getByName(url.getHost());
            if (!address.isLoopbackAddress() && !address.isSiteLocalAddress()) throw new IOException("公网 API 必须使用 HTTPS；HTTP 仅允许本机或局域网");
        }
        return url;
    }
    @PluginMethod public void request(PluginCall call) {
        run(call, network, () -> {
            if (!call.getBoolean("allowExternalData", false)) throw new IOException("尚未授权向此 API 发送数据；完全本地模式不会调用外部服务");
            JSObject config = call.getObject("config"); if (config == null) throw new IOException("缺少 API 配置");
            String operation = call.getString("operation", "infer");
            String path = operation.equals("models") ? "/models" : operation.equals("transcribe") ? "/audio/transcriptions" : "/chat/completions";
            HttpURLConnection connection = (HttpURLConnection)apiUrl(config, path).openConnection();
            connection.setInstanceFollowRedirects(false);
            int timeout = Math.max(1000, Math.min(120000, config.optInt("timeoutMs", config.optInt("timeout", 60) * 1000)));
            connection.setConnectTimeout(timeout); connection.setReadTimeout(timeout);
            String key = config.optString("apiKey", "");
            if (key.isEmpty() && !config.optString("id").isEmpty()) {
                String stored = decrypt(new File(dataDir(), "key-" + hashId(config.getString("id")) + ".enc")); if (stored != null) key = stored;
            }
            if (!key.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + key);
            JSONObject headers = config.optJSONObject("headers");
            if (headers == null) headers = config.optJSONObject("customHeaders");
            if (headers != null) {
                Iterator<String> names = headers.keys();
                while (names.hasNext()) {
                    String name = names.next(); String value = headers.getString(name);
                    if (name.contains("\r") || name.contains("\n") || value.contains("\r") || value.contains("\n")) throw new IOException("自定义请求头包含非法换行");
                    connection.setRequestProperty(name, value);
                }
            }
            activeRequests.add(connection);
            try {
                if (!operation.equals("models")) {
                    connection.setRequestMethod("POST"); connection.setDoOutput(true);
                    if (operation.equals("transcribe")) writeAudio(call, config, connection);
                    else {
                        JSONObject body = new JSONObject();
                        JSONObject extra = config.optJSONObject("extra");
                        if (extra == null) extra = config.optJSONObject("extraParams"); if (extra == null) extra = config.optJSONObject("extraParameters");
                        if (extra != null) { Iterator<String> it = extra.keys(); while(it.hasNext()) { String n = it.next(); body.put(n, extra.get(n)); } }
                        body.put("model", config.optString("modelId", config.optString("model")));
                        JSArray messages = call.getArray("messages");
                        if (messages == null) messages = new JSArray("[{\"role\":\"user\",\"content\":\"请回复：连接测试成功\"}]");
                        body.put("messages", messages);
                        body.put("max_tokens", config.optInt("maxTokens", config.optInt("maxOutputTokens", 512)));
                        body.put("temperature", config.optDouble("temperature", 0.6));
                        body.put("stream", config.optBoolean("stream", false));
                        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                        try(OutputStream out = connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
                    }
                }
                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) {
                    String error = new String(readLimited(connection.getErrorStream(), 65536), StandardCharsets.UTF_8);
                    String message = "HTTP " + code;
                    try { JSONObject e = new JSONObject(error); JSONObject detail = e.optJSONObject("error"); if (detail != null) message += "：" + detail.optString("message", "服务拒绝请求"); }
                    catch(Exception ignored) {}
                    if (!key.isEmpty()) message = message.replace(key, "[密钥已隐藏]");
                    if (headers != null) {
                        Iterator<String> it = headers.keys();
                        while (it.hasNext()) {
                            String value = headers.optString(it.next());
                            if (value.length() >= 4) message = message.replace(value, "[请求头已隐藏]");
                        }
                    }
                    throw new IOException(message.substring(0, Math.min(1000,message.length())));
                }
                String contentType = connection.getContentType();
                if (contentType != null && contentType.contains("text/event-stream")) return readStream(connection);
                JSONObject response = new JSONObject(new String(readLimited(connection.getInputStream(), 16 * 1024 * 1024), StandardCharsets.UTF_8));
                if (operation.equals("models")) return new JSObject().put("models", response.optJSONArray("data") == null ? new JSONArray() : response.getJSONArray("data"));
                if (operation.equals("transcribe")) return new JSObject().put("text", response.getString("text")).put("processingLocation", "外部 API");
                JSONArray choices = response.optJSONArray("choices");
                if (choices == null || choices.length() == 0) throw new IOException("API 返回缺少 choices，确认 OpenAI 兼容协议与模型 ID");
                JSONObject message = choices.getJSONObject(0).getJSONObject("message");
                return new JSObject().put("text", message.optString("content", "")).put("usage", response.optJSONObject("usage"))
                        .put("model", response.optString("model", config.optString("modelId"))).put("processingLocation", "外部 API");
            } finally { activeRequests.remove(connection); connection.disconnect(); }
        });
    }
    private JSObject readStream(HttpURLConnection connection) throws Exception {
        StringBuilder text = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
            String line; while ((line = reader.readLine()) != null) {
                if (!line.startsWith("data:")) continue;
                String data = line.substring(5).trim(); if (data.equals("[DONE]")) break;
                if (data.isEmpty()) continue;
                JSONObject part = new JSONObject(data); JSONArray choices = part.optJSONArray("choices");
                if (choices == null || choices.length() == 0) continue;
                JSONObject delta = choices.getJSONObject(0).optJSONObject("delta");
                if (delta != null) text.append(delta.optString("content", ""));
                if (text.length() > 2 * 1024 * 1024) throw new IOException("流式输出超出限制");
                notifyListeners("apiToken", new JSObject().put("text", text.toString()));
            }
        }
        return new JSObject().put("text", text.toString()).put("processingLocation", "外部 API").put("streamed", true);
    }
    private void writeAudio(PluginCall call, JSONObject config, HttpURLConnection connection) throws Exception {
        JSObject audio = call.getObject("audio"); if (audio == null) throw new IOException("缺少音频数据");
        String base64 = audio.optString("base64", audio.optString("data"));
        String inferredMime = base64.startsWith("data:") && base64.contains(";") ? base64.substring(5, base64.indexOf(';')) : "audio/webm";
        if (base64.contains(",")) base64 = base64.substring(base64.indexOf(',') + 1);
        if (base64.length() > 28 * 1024 * 1024) throw new IOException("音频应小于 20MiB");
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        String boundary = "muyu" + UUID.randomUUID().toString().replace("-", "");
        String filename = audio.optString("name", "recording.webm").replaceAll("[^a-zA-Z0-9._-]", "_");
        String mime = audio.optString("mimeType", inferredMime); if (!mime.matches("[a-zA-Z0-9.+/-]+")) throw new IOException("音频 MIME 无效");
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        try (OutputStream out = connection.getOutputStream()) {
            out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n" + config.optString("modelId", config.optString("model")) + "\r\n").getBytes(StandardCharsets.UTF_8));
            out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"\r\nContent-Type: " + mime + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            out.write(bytes); out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        }
    }
    @Override protected void handleOnPause() {
        // This first version has no background connector permission. Never imply unattended auto-send survives app suspension.
        cancelled = true; try { NativeInference.cancel(); } catch (Throwable ignored) {}
        try { LocalSpeech.cancel(); } catch (Throwable ignored) {}
        taskGeneration.incrementAndGet();
        for (HttpURLConnection request : activeRequests) request.disconnect();
        serial.execute(() -> { NativeInference.unload(); loadedPath = null; modelStage = "已暂停：切至后台"; });
        notifyListeners("appSuspended", new JSObject().put("localInferencePaused", true).put("backgroundAutoReply", false));
        super.handleOnPause();
    }
}
