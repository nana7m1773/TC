import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat} from 'node:fs/promises';
import path from 'node:path';

const CLIENTS = Object.freeze({
  bilibili: {name: '哔哩哔哩', url: 'https://message.bilibili.com/', domains: ['bilibili.com'], processes: ['bilibili']},
  weibo: {name: '微博', url: 'https://weibo.com/messages', domains: ['weibo.com', 'weibo.cn', 'login.sina.com.cn', 'passport.sina.cn'], processes: ['weibo']},
  whatsapp: {name: 'WhatsApp', url: 'https://web.whatsapp.com/', domains: ['whatsapp.com'], processes: ['whatsapp'], executables: ['WhatsApp.exe']},
  wechat: {name: '微信', url: 'https://wx.qq.com/', domains: ['wx.qq.com', 'wx2.qq.com', 'wx8.qq.com', 'web.wechat.com', 'web2.wechat.com', 'login.wechat.com', 'login.weixin.qq.com'], processes: ['wechat', 'weixin'], executables: ['WeChat.exe', 'Weixin.exe']},
  qq: {name: 'QQ', url: null, domains: [], processes: ['qq', 'qqnt'], executables: ['QQ.exe']},
});
const failure = (code, message) => Object.assign(new Error(message), {code});
function clientFor(platform) {
  if (typeof platform !== 'string' || !Object.hasOwn(CLIENTS, platform)) throw failure('SOCIAL_PLATFORM', '请选择支持的社交平台。');
  return CLIENTS[platform];
}

export function isOfficialSocialUrl(platform, input) {
  const client = clientFor(platform);
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      client.domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

function installationCandidates(platform, environment) {
  const bases = [environment.ProgramFiles, environment['ProgramFiles(x86)'], environment.LOCALAPPDATA]
    .filter(value => typeof value === 'string' && path.win32.isAbsolute(value));
  const relative = {
    wechat: ['Tencent/WeChat/WeChat.exe', 'Tencent/Weixin/Weixin.exe', 'Programs/Tencent/WeChat/WeChat.exe', 'Programs/Tencent/Weixin/Weixin.exe'],
    qq: ['Tencent/QQNT/QQ.exe', 'Tencent/QQNT/Bin/QQ.exe', 'Tencent/QQ/Bin/QQ.exe', 'Programs/Tencent/QQNT/QQ.exe'],
    whatsapp: ['WhatsApp/WhatsApp.exe', 'Programs/WhatsApp/WhatsApp.exe'],
  }[platform] || [];
  return bases.flatMap(base => relative.map(relative => path.win32.join(base, relative)));
}

async function registeredAppPaths(platform, environment) {
  const root = environment.SystemRoot || 'C:\\Windows';
  if (!path.win32.isAbsolute(root)) return [];
  const execute = promisify(execFile);
  const results = [];
  for (const executable of CLIENTS[platform].executables || []) {
    for (const hive of ['HKCU', 'HKLM']) {
      try {
        const {stdout} = await execute(path.win32.join(root, 'System32', 'reg.exe'),
          ['query', `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`, '/ve'],
          {shell: false, windowsHide: true, timeout: 1500, maxBuffer: 8192, encoding: 'utf8'});
        const value = stdout.match(/REG_SZ\s+([^\r\n]+)/)?.[1]?.trim().replace(/^"(.*)"$/, '$1');
        if (value && path.win32.isAbsolute(value) && path.win32.basename(value).toLowerCase() === executable.toLowerCase()) results.push(value);
      } catch { /* A missing App Paths entry is normal. Never expose registry output. */ }
    }
  }
  return results;
}

async function findNativeExecutable(platform, environment) {
  const candidates = [...installationCandidates(platform, environment), ...await registeredAppPaths(platform, environment)];
  for (const candidate of candidates) {
    try { if ((await stat(candidate)).isFile()) return candidate; } catch { /* Continue with other standard installations. */ }
  }
  return null;
}

function launchExecutable(executable) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {shell: false, windowsHide: false, detached: true, stdio: 'ignore', cwd: path.win32.dirname(executable)});
    child.once('error', () => reject(failure('SOCIAL_NATIVE_LAUNCH', '客户端启动失败，请先从 Windows 开始菜单打开官方客户端。')));
    child.once('spawn', () => {child.unref(); resolve();});
  });
}

