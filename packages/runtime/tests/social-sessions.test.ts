import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createSocialSessions, isOfficialSocialUrl} from '../social-sessions.mjs';

// These window doubles verify isolation and truthful status, not a real login or Windows client.
function fixture(extra:Record<string, unknown> = {}) {
  const windows:any[] = [], partitions = new Map<string, any>();
  class TestWindow extends EventEmitter {
    options:any; webContents:any; destroyed = false; loaded:string[] = []; focused = false;
    constructor(options:any) {
      super(); this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (handler:any) => {this.webContents.open = handler;};
      windows.push(this);
    }
    async loadURL(url:string) {this.loaded.push(url);}
    isDestroyed() {return this.destroyed;}
    isMinimized() {return false;}
    show() {}
    focus() {this.focused = true;}
    close() {this.destroyed = true; this.emit('closed');}
  }
  const session = {fromPartition(partition:string) {
    if (!partitions.has(partition)) partitions.set(partition, {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) L-BOT/0.2.0 Chrome/152.0.0.0 Electron/44.7.0 Safari/537.36',
      getUserAgent() {return this.userAgent;},
      setUserAgent(userAgent:string) {this.userAgent = userAgent;},
      setPermissionRequestHandler(handler:any) {this.request = handler;},
      setPermissionCheckHandler(handler:any) {this.check = handler;},
    });
    return partitions.get(partition);
  }};
  const service = createSocialSessions({BrowserWindow: TestWindow, session, platform: 'linux', ...extra});
  return {service, windows, partitions};
}

test('navigation accepts each platform official HTTPS login domains and rejects mixed or spoofed origins', () => {
  for (const [platform, url] of [['bilibili', 'https://passport.bilibili.com/login'], ['weibo', 'https://login.sina.com.cn/'],
    ['whatsapp', 'https://web.whatsapp.com/'], ['wechat', 'https://login.wx.qq.com/']]) {
    assert.equal(isOfficialSocialUrl(platform, url), true);
    for (const invalid of ['https://example.com/', 'http://web.whatsapp.com/', 'file:///tmp/test',
      'javascript:alert(1)', 'https://message.bilibili.com.evil.test/', 'https://web.whatsapp.com:8443/',
      'https://user:password@web.whatsapp.com/']) assert.equal(isOfficialSocialUrl(platform, invalid), false);
  }
  assert.equal(isOfficialSocialUrl('qq', 'https://im.qq.com/'), false);
  assert.throws(() => isOfficialSocialUrl('__proto__', 'https://example.com/'), {code: 'SOCIAL_PLATFORM'});
});

test('official web windows have separate persistent sessions with no preload or node and deny device permission', async () => {
  const {service, windows, partitions} = fixture();
  for (const platform of ['bilibili', 'weibo', 'whatsapp', 'wechat']) {
    const opened = await service.openSocialApp({platform, mode: 'web'});
    assert.equal(opened.opened, true); assert.equal(opened.windowOpened, true);
    assert.equal(opened.loggedIn, 'unknown'); assert.equal(opened.messageAccess, 'none');
  }
  assert.equal(partitions.size, 4);
  assert.deepEqual([...partitions.keys()], ['persist:lbot-social-bilibili', 'persist:lbot-social-weibo', 'persist:lbot-social-whatsapp', 'persist:lbot-social-wechat']);
  for (const window of windows) {
    const prefs = window.options.webPreferences;
    assert.equal(prefs.session.getUserAgent(), 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      'only the isolated session shell product tokens are removed; actual OS and Chromium version remain');
    assert.equal(prefs.preload, undefined); assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.nodeIntegrationInSubFrames, false);
    assert.equal(prefs.sandbox, true); assert.equal(prefs.webSecurity, true);
    assert.equal(prefs.webviewTag, false); assert.equal(prefs.allowRunningInsecureContent, false);
    assert.equal(prefs.session.check(), false);
    let allowed = true; prefs.session.request(null, 'media', (value:boolean) => {allowed = value;});
    assert.equal(allowed, false);
  }
  const response = await service.getSocialStatus();
  assert.equal(response.messageAccess, 'none');
  assert.equal(response.sessions.length, 5);
  assert.equal(response.sessions.find((item:any) => item.platform === 'qq').webAvailable, false);
  assert.match(response.sessions.find((item:any) => item.platform === 'wechat').detail, /账号/);
  assert.equal(JSON.stringify(response).includes('cookie'), false);
});

