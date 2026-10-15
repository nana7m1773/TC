import {spawn} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateLocalImage} from './images.mjs';

const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_CAPTURE_OUTPUT_BYTES = 7_050_000;
const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;
const MAX_JSON_DEPTH = 8;
const MAX_WINDOWS = 100;
const MAX_CONTROLS = 160;
const MAX_TEXT_LENGTH = 16000;
const SELECTION_LIFETIME_MS = 30 * 60 * 1000;
const REPLY_TICKET_LIFETIME_MS = 30 * 1000;
const SCRIPT_PATH = fileURLToPath(new URL('../../apps/desktop/windows-ui.ps1', import.meta.url))
  .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
const CLIENTS = new Set(['wechat', 'weixin', 'qq', 'qqnt', 'whatsapp', 'bilibili', 'weibo']);
const BROWSERS = new Set(['msedge', 'chrome', 'firefox']);
const MESSAGES = {
  WINDOWS_UI_UNSUPPORTED: '窗口访问仅支持 Windows 10/11 桌面版。',
  WINDOWS_UI_CONSENT: '请明确同意本次所选窗口操作，再继续。',
  WINDOWS_UI_SELECTION: '请选择本次枚举中的窗口；选择已失效时请重新刷新。',
  WINDOWS_UI_CHANGED: '窗口已关闭、切换身份或标题已改变。请重新选择并确认后再读取。',
  WINDOWS_UI_UNAVAILABLE: '该窗口没有提供可安全读取的可见辅助功能文本。可查看窗口截图，或在官方客户端手动复制。',
  WINDOWS_UI_TIMEOUT: '读取窗口超时，已停止本次读取。请在官方客户端确认窗口状态后重试。',
  WINDOWS_UI_OUTPUT: '窗口返回的数据超过安全限制或格式无效，本次内容未读取。',
  WINDOWS_UI_FAILED: '本机窗口访问失败。请确认客户端正常打开且与 L-BOT 具有相同的权限级别后重试。',
  WINDOWS_UI_CAPTURE: '该窗口未能提供截图。请在官方客户端确认窗口正常显示，或手动复制内容。',
  WINDOWS_UI_CAPTURE_PROTECTED: '窗口已明确启用捕获保护，本次没有截图。',
  WINDOWS_UI_CAPTURE_DIMENSIONS: '窗口尺寸无效或超过 400 万像素，请缩小窗口后重新选择。',
  WINDOWS_UI_UNSUPPORTED_INPUT: '请选择要操作的输入框与发送方式；若没有可核验的编辑控件，请在客户端手动发送。',
  WINDOWS_UI_KEYBOARD_TEXT: 'Unicode 键盘输入目前支持单行回复；多行内容请改用 UIA 输入或在客户端手动编辑。',
  WINDOWS_UI_DRAFT_PRESENT: '输入框已有草稿，本次已停止。请在官方客户端处理草稿后重新读取。',
  WINDOWS_UI_DRAFT_CHANGED: '输入框内容、焦点或所选窗口发生变化，本次已停止。请核对草稿与目标窗口后重新读取。',
  WINDOWS_UI_SNAPSHOT_CHANGED: '可见会话预览已变化。请重新读取并确认本次回复。',
  WINDOWS_UI_TICKET: '发送凭证已使用或失效。请重新读取并准备本次回复。',
  WINDOWS_UI_REPLY_TEXT: '本次回复需要 1 至 4,000 个字符，且不能含不可见控制字符。',
  WINDOWS_UI_REPLY_INTERRUPTED: '本次发送过程无法确认。请在官方客户端核对草稿与发送状态；系统不会自动重试。',
};

export class WindowsUiError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(MESSAGES, code) ? code : 'WINDOWS_UI_FAILED';
    super(MESSAGES[safeCode]);
    this.name = 'WindowsUiError';
    this.code = safeCode;
  }
}

const fail = code => { throw new WindowsUiError(code); };
const ownObject = value => value && typeof value === 'object' && !Array.isArray(value);
const safeString = (value, max) => typeof value === 'string' && value.length <= max && !value.includes('\0');