/** Main-process service. Dependencies are trusted construction inputs, never renderer inputs. */
export function createSocialSessions({BrowserWindow, session, windowsUi, platform = process.platform,
  environment = process.env, findExecutable = findNativeExecutable, launch = launchExecutable} = {}) {
  const webWindows = new Map();
  const nativeOpened = new Set();
  const nativeLaunchRequested = new Set();
  const nativeAvailable = new Set();
  const pendingWeb = new Map();
  const instructions = ['先从官方客户端登录并打开要处理的会话。', '在「桌面界面接入」刷新窗口，选择本次窗口并确认后读取；窗口截图也需要逐次确认。',
    '打开登录窗口不表示已登录，也不授予消息读取或发送权限。'];
  const detailFor = name => name === 'qq' ? 'QQ 个人账号没有可用的官方网页私信入口，请使用本机官方 QQ 客户端和「桌面界面接入」。' :
    name === 'wechat' ? '微信网页版是否允许登录由账号决定；若提示不能使用网页微信，请打开本机微信并到「桌面界面接入」选择窗口。' :
      '请在官方窗口自行登录。登录状态未知；需要处理消息时到「桌面界面接入」选择窗口并确认。';
  const nativePath = async name => {
    if (platform !== 'win32') return null;
    const executable = await findExecutable(name, environment);
    if (executable) nativeAvailable.add(name);
    else nativeAvailable.delete(name);
    return executable;
  };
  const status = name => ({platform: name, name: CLIENTS[name].name, webAvailable: Boolean(CLIENTS[name].url),
    webWindowOpened: Boolean(webWindows.get(name)?.size), windowOpened: Boolean(webWindows.get(name)?.size) || nativeOpened.has(name),
    nativeAvailable: nativeAvailable.has(name), nativeWindowOpened: nativeOpened.has(name), nativeLaunchRequested: nativeLaunchRequested.has(name),
    loggedIn: 'unknown', messageAccess: 'none', detail: detailFor(name)});

  function createWebWindow(name, url, parent) {
    const isolated = session.fromPartition(`persist:lbot-social-${name}`);
    // Keep this Chromium's real browser/OS identity. Removing the shell's product
    // labels avoids unsupported-browser detection; it does not establish login.
    const browserAgent = isolated.getUserAgent().replace(/(?:^|\s)(?:Electron|L-BOT)\/[^\s]+/gi, '').replace(/\s{2,}/g, ' ').trim();
    isolated.setUserAgent(browserAgent);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    const target = new BrowserWindow({width: 1100, height: 800, minWidth: 640, minHeight: 480, title: `${CLIENTS[name].name} · 官方登录窗口`,
      ...(parent ? {parent} : {}), webPreferences: {session: isolated, contextIsolation: true, nodeIntegration: false,
        nodeIntegrationInSubFrames: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false}});
    if (!webWindows.has(name)) webWindows.set(name, new Set());
    const windows = webWindows.get(name);
    windows.add(target);
    target.on('closed', () => windows.delete(target));
    for (const eventName of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
      target.webContents.on(eventName, (event, destination) => {
        const next = typeof destination === 'string' ? destination : event.url;
        if (!isOfficialSocialUrl(name, next)) event.preventDefault();
      });
    }
    target.webContents.setWindowOpenHandler(({url: destination}) => {
      if (isOfficialSocialUrl(name, destination) && windows.size < 5) {
        const popup = createWebWindow(name, destination, target);
        popup.load.catch(() => {});
      }
      return {action: 'deny'};
    });
    // The remote window has no preload and never receives the assistant bridge.
    return {window: target, load: target.loadURL(url)};
  }

  async function openWeb(name) {
    const client = CLIENTS[name];
    if (!client.url) throw failure('SOCIAL_WEB_UNAVAILABLE', detailFor(name));
    const existing = [...(webWindows.get(name) || [])].find(item => !item.isDestroyed());
    if (existing) {if (existing.isMinimized()) existing.restore(); existing.show(); existing.focus();
      return {...status(name), mode: 'web', opened: true, windowOpened: true};}
    if (pendingWeb.has(name)) return pendingWeb.get(name);
    const operation = (async () => {
      const created = createWebWindow(name, client.url);
      try {await created.load; return {...status(name), mode: 'web', opened: true, windowOpened: true};}
      catch {return {...status(name), mode: 'web', opened: true, windowOpened: !created.window.isDestroyed(), pageLoaded: false,
        detail: '官方窗口已创建，但网页未成功加载。请检查网络后重试，或在本机官方客户端登录并使用「桌面界面接入」。'};}
    })();
    pendingWeb.set(name, operation);
    try {return await operation;} finally {pendingWeb.delete(name);}
  }

  return {
    async getSocialStatus() {
      await Promise.all(Object.keys(CLIENTS).map(nativePath));
      return {platform, sessions: Object.keys(CLIENTS).map(status), messageAccess: 'none'};
    },
    async openSocialApp(input = {}) {
      const name = input.platform;
      const client = clientFor(name);
      const mode = input.mode ?? (client.url ? 'web' : 'native');
      if (!['web', 'native'].includes(mode)) throw failure('SOCIAL_MODE', '请选择官方网页窗口或本机客户端。');
      if (mode === 'web') return openWeb(name);
      if (platform !== 'win32') throw failure('SOCIAL_NATIVE_UNSUPPORTED', '本机客户端唤起仅支持 Windows 桌面版；请自行打开官方客户端。');
      if (windowsUi?.listSocialWindows && windowsUi?.activateSocialWindow) {
        let windows = [];
        try {({windows} = await windowsUi.listSocialWindows());} catch { /* A broken UIA provider must not prevent a standard client launch. */ }
        const selected = windows.find(item => item.kind === 'client' && client.processes.includes(item.process));
        if (selected) {
          await windowsUi.activateSocialWindow({selection: selected.selection, expectedTitle: selected.title, consent: true});
          nativeOpened.add(name); nativeAvailable.add(name);
          return {...status(name), mode: 'native', opened: true, windowOpened: true, activated: true,
            detail: '已唤起本机客户端窗口。请在「桌面界面接入」选择会话并确认读取；登录及消息权限仍需实际核验。'};
        }
      }
      const executable = await nativePath(name);
      if (!executable) throw failure('SOCIAL_NATIVE_NOT_FOUND', '未找到此平台的本机客户端。请先安装或从 Windows 开始菜单打开官方客户端，再刷新「桌面界面接入」窗口列表。');
      await launch(executable);
      nativeLaunchRequested.add(name);
      return {...status(name), mode: 'native', opened: true, windowOpened: false, launchRequested: true,
        detail: '已向本机客户端发出启动请求。请核对实际窗口并登录，再在「桌面界面接入」刷新并选择会话。'};
    },
    async requestSocialAccess() {
      if (platform !== 'win32') return {platform, supported: false, windows: [], messageAccess: 'none',
        instructions: ['Windows 10/11 桌面版可逐次选择官方客户端窗口；当前系统请手动导入聊天内容。', ...instructions]};
      const result = await windowsUi.listSocialWindows();
      return {platform, supported: true, windows: result.windows, messageAccess: 'none', instructions};
    },
  };
}
