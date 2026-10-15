import { test, expect, type Page } from "@playwright/test";

// These component tests use explicit native/model/callback doubles. They do not run
// Android, Windows, an official social app, a real model, or an actual notification reply.
type EventFixture = { eventId: string; notificationKey: string; platform: string; packageName: string; title: string; text: string; postedAt: number; receivedAt: number; canReply: boolean; replyState: string; source: string; messages: { text: string; sender: string; timestamp: number; isSelf: boolean | null }[] };
const notification = (id: string, canReply = true, key = `notification:${id}`): EventFixture => ({ eventId: id, notificationKey: key, platform: "qq", packageName: "com.tencent.mobileqq", title: "通知替身联系人", text: `原始通知正文 ${id}`, postedAt: 1000, receivedAt: Date.now(), canReply, replyState: canReply ? "available" : "unavailable", source: "android-notification", messages: [{ text: `原始消息片段 ${id}`, sender: "通知替身联系人", timestamp: 1000, isSelf: false }] });
type DoubleState = {
  access: boolean; listener: boolean; events: EventFixture[]; needsReview: boolean; deferred: boolean;
  calls: { native: { method: string; args: Record<string, unknown> }[]; generated: EventFixture[]; sends: { event: EventFixture; draft: string; jobId: string; approved: boolean }[]; resolves: unknown[]; imports: string[]; computer: number; models: number };
  release?: () => void; visibility: DocumentVisibilityState;
  rejectBeforeSend?: boolean;
};
const stateOf = (page: Page) => page.evaluate(() => (window as unknown as { __social: DoubleState }).__social);