function identity(value) {
  if (!ownObject(value) || !safeString(value.title, 1024) || !value.title.trim() ||
      typeof value.handle !== 'string' || !/^[1-9]\d{0,18}$/.test(value.handle) ||
      !Number.isSafeInteger(value.processId) || value.processId < 1 ||
      !safeString(value.startedAt, 64) || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value.startedAt) ||
      !safeString(value.process, 64) || !value.process.trim() || /[\u0000-\u001f\u007f/\\]/.test(value.process) ||
      value.kind !== (BROWSERS.has(value.process) ? 'browser' : CLIENTS.has(value.process) ? 'client' : 'application')) fail('WINDOWS_UI_OUTPUT');
  const result = {handle: value.handle, title: value.title, process: value.process,
    processId: value.processId, startedAt: value.startedAt, kind: value.kind};
  if (value.signature !== undefined) {
    if (!ownObject(value.signature) || !['verified', 'unverified'].includes(value.signature.status) ||
        (value.signature.publisher !== null && !safeString(value.signature.publisher, 256))) fail('WINDOWS_UI_OUTPUT');
    result.signature = {status: value.signature.status, publisher: value.signature.publisher};
  }
  return result;
}

function sameIdentity(left, right) {
  return ['handle', 'title', 'process', 'processId', 'startedAt', 'kind'].every(key => left[key] === right[key]);
}

function replySummary(raw) {
  if (raw === undefined) return {canSend: false, reasonCode: 'WINDOWS_UI_UNSUPPORTED_INPUT', inputFingerprint: null,
    imeLayout: null, method: 'uia-value-pattern', sendAction: 'button', selectedInputTarget: null};
  if (!ownObject(raw) || typeof raw.canSend !== 'boolean' ||
      (raw.inputFingerprint !== null && (typeof raw.inputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(raw.inputFingerprint))) ||
      (raw.imeLayout !== null && (typeof raw.imeLayout !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(raw.imeLayout)))) fail('WINDOWS_UI_OUTPUT');
  const reasonCode = ['WINDOWS_UI_UNSUPPORTED_INPUT', 'WINDOWS_UI_DRAFT_PRESENT', 'WINDOWS_UI_DRAFT_CHANGED'].includes(raw.reasonCode)
    ? raw.reasonCode : 'WINDOWS_UI_UNSUPPORTED_INPUT';
  const method = raw.method ?? 'uia-value-pattern', sendAction = raw.sendAction ?? 'button';
  const selectedInputTarget = raw.selectedInputTarget ?? null;
  if (!['uia-value-pattern', 'unicode-keyboard'].includes(method) || !['button', 'enter', 'ctrl-enter'].includes(sendAction) ||
      (method === 'uia-value-pattern' && sendAction !== 'button') ||
      (selectedInputTarget !== null && (typeof selectedInputTarget !== 'string' || !/^[a-f0-9]{64}$/.test(selectedInputTarget))) ||
      (raw.canSend && raw.inputFingerprint === null)) fail('WINDOWS_UI_OUTPUT');
  return {canSend: raw.canSend, reasonCode, inputFingerprint: raw.inputFingerprint, imeLayout: raw.imeLayout,
    method, sendAction, selectedInputTarget};
}

function inputTargets(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) fail('WINDOWS_UI_OUTPUT');
  const targets = value.map(target => {
    if (!ownObject(target) || typeof target.id !== 'string' || !/^[a-f0-9]{64}$/.test(target.id) ||
        !safeString(target.label, 200) || !target.label.trim() ||
        !['uia-value-pattern', 'unicode-keyboard'].includes(target.method) ||
        !['button', 'enter', 'ctrl-enter'].includes(target.sendAction) ||
        (target.method === 'uia-value-pattern' && target.sendAction !== 'button')) fail('WINDOWS_UI_OUTPUT');
    return {id: target.id, label: target.label, method: target.method, sendAction: target.sendAction};
  });
  if (new Set(targets.map(target => target.id)).size !== targets.length) fail('WINDOWS_UI_OUTPUT');
  return targets;
}

function inputMetadata(reply) {
  return {method: reply.method, imeBypassed: true, imeLayout: reply.imeLayout,
    switchesInputMethod: false, compositionState: 'unknown'};
}