test('remote navigation and popups are bounded to the same platform and reuse safe isolated preferences', async () => {
  const {service, windows} = fixture();
  await service.openSocialApp({platform: 'bilibili'});
  const initial = windows[0];
  for (const type of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
    let prevented = false;
    initial.webContents.emit(type, {preventDefault() {prevented = true;}}, 'https://evil.test/');
    assert.equal(prevented, true);
    prevented = false;
    initial.webContents.emit(type, {preventDefault() {prevented = true;}}, 'https://passport.bilibili.com/login');
    assert.equal(prevented, false);
  }
  assert.deepEqual(initial.webContents.open({url: 'https://evil.test/'}), {action: 'deny'});
  assert.equal(windows.length, 1);
  initial.webContents.open({url: 'https://passport.bilibili.com/login'});
  assert.equal(windows.length, 2);
  assert.equal(windows[1].options.webPreferences.preload, undefined);
  assert.equal(windows[1].options.webPreferences.session, initial.options.webPreferences.session);
  for (let index = 0; index < 20; index++) initial.webContents.open({url: 'https://passport.bilibili.com/login'});
  assert.equal(windows.length, 5);
  const reused = await service.openSocialApp({platform: 'bilibili'});
  assert.equal(reused.messageAccess, 'none'); assert.equal(windows.length, 5);
  for (const window of windows) window.close();
  assert.equal((await service.getSocialStatus()).sessions[0].webWindowOpened, false);
});

test('QQ refuses invented personal web login and native launch is explicit and honest', async () => {
  const launches:string[] = [];
  const {service, windows} = fixture({platform: 'win32', findExecutable: async () => 'C:\\Program Files\\Tencent\\QQNT\\QQ.exe',
    launch: async (file:string) => {launches.push(file);}});
  await assert.rejects(service.openSocialApp({platform: 'qq', mode: 'web'}), {code: 'SOCIAL_WEB_UNAVAILABLE'});
  assert.equal(windows.length, 0);
  const opened = await service.openSocialApp({platform: 'qq', mode: 'native'});
  assert.deepEqual(launches, ['C:\\Program Files\\Tencent\\QQNT\\QQ.exe']);
  assert.equal(opened.launchRequested, true); assert.equal(opened.windowOpened, false);
  assert.equal(opened.nativeWindowOpened, false); assert.equal(opened.loggedIn, 'unknown'); assert.equal(opened.messageAccess, 'none');
  assert.match(opened.detail, /核对实际窗口/);
  const missing = fixture({platform: 'win32', findExecutable: async () => null});
  await assert.rejects(missing.service.openSocialApp({platform: 'qq'}), {code: 'SOCIAL_NATIVE_NOT_FOUND'});
});

test('native action activates only a matching enumerated official client and never reads messages', async () => {
  const calls:any[] = [];
  const selected = {selection: 'opaque-selection', title: '微信', process: 'weixin', kind: 'client'};
  const windowsUi = {listSocialWindows: async () => {calls.push('list'); return {windows: [
    {selection: 'browser', title: '微信', process: 'chrome', kind: 'browser'}, selected]};},
    activateSocialWindow: async (input:any) => {calls.push(input); return {activated: true};},
    readSocialWindow: () => {throw new Error('must not read');}};
  const {service} = fixture({platform: 'win32', windowsUi, findExecutable: () => {throw new Error('must not probe');}});
  const response = await service.openSocialApp({platform: 'wechat', mode: 'native'});
  assert.deepEqual(calls, ['list', {selection: selected.selection, expectedTitle: selected.title, consent: true}]);
  assert.equal(response.activated, true); assert.equal(response.windowOpened, true);
  assert.equal(response.loggedIn, 'unknown'); assert.equal(response.messageAccess, 'none');
});

test('access requests enumerate Windows choices without claiming OAuth or granted message access', async () => {
  let calls = 0;
  const windows = [{selection: 'opaque', title: 'QQ', process: 'qq', kind: 'client'}];
  const {service} = fixture({platform: 'win32', windowsUi: {listSocialWindows: async () => {calls++; return {supported: true, windows};}},
    findExecutable: async () => null});
  const status = await service.getSocialStatus(); assert.equal(calls, 0, 'status does not invalidate active selection tokens');
  assert.equal(status.sessions.every((item:any) => item.messageAccess === 'none'), true);
  const access = await service.requestSocialAccess(); assert.equal(calls, 1);
  assert.equal(access.supported, true); assert.deepEqual(access.windows, windows);
  assert.equal(access.messageAccess, 'none'); assert.match(access.instructions.join(' '), /确认/);
  const unsupported = await fixture().service.requestSocialAccess();
  assert.equal(unsupported.supported, false); assert.deepEqual(unsupported.windows, []);
  await assert.rejects(fixture().service.openSocialApp({platform: 'qq', mode: 'native'}), {code: 'SOCIAL_NATIVE_UNSUPPORTED'});
});

test('desktop IPC exposes only exact session operations to its existing trusted main-frame sender guard', async () => {
  const preload = await readFile(new URL('../../../apps/desktop/preload.cjs', import.meta.url), 'utf8');
  const main = await readFile(new URL('../../../apps/desktop/main.cjs', import.meta.url), 'utf8');
  for (const method of ['getSocialStatus', 'openSocialApp', 'requestSocialAccess', 'activateSocialWindow']) {
    assert.ok(preload.includes(`'${method}'`)); assert.ok(main.includes(`register('${method}'`));
  }
  assert.ok(main.includes('event.senderFrame!==window.webContents.mainFrame'));
  assert.ok(main.includes('if(!senderAllowed(event))'));
});