async function mount(page: Page, options: { target?: "browser" | "desktop" | "android"; access?: boolean; events?: EventFixture[]; needsReview?: boolean; deferred?: boolean; paused?: boolean } = {}) {
  await page.addInitScript(options => {
    const target = window as unknown as { __social: DoubleState; assistant: unknown; CapacitorCustomPlatform: unknown; Capacitor: unknown };
    const state = target.__social = { access: options.access === true, listener: options.access === true, events: options.events ?? [], needsReview: options.needsReview === true, deferred: options.deferred === true, visibility: "visible", calls: { native: [], generated: [], sends: [], resolves: [], imports: [], computer: 0, models: 0 } };
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state.visibility });
    const sessions = ["qq", "wechat", "bilibili", "weibo", "whatsapp"].map(platform => ({ platform, webAvailable: platform === "wechat", webWindowOpened: false, nativeAvailable: platform === "qq", nativeWindowOpened: false, loggedIn: "unknown", messageAccess: "none", detail: "原生状态替身：登录未验证" }));
    const native = async (method: string, args: Record<string, unknown> = {}) => {
      state.calls.native.push({ method, args });
      if (method === "getSocialStatus") return options.target === "desktop" ? { platform: "win32", sessions } : { platform: "android", notificationAccess: state.access, listenerConnected: state.listener, apps: [{ platform: "qq", name: "QQ", packageName: "com.tencent.mobileqq", installed: true, canLaunch: true }, { platform: "wechat", name: "微信", packageName: "com.tencent.mm", installed: false, canLaunch: false }], capturedCount: state.events.length, notificationsOnly: true, backgroundAutoReply: false };
      if (method === "getSocialNotifications") return { events: state.events };
      if (method === "requestSocialAccess") return { opened: true, instructions: "授权设置替身已打开；请本人开启后返回。" };
      if (method === "openSocialApp") { const session = sessions.find(item => item.platform === args.platform); if (session && args.mode === "web") session.webWindowOpened = true; return { opened: true, detail: "打开官方界面请求已发出，登录状态未验证。" }; }
      if (method === "replySocialNotification") return { status: "unknown", message: "通知回复替身已调用；发送结果未知，请本人核实。" };
      if (method === "addListener") return "listener-double";
      return {};
    };
    const methods = ["getSocialStatus", "getSocialNotifications", "requestSocialAccess", "openSocialApp", "replySocialNotification", "removeListener"];
    if (options.target === "android") {
      target.CapacitorCustomPlatform = { name: "android" };
      target.Capacitor = { PluginHeaders: [{ name: "NativeAssistant", methods: [...methods.map(name => ({ name, rtype: "promise" })), { name: "addListener", rtype: "callback" }] }], nativePromise: (_plugin: string, method: string, args: Record<string, unknown>) => native(method, args), nativeCallback: () => "listener-double" };
    } else if (options.target === "desktop") target.assistant = Object.fromEntries(methods.map(method => [method, (args: Record<string, unknown>) => native(method, args)]));
  }, options);
  // Replace only the app shell with a small component harness. Keep Vite's exact
  // React import so hooks and the imported production component share one runtime.
  await page.route("**/src/App.tsx", async route => {
    const response = await route.fetch();
    const source = await response.text();
    const reactImport = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)?.[1];
    if (!reactImport) throw new Error("Vite React import was not found for the connections harness.");
    await route.fulfill({ response, contentType: "application/javascript", body: `
      import React from ${JSON.stringify(reactImport)};
      import {SocialConnections} from '/src/SocialConnections.tsx';
      import {requireRuntime} from '/src/runtime.ts';
      const {createElement,useState}=React;
      export default function Harness(){
        const [paused,setPaused]=useState(${Boolean(options.paused)});const [notice,setNotice]=useState('');const state=window.__social;
        return createElement('main',null,createElement('div',{role:'status'},notice),createElement(SocialConnections,{
          notify:setNotice,onOpenComputer:()=>{state.calls.computer++},onOpenModels:()=>{state.calls.models++},onOpenApis:()=>{},preferApi:true,
          globallyPaused:paused,onResume:()=>setPaused(false),onUseText:text=>{state.calls.imports.push(text)},
          onGenerateNotification:async event=>{state.calls.generated.push(event);if(state.deferred)await new Promise(resolve=>{state.release=resolve});return {text:'本地模型替身回复 '+event.eventId,requiresReview:state.needsReview,reason:state.needsReview?'测试规则要求本人审核':undefined,jobId:'job:'+event.eventId}},
          onSendNotification:async input=>{state.calls.sends.push(input);if(state.rejectBeforeSend)throw Object.assign(new Error('安全存储替身拒绝，系统发送尚未调用'),{definitelyNotSent:true});return await requireRuntime().replySocialNotification({eventId:input.event.eventId,text:input.draft,consent:true})},
          onResolveNotification:async input=>{state.calls.resolves.push(input)}
        }));
      }
    ` });
  });
  await page.goto(process.env.TC_UI_BASE_URL ?? "http://127.0.0.1:5173");
  await expect(page.getByTestId("social-connections")).toBeVisible();
}
const refresh = (page: Page) => page.getByRole("button", { name: "刷新接入状态", exact: true }).click();
const eventCard = (page: Page, id: string) => page.getByTestId(`social-notification-${id}`);
async function addEvent(page: Page, event: EventFixture) { await page.evaluate(event => { (window as unknown as { __social: DoubleState }).__social.events.push(event); }, event); }

