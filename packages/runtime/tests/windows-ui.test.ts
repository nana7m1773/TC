import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createWindowsUiReader, listSocialWindows, readSocialWindow, captureSocialWindow, prepareSocialReply, commitSocialReply, WindowsUiError} from '../windows-ui.mjs';

// These explicitly injected execution substitutes validate the JSON protocol and rejection paths.
// They do not run PowerShell, capture a real window, or demonstrate any real app's UIA support.
const windowIdentity = {handle: '123456', title: '微信 · 测试窗口', process: 'wechat', processId: 987,
  startedAt: '2026-10-13T10:00:00.1234567Z', kind: 'client'};
const controls = [{type: 'Text', name: '仅在界面中可见的文字 👋'}, {type: 'Button', name: '返回'}];
const readResult = (extra:Record<string, unknown> = {}) => ({ok: true, before: {...windowIdentity},
  after: {...windowIdentity}, text: controls.map(control => control.name).join('\n'), controls,
  truncated: false, ...extra});
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlAAAAABJRU5ErkJggg==';
const capturedImage = {data: png, width: 1, height: 1, sizeBytes: Buffer.from(png.split(',')[1], 'base64').length,
  mime: 'image/png', originalWidth: 1, originalHeight: 1};
const captureResult = (extra:Record<string, unknown> = {}) => ({ok: true, before: {...windowIdentity},
  after: {...windowIdentity}, image: {...capturedImage}, ...extra});
const output = (value:unknown) => ({stdout: JSON.stringify(value), exitCode: 0});
const fixture = (read:unknown = readResult(), windows:unknown[] = [{...windowIdentity}]) => {
  const requests:any[] = [];
  const reader = createWindowsUiReader({platform: 'win32', executePowerShell: async ({input}:{input:string}) => {
    const request = JSON.parse(input); requests.push(request);
    return output(request.operation === 'list' ? {ok: true, windows} : read);
  }});
  return {reader, requests};
};

test('Linux is explicitly unsupported and never runs the PowerShell substitute', async () => {
  let executions = 0;
  const reader = createWindowsUiReader({platform: 'linux', executePowerShell: async () => { executions++; throw new Error('must not run'); }});
  await assert.rejects(reader.listSocialWindows(), {code: 'WINDOWS_UI_UNSUPPORTED'});
  await assert.rejects(reader.readSocialWindow({consent: true}), {code: 'WINDOWS_UI_UNSUPPORTED'});
  await assert.rejects(reader.captureSocialWindow({consent: true}), {code: 'WINDOWS_UI_UNSUPPORTED'});
  await assert.rejects(reader.prepareSocialReply({consent: true}), {code: 'WINDOWS_UI_UNSUPPORTED'});
  await assert.rejects(reader.commitSocialReply({consent: true}), {code: 'WINDOWS_UI_UNSUPPORTED'});
  assert.equal(executions, 0);
  if (process.platform !== 'win32') {
    await assert.rejects(listSocialWindows(), {code: 'WINDOWS_UI_UNSUPPORTED'});
    await assert.rejects(readSocialWindow({consent: true}), {code: 'WINDOWS_UI_UNSUPPORTED'});
    await assert.rejects(captureSocialWindow({consent: true}), {code: 'WINDOWS_UI_UNSUPPORTED'});
    await assert.rejects(prepareSocialReply({consent: true}), {code: 'WINDOWS_UI_UNSUPPORTED'});
    await assert.rejects(commitSocialReply({consent: true}), {code: 'WINDOWS_UI_UNSUPPORTED'});
  }
});

test('0, 1, and multiple enumerated windows produce opaque tokens and bounded public fields', async () => {
  for (const count of [0, 1, 3]) {
    const {reader} = fixture(readResult(), Array.from({length: count}, (_, index) => ({...windowIdentity,
      handle: String(123456 + index), processId: 987 + index})));
    const result = await reader.listSocialWindows();
    assert.equal(result.supported, true);
    assert.equal(result.windows.length, count);
    assert.equal(new Set(result.windows.map((window:any) => window.selection)).size, count);
    for (const window of result.windows) {
      assert.match(window.selection, /^[a-f0-9-]{36}$/);
      assert.equal(window.processId, undefined);
      assert.equal(window.startedAt, undefined);
      assert.notEqual(window.selection, window.handle);
    }
  }
});

test('every read needs exact boolean consent, a current enumeration token and exact title', async () => {
  const {reader, requests} = fixture();
  const {windows} = await reader.listSocialWindows();
  const selected = windows[0];
  for (const consent of [undefined, false, 'true', 1, {}]) {
    await assert.rejects(reader.readSocialWindow({...selected, consent, expectedTitle: selected.title}), {code: 'WINDOWS_UI_CONSENT'});
  }
  await assert.rejects(reader.readSocialWindow({selection: selected.handle, consent: true, expectedTitle: selected.title}), {code: 'WINDOWS_UI_SELECTION'});
  await assert.rejects(reader.readSocialWindow({...selected, consent: true, expectedTitle: 'changed'}), {code: 'WINDOWS_UI_CHANGED'});
  assert.equal(requests.length, 1, 'all invalid reads are rejected before execution');
  await reader.listSocialWindows();
  await assert.rejects(reader.readSocialWindow({...selected, consent: true, expectedTitle: selected.title}), {code: 'WINDOWS_UI_SELECTION'});
});