function validatedPreview(result, expected) {
  if (!safeString(result.text, MAX_TEXT_LENGTH) || !Array.isArray(result.controls) || result.controls.length > MAX_CONTROLS ||
      typeof result.truncated !== 'boolean') fail('WINDOWS_UI_OUTPUT');
  const controls = result.controls.map(control => {
    if (!ownObject(control) || !safeString(control.name, 512) || !control.name.trim() ||
        !safeString(control.type, 32) || !/^[A-Za-z]+$/.test(control.type) || ['Edit', 'ComboBox'].includes(control.type)) fail('WINDOWS_UI_OUTPUT');
    return {type: control.type, name: control.name};
  });
  const reply = replySummary(result.reply), targets = inputTargets(result.inputTargets);
  if (reply.selectedInputTarget !== null && !targets.some(target => target.id === reply.selectedInputTarget &&
      target.method === reply.method && target.sendAction === reply.sendAction)) fail('WINDOWS_UI_OUTPUT');
  if (reply.method === 'unicode-keyboard' && reply.selectedInputTarget === null) fail('WINDOWS_UI_OUTPUT');
  if (result.truncated) { reply.canSend = false; reply.reasonCode = 'WINDOWS_UI_UNSUPPORTED_INPUT'; }
  // NUL separators and the exact ordered fields are mirrored by the fixed PowerShell script.
  const parts = ['TC-WINDOW-PREVIEW-1', expected.handle, String(expected.processId), expected.startedAt,
    expected.title, expected.process, expected.kind, result.text, result.truncated ? '1' : '0', reply.inputFingerprint || ''];
  for (const control of controls) parts.push(control.type, control.name);
  const snapshot = createHash('sha256').update(parts.join('\0'), 'utf8').digest('hex');
  if (result.snapshot !== undefined && result.snapshot !== snapshot) fail('WINDOWS_UI_OUTPUT');
  if (result.canCapture !== undefined && typeof result.canCapture !== 'boolean') fail('WINDOWS_UI_OUTPUT');
  const canRead = Boolean(controls.length && result.text.trim());
  return {text: result.text, controls, truncated: result.truncated, snapshot,
    inputFingerprint: reply.inputFingerprint, conversationTitle: null, inputTargets: targets,
    selectedInputTarget: reply.selectedInputTarget,
    capability: {canRead, canCapture: result.canCapture !== false, canType: reply.canSend, canSend: reply.canSend,
      reason: reply.canSend ? '' : MESSAGES[reply.reasonCode], reasonCode: reply.canSend ? null : reply.reasonCode},
    input: inputMetadata(reply), reply};
}

function validReplyText(text) {
  return safeString(text, 4000) && Boolean(text.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
}

function replyBinding(value, reply) {
  const runtimeId = id => typeof id === 'string' && /^-?\d{1,10}(,-?\d{1,10}){0,63}$/.test(id);
  if (!ownObject(value) || !runtimeId(value.editorId) || value.inputFingerprint !== reply.inputFingerprint) fail('WINDOWS_UI_OUTPUT');
  if (reply.selectedInputTarget === null) {
    if (!runtimeId(value.buttonId) || value.editorId === value.buttonId) fail('WINDOWS_UI_OUTPUT');
    return {editorId: value.editorId, buttonId: value.buttonId, inputFingerprint: value.inputFingerprint};
  }
  if ((reply.sendAction === 'button' ? !runtimeId(value.buttonId) || value.editorId === value.buttonId : value.buttonId !== '') ||
      value.targetId !== reply.selectedInputTarget || value.method !== reply.method || value.sendAction !== reply.sendAction) fail('WINDOWS_UI_OUTPUT');
  return {editorId: value.editorId, buttonId: value.buttonId, inputFingerprint: value.inputFingerprint,
    targetId: value.targetId, method: value.method, sendAction: value.sendAction};
}

function boundedJson(raw) {
  let depth = 0, quoted = false, escaped = false;
  for (const character of raw) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      if (++depth > MAX_JSON_DEPTH) fail('WINDOWS_UI_OUTPUT');
    } else if (character === '}' || character === ']') depth--;
  }
  try { return JSON.parse(raw.replace(/^\uFEFF/, '')); }
  catch { fail('WINDOWS_UI_OUTPUT'); }
}

