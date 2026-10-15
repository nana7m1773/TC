import { useEffect, useRef, useState } from "react";
import { Bell, ExternalLink, FileText, RefreshCw, ShieldCheck } from "lucide-react";
import { requireRuntime, runtimeTarget } from "./runtime";
import "./social-connections.css";

export type SocialPlatform = "qq" | "wechat" | "bilibili" | "weibo" | "whatsapp";
export type SocialNotificationEvent = {
  eventId: string;
  platform: SocialPlatform;
  packageName: string;
  notificationKey: string;
  title: string;
  text: string;
  postedAt: number;
  receivedAt: number;
  messages: { text: string; sender: string | null; timestamp: number; isSelf: boolean | null }[];
  canReply: boolean;
  replyState: "available" | "unavailable" | "attempted";
  source: "android-notification";
};
export type SocialNotificationDraft = { text: string; requiresReview: boolean; reason?: string; jobId: string };
export type SocialNotificationSendInput = { event: SocialNotificationEvent; draft: string; jobId: string; approved: boolean };
export type SocialConnectionsProps = {
  notify: (message: string) => void;
  onOpenComputer: () => void;
  onOpenModels: () => void;
  onOpenApis?: () => void;
  preferApi?: boolean;
  globallyPaused?: boolean;
  onResume?: () => void;
  onUseText: (text: string) => void;
  onGenerateNotification?: (event: SocialNotificationEvent) => Promise<SocialNotificationDraft>;
  onSendNotification?: (input: SocialNotificationSendInput) => Promise<{ status: "unknown"; message: string }>;
  onResolveNotification?: (input: { jobId: string; outcome: "accepted" | "not-sent"; evidence: string }) => Promise<void>;
};

type DesktopSession = { platform: SocialPlatform; webAvailable: boolean; webWindowOpened: boolean; nativeAvailable: boolean; nativeWindowOpened: boolean; detail: string };
type AndroidApp = { platform: SocialPlatform; name: string; packageName: string; installed: boolean; canLaunch: boolean };
type Status =
  | { platform: "win32"; sessions: DesktopSession[] }
  | { platform: "android"; notificationAccess: boolean; listenerConnected: boolean; apps: AndroidApp[]; capturedCount: number };
type Reply = { draft: SocialNotificationDraft; text: string; state: "review" | "sending" | "unknown" | "resolved"; detail?: string; evidence: string };
const platforms: { id: SocialPlatform; name: string; mark: string }[] = [
  { id: "qq", name: "QQ", mark: "Q" }, { id: "wechat", name: "微信", mark: "微" },
  { id: "bilibili", name: "哔哩哔哩", mark: "哔" }, { id: "weibo", name: "微博", mark: "W" },
  { id: "whatsapp", name: "WhatsApp", mark: "WA" },
];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isPlatform = (value: unknown): value is SocialPlatform => platforms.some(platform => platform.id === value);
function parseStatus(value: unknown): Status {
  const data = record(value);
  if (data.platform === "win32" && Array.isArray(data.sessions)) return { platform: "win32", sessions: data.sessions.filter(value => isPlatform(record(value).platform)).map(value => {
    const item = record(value);
    return { platform: item.platform as SocialPlatform, webAvailable: item.webAvailable === true, webWindowOpened: item.webWindowOpened === true, nativeAvailable: item.nativeAvailable === true, nativeWindowOpened: item.nativeWindowOpened === true, detail: typeof item.detail === "string" ? item.detail : "" };
  }) };
  if (data.platform === "android" && Array.isArray(data.apps)) return { platform: "android", notificationAccess: data.notificationAccess === true, listenerConnected: data.listenerConnected === true, capturedCount: Number(data.capturedCount) || 0, apps: data.apps.filter(value => isPlatform(record(value).platform)).map(value => {
    const item = record(value);
    return { platform: item.platform as SocialPlatform, name: String(item.name ?? ""), packageName: String(item.packageName ?? ""), installed: item.installed === true, canLaunch: item.canLaunch === true };
  }) };
  throw new Error("当前原生版本未提供可验证的账号接入状态，请更新应用或手动导入消息。");
}
function parseEvents(value: unknown): SocialNotificationEvent[] {
  const events = record(value).events;
  if (!Array.isArray(events)) throw new Error("原生通知返回格式无效，未生成或发送回复。");
  return events.filter(value => {
    const event = record(value);
    return event.source === "android-notification" && isPlatform(event.platform) && typeof event.eventId === "string" && event.eventId.length > 0 && typeof event.notificationKey === "string" && event.notificationKey.length > 0 && typeof event.packageName === "string" && typeof event.text === "string";
  }).map(value => {
    const event = record(value);
    return { eventId: event.eventId as string, platform: event.platform as SocialPlatform, packageName: event.packageName as string,
      notificationKey: event.notificationKey as string, title: typeof event.title === "string" ? event.title : "", text: event.text as string,
      postedAt: Number(event.postedAt) || 0, receivedAt: Number(event.receivedAt) || 0,
      messages: Array.isArray(event.messages) ? event.messages.filter(value => typeof record(value).text === "string").map(value => {
        const message = record(value);
        return { text: message.text as string, sender: typeof message.sender === "string" ? message.sender : null, timestamp: Number(message.timestamp) || 0, isSelf: typeof message.isSelf === "boolean" ? message.isSelf : null };
      }) : [], canReply: event.canReply === true, replyState: event.replyState === "available" ? "available" : event.replyState === "attempted" ? "attempted" : "unavailable", source: "android-notification" as const };
  });
}