test('expired selection is rejected before executing a read', async () => {
  let clock = 10000, executions = 0;
  const reader = createWindowsUiReader({platform: 'win32', now: () => clock,
    executePowerShell: async () => { executions++; return output({ok: true, windows: [windowIdentity]}); }});
  const selected = (await reader.listSocialWindows()).windows[0];
  clock += 5 * 60 * 1000 + 1;
  await assert.rejects(reader.readSocialWindow({...selected, consent: true, expectedTitle: selected.title}), {code: 'WINDOWS_UI_SELECTION'});
  assert.equal(executions, 1);
});

test('successful substitute returns only the selected local preview, without acting on controls', async () => {
  const {reader, requests} = fixture(readResult({unexpectedPrivateDiagnostic: 'discard me'}));
  const selected = (await reader.listSocialWindows()).windows[0];
  const preview = await reader.readSocialWindow({...selected, consent: true, expectedTitle: selected.title,
    command: 'Invoke-Expression anything', shell: true, handle: '999', process: 'arbitrary'});
  assert.equal(preview.text, controls.map(control => control.name).join('\n'));
  assert.deepEqual(preview.controls, controls);
  assert.equal(preview.handle, windowIdentity.handle);
  assert.equal(preview.processingLocation, 'local');
  assert.equal(preview.requiresReview, true);
  assert.equal(preview.unexpectedPrivateDiagnostic, undefined);
  assert.deepEqual(requests[1], {operation: 'read', consent: true, window: windowIdentity});
});

test('a browser selection stays explicit and PowerShell-like title text remains JSON data', async () => {
  const browser = {...windowIdentity, process: 'chrome', kind: 'browser',
    title: "社交网页 👋 '; Invoke-Expression $(Get-Credential); #"};
  const {reader, requests} = fixture(readResult({before: browser, after: browser}), [browser]);
  const selected = (await reader.listSocialWindows()).windows[0];
  assert.equal(selected.kind, 'browser');
  await assert.rejects(reader.readSocialWindow({...selected, consent: true}), {code: 'WINDOWS_UI_CHANGED'});
  const preview = await reader.readSocialWindow({...selected, consent: true, expectedTitle: browser.title});
  assert.equal(preview.title, browser.title);
  assert.equal(requests[1].window.title, browser.title);
  assert.equal(requests[1].command, undefined);
});

test('handle, process, pid, process creation time and title changes before/after UIA discard the preview', async () => {
  const changes = {handle: '123457', process: 'qq', processId: 988,
    startedAt: '2026-10-13T10:00:01.1234567Z', title: '另一会话'};
  for (const phase of ['before', 'after']) {
    for (const [field, value] of Object.entries(changes)) {
      const {reader} = fixture(readResult({[phase]: {...windowIdentity, [field]: value}}));
      const selected = (await reader.listSocialWindows()).windows[0];
      await assert.rejects(reader.readSocialWindow({...selected, consent: true, expectedTitle: selected.title}), {code: 'WINDOWS_UI_CHANGED'});
      await assert.rejects(reader.readSocialWindow({...selected, consent: true, expectedTitle: selected.title}), {code: 'WINDOWS_UI_SELECTION'});
    }
  }
});

test('unavailable UIA reports a real limitation, with no invented message', async () => {
  for (const result of [{ok: false, code: 'WINDOWS_UI_UNAVAILABLE', message: 'private password'}, readResult({text: '', controls: []})]) {
    const {reader} = fixture(result);
    const selected = (await reader.listSocialWindows()).windows[0];
    await assert.rejects(reader.readSocialWindow({...selected, consent: true, expectedTitle: selected.title}),
      (error:any) => error.code === 'WINDOWS_UI_UNAVAILABLE' && !error.message.includes('private password'));
  }
});

test('stdout byte/depth, text, control-count and control-name limits reject all preview content', async () => {
  const invalidResults = [readResult({text: 'x'.repeat(16001)}),
    readResult({controls: Array.from({length: 161}, () => controls[0])}),
    readResult({controls: [{type: 'Text', name: 'x'.repeat(513)}]}),
    readResult({controls: [{type: 'Edit', name: 'draft or password'}]}),
    readResult({controls: [{type: 'ComboBox', name: 'draft or password'}]})];
  for (const result of invalidResults) {
    const {reader} = fixture(result);
    const selected = (await reader.listSocialWindows()).windows[0];
    await assert.rejects(reader.readSocialWindow({...selected, consent: true, expectedTitle: selected.title}), {code: 'WINDOWS_UI_OUTPUT'});
  }
  const reader = createWindowsUiReader({platform: 'win32', executePowerShell: async () =>
    ({stdout: JSON.stringify({ok: true, windows: [], padding: '汉'.repeat(90000)}), exitCode: 0})});
  await assert.rejects(reader.listSocialWindows(), {code: 'WINDOWS_UI_OUTPUT'});
  const nested = createWindowsUiReader({platform: 'win32', executePowerShell: async () =>
    output({ok: true, windows: [], padding: [[[[[[[[[]]]]]]]]]})});
  await assert.rejects(nested.listSocialWindows(), {code: 'WINDOWS_UI_OUTPUT'});
});