/** Fixed local executable/script only. Neither the caller nor window titles become shell code. */
function executeLocalPowerShell({input, maxOutputBytes}) {
  return new Promise((resolve, reject) => {
    const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
    if (!path.win32.isAbsolute(windowsRoot)) return reject(new WindowsUiError('WINDOWS_UI_FAILED'));
    const executable = path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    let child;
    try {
      child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
        '-File', SCRIPT_PATH], {shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    } catch { return reject(new WindowsUiError('WINDOWS_UI_FAILED')); }
    let settled = false, size = 0;
    const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { child.kill(); reject(error); }
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new WindowsUiError('WINDOWS_UI_TIMEOUT')), 15000);
    child.once('error', () => finish(new WindowsUiError('WINDOWS_UI_FAILED')));
    child.stdin.once('error', () => finish(new WindowsUiError('WINDOWS_UI_FAILED')));
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxOutputBytes) return finish(new WindowsUiError('WINDOWS_UI_OUTPUT'));
      chunks.push(chunk);
    });
    // Native/provider diagnostics may contain private UI text. Never retain or expose stderr.
    child.stderr.on('data', () => {});
    child.once('close', code => finish(code === 0 ? null : new WindowsUiError('WINDOWS_UI_FAILED'),
      {stdout: Buffer.concat(chunks).toString('utf8'), exitCode: code}));
    child.stdin.end(input, 'utf8');
  });
}

/**
 * Trusted main-process factory. executePowerShell is a test seam, never an IPC input.
 * Test substitutes exercise the protocol; they do not demonstrate Windows UIA availability.
 */