test("browser component exposes honest capability limits and a usable manual import", async ({ page }) => {
  await mount(page);
  await expect(page.getByText("浏览器演示不能读取系统通知或操作聊天应用。", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新接入状态", exact: true })).toBeDisabled();
  await page.getByLabel("要导入的消息文字", { exact: true }).fill("  手动导入替身消息  ");
  await page.getByRole("button", { name: "带到消息中心", exact: true }).click();
  expect((await stateOf(page)).calls.imports).toEqual(["手动导入替身消息"]);
  expect((await stateOf(page)).calls.native).toHaveLength(0);
});

test("desktop native double opens only available official targets without declaring login or message access", async ({ page }) => {
  await mount(page, { target: "desktop" });
  const wechat = page.getByTestId("social-app-wechat");
  const qq = page.getByTestId("social-app-qq");
  await expect(wechat.getByRole("button", { name: "打开本机客户端", exact: true })).toBeDisabled();
  await expect(qq.getByRole("button", { name: "打开官方网页登录", exact: true })).toBeDisabled();
  await wechat.getByRole("button", { name: "打开官方网页登录", exact: true }).click();
  await expect(wechat).toContainText("官方网页窗口已打开。");
  await expect(wechat).toContainText("登录状态未验证");
  await expect(wechat).toContainText("消息读写权限尚未授予");
  await qq.getByRole("button", { name: "打开本机客户端", exact: true }).click();
  await page.getByRole("button", { name: "选择聊天窗口", exact: true }).click();
  const state = await stateOf(page);
  expect(state.calls.native.filter(call => call.method === "openSocialApp").map(call => call.args)).toEqual([{ platform: "wechat", mode: "web" }, { platform: "qq", mode: "native" }]);
  expect(state.calls.computer).toBe(1);
  expect(state.calls.generated).toHaveLength(0);
});

test("Android permission settings double never grants access by merely opening settings", async ({ page }) => {
  await mount(page, { target: "android", events: [notification("permission")] });
  await page.getByRole("button", { name: "打开系统通知使用权设置", exact: true }).click();
  await expect(page.getByTestId("social-access-status")).toContainText("通知使用权未开启");
  expect((await stateOf(page)).calls.native.some(call => call.method === "getSocialNotifications")).toBe(false);
  await expect(page.getByTestId("social-app-wechat").getByRole("button", { name: "打开官方 App", exact: true })).toBeDisabled();
  await page.evaluate(() => { const state = (window as unknown as { __social: DoubleState }).__social; state.access = true; state.listener = true; });
  await refresh(page);
  await expect(eventCard(page, "permission")).toContainText("原始通知正文 permission");
  await expect(eventCard(page, "permission")).toContainText("com.tencent.mobileqq");
  expect((await stateOf(page)).calls.generated).toHaveLength(0);
});

test("notification without RemoteInput supports a local suggestion and copying while send stays disabled", async ({ page }) => {
  await mount(page, { target: "android", access: true, events: [notification("preview", false)] });
  const card = eventCard(page, "preview");
  await card.getByRole("button", { name: "生成回复建议", exact: true }).click();
  await expect(card.getByLabel("回复草稿 preview", { exact: true })).toHaveValue("本地模型替身回复 preview");
  await expect(card.getByRole("button", { name: "审核并发送一次", exact: true })).toBeDisabled();
  await expect(card.getByRole("button", { name: "复制回复草稿", exact: true })).toBeEnabled();
  await card.getByRole("button", { name: "打开此通知的官方 App", exact: true }).click();
  expect((await stateOf(page)).calls.sends).toHaveLength(0);
  expect((await stateOf(page)).calls.native.some(call => call.method === "openSocialApp" && call.args.platform === "qq")).toBe(true);
  await expect(page.getByText("通知回复使用本地模型；API 请先导入消息中心，再明确授权。", { exact: true })).toBeVisible();
});

test("owner approval calls the notification reply double once, stops at unknown, and requires receipt evidence", async ({ page }) => {
  await mount(page, { target: "android", access: true, events: [notification("manual")], needsReview: true });
  const card = eventCard(page, "manual");
  await card.getByRole("button", { name: "生成回复建议", exact: true }).click();
  await expect(card).toContainText("需要本人审核：测试规则要求本人审核");
  expect((await stateOf(page)).calls.sends).toHaveLength(0);
  await card.getByRole("button", { name: "审核并发送一次", exact: true }).click();
  await expect(card.getByTestId("notification-send-result")).toContainText("发送结果未知");
  await refresh(page);
  expect((await stateOf(page)).calls.sends).toEqual([expect.objectContaining({ approved: true, jobId: "job:manual", draft: "本地模型替身回复 manual" })]);
  expect((await stateOf(page)).calls.native.filter(call => call.method === "replySocialNotification")).toHaveLength(1);
  await expect(card.getByRole("button", { name: "本人核实已发送", exact: true })).toBeDisabled();
  await card.getByLabel("核实依据 manual", { exact: true }).fill("本人在官方会话中核对正文和时间，消息已发出");
  await card.getByRole("button", { name: "本人核实已发送", exact: true }).click();
  expect((await stateOf(page)).calls.resolves).toEqual([{ jobId: "job:manual", outcome: "accepted", evidence: "本人在官方会话中核对正文和时间，消息已发出" }]);
});

test("foreground opt-in processes only a new safe notification and stops after an unknown result", async ({ page }) => {
  await mount(page, { target: "android", access: true, events: [notification("old")] });
  await expect(eventCard(page, "old")).toBeVisible();
  const auto = page.getByLabel("仅前台自动回复 QQ", { exact: true });
  await auto.check();
  expect((await stateOf(page)).calls.generated).toHaveLength(0);
  await addEvent(page, notification("new"));
  // No manual refresh: this verifies the foreground two-second poll contract.
  await expect(eventCard(page, "new").getByTestId("notification-send-result")).toContainText("发送结果未知", { timeout: 6000 });
  expect((await stateOf(page)).calls.sends).toEqual([expect.objectContaining({ approved: false, jobId: "job:new" })]);
  await expect(auto).not.toBeChecked();
  await auto.check();
  await addEvent(page, notification("same-notification-update", true, "notification:new"));
  await refresh(page);
  expect((await stateOf(page)).calls.sends).toHaveLength(1);
  expect((await stateOf(page)).calls.generated).toHaveLength(1);
});

test("foreground auto double pauses on review rules and never sends unsupported notification actions", async ({ page }) => {
  await mount(page, { target: "android", access: true, needsReview: true });
  const auto = page.getByLabel("仅前台自动回复 QQ", { exact: true });
  await expect(auto).toBeEnabled(); await auto.check();
  await addEvent(page, notification("unsupported", false)); await refresh(page);
  expect((await stateOf(page)).calls.generated).toHaveLength(0);
  await addEvent(page, notification("review")); await refresh(page);
  await expect(eventCard(page, "review")).toContainText("需要本人审核");
  await expect(auto).not.toBeChecked();
  expect((await stateOf(page)).calls.sends).toHaveLength(0);
});

test("hiding the component during deferred generation revokes foreground auto before the send callback", async ({ page }) => {
  await mount(page, { target: "android", access: true, deferred: true });
  const auto = page.getByLabel("仅前台自动回复 QQ", { exact: true });
  await expect(auto).toBeEnabled(); await auto.check();
  await addEvent(page, notification("deferred")); await refresh(page);
  await expect.poll(async () => (await stateOf(page)).calls.generated.length).toBe(1);
  await page.evaluate(() => { const state = (window as unknown as { __social: DoubleState }).__social; state.visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); state.release?.(); });
  await expect(auto).not.toBeChecked();
  await expect(eventCard(page, "deferred")).toContainText("前台授权已停止");
  const reads = (await stateOf(page)).calls.native.filter(call => call.method === "getSocialNotifications").length;
  await refresh(page);
  expect((await stateOf(page)).calls.native.filter(call => call.method === "getSocialNotifications")).toHaveLength(reads);
  expect((await stateOf(page)).calls.sends).toHaveLength(0);
});

test("an explicit resume is required after the global pause double", async ({ page }) => {
  await mount(page, { target: "android", access: true, events: [notification("paused")], paused: true });
  const generate = eventCard(page, "paused").getByRole("button", { name: "生成回复建议", exact: true });
  await expect(generate).toBeDisabled();
  await expect(page.getByLabel("仅前台自动回复 QQ", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "恢复通知处理", exact: true }).click();
  await expect(generate).toBeEnabled();
  expect((await stateOf(page)).calls.generated).toHaveLength(0);
});

test("revoking notification permission during generation blocks both sending and further notification reads", async ({ page }) => {
  await mount(page, { target: "android", access: true, deferred: true });
  const auto = page.getByLabel("仅前台自动回复 QQ", { exact: true });
  await expect(auto).toBeEnabled(); await auto.check();
  await addEvent(page, notification("revoked")); await refresh(page);
  await expect.poll(async () => (await stateOf(page)).calls.generated.length).toBe(1);
  const reads = (await stateOf(page)).calls.native.filter(call => call.method === "getSocialNotifications").length;
  await page.evaluate(() => { const state = (window as unknown as { __social: DoubleState }).__social; state.access = false; state.listener = false; });
  await refresh(page);
  await page.evaluate(() => { (window as unknown as { __social: DoubleState }).__social.release?.(); });
  await expect(auto).not.toBeChecked(); await expect(auto).toBeDisabled();
  await expect(eventCard(page, "revoked")).toContainText("前台授权已停止");
  expect((await stateOf(page)).calls.sends).toHaveLength(0);
  expect((await stateOf(page)).calls.native.filter(call => call.method === "getSocialNotifications")).toHaveLength(reads);
});

test("Android component fits a narrow display with its source text, draft and receipt controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page, { target: "android", access: true, events: [notification("mobile")] });
  const card = eventCard(page, "mobile");
  await card.getByRole("button", { name: "生成回复建议", exact: true }).click();
  await card.getByRole("button", { name: "审核并发送一次", exact: true }).click();
  await expect(card.getByLabel("核实依据 mobile", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a callback rejection explicitly marked definitely not sent returns to review without calling the native send double", async ({ page }) => {
  await mount(page, { target: "android", access: true, events: [notification("not-sent")] });
  const card = eventCard(page, "not-sent");
  await card.getByRole("button", { name: "生成回复建议", exact: true }).click();
  await page.evaluate(() => { (window as unknown as { __social: DoubleState }).__social.rejectBeforeSend = true; });
  await card.getByRole("button", { name: "审核并发送一次", exact: true }).click();
  await expect(card).toContainText("尚未调用系统发送，请解决问题后重试");
  await expect(card.getByTestId("notification-send-result")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "审核并发送一次", exact: true })).toBeEnabled();
  expect((await stateOf(page)).calls.native.filter(call => call.method === "replySocialNotification")).toHaveLength(0);
  await expect(page.getByLabel("仅前台自动回复 QQ", { exact: true })).not.toBeChecked();
  await page.evaluate(() => { (window as unknown as { __social: DoubleState }).__social.rejectBeforeSend = false; });
  await card.getByRole("button", { name: "审核并发送一次", exact: true }).click();
  await expect(card.getByTestId("notification-send-result")).toContainText("发送结果未知");
  expect((await stateOf(page)).calls.native.filter(call => call.method === "replySocialNotification")).toHaveLength(1);
});

test("only an unattempted review draft can be explicitly regenerated and an unknown result cannot", async ({ page }) => {
  await mount(page, { target: "android", access: true, events: [notification("regenerate")] });
  const card = eventCard(page, "regenerate");
  await card.getByRole("button", { name: "生成回复建议", exact: true }).click();
  await card.getByLabel("回复草稿 regenerate", { exact: true }).fill("本人编辑的旧草稿");
  await card.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(card.getByLabel("回复草稿 regenerate", { exact: true })).toHaveValue("本地模型替身回复 regenerate");
  expect((await stateOf(page)).calls.generated).toHaveLength(2);
  expect((await stateOf(page)).calls.sends).toHaveLength(0);
  await card.getByRole("button", { name: "审核并发送一次", exact: true }).click();
  await expect(card.getByTestId("notification-send-result")).toContainText("发送结果未知");
  await expect(card.getByRole("button", { name: "重新生成", exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "生成回复建议", exact: true })).toBeDisabled();
  expect((await stateOf(page)).calls.generated).toHaveLength(2);
  expect((await stateOf(page)).calls.sends).toHaveLength(1);
});