/** Shows observed native capabilities; opening an official app never establishes a login or message grant. */
export function SocialConnections(props: SocialConnectionsProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [instructions, setInstructions] = useState("");
  const [events, setEvents] = useState<SocialNotificationEvent[]>([]);
  const [replies, setReplies] = useState<Record<string, Reply>>({});
  const [working, setWorking] = useState<Record<string, boolean>>({});
  const [autoApps, setAutoApps] = useState<Partial<Record<SocialPlatform, boolean>>>({});
  const [manualText, setManualText] = useState("");
  const mounted = useRef(false);
  const currentStatus = useRef<Status | null>(null);
  const latest = useRef(props);
  const auto = useRef(autoApps);
  const replyRef = useRef(replies);
  const seen = useRef(new Set<string>());
  const attempted = useRef(new Set<string>());
  const active = useRef(new Set<string>());
  const polling = useRef(false);
  const epoch = useRef(0);
  latest.current = props;
  auto.current = autoApps;
  replyRef.current = replies;
  const android = runtimeTarget === "android" && status?.platform === "android";
  const notificationsReady = android && status.notificationAccess && status.listenerConnected;

  function fail(reason: unknown) {
    if (!mounted.current) return;
    const message = errorText(reason); setError(message); latest.current.notify(message);
  }
  function updateReply(eventId: string, patch: Partial<Reply>) {
    if (!mounted.current) return;
    setReplies(previous => {
      if (!previous[eventId]) return previous;
      const next = { ...previous, [eventId]: { ...previous[eventId], ...patch } };
      replyRef.current = next;
      return next;
    });
  }
  function stopAuto(platform?: SocialPlatform) {
    const next = platform ? { ...auto.current, [platform]: false } : {};
    auto.current = next;
    if (mounted.current) setAutoApps(next);
  }
  function readyToReply(event: SocialNotificationEvent) {
    const state = currentStatus.current;
    return runtimeTarget === "android" && !latest.current.globallyPaused && document.visibilityState === "visible" && state?.platform === "android" && state.notificationAccess && state.listenerConnected
      && event.canReply && event.replyState === "available" && !attempted.current.has(event.notificationKey);
  }
  async function send(event: SocialNotificationEvent, draft: SocialNotificationDraft, text: string, approved: boolean) {
    if (!mounted.current || !readyToReply(event) || !text.trim() || !latest.current.onSendNotification) return;
    // Reserve before awaiting the callback. A thrown or ambiguous result must never cause a retry.
    attempted.current.add(event.notificationKey);
    stopAuto(event.platform);
    updateReply(event.eventId, { state: "sending" });
    try {
      const result = await latest.current.onSendNotification({ event, draft: text.trim(), jobId: draft.jobId, approved });
      updateReply(event.eventId, { state: "unknown", detail: result.message || "已尝试调用通知回复，发送结果未知，请到官方 App 核实。" });
    } catch (reason) {
      if (record(reason).definitelyNotSent === true) {
        attempted.current.delete(event.notificationKey);
        updateReply(event.eventId, { state: "review", detail: `尚未调用系统发送，请解决问题后重试。${errorText(reason)}` });
      } else {
        updateReply(event.eventId, { state: "unknown", detail: `发送结果未知，已停止且不会重试。${errorText(reason)}` });
      }
    }
  }
  async function generate(event: SocialNotificationEvent, automatic = false, replacement = false) {
    const previous = replyRef.current[event.eventId];
    if (document.visibilityState !== "visible" || latest.current.globallyPaused || active.current.has(event.eventId) || !latest.current.onGenerateNotification) return;
    if (replacement ? previous?.state !== "review" || attempted.current.has(event.notificationKey) : Boolean(previous)) return;
    if (automatic && (!auto.current[event.platform] || !readyToReply(event))) return;
    const token = epoch.current;
    active.current.add(event.eventId);
    if (replacement) {
      const remaining = { ...replyRef.current };
      delete remaining[event.eventId];
      replyRef.current = remaining;
      setReplies(remaining);
    }
    if (mounted.current) setWorking(previous => ({ ...previous, [event.eventId]: true }));
    try {
      const draft = await latest.current.onGenerateNotification(event);
      if (!draft.text.trim() || !draft.jobId) throw new Error("模型未返回可审核的草稿，未调用发送。");
      if (!mounted.current) return;
      const reply: Reply = { draft, text: draft.text, state: "review", evidence: "" };
      replyRef.current = { ...replyRef.current, [event.eventId]: reply };
      setReplies(replyRef.current);
      if (automatic) {
        if (token !== epoch.current || !auto.current[event.platform] || !readyToReply(event)) {
          updateReply(event.eventId, { detail: "前台授权已停止，请本人重新审核此建议。" });
          return;
        }
        if (draft.requiresReview) { stopAuto(event.platform); return; }
        await send(event, draft, draft.text, false);
      }
    } catch (reason) { stopAuto(event.platform); fail(reason); }
    finally {
      active.current.delete(event.eventId);
      if (mounted.current) setWorking(previous => ({ ...previous, [event.eventId]: false }));
    }
  }
  async function refresh() {
    if (runtimeTarget === "browser" || polling.current || document.visibilityState !== "visible") return;
    polling.current = true;
    try {
      const native = requireRuntime();
      if (!native.getSocialStatus) throw new Error("当前原生版本尚无账号接入桥接，请更新应用或使用手动导入。");
      const next = parseStatus(await native.getSocialStatus());
      if (!mounted.current || document.visibilityState !== "visible") return;
      if ((runtimeTarget === "android") !== (next.platform === "android")) throw new Error("原生运行平台与接入状态不一致，未启用通知操作。");
      currentStatus.current = next;
      setStatus(next);
      setError("");
      if (next.platform !== "android" || !next.notificationAccess || !next.listenerConnected) { stopAuto(); epoch.current++; return; }
      if (!native.getSocialNotifications) throw new Error("当前版本不能读取系统通知，请更新应用。");
      const incoming = parseEvents(await native.getSocialNotifications({ limit: 40 }));
      if (!mounted.current || document.visibilityState !== "visible") return;
      const fresh = incoming.filter(event => !seen.current.has(event.eventId));
      for (const event of incoming) seen.current.add(event.eventId);
      setEvents(previous => {
        const merged = new Map(previous.map(event => [event.eventId, event]));
        for (const event of incoming) merged.set(event.eventId, event);
        return Array.from(merged.values()).sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 40);
      });
      for (const event of fresh) if (auto.current[event.platform] && event.canReply && event.replyState === "available") void generate(event, true);
    } catch (reason) { currentStatus.current = null; if (mounted.current) setStatus(null); stopAuto(); fail(reason); }
    finally { polling.current = false; }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = runtimeTarget === "android" ? window.setInterval(() => { void refresh(); }, 2000) : undefined;
    const suspend = () => { epoch.current++; stopAuto(); };
    const visibility = () => { if (document.visibilityState === "visible") void refresh(); else suspend(); };
    document.addEventListener("visibilitychange", visibility);
    let removePause: (() => void) | undefined;
    if (runtimeTarget !== "browser") removePause = requireRuntime().onPause?.(suspend);
    return () => { mounted.current = false; epoch.current++; auto.current = {}; if (timer) window.clearInterval(timer); document.removeEventListener("visibilitychange", visibility); removePause?.(); };
  }, []);
  useEffect(() => { if (props.globallyPaused) { epoch.current++; stopAuto(); } }, [props.globallyPaused]);
  async function requestAccess() {
    epoch.current++; stopAuto();
    setBusy("access");
    try {
      const native = requireRuntime();
      if (!native.requestSocialAccess) throw new Error("当前原生版本尚不支持打开授权设置。");
      const result = record(await native.requestSocialAccess());
      const instructionText = typeof result.instructions === "string" ? result.instructions : Array.isArray(result.instructions) ? result.instructions.filter((value): value is string => typeof value === "string").join("\n") : "";
      if (mounted.current) setInstructions(instructionText || "请在系统设置中为 L-BOT 开启通知使用权，返回后刷新状态。");
      // Opening settings is not evidence that permission was granted.
    } catch (reason) { fail(reason); }
    finally { if (mounted.current) setBusy(""); }
  }
  async function openApp(platform: SocialPlatform, mode?: "native" | "web") {
    epoch.current++; stopAuto();
    setBusy(`${platform}:${mode ?? "native"}`);
    try {
      const native = requireRuntime();
      if (!native.openSocialApp) throw new Error("当前原生版本不能打开官方应用，请手动打开。");
      const result = record(await native.openSocialApp({ platform, ...(mode ? { mode } : {}) }));
      const message = typeof result.detail === "string" ? result.detail : typeof result.details === "string" ? result.details : result.opened === true ? "已请求打开官方应用，请本人在官方界面登录；登录及消息权限尚未验证。" : "未能打开官方应用，请检查是否已安装。";
      latest.current.notify(message);
      await refresh();
    } catch (reason) { fail(reason); }
    finally { if (mounted.current) setBusy(""); }
  }
  async function resolve(event: SocialNotificationEvent, outcome: "accepted" | "not-sent") {
    const reply = replyRef.current[event.eventId];
    if (!reply || reply.state !== "unknown" || !reply.evidence.trim() || !latest.current.onResolveNotification || active.current.has(event.eventId)) return;
    active.current.add(event.eventId);
    setWorking(previous => ({ ...previous, [event.eventId]: true }));
    try {
      await latest.current.onResolveNotification({ jobId: reply.draft.jobId, outcome, evidence: reply.evidence.trim() });
      updateReply(event.eventId, { state: "resolved", detail: outcome === "accepted" ? "本人核实已发送，已记录核实依据。" : "本人核实未发送，已记录；本条不会重试。" });
    } catch (reason) { fail(reason); }
    finally { active.current.delete(event.eventId); if (mounted.current) setWorking(previous => ({ ...previous, [event.eventId]: false })); }
  }
  async function copyReply(text: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("系统剪贴板不可用，请选中草稿文字后手动复制。");
      await navigator.clipboard.writeText(text);
      latest.current.notify("已复制回复草稿，请本人粘贴到官方 App。");
    } catch (reason) { fail(reason); }
  }

  return <div className="social-connections" data-testid="social-connections">
    <section className="panel social-intro">
      <div className="row wrap"><h2><ShieldCheck size={20} />连接你的聊天应用</h2><button className="button secondary" onClick={() => void refresh()} disabled={runtimeTarget === "browser" || Boolean(busy)}><RefreshCw size={14} />刷新接入状态</button></div>
      <ol className="social-steps"><li><b>1</b><span>{runtimeTarget === "android" ? "授权系统通知" : "打开官方应用并登录"}</span></li><li><b>2</b><span>{runtimeTarget === "android" ? "接收新通知，生成建议" : "选择聊天窗口，读取消息"}</span></li><li><b>3</b><span>本人审核，再回复一次</span></li></ol>
      <p>{runtimeTarget === "android" ? "读取系统实际投递的新通知，并在通知提供回复动作时回复。收不到的消息可手动导入。" : runtimeTarget === "desktop" ? "官方网页使用独立登录窗口。本机客户端需已安装；打开后在「桌面界面接入」选择要操作的窗口。" : "浏览器演示不能读取系统通知或操作聊天应用。请安装 Windows / Android 原生应用，或手动导入消息。"}</p>
      <div className="social-model row wrap"><span>{runtimeTarget === "android" ? "通知回复使用本地模型；API 请先导入消息中心，再明确授权。" : `回复引擎：${props.preferApi ? "已选择的自定义 API" : "本地模型"}`}</span><button className="button secondary" onClick={props.onOpenModels}>配置本地模型</button>{props.onOpenApis && <button className="button secondary" onClick={props.onOpenApis}>配置 API</button>}</div>
      {props.globallyPaused && <div className="social-pause"><p>已暂停，恢复后才能生成或回复通知。打开官方 App 或系统设置后，需由本人恢复。</p>{props.onResume && <button className="button" onClick={props.onResume}>恢复通知处理</button>}</div>}
      {error && <p className="social-error" role="alert">{error}</p>}
    </section>

    {runtimeTarget === "android" && <section className="panel social-access" aria-label="Android 通知授权">
      <h3><Bell size={17} />系统通知接入</h3>
      <p data-testid="social-access-status">{status?.platform === "android" ? `通知使用权${status.notificationAccess ? "已开启" : "未开启"} · 监听器${status.listenerConnected ? "已连接" : "未连接"} · 已捕获 ${status.capturedCount} 条通知` : "正在检查系统通知权限…"}</p>
      <button className="button" onClick={() => void requestAccess()} disabled={Boolean(busy)}>打开系统通知使用权设置</button>
      {instructions && <p className="note-block">{instructions}</p>}
      <p className="hint">授权后仅在此页面前台每 2 秒检查新通知。切到后台或离开此页会关闭本次自动回复；持续后台 AI 回复尚未实现。通知不代表完整聊天记录，也不能确认账号身份。</p>
    </section>}

    <div className="social-apps">{platforms.map(platform => {
      const session = status?.platform === "win32" ? status.sessions.find(item => item.platform === platform.id) : undefined;
      const app = status?.platform === "android" ? status.apps.find(item => item.platform === platform.id) : undefined;
      return <article className="panel social-app" key={platform.id} data-testid={`social-app-${platform.id}`}>
        <div className="row"><span className="avatar sage">{platform.mark}</span><div><h3>{platform.name}</h3><span className="badge muted">{runtimeTarget === "android" ? app?.installed ? "已安装 · 账号未验证" : "未检测到已安装应用" : "登录状态未验证"}</span></div></div>
        {runtimeTarget === "desktop" ? <>
          <p>{session?.detail || "请在官方应用中登录，再选择聊天窗口。"}</p>
          <p className="hint">{session?.webWindowOpened ? "官方网页窗口已打开。" : ""}{session?.nativeWindowOpened ? "已请求打开本机客户端。" : ""}消息读写权限尚未授予。</p>
          <div className="row wrap"><button className="button secondary" disabled={!session?.webAvailable || Boolean(busy)} onClick={() => void openApp(platform.id, "web")}><ExternalLink size={13} />打开官方网页登录</button><button className="button secondary" disabled={!session?.nativeAvailable || Boolean(busy)} onClick={() => void openApp(platform.id, "native")}>打开本机客户端</button></div>
        </> : runtimeTarget === "android" ? <>
          <p>{app?.packageName || "本机安装状态待原生桥接确认"}</p>
          <button className="button secondary" disabled={!app?.canLaunch || Boolean(busy)} onClick={() => void openApp(platform.id)}>打开官方 App</button>
          <label className="check-field social-auto"><input type="checkbox" checked={Boolean(autoApps[platform.id])} disabled={props.globallyPaused || !notificationsReady || !app?.installed || !props.onGenerateNotification || !props.onSendNotification} onChange={event => { const next = { ...auto.current, [platform.id]: event.target.checked }; auto.current = next; setAutoApps(next); }} />仅前台自动回复 {platform.name}</label>
          {autoApps[platform.id] && <p className="hint">仅处理启用后收到的新通知；无回复动作时跳过，需审核或发送结果未知时停止。</p>}
        </> : <p>原生应用可检查安装状态并打开官方登录。本页支持手动导入。</p>}
      </article>;
    })}</div>
    {runtimeTarget === "desktop" && <section className="panel social-next"><h3>登录后，选择要回复的窗口</h3><p>由本人选定窗口和当前消息；窗口是否支持读取和发送，以实际检测为准。</p><button className="button" onClick={props.onOpenComputer}>选择聊天窗口</button></section>}

    {runtimeTarget === "android" && <section className="panel social-notifications">
      <div className="row wrap"><h3>实际收到的通知 · {events.length}</h3><span className="badge muted">默认只生成建议</span></div>
      {!events.length && <p>{notificationsReady ? "暂未收到新通知。请让联系人发来一条新消息；应用未展示的通知无法读取。" : "开启系统通知使用权，并等待监听器连接后，才会读取新通知。"}</p>}
      {events.map(event => {
        const reply = replies[event.eventId];
        const canSend = !props.globallyPaused && notificationsReady && event.canReply && event.replyState === "available" && !attempted.current.has(event.notificationKey);
        return <article className="social-notification" key={event.eventId} data-testid={`social-notification-${event.eventId}`}>
          <div className="row wrap"><h4>{event.title || platforms.find(platform => platform.id === event.platform)?.name}</h4><span className="badge muted">{event.canReply && event.replyState === "available" ? "提供 RemoteInput 回复动作" : event.replyState === "attempted" ? "本条回复已尝试，禁止重试" : "没有可用通知回复动作"}</span></div>
          <small>来源：Android 系统通知 · {event.packageName}{event.receivedAt > 0 ? ` · ${new Date(event.receivedAt).toLocaleTimeString("zh-CN")}` : ""}</small>
          <p className="social-original">{event.text || "（通知未提供可读正文）"}</p>
          {event.messages.length > 0 && <details><summary>查看原通知消息片段</summary>{event.messages.map((message, index) => <p className="social-original" key={index}>{message.sender || "未标注发送人"}（{message.isSelf === true ? "通知标记为本人" : message.isSelf === false ? "通知标记为对方" : "身份未确认"}）：{message.text}</p>)}</details>}
          <div className="row wrap"><button className="button secondary" disabled={!event.text.trim()} onClick={() => props.onUseText(event.text)}>导入消息中心</button><button className="button" disabled={props.globallyPaused || !props.onGenerateNotification || !notificationsReady || !event.text.trim() || Boolean(reply) || working[event.eventId]} onClick={() => void generate(event)}>{working[event.eventId] && !reply ? "正在生成…" : "生成回复建议"}</button></div>
          {reply && <div className="social-reply">
            <label className="field"><span>本条通知的回复草稿</span><textarea aria-label={`回复草稿 ${event.eventId}`} value={reply.text} disabled={reply.state !== "review"} onChange={change => updateReply(event.eventId, { text: change.target.value })} /></label>
            {reply.draft.requiresReview && <p className="social-review"><ShieldCheck size={14} />需要本人审核{reply.draft.reason ? `：${reply.draft.reason}` : ""}</p>}
            {reply.state === "review" && <div className="row wrap"><button className="button" disabled={!canSend || !reply.text.trim() || working[event.eventId] || !props.onSendNotification} onClick={() => void send(event, reply.draft, reply.text, true)}>审核并发送一次</button><button className="button secondary" disabled={props.globallyPaused || !notificationsReady || working[event.eventId] || !props.onGenerateNotification || attempted.current.has(event.notificationKey)} onClick={() => void generate(event, false, true)}>重新生成</button></div>}
            <div className="row wrap"><button className="button secondary" disabled={!reply.text.trim()} onClick={() => void copyReply(reply.text)}>复制回复草稿</button><button className="button secondary" disabled={Boolean(busy) || status?.platform !== "android" || !status.apps.some(app => app.platform === event.platform && app.canLaunch)} onClick={() => void openApp(event.platform)}>打开此通知的官方 App</button></div>
            {reply.state === "sending" && <p>正在尝试通知回复…</p>}
            {(reply.state === "unknown" || reply.state === "resolved") && <p className="social-review" data-testid="notification-send-result">{reply.state === "unknown" ? "发送结果未知 · 自动回复已停止，不会重试。" : ""}{reply.detail}</p>}
            {reply.state === "unknown" && props.onResolveNotification && <div className="social-receipt"><label className="field"><span>本人在官方 App 核实的依据</span><input aria-label={`核实依据 ${event.eventId}`} value={reply.evidence} onChange={change => updateReply(event.eventId, { evidence: change.target.value })} placeholder="核对会话、消息正文和发送时间" /></label><div className="row wrap"><button className="button secondary" disabled={!reply.evidence.trim() || working[event.eventId]} onClick={() => void resolve(event, "accepted")}>本人核实已发送</button><button className="button secondary" disabled={!reply.evidence.trim() || working[event.eventId]} onClick={() => void resolve(event, "not-sent")}>本人核实未发送</button></div></div>}
            {reply.state === "review" && reply.detail && <p>{reply.detail}</p>}
          </div>}
        </article>;
      })}
    </section>}

    <section className="panel social-import"><h3><FileText size={17} />手动导入消息</h3><p>任何平台都可粘贴收到的文字，在消息中心生成回复，再本人复制到官方应用。</p><label className="field"><span>要导入的消息文字</span><textarea value={manualText} onChange={event => setManualText(event.target.value)} placeholder="粘贴要回复的消息…" /></label><button className="button secondary" disabled={!manualText.trim()} onClick={() => props.onUseText(manualText.trim())}>带到消息中心</button></section>
  </div>;
}