export function createWindowsUiReader({platform = process.platform, executePowerShell = executeLocalPowerShell,
  now = Date.now} = {}) {
  const selections = new Map();
  const tickets = new Map();
  const committingSelections = new Set();
  const requireWindows = () => { if (platform !== 'win32') fail('WINDOWS_UI_UNSUPPORTED'); };
  const invoke = async request => {
    const maxOutputBytes = request.operation === 'capture' ? MAX_CAPTURE_OUTPUT_BYTES : MAX_OUTPUT_BYTES;
    let response;
    try { response = await executePowerShell({input: JSON.stringify(request), maxOutputBytes}); }
    catch (error) {
      if (error instanceof WindowsUiError) throw new WindowsUiError(error.code);
      fail('WINDOWS_UI_FAILED');
    }
    if (!ownObject(response) || response.exitCode !== 0 || typeof response.stdout !== 'string') fail('WINDOWS_UI_FAILED');
    if (Buffer.byteLength(response.stdout, 'utf8') > maxOutputBytes) fail('WINDOWS_UI_OUTPUT');
    const result = boundedJson(response.stdout);
    if (!ownObject(result)) fail('WINDOWS_UI_OUTPUT');
    if (result.ok !== true) fail(typeof result.code === 'string' ? result.code : 'WINDOWS_UI_FAILED');
    return result;
  };
  const prune = () => {
    for (const [token, value] of selections) if (now() - value.createdAt > SELECTION_LIFETIME_MS) selections.delete(token);
    for (const [token, value] of tickets) if (now() >= value.expiresAt || selections.get(value.selection) !== value.selected) tickets.delete(token);
  };
  const accessSelected = async (input, operation, extra = {}) => {
    requireWindows();
    if (!ownObject(input) || input.consent !== true) fail('WINDOWS_UI_CONSENT');
    prune();
    const selected = typeof input.selection === 'string' ? selections.get(input.selection) : null;
    if (!selected) fail('WINDOWS_UI_SELECTION');
    const expected = selected.window;
    if (input.expectedTitle !== expected.title) fail('WINDOWS_UI_CHANGED');
    if (input.inputTarget !== undefined && (typeof input.inputTarget !== 'string' || !/^[a-f0-9]{64}$/.test(input.inputTarget))) fail('WINDOWS_UI_UNSUPPORTED_INPUT');
    const target = input.inputTarget === undefined ? {} : {inputTarget: input.inputTarget};
    const result = await invoke({operation, consent: true, window: expected, ...target, ...extra});
    prune();
    if (selections.get(input.selection) !== selected) fail('WINDOWS_UI_SELECTION');
    const before = identity(result.before), after = identity(result.after);
    if (!sameIdentity(expected, before) || !sameIdentity(expected, after)) {
      selections.delete(input.selection);
      fail('WINDOWS_UI_CHANGED');
    }
    return {result, expected, selected};
  };
  const previewMetadata = (input, expected) => ({selection: input.selection, title: expected.title,
    process: expected.process, handle: expected.handle, kind: expected.kind,
    capturedAt: new Date(now()).toISOString(), processingLocation: 'local', requiresReview: true});

  return {
    async listSocialWindows() {
      requireWindows();
      const result = await invoke({operation: 'list'});
      if (!Array.isArray(result.windows) || result.windows.length > MAX_WINDOWS) fail('WINDOWS_UI_OUTPUT');
      const candidates = result.windows.map(identity);
      if (new Set(candidates.map(window => window.handle)).size !== candidates.length) fail('WINDOWS_UI_OUTPUT');
      selections.clear();
      tickets.clear();
      const windows = candidates.map(window => {
        const selection = randomUUID();
        selections.set(selection, {window, createdAt: now()});
        return {selection, title: window.title, process: window.process, handle: window.handle, kind: window.kind,
          ...(window.signature ? {signature: window.signature} : {})};
      });
      return {supported: true, windows};
    },
    async readSocialWindow(input) {
      const {result, expected} = await accessSelected(input, 'read');
      const {reply, ...preview} = validatedPreview(result, expected);
      if (input.inputTarget !== undefined && preview.selectedInputTarget !== input.inputTarget) fail('WINDOWS_UI_UNSUPPORTED_INPUT');
      // Return only bounded fields. Unexpected provider/script metadata never crosses IPC.
      return {...previewMetadata(input, expected), ...preview};
    },
    async prepareSocialReply(input) {
      requireWindows();
      if (!ownObject(input) || input.consent !== true) fail('WINDOWS_UI_CONSENT');
      if (!validReplyText(input.text)) fail('WINDOWS_UI_REPLY_TEXT');
      if (typeof input.expectedSnapshot !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedSnapshot)) fail('WINDOWS_UI_SNAPSHOT_CHANGED');
      if (committingSelections.has(input.selection)) fail('WINDOWS_UI_DRAFT_CHANGED');
      const {result, expected, selected} = await accessSelected(input, 'prepare',
        {text: input.text, expectedSnapshot: input.expectedSnapshot});
      if (committingSelections.has(input.selection)) fail('WINDOWS_UI_DRAFT_CHANGED');
      const {reply, ...preview} = validatedPreview(result, expected);
      if (preview.snapshot !== input.expectedSnapshot) fail('WINDOWS_UI_SNAPSHOT_CHANGED');
      if (!reply.canSend) fail(reply.reasonCode);
      if (input.inputTarget !== undefined && preview.selectedInputTarget !== input.inputTarget) fail('WINDOWS_UI_UNSUPPORTED_INPUT');
      if (reply.method === 'unicode-keyboard' && input.inputTarget !== preview.selectedInputTarget) fail('WINDOWS_UI_UNSUPPORTED_INPUT');
      if (reply.method === 'unicode-keyboard' && /[\r\n\t]/.test(input.text)) fail('WINDOWS_UI_KEYBOARD_TEXT');
      const binding = replyBinding(result.binding, reply);
      for (const [token, value] of tickets) if (value.selection === input.selection) tickets.delete(token);
      const ticket = randomUUID(), expiresAt = now() + REPLY_TICKET_LIFETIME_MS;
      tickets.set(ticket, {selection: input.selection, selected, window: expected, text: input.text,
        snapshot: preview.snapshot, binding, expiresAt, inputTarget: preview.selectedInputTarget});
      return {...previewMetadata(input, expected), ticket, expiresAt,
        text: input.text, preview, input: preview.input};
    },
    async commitSocialReply(input) {
      requireWindows();
      if (!ownObject(input) || input.consent !== true) fail('WINDOWS_UI_CONSENT');
      prune();
      const prepared = typeof input.ticket === 'string' ? tickets.get(input.ticket) : null;
      if (!prepared) fail('WINDOWS_UI_TICKET');
      // Consume before any await: simultaneous/retried commits cannot replay a send.
      tickets.delete(input.ticket);
      if (committingSelections.has(prepared.selection)) fail('WINDOWS_UI_TICKET');
      committingSelections.add(prepared.selection);
      const selectedInput = {selection: prepared.selection, consent: true, expectedTitle: prepared.window.title,
        ...(prepared.inputTarget ? {inputTarget: prepared.inputTarget} : {})};
      try {
        const {result, expected} = await accessSelected(selectedInput, 'commit',
          {text: prepared.text, expectedSnapshot: prepared.snapshot, binding: prepared.binding, expiresAt: prepared.expiresAt});
        if (result.status !== 'unknown') fail('WINDOWS_UI_REPLY_INTERRUPTED');
        const reply = replySummary(result.reply);
        if (reply.inputFingerprint !== prepared.binding.inputFingerprint || reply.method !== (prepared.binding.method ?? 'uia-value-pattern') ||
            reply.sendAction !== (prepared.binding.sendAction ?? 'button') || reply.selectedInputTarget !== prepared.inputTarget) fail('WINDOWS_UI_REPLY_INTERRUPTED');
        return {...previewMetadata(selectedInput, expected), status: 'unknown', text: prepared.text,
          input: inputMetadata(reply),
          message: '已尝试通过所选窗口和发送方式提交回复，请在客户端核对。本次未确认消息发出或送达，不会自动重试。'};
      } catch (error) {
        if (error instanceof WindowsUiError && ['WINDOWS_UI_UNSUPPORTED_INPUT', 'WINDOWS_UI_DRAFT_PRESENT',
          'WINDOWS_UI_DRAFT_CHANGED', 'WINDOWS_UI_SNAPSHOT_CHANGED', 'WINDOWS_UI_KEYBOARD_TEXT'].includes(error.code)) throw error;
        // Process errors/timeouts/changed identities after invocation can follow a partial action.
        fail('WINDOWS_UI_REPLY_INTERRUPTED');
      } finally {
        committingSelections.delete(prepared.selection);
      }
    },
    async activateSocialWindow(input) {
      const {result, expected} = await accessSelected(input, 'activate');
      if (result.activated !== true) fail('WINDOWS_UI_FAILED');
      return {...previewMetadata(input, expected), activated: true};
    },
    async captureSocialWindow(input) {
      const {result, expected} = await accessSelected(input, 'capture');
      const image = result.image;
      if (!ownObject(image) || !Number.isInteger(image.originalWidth) || !Number.isInteger(image.originalHeight) ||
          image.originalWidth < 1 || image.originalHeight < 1 || image.originalWidth > 4_000_000 ||
          image.originalHeight > 4_000_000 || image.originalWidth * image.originalHeight > 4_000_000 ||
          typeof image.data !== 'string' || !image.data.startsWith('data:image/png;base64,') ||
          image.mime !== 'image/png' || !Number.isInteger(image.sizeBytes) || image.sizeBytes > MAX_CAPTURE_BYTES ||
          image.sizeBytes < 24) fail('WINDOWS_UI_OUTPUT');
      let validated;
      try { validated = validateLocalImage({data: image.data}); }
      catch { fail('WINDOWS_UI_OUTPUT'); }
      if (Buffer.from(image.data.slice('data:image/png;base64,'.length), 'base64').toString('base64') !==
          image.data.slice('data:image/png;base64,'.length)) fail('WINDOWS_UI_OUTPUT');
      const scale = Math.min(1, 1280 / Math.max(image.originalWidth, image.originalHeight));
      if (validated.width !== image.width || validated.height !== image.height || validated.sizeBytes !== image.sizeBytes ||
          image.width !== Math.max(1, Math.floor(image.originalWidth * scale)) ||
          image.height !== Math.max(1, Math.floor(image.originalHeight * scale))) fail('WINDOWS_UI_OUTPUT');
      if (result.captureProtection !== undefined && !['none', 'unavailable'].includes(result.captureProtection)) fail('WINDOWS_UI_OUTPUT');
      return {...previewMetadata(input, expected), captureProtection: result.captureProtection ?? 'unavailable', image: {...validated,
        originalWidth: image.originalWidth, originalHeight: image.originalHeight}};
    },
  };
}

const localReader = createWindowsUiReader();
export const listSocialWindows = () => localReader.listSocialWindows();
export const readSocialWindow = input => localReader.readSocialWindow(input);
export const captureSocialWindow = input => localReader.captureSocialWindow(input);
export const prepareSocialReply = input => localReader.prepareSocialReply(input);
export const commitSocialReply = input => localReader.commitSocialReply(input);

export const activateSocialWindow = input => localReader.activateSocialWindow(input);