test('a refreshed enumeration invalidates an in-flight read before its content can return', async () => {
  let completeRead:((result:unknown) => void) | undefined;
  const reader = createWindowsUiReader({platform: 'win32', executePowerShell: async ({input}:{input:string}) => {
    if (JSON.parse(input).operation === 'list') return output({ok: true, windows: [windowIdentity]});
    return new Promise(resolve => { completeRead = resolve; });
  }});
  const selected = (await reader.listSocialWindows()).windows[0];
  const pendingRead = reader.readSocialWindow({...selected, consent: true, expectedTitle: selected.title});
  await reader.listSocialWindows();
  completeRead!(output(readResult()));
  await assert.rejects(pendingRead, {code: 'WINDOWS_UI_SELECTION'});
});

test('malformed list identities, duplicate handles and unlisted processes are rejected', async () => {
  for (const windows of [[{...windowIdentity, process: 'powershell'}], [{...windowIdentity, kind: 'browser'}],
    [{...windowIdentity, handle: '$(bad)'}], [{...windowIdentity, processId: -1}],
    [{...windowIdentity}, {...windowIdentity}], Array.from({length: 101}, () => windowIdentity)]) {
    const {reader} = fixture(readResult(), windows);
    await assert.rejects(reader.listSocialWindows(), {code: 'WINDOWS_UI_OUTPUT'});
  }
});

