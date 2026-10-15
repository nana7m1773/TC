package cn.muyu.assistant;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.ContentObserver;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** System-provided notifications only. Private content and PendingIntents never leave process memory. */
public final class SocialNotificationService extends NotificationListenerService {
    private static final Object LOCK = new Object();
    private static final int MAX_EVENTS = 100;
    private static final int MAX_TEXT = 4096;
    private static final LinkedHashMap<String, Event> EVENTS = new LinkedHashMap<>();
    private static final Map<String, Event> CURRENT = new HashMap<>();
    private static SocialNotificationService connected;
    private static final String[][] APPS = {
            {"qq", "QQ", "com.tencent.mobileqq"},
            {"wechat", "微信", "com.tencent.mm"},
            {"bilibili", "哔哩哔哩", "tv.danmaku.bili"},
            {"weibo", "微博", "com.sina.weibo"},
            {"whatsapp", "WhatsApp", "com.whatsapp", "com.whatsapp.w4b"}
    };

    private final ContentObserver accessObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
        @Override public void onChange(boolean selfChange) { hasAccess(SocialNotificationService.this); }
    };

    @Override public void onCreate() {
        super.onCreate();
        getContentResolver().registerContentObserver(Settings.Secure.getUriFor("enabled_notification_listeners"), false, accessObserver);
    }

    static boolean hasAccess(Context context) {
        ComponentName component = new ComponentName(context, SocialNotificationService.class);
        boolean allowed = false;
        try {
            if (Build.VERSION.SDK_INT >= 27) {
                NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                allowed = manager != null && manager.isNotificationListenerAccessGranted(component);
            } else {
                String listeners = Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
                if (listeners != null) for (String value : listeners.split(":")) {
                    if (component.equals(ComponentName.unflattenFromString(value))) { allowed = true; break; }
                }
            }
        } catch (RuntimeException ignored) { /* A denied or unavailable setting never authorizes reading. */ }
        if (!allowed) synchronized (LOCK) { clearLocked(); }
        return allowed;
    }

    static Intent accessSettings(Context context) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.putExtra(":settings:fragment_args_key", new ComponentName(context, SocialNotificationService.class).flattenToString());
        return intent;
    }

    private static void clearLocked() {
        for (Event event : EVENTS.values()) event.invalidate();
        EVENTS.clear(); CURRENT.clear(); connected = null;
    }

    @Override public void onListenerConnected() {
        super.onListenerConnected();
        if (!hasAccess(this)) return;
        synchronized (LOCK) { clearLocked(); connected = this; }
        // Existing system notifications may be read only after the owner has granted this listener access.
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active != null) for (StatusBarNotification notification : active) capture(notification);
        } catch (SecurityException ignored) { synchronized (LOCK) { clearLocked(); } }
    }

    @Override public void onListenerDisconnected() {
        synchronized (LOCK) { if (connected == this) clearLocked(); }
        super.onListenerDisconnected();
    }

    @Override public void onDestroy() {
        getContentResolver().unregisterContentObserver(accessObserver);
        synchronized (LOCK) { if (connected == this) clearLocked(); }
        super.onDestroy();
    }

    @Override public void onNotificationPosted(StatusBarNotification notification) { capture(notification); }

    @Override public void onNotificationRemoved(StatusBarNotification notification) {
        if (notification == null) return;
        synchronized (LOCK) {
            if (connected != this) return;
            Event previous = CURRENT.remove(notification.getKey());
            if (previous != null) previous.invalidate();
        }
    }

    private void capture(StatusBarNotification notification) {
        if (notification == null || platformForPackage(notification.getPackageName()) == null || !hasAccess(this)) return;
        synchronized (LOCK) {
            if (connected != this) return;
            Event previous = CURRENT.remove(notification.getKey());
            if (previous != null) previous.invalidate();
        }
        try {
            Event event = new Event(notification);
            synchronized (LOCK) {
                if (connected != this) return;
                CURRENT.put(event.notificationKey, event);
                EVENTS.put(event.eventId, event);
                while (EVENTS.size() > MAX_EVENTS) {
                    String first = EVENTS.keySet().iterator().next();
                    Event expired = EVENTS.remove(first);
                    if (CURRENT.get(expired.notificationKey) == expired) CURRENT.remove(expired.notificationKey);
                    expired.invalidate();
                }
            }
        } catch (RuntimeException ignored) { /* Malformed third-party notification extras are not logged or persisted. */ }
    }

    static String platformForPackage(String packageName) {
        for (String[] app : APPS) for (int i = 2; i < app.length; i++) if (app[i].equals(packageName)) return app[0];
        return null;
    }

    static Intent launchIntent(Context context, String platform) throws IOException {
        for (String[] app : APPS) if (app[0].equals(platform)) {
            for (int i = 2; i < app.length; i++) {
                Intent intent = context.getPackageManager().getLaunchIntentForPackage(app[i]);
                if (intent != null) return intent;
            }
            throw new IOException("未安装或无法打开该平台的官方 Android 应用，请先安装并登录");
        }
        throw new IOException("不支持的社交平台");
    }

    static JSObject status(Context context) {
        boolean access = hasAccess(context);
        JSArray apps = new JSArray();
        PackageManager packages = context.getPackageManager();
        for (String[] app : APPS) {
            boolean installed = false, canLaunch = false;
            String selected = app[2];
            JSArray variants = new JSArray();
            for (int i = 2; i < app.length; i++) {
                boolean present = false, launchable = false;
                try {
                    packages.getApplicationInfo(app[i], 0); present = true;
                    launchable = packages.getLaunchIntentForPackage(app[i]) != null;
                } catch (PackageManager.NameNotFoundException ignored) { }
                if ((present && !installed) || (launchable && !canLaunch)) selected = app[i];
                installed |= present; canLaunch |= launchable;
                variants.put(new JSObject().put("packageName", app[i]).put("installed", present).put("canLaunch", launchable));
            }
            apps.put(new JSObject().put("platform", app[0]).put("name", app[1]).put("packageName", selected)
                    .put("installed", installed).put("canLaunch", canLaunch).put("packages", variants));
        }
        synchronized (LOCK) {
            return new JSObject().put("platform", "android").put("notificationAccess", access)
                    .put("listenerConnected", access && connected != null).put("notificationsOnly", true)
                    .put("backgroundAutoReply", false).put("capturedCount", EVENTS.size()).put("apps", apps);
        }
    }

    static JSObject notifications(Context context, int limit) {
        boolean access = hasAccess(context);
        JSArray events = new JSArray();
        synchronized (LOCK) {
            List<Event> ordered = new ArrayList<>(EVENTS.values());
            Collections.reverse(ordered);
            for (Event event : ordered) { if (events.length() >= limit) break; events.put(event.toJson()); }
            return new JSObject().put("notificationAccess", access).put("listenerConnected", access && connected != null).put("events", events);
        }
    }

    /** Must run on the UI thread, alongside listener callbacks, so no update can race the final validation and send. */
    static JSObject reply(Context context, String eventId, String text, boolean consent) throws IOException {
        if (Looper.myLooper() != Looper.getMainLooper()) throw new IOException("系统通知回复必须在主线程执行");
        if (!consent) throw new IOException("请先确认本次通知回复内容与收件来源");
        if (blank(text) || text.length() > 6000) throw new IOException("通知回复须为 1–6000 个字符");
        if (!hasAccess(context)) throw new IOException("未授权系统通知使用权，或授权已撤销");
        synchronized (LOCK) {
            Event event = EVENTS.get(eventId);
            if (connected == null || event == null || CURRENT.get(event.notificationKey) != event || !event.canReply())
                throw new IOException("该通知回复入口已失效或已经提交，请打开官方应用确认");
            StatusBarNotification active = null;
            try {
                StatusBarNotification[] notifications = connected.getActiveNotifications(new String[]{event.notificationKey});
                if (notifications != null) for (StatusBarNotification value : notifications)
                    if (event.notificationKey.equals(value.getKey()) && event.packageName.equals(value.getPackageName())) { active = value; break; }
            } catch (SecurityException e) {
                clearLocked(); throw new IOException("通知授权已撤销，请重新授权后选择新通知");
            }
            if (active == null || !event.matches(active)) {
                event.invalidate(); CURRENT.remove(event.notificationKey);
                throw new IOException("原通知已更新、移除或快捷回复动作已改变，请选择最新通知");
            }
            PendingIntent action = event.pendingIntent;
            RemoteInput[] inputs = event.remoteInputs;
            event.attempted = true;
            event.invalidate(); // Consume before PendingIntent.send: an uncertain outcome must never be retried automatically.
            String outcome = "submitted";
            try {
                Bundle results = new Bundle();
                for (RemoteInput input : inputs) if (input != null && input.getAllowFreeFormInput()) results.putCharSequence(input.getResultKey(), text);
                Intent fillIn = new Intent().addFlags(Intent.FLAG_RECEIVER_FOREGROUND);
                RemoteInput.addResultsToIntent(inputs, fillIn, results);
                if (Build.VERSION.SDK_INT >= 28) RemoteInput.setResultsSource(fillIn, RemoteInput.SOURCE_FREE_FORM_INPUT);
                action.send(context, 0, fillIn);
            }
            catch (PendingIntent.CanceledException | RuntimeException e) { outcome = "unknown"; }
            return new JSObject().put("eventId", event.eventId).put("status", outcome).put("retryAllowed", false);
        }
    }

    private static String text(CharSequence text) {
        if (text == null) return "";
        String value = text.toString();
        return value.length() > MAX_TEXT ? value.substring(0, MAX_TEXT) : value;
    }

    private static boolean blank(String value) {
        if (value == null) return true;
        for (int i = 0; i < value.length(); i++) if (!Character.isWhitespace(value.charAt(i))) return false;
        return true;
    }

    private static JSObject content(Notification notification) {
        Bundle extras = notification.extras == null ? new Bundle() : notification.extras;
        String title = text(extras.getCharSequence(Notification.EXTRA_TITLE));
        String body = text(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (blank(body)) body = text(extras.getCharSequence(Notification.EXTRA_TEXT));
        if (blank(body)) {
            CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
            if (lines != null) {
                StringBuilder joined = new StringBuilder();
                for (CharSequence line : lines) { if (joined.length() >= MAX_TEXT) break; if (joined.length() > 0) joined.append('\n'); joined.append(text(line)); }
                body = text(joined);
            }
        }
        JSArray messages = new JSArray();
        NotificationCompat.MessagingStyle style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification);
        if (style != null) {
            List<NotificationCompat.MessagingStyle.Message> source = style.getMessages();
            Person owner = style.getUser();
            for (int i = Math.max(0, source.size() - 20); i < source.size(); i++) {
                NotificationCompat.MessagingStyle.Message message = source.get(i);
                Person person = message.getPerson();
                CharSequence sender = person == null ? null : person.getName();
                // MessagingStyle specifies a null sender/person for messages from this device's user.
                // An unnamed peer Person must never be mistaken for the owner.
                boolean self = person == null;
                if (person != null && owner != null) {
                    if ((!blank(owner.getKey()) && owner.getKey().equals(person.getKey()))
                            || (!blank(owner.getUri()) && owner.getUri().equals(person.getUri()))) self = true;
                }
                messages.put(new JSObject().put("text", text(message.getText())).put("sender", sender == null ? JSONObject.NULL : text(sender))
                        .put("timestamp", message.getTimestamp()).put("isSelf", self));
            }
        }
        if (blank(body) && messages.length() > 0) body = messages.optJSONObject(messages.length() - 1).optString("text");
        if (messages.length() == 0 && !blank(body)) messages.put(new JSObject().put("text", body)
                .put("sender", title).put("timestamp", notification.when).put("isSelf", JSONObject.NULL));
        return new JSObject().put("title", title).put("text", body).put("messages", messages);
    }

    private static Notification.Action replyAction(Notification notification) {
        if ((notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0 || notification.actions == null) return null;
        for (Notification.Action action : notification.actions) {
            if (action == null || action.actionIntent == null || action.getRemoteInputs() == null) continue;
            if (Build.VERSION.SDK_INT >= 31 && (action.isAuthenticationRequired() || action.actionIntent.isImmutable())) continue;
            for (RemoteInput input : action.getRemoteInputs()) if (input != null && input.getAllowFreeFormInput()) return action;
        }
        return null;
    }

    private static String inputsSignature(RemoteInput[] inputs) {
        StringBuilder signature = new StringBuilder();
        if (inputs != null) for (RemoteInput input : inputs) {
            if (input == null) { signature.append("null;"); continue; }
            String key = input.getResultKey();
            signature.append(key.length()).append(':').append(key).append(':').append(input.getAllowFreeFormInput()).append(';');
        }
        return signature.toString();
    }

    private static final class Event {
        final String eventId = UUID.randomUUID().toString();
        final String platform, packageName, notificationKey, contentSnapshot, actionTitle, inputsSignature;
        final long postedAt, receivedAt = System.currentTimeMillis(), notificationWhen;
        final JSObject data;
        PendingIntent pendingIntent;
        RemoteInput[] remoteInputs;
        boolean attempted;

        Event(StatusBarNotification notification) {
            packageName = notification.getPackageName(); platform = platformForPackage(packageName);
            notificationKey = notification.getKey(); postedAt = notification.getPostTime();
            notificationWhen = notification.getNotification().when;
            data = content(notification.getNotification()); contentSnapshot = data.toString();
            Notification.Action action = replyAction(notification.getNotification());
            pendingIntent = action == null ? null : action.actionIntent;
            remoteInputs = action == null ? null : action.getRemoteInputs();
            actionTitle = action == null ? "" : text(action.title);
            inputsSignature = inputsSignature(remoteInputs);
        }

        boolean canReply() { return !attempted && pendingIntent != null && remoteInputs != null; }
        void invalidate() { pendingIntent = null; remoteInputs = null; }

        boolean matches(StatusBarNotification active) {
            if (active.getPostTime() != postedAt || active.getNotification().when != notificationWhen
                    || !contentSnapshot.equals(content(active.getNotification()).toString())) return false;
            Notification.Action action = replyAction(active.getNotification());
            return action != null && Objects.equals(pendingIntent, action.actionIntent)
                    && actionTitle.equals(text(action.title)) && inputsSignature.equals(inputsSignature(action.getRemoteInputs()));
        }

        JSObject toJson() {
            return new JSObject().put("eventId", eventId).put("platform", platform).put("packageName", packageName)
                    .put("notificationKey", notificationKey).put("title", data.optString("title")).put("text", data.optString("text"))
                    .put("messages", data.optJSONArray("messages")).put("postedAt", postedAt).put("receivedAt", receivedAt)
                    .put("canReply", canReply()).put("replyState", attempted ? "attempted" : canReply() ? "available" : "unavailable")
                    .put("source", "android-notification");
        }
    }
}