test('malformed JSON, exit failures, provider errors and thrown diagnostics are redacted', async () => {
  const secret = 'password=never expose private conversation';
  const substitutes = [async () => ({stdout: secret, stderr: secret, exitCode: 0}),
    async () => ({stdout: '{}', stderr: secret, exitCode: 1}),
    async () => output({ok: false, code: secret, message: secret}),
    async () => { throw new Error(secret); },
    async () => { const error = new WindowsUiError('WINDOWS_UI_TIMEOUT'); error.message = secret; throw error; }];
  for (const executePowerShell of substitutes) {
    const reader = createWindowsUiReader({platform: 'win32', executePowerShell});
    await assert.rejects(reader.listSocialWindows(), (error:any) => {
      assert.ok(['WINDOWS_UI_OUTPUT', 'WINDOWS_UI_FAILED', 'WINDOWS_UI_TIMEOUT'].includes(error.code));
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('capture needs its own explicit consent, current opaque token and matching title before execution', async () => {
  const {reader, requests} = fixture(captureResult());
  const selected = (await reader.listSocialWindows()).windows[0];
  for (const consent of [undefined, false, 'true', 1]) {
    await assert.rejects(reader.captureSocialWindow({...selected, consent, expectedTitle: selected.title}), {code: 'WINDOWS_UI_CONSENT'});
  }
  await assert.rejects(reader.captureSocialWindow({selection: selected.handle, consent: true, expectedTitle: selected.title}), {code: 'WINDOWS_UI_SELECTION'});
  await assert.rejects(reader.captureSocialWindow({...selected, consent: true, expectedTitle: 'another window'}), {code: 'WINDOWS_UI_CHANGED'});
  assert.equal(requests.length, 1);
  await reader.listSocialWindows();
  await assert.rejects(reader.captureSocialWindow({...selected, consent: true, expectedTitle: selected.title}), {code: 'WINDOWS_UI_SELECTION'});
});

test('capture sends only the selected identity and returns one bounded memory image', async () => {
  const {reader, requests} = fixture(captureResult({privateDiagnostic: 'discard'}));
  const selected = (await reader.listSocialWindows()).windows[0];
  const captured = await reader.captureSocialWindow({...selected, consent: true, expectedTitle: selected.title,
    command: 'Capture-all-windows', handle: '9999999', filename: 'should-not-be-written.png'});
  assert.deepEqual(requests[1], {operation: 'capture', consent: true, window: windowIdentity});
  assert.deepEqual(captured.image, capturedImage);
  assert.equal(captured.handle, selected.handle);
  assert.equal(captured.privateDiagnostic, undefined);
  assert.equal(captured.processingLocation, 'local');
  assert.equal(captured.requiresReview, true);
});

test('capture discards the image when selected identity changes before or after PrintWindow', async () => {
  const changes = {handle: '123457', process: 'qq', processId: 988,
    startedAt: '2026-10-13T10:00:01.1234567Z', title: '另一会话'};
  for (const phase of ['before', 'after']) {
    for (const [field, value] of Object.entries(changes)) {
      const {reader} = fixture(captureResult({[phase]: {...windowIdentity, [field]: value}}));
      const selected = (await reader.listSocialWindows()).windows[0];
      await assert.rejects(reader.captureSocialWindow({...selected, consent: true, expectedTitle: selected.title}), {code: 'WINDOWS_UI_CHANGED'});
    }
  }
});

test('capture rejects expired selections and in-flight refresh without returning an image', async () => {
  let clock = 10000, executions = 0, completeCapture:((value:unknown) => void) | undefined;
  const reader = createWindowsUiReader({platform: 'win32', now: () => clock,
    executePowerShell: async ({input}:{input:string}) => {
      executions++;
      if (JSON.parse(input).operation === 'list') return output({ok: true, windows: [windowIdentity]});
      return new Promise(resolve => { completeCapture = resolve; });
    }});
  const expired = (await reader.listSocialWindows()).windows[0];
  clock += 5 * 60 * 1000 + 1;
  await assert.rejects(reader.captureSocialWindow({...expired, consent: true, expectedTitle: expired.title}), {code: 'WINDOWS_UI_SELECTION'});
  assert.equal(executions, 1);
  const selected = (await reader.listSocialWindows()).windows[0];
  const pending = reader.captureSocialWindow({...selected, consent: true, expectedTitle: selected.title});
  await reader.listSocialWindows();
  completeCapture!(output(captureResult()));
  await assert.rejects(pending, {code: 'WINDOWS_UI_SELECTION'});
});

test('capture validates original area, PNG dimensions, scale, encoding and raw size', async () => {
  const oversizedHeader = Buffer.from(png.split(',')[1], 'base64'); oversizedHeader.writeUInt32BE(1281, 16);
  const oversizedRaw = Buffer.concat([Buffer.from(png.split(',')[1], 'base64'), Buffer.alloc(5 * 1024 * 1024)]);
  const invalidImages = [{...capturedImage, originalWidth: 4000001}, {...capturedImage, originalHeight: 0},
    {...capturedImage, originalWidth: 3000, originalHeight: 2000},
    {...capturedImage, width: 2}, {...capturedImage, height: 2}, {...capturedImage, sizeBytes: capturedImage.sizeBytes + 1},
    {...capturedImage, originalWidth: 2000, originalHeight: 1000},
    {...capturedImage, mime: 'image/jpeg'}, {...capturedImage, data: 'data:image/png;base64,notPNG'},
    {...capturedImage, data: png.replace(/=+$/, '')},
    {...capturedImage, data: 'data:image/png;base64,' + oversizedHeader.toString('base64'), width: 1281},
    {...capturedImage, data: 'data:image/png;base64,' + oversizedRaw.toString('base64')},
    {...capturedImage, sizeBytes: 5 * 1024 * 1024 + 1}];
  for (const image of invalidImages) {
    const {reader} = fixture(captureResult({image}));
    const selected = (await reader.listSocialWindows()).windows[0];
    await assert.rejects(reader.captureSocialWindow({...selected, consent: true, expectedTitle: selected.title}), {code: 'WINDOWS_UI_OUTPUT'});
  }
});

test('capture has a separate ~7MB stdout budget while UIA keeps 256KiB and all operations bound JSON depth', async () => {
  const limits:number[] = [];
  const reader = createWindowsUiReader({platform: 'win32', executePowerShell: async ({input, maxOutputBytes}:{input:string,maxOutputBytes:number}) => {
    const operation = JSON.parse(input).operation; limits.push(maxOutputBytes);
    return output(operation === 'list' ? {ok: true, windows: [windowIdentity]} :
      operation === 'capture' ? captureResult({padding: 'x'.repeat(300000)}) : readResult({padding: 'x'.repeat(300000)}));
  }});
  const selected = (await reader.listSocialWindows()).windows[0];
  const input = {...selected, consent: true, expectedTitle: selected.title};
  assert.equal((await reader.captureSocialWindow(input)).image.data, png);
  await assert.rejects(reader.readSocialWindow(input), {code: 'WINDOWS_UI_OUTPUT'});
  assert.deepEqual(limits, [256 * 1024, 7_050_000, 256 * 1024]);
  for (const result of [captureResult({padding: 'x'.repeat(7_050_000)}),
    captureResult({padding: [[[[[[[[[]]]]]]]]]})]) {
    const {reader: rejected} = fixture(result);
    const window = (await rejected.listSocialWindows()).windows[0];
    await assert.rejects(rejected.captureSocialWindow({...window, consent: true, expectedTitle: window.title}), {code: 'WINDOWS_UI_OUTPUT'});
  }
});

test('capture failure/protection/dimension errors are generic and never fall back to another window', async () => {
  for (const code of ['WINDOWS_UI_CAPTURE', 'WINDOWS_UI_CAPTURE_PROTECTED', 'WINDOWS_UI_CAPTURE_DIMENSIONS']) {
    const {reader, requests} = fixture({ok: false, code, message: 'password=private window content'});
    const selected = (await reader.listSocialWindows()).windows[0];
    await assert.rejects(reader.captureSocialWindow({...selected, consent: true, expectedTitle: selected.title}), (error:any) =>
      error.code === code && !error.message.includes('password=private'));
    assert.deepEqual(requests.map(request => request.operation), ['list', 'capture']);
  }
});

test('fixed local script bounds capture/read and permits only confirmed ValuePattern/InvokePattern actions', async () => {
  const module = await readFile(new URL('../windows-ui.mjs', import.meta.url), 'utf8');
  const script = await readFile(new URL('../../../apps/desktop/windows-ui.ps1', import.meta.url), 'utf8');
  assert.equal(script.charCodeAt(0), 0xFEFF, 'WinPS5.1 needs a BOM to decode Chinese publisher names');
  assert.match(module, /WindowsPowerShell.*v1\.0.*powershell\.exe/);
  assert.match(module, /shell: false/);
  assert.match(module, /child\.stdin\.end\(input, 'utf8'\)/);
  assert.match(script, /CACHE_ONLY_URL_RETRIEVAL/);
  assert.doesNotMatch(script, /\b(Get-AuthenticodeSignature|Invoke-WebRequest|Invoke-RestMethod|Start-Process|SetFocus|SetForegroundWindow|SendKeys|SendInput|Get-Clipboard|Set-Clipboard|Clipboard|mouse_event|keybd_event)\b/);
  assert.doesNotMatch(script, /FindAll\s*\(|DocumentRange|GetText\s*\(/);
  assert.ok(script.indexOf('IsPasswordProperty') < script.indexOf('NameProperty'));
  assert.equal((script.match(/\.SetValue\(/g) || []).length, 1);
  assert.equal((script.match(/\.Invoke\(/g) || []).length, 1);
  assert.match(script, /\$access\.valuePattern\.SetValue\(\[string\]\$request\.text\)/);
  assert.match(script, /\$written\.invokePattern\.Invoke\(\)/);
  assert.match(script, /\$editors\.Count -ne 1 -or \$buttons\.Count -ne 1/);
  assert.match(script, /GetForegroundWindow\(\) -eq \$windowHandle/);
  assert.match(script, /HasKeyboardFocusProperty/);
  assert.match(script, /Current\.Value -cne \$expectedValue/);
  assert.match(script, /no UIA atomic compare-and-set/);
  assert.match(script, /ToUnixTimeMilliseconds\(\) -ge \$request\.expiresAt/);
  assert.match(script, /\$writeStarted -eq \$true.*WINDOWS_UI_REPLY_INTERRUPTED/);
  assert.ok(script.indexOf("Assert-IdleEditor $access $windowHandle ''") < script.indexOf('$access.valuePattern.SetValue'));
  assert.ok(script.indexOf('Assert-IdleEditor $written') < script.indexOf('$written.invokePattern.Invoke'));
  assert.match(script, /status = 'unknown'/);
  assert.doesNotMatch(script, /status = '(accepted|sent|delivered)'/);
  assert.match(script, /Assert-Identity \$before \$expected/);
  assert.match(script, /Assert-Identity \$after \$expected/);
  assert.match(script, /PrintWindow\(hwnd, context, 2\)/);
  assert.match(script, /GetWindowDisplayAffinity\(hwnd, out affinity\).*affinity != 0/);
  assert.ok(script.indexOf('int[] original = CaptureSize(hwnd)') < script.indexOf('new Bitmap(original[0]'));
  assert.match(script, /graphics\.ReleaseHdc\(context\)/);
  assert.match(script, /new MemoryStream\(\)/);
  assert.match(script, /Get-Identity \$windowHandle \$true/);
  assert.doesNotMatch(script, /CopyFromScreen|GetDesktopWindow|GetDC\(IntPtr\.Zero\)|\.Save\s*\(\s*['"]|WriteAllBytes|Out-File|Set-Content/);
});

// Send tests exercise the trusted runner's protocol only. The double never interacts with a UI.
const binding = {editorId: '42,7,11', buttonId: '42,7,12',
  inputFingerprint: createHash('sha256').update(['TC-WINDOW-INPUT-1', '42,7,11', '42,7,12'].join('\0')).digest('hex')};
const reply = {canSend: true, reasonCode: 'WINDOWS_UI_UNSUPPORTED_INPUT',
  inputFingerprint: binding.inputFingerprint, imeLayout: '0x8040804'};
const sendableResult = (extra:Record<string, unknown> = {}) => readResult({reply: {...reply}, binding: {...binding}, ...extra});
const commitResult = (extra:Record<string, unknown> = {}) => ({ok: true, before: {...windowIdentity},
  after: {...windowIdentity}, status: 'unknown', reply: {...reply}, ...extra});
const sendFixture = (response?: (request:any) => unknown | Promise<unknown>) => {
  const requests:any[] = [];
  let clock = Date.parse('2026-10-13T10:05:00Z');
  const reader = createWindowsUiReader({platform: 'win32', now: () => clock,
    executePowerShell: async ({input, maxOutputBytes}:{input:string,maxOutputBytes:number}) => {
      const request = JSON.parse(input); requests.push({...request, maxOutputBytes});
      if (request.operation === 'list') return output({ok: true, windows: [windowIdentity]});
      const result = response ? await response(request) : request.operation === 'commit' ? commitResult() : sendableResult();
      return output(result);
    }});
  return {reader, requests, tick: (milliseconds:number) => { clock += milliseconds; }, now: () => clock};
};
const selectPreview = async (reader:any) => {
  const selected = (await reader.listSocialWindows()).windows[0];
  const input = {selection: selected.selection, consent: true, expectedTitle: selected.title};
  const preview = await reader.readSocialWindow(input);
  return {selected, input, preview};
};
const prepare = async (reader:any, text = '你好 👋\nUnicode 中文回复') => {
  const {input, preview} = await selectPreview(reader);
  return reader.prepareSocialReply({...input, text, expectedSnapshot: preview.snapshot});
};

test('read provides a deterministic bounded snapshot, capability, fingerprint and honest IME metadata', async () => {
  const {reader} = sendFixture();
  const {input, preview} = await selectPreview(reader);
  assert.equal(preview.snapshot, (await reader.readSocialWindow(input)).snapshot);
  const snapshotParts = ['TC-WINDOW-PREVIEW-1', windowIdentity.handle, String(windowIdentity.processId),
    windowIdentity.startedAt, windowIdentity.title, windowIdentity.process, windowIdentity.kind,
    controls.map(control => control.name).join('\n'), '0', binding.inputFingerprint,
    ...controls.flatMap(control => [control.type, control.name])];
  assert.equal(preview.snapshot, createHash('sha256').update(snapshotParts.join('\0'), 'utf8').digest('hex'));
  assert.deepEqual(preview.capability, {canSend: true, reason: '', reasonCode: null});
  assert.equal(preview.inputFingerprint, binding.inputFingerprint);
  assert.equal(preview.binding, undefined, 'native RuntimeIds are not exposed to the renderer');
  assert.deepEqual(preview.input, {method: 'uia-value-pattern', imeBypassed: true, imeLayout: '0x8040804',
    switchesInputMethod: false, compositionState: 'unknown'});
  const unavailable = fixture();
  const fallback = await selectPreview(unavailable.reader);
  assert.equal(fallback.preview.capability.canSend, false);
  assert.equal(fallback.preview.inputFingerprint, null);
});

test('prepare validates exact consent, selection/title, text and the reviewed snapshot before execution', async () => {
  const {reader, requests} = sendFixture();
  const {input, preview} = await selectPreview(reader);
  const valid = {...input, text: '回复', expectedSnapshot: preview.snapshot};
  for (const consent of [undefined, false, 'true', 1]) {
    await assert.rejects(reader.prepareSocialReply({...valid, consent}), {code: 'WINDOWS_UI_CONSENT'});
  }
  for (const text of ['', ' \n\t ', 'x'.repeat(4001), '\0', 'hello\u0007', 'hello\u007f', undefined, 1]) {
    await assert.rejects(reader.prepareSocialReply({...valid, text}), {code: 'WINDOWS_UI_REPLY_TEXT'});
  }
  for (const expectedSnapshot of [undefined, '', 'f'.repeat(63), 'F'.repeat(64), 'not a hash']) {
    await assert.rejects(reader.prepareSocialReply({...valid, expectedSnapshot}), {code: 'WINDOWS_UI_SNAPSHOT_CHANGED'});
  }
  await assert.rejects(reader.prepareSocialReply({...valid, selection: 'unlisted'}), {code: 'WINDOWS_UI_SELECTION'});
  await assert.rejects(reader.prepareSocialReply({...valid, expectedTitle: 'other chat'}), {code: 'WINDOWS_UI_CHANGED'});
  assert.equal(requests.length, 2, 'invalid arguments never reach the native runner');
});

test('prepare returns a 30-second numeric deadline and binds Unicode text, snapshot and immutable native identifiers', async () => {
  const {reader, requests, now} = sendFixture();
  const {input, preview} = await selectPreview(reader);
  const text = "你好 👋 日本語 한글\n'; Invoke-Expression anything #";
  const prepared = await reader.prepareSocialReply({...input, text, expectedSnapshot: preview.snapshot,
    binding: {editorId: 'attacker'}, expiresAt: Number.MAX_SAFE_INTEGER, command: 'anything'});
  assert.match(prepared.ticket, /^[a-f0-9-]{36}$/);
  assert.equal(typeof prepared.expiresAt, 'number');
  assert.equal(prepared.expiresAt, now() + 30_000);
  assert.equal(prepared.text, text);
  assert.equal(prepared.preview.text, preview.text);
  assert.deepEqual(requests[2], {operation: 'prepare', consent: true, window: windowIdentity,
    text, expectedSnapshot: preview.snapshot, maxOutputBytes: 256 * 1024});
  const result = await reader.commitSocialReply({ticket: prepared.ticket, consent: true,
    text: 'attacker replacement', window: {}, binding: {editorId: 'attacker'}});
  assert.equal(result.text, text);
  assert.equal(result.status, 'unknown');
  assert.deepEqual(requests[3], {operation: 'commit', consent: true, window: windowIdentity,
    text, expectedSnapshot: preview.snapshot, binding, expiresAt: prepared.expiresAt, maxOutputBytes: 256 * 1024});
  assert.equal(result.accepted, undefined);
  assert.equal(result.sent, undefined);
  assert.equal(result.delivered, undefined);
  assert.match(result.message, /未确认.*不会自动重试/);
});

test('commit needs its own boolean consent and retains a ticket after missing consent', async () => {
  const {reader, requests} = sendFixture();
  const prepared = await prepare(reader);
  for (const consent of [undefined, false, 'true', 1]) {
    await assert.rejects(reader.commitSocialReply({ticket: prepared.ticket, consent}), {code: 'WINDOWS_UI_CONSENT'});
  }
  assert.equal(requests.filter(request => request.operation === 'commit').length, 0);
  assert.equal((await reader.commitSocialReply({ticket: prepared.ticket, consent: true})).status, 'unknown');
});

test('tickets expire exactly at 30 seconds and are invalidated by re-preparation and refreshed selections', async () => {
  for (const elapsed of [30_000, 30_001]) {
    const {reader, requests, tick} = sendFixture();
    const prepared = await prepare(reader); tick(elapsed);
    await assert.rejects(reader.commitSocialReply({ticket: prepared.ticket, consent: true}), {code: 'WINDOWS_UI_TICKET'});
    assert.equal(requests.filter(request => request.operation === 'commit').length, 0);
  }
  const {reader, tick} = sendFixture();
  const {input, preview} = await selectPreview(reader);
  const first = await reader.prepareSocialReply({...input, text: 'first', expectedSnapshot: preview.snapshot});
  const second = await reader.prepareSocialReply({...input, text: 'second', expectedSnapshot: preview.snapshot});
  await assert.rejects(reader.commitSocialReply({ticket: first.ticket, consent: true}), {code: 'WINDOWS_UI_TICKET'});
  tick(29_999);
  assert.equal((await reader.commitSocialReply({ticket: second.ticket, consent: true})).text, 'second');
  const third = await reader.prepareSocialReply({...input, text: 'third', expectedSnapshot: preview.snapshot});
  await reader.listSocialWindows();
  await assert.rejects(reader.commitSocialReply({ticket: third.ticket, consent: true}), {code: 'WINDOWS_UI_TICKET'});
});

test('a pending commit consumes its ticket synchronously and blocks another preparation for that window', async () => {
  let resolveCommit: ((value:unknown) => void) | undefined;
  const {reader, requests} = sendFixture(request => request.operation === 'commit'
    ? new Promise(resolve => { resolveCommit = resolve; }) : sendableResult());
  const {input, preview} = await selectPreview(reader);
  const prepared = await reader.prepareSocialReply({...input, text: 'reply', expectedSnapshot: preview.snapshot});
  const pending = reader.commitSocialReply({ticket: prepared.ticket, consent: true});
  await assert.rejects(reader.commitSocialReply({ticket: prepared.ticket, consent: true}), {code: 'WINDOWS_UI_TICKET'});
  await assert.rejects(reader.prepareSocialReply({...input, text: 'second', expectedSnapshot: preview.snapshot}), {code: 'WINDOWS_UI_DRAFT_CHANGED'});
  resolveCommit!(commitResult());
  assert.equal((await pending).status, 'unknown');
  assert.equal(requests.filter(request => request.operation === 'commit').length, 1);
  await assert.rejects(reader.commitSocialReply({ticket: prepared.ticket, consent: true}), {code: 'WINDOWS_UI_TICKET'});
});

test('changed conversation text, truncation, visible control ordering or editor fingerprint invalidates the reviewed snapshot', async () => {
  const changed = [sendableResult({text: '另一会话'}), sendableResult({truncated: true}),
    sendableResult({controls: [...controls].reverse()}),
    sendableResult({reply: {...reply, inputFingerprint: 'b'.repeat(64)}})];
  for (const result of changed) {
    const {reader, requests} = sendFixture(request => request.operation === 'prepare' ? result : sendableResult());
    const {input, preview} = await selectPreview(reader);
    await assert.rejects(reader.prepareSocialReply({...input, text: 'reply', expectedSnapshot: preview.snapshot}), {code: 'WINDOWS_UI_SNAPSHOT_CHANGED'});
    assert.equal(requests.filter(request => request.operation === 'commit').length, 0);
  }
});

test('empty draft, unique editor/button capability and current focus refusal must pass at prepare and commit', async () => {
  for (const code of ['WINDOWS_UI_DRAFT_PRESENT', 'WINDOWS_UI_DRAFT_CHANGED', 'WINDOWS_UI_UNSUPPORTED_INPUT']) {
    const {reader} = sendFixture(request => request.operation === 'prepare'
      ? sendableResult({reply: {...reply, canSend: false, reasonCode: code}}) : sendableResult());
    const {input, preview} = await selectPreview(reader);
    await assert.rejects(reader.prepareSocialReply({...input, text: 'reply', expectedSnapshot: preview.snapshot}), {code});
    const rejected = sendFixture(request => request.operation === 'commit' ? {ok: false, code} : sendableResult());
    const prepared = await prepare(rejected.reader);
    await assert.rejects(rejected.reader.commitSocialReply({ticket: prepared.ticket, consent: true}), {code});
    await assert.rejects(rejected.reader.commitSocialReply({ticket: prepared.ticket, consent: true}), {code: 'WINDOWS_UI_TICKET'});
    assert.equal(rejected.requests.filter(request => request.operation === 'commit').length, 1);
  }
});

test('malformed capability, script snapshots and editor/button bindings never produce a usable send ticket', async () => {
  for (const extra of [{reply: {...reply, canSend: 'true'}}, {reply: {...reply, inputFingerprint: null}},
    {reply: {...reply, imeLayout: 'private text'}}, {snapshot: 'a'.repeat(64)},
    {binding: {...binding, editorId: '$(bad)'}}, {binding: {...binding, buttonId: binding.editorId}},
    {binding: {...binding, inputFingerprint: 'b'.repeat(64)}}, {binding: undefined}]) {
    const {reader} = sendFixture(request => request.operation === 'prepare' ? sendableResult(extra) : sendableResult());
    const {input, preview} = await selectPreview(reader);
    await assert.rejects(reader.prepareSocialReply({...input, text: 'reply', expectedSnapshot: preview.snapshot}), {code: 'WINDOWS_UI_OUTPUT'});
    await assert.rejects(reader.commitSocialReply({ticket: undefined, consent: true}), {code: 'WINDOWS_UI_TICKET'});
  }
});

test('native commit snapshot/draft rejection remains rejected and never auto retries or learns acceptance', async () => {
  const {reader, requests} = sendFixture(request => request.operation === 'commit'
    ? {ok: false, code: 'WINDOWS_UI_SNAPSHOT_CHANGED', message: 'private chat'} : sendableResult());
  const prepared = await prepare(reader);
  await assert.rejects(reader.commitSocialReply({ticket: prepared.ticket, consent: true}), {code: 'WINDOWS_UI_SNAPSHOT_CHANGED'});
  await assert.rejects(reader.commitSocialReply({ticket: prepared.ticket, consent: true}), {code: 'WINDOWS_UI_TICKET'});
  assert.equal(requests.filter(request => request.operation === 'commit').length, 1);
});

test('identity/signature failures, provider exceptions, partial actions and unsupported success claims remain interrupted', async () => {
  const secret = 'private draft / token do not expose';
  const failures = [{ok: false, code: 'WINDOWS_UI_CHANGED', message: secret},
    {ok: false, code: 'WINDOWS_UI_REPLY_INTERRUPTED', message: secret},
    commitResult({after: {...windowIdentity, processId: 988}}), commitResult({status: 'accepted'}),
    commitResult({status: 'sent'}), commitResult({status: 'delivered'}),
    commitResult({reply: {...reply, inputFingerprint: 'bad'}}), new Error(secret), new WindowsUiError('WINDOWS_UI_TIMEOUT')];
  for (const result of failures) {
    const {reader, requests} = sendFixture(request => {
      if (request.operation !== 'commit') return sendableResult();
      if (result instanceof Error) throw result;
      return result;
    });
    const prepared = await prepare(reader);
    await assert.rejects(reader.commitSocialReply({ticket: prepared.ticket, consent: true}), (error:any) => {
      assert.equal(error.code, 'WINDOWS_UI_REPLY_INTERRUPTED');
      assert.equal(error.message.includes(secret), false);
      return true;
    });
    await assert.rejects(reader.commitSocialReply({ticket: prepared.ticket, consent: true}), {code: 'WINDOWS_UI_TICKET'});
    assert.equal(requests.filter(request => request.operation === 'commit').length, 1);
  }
});

test('truncated previews stay readable but cannot issue a send ticket from incomplete context', async () => {
  const {reader} = sendFixture(() => sendableResult({truncated: true}));
  const {input, preview} = await selectPreview(reader);
  assert.equal(preview.truncated, true);
  assert.equal(preview.capability.canSend, false);
  await assert.rejects(reader.prepareSocialReply({...input, text: 'reply', expectedSnapshot: preview.snapshot}), {code: 'WINDOWS_UI_UNSUPPORTED_INPUT'});
});

test('prepare discards responses when identity changes or enumeration refreshes while it is pending', async () => {
  for (const phase of ['before', 'after']) {
    const {reader} = sendFixture(request => request.operation === 'prepare'
      ? sendableResult({[phase]: {...windowIdentity, title: '另一身份会话'}}) : sendableResult());
    const {input, preview} = await selectPreview(reader);
    await assert.rejects(reader.prepareSocialReply({...input, text: 'reply', expectedSnapshot: preview.snapshot}), {code: 'WINDOWS_UI_CHANGED'});
  }
  let resolvePrepare: ((value:unknown) => void) | undefined;
  const {reader} = sendFixture(request => request.operation === 'prepare'
    ? new Promise(resolve => { resolvePrepare = resolve; }) : sendableResult());
  const {input, preview} = await selectPreview(reader);
  const pending = reader.prepareSocialReply({...input, text: 'reply', expectedSnapshot: preview.snapshot});
  await reader.listSocialWindows();
  resolvePrepare!(sendableResult());
  await assert.rejects(pending, {code: 'WINDOWS_UI_SELECTION'});
});

test('refresh during an already invoked commit reports interruption and retains no replay ticket', async () => {
  let resolveCommit: ((value:unknown) => void) | undefined;
  const {reader, requests} = sendFixture(request => request.operation === 'commit'
    ? new Promise(resolve => { resolveCommit = resolve; }) : sendableResult());
  const prepared = await prepare(reader);
  const pending = reader.commitSocialReply({ticket: prepared.ticket, consent: true});
  await reader.listSocialWindows();
  resolveCommit!(commitResult());
  await assert.rejects(pending, {code: 'WINDOWS_UI_REPLY_INTERRUPTED'});
  await assert.rejects(reader.commitSocialReply({ticket: prepared.ticket, consent: true}), {code: 'WINDOWS_UI_TICKET'});
  assert.equal(requests.filter(request => request.operation === 'commit').length, 1);
});
