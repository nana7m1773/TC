import { createReadStream } from 'node:fs';
import { link, mkdir, open, readFile, rename, rm, stat, statfs } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';

export const defaultModel = JSON.parse(await readFile(new URL('../resources/default-model.json', import.meta.url), 'utf8'));

/** Desktop selection is explicit: importing this tool never changes the Android default. */
export async function readDesktopManifest() {
  return JSON.parse(await readFile(new URL('../resources/default-model.windows.json', import.meta.url), 'utf8'));
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function readWhisperMetadata(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const data = Buffer.alloc(48);
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    if (bytesRead !== 48 || data.readUInt32LE(0) !== 0x67676d6c) throw new Error('Whisper 模型文件头无效，仅支持 whisper.cpp GGML 模型');
    const fields = ['vocabularySize', 'audioContextSize', 'audioStateSize', 'audioHeadCount', 'audioLayerCount',
      'textContextSize', 'textStateSize', 'textHeadCount', 'textLayerCount', 'melCount', 'quantizationType'];
    const metadata = { format: 'whisper-ggml', architecture: 'whisper', sizeBytes: size };
    for (let i = 0; i < fields.length; i++) metadata[fields[i]] = data.readInt32LE(4 + i * 4);
    if (fields.slice(0, -1).some((key) => metadata[key] <= 0 || metadata[key] > 1000000) || metadata.quantizationType < 0
      || metadata.textStateSize !== metadata.audioStateSize) throw new Error('Whisper 模型参数无效');
    metadata.multilingual = metadata.vocabularySize >= 51865;
    metadata.name = 'Whisper ' + ({ 4: 'Tiny', 6: 'Base', 12: 'Small', 24: 'Medium', 32: 'Large' }[metadata.audioLayerCount] ?? 'GGML');
    return metadata;
  } finally { await handle.close(); }
}

export async function readSpeechManifest() {
  return JSON.parse(await readFile(new URL('../resources/local-speech.json', import.meta.url), 'utf8'));
}

/** Read metadata only, never mmap/load tensor weights. The engine remains the final compatibility check. */
export async function readGgufMetadata(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const data = Buffer.alloc(Math.min(size, 64 * 1024 * 1024));
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    let offset = 0;
    const take = (length) => {
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytesRead) {
        throw new Error('GGUF 元数据损坏、文件未完整下载，或元数据超过 64 MiB 限制');
      }
      const value = data.subarray(offset, offset + length); offset += length; return value;
    };
    const u32 = () => take(4).readUInt32LE();
    const u64 = () => {
      const value = take(8).readBigUInt64LE();
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('GGUF 长度越界');
      return Number(value);
    };
    const string = () => { const length = u64(); if (length > 16 * 1024 * 1024) throw new Error('GGUF 字符串过大'); return take(length).toString('utf8'); };
    const widths = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
    const value = (type, retain, depth = 0) => {
      if (depth > 3) throw new Error('GGUF 元数据嵌套过深');
      if (type === 8) return string();
      if (type === 9) {
        const elementType = u32(), count = u64();
        if (count > 10000000) throw new Error('GGUF 元数据数组过大');
        if (widths[elementType]) take(widths[elementType] * count);
        else for (let i = 0; i < count; i++) value(elementType, false, depth + 1);
        return undefined;
      }
      if (!widths[type]) throw new Error(`不支持的 GGUF 元数据类型 ${type}`);
      const raw = take(widths[type]);
      if (!retain) return undefined;
      if (type === 0 || type === 7) return raw.readUInt8();
      if (type === 1) return raw.readInt8();
      if (type === 2) return raw.readUInt16LE();
      if (type === 3) return raw.readInt16LE();
      if (type === 4) return raw.readUInt32LE();
      if (type === 5) return raw.readInt32LE();
      if (type === 6) return raw.readFloatLE();
      if (type === 10) return Number(raw.readBigUInt64LE());
      if (type === 11) return Number(raw.readBigInt64LE());
      return raw.readDoubleLE();
    };
    if (take(4).toString('ascii') !== 'GGUF') throw new Error('仅支持 GGUF 模型，文件头无效');
    const version = u32();
    if (version !== 2 && version !== 3) throw new Error(`仅支持 GGUF v2/v3，当前为 v${version}`);
    const tensorCount = u64(), count = u64();
    if (!tensorCount || tensorCount > 10000000 || count > 100000) throw new Error('GGUF 元数据计数无效');
    const metadata = {};
    for (let i = 0; i < count; i++) {
      const key = string(), type = u32();
      const retain = key === 'general.architecture' || key === 'general.name' || key === 'general.file_type' || key.endsWith('.context_length');
      const item = value(type, retain);
      if (retain) metadata[key] = item;
    }
    const architecture = metadata['general.architecture'];
    if (typeof architecture !== 'string' || !architecture) throw new Error('GGUF 缺少模型架构');
    const quantizations = { 0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1', 10: 'Q2_K',
      11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L', 14: 'Q4_K_S', 15: 'Q4_K_M', 16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K', 32: 'BF16' };
    return { version, sizeBytes: size, tensorCount, architecture, name: metadata['general.name'],
      nativeContextSize: metadata[`${architecture}.context_length`], contextLength: metadata[`${architecture}.context_length`],
      quantization: quantizations[metadata['general.file_type']] ?? 'GGUF 类型 ' + metadata['general.file_type'],
      quantizationType: metadata['general.file_type'] };
  } finally { await handle.close(); }
}

export async function verifyModel(filePath, manifest = defaultModel) {
  if (manifest && !/^[0-9a-f]{64}$/i.test(manifest.sha256 ?? '')) throw new Error('模型缺少可信的 SHA-256，禁止下载或安装');
  const speech = manifest?.format === 'whisper-ggml';
  const metadata = speech ? await readWhisperMetadata(filePath) : await readGgufMetadata(filePath);
  if (manifest && metadata.sizeBytes !== manifest.sizeBytes) throw new Error(`模型大小不符：${metadata.sizeBytes} / ${manifest.sizeBytes} 字节`);
  const actualSha256 = await sha256File(filePath);
  if (!manifest) return { ...metadata, sha256: actualSha256, verified: false, sourceUnverified: true };
  if (actualSha256 !== manifest.sha256.toLowerCase()) throw new Error('模型 SHA-256 校验失败，请重新下载');
  if (manifest.architecture && metadata.architecture !== manifest.architecture) throw new Error('模型架构与安装清单不符');
  if (speech) {
    if (manifest.languages?.includes('zh') && !metadata.multilingual) throw new Error('英语专用模型不能作为中文语音识别模型安装');
  } else if (manifest.kind === 'vision-projector') {
    if (metadata.architecture !== 'clip') throw new Error('视觉组件必须是兼容的 CLIP GGUF 投影文件');
  } else if (!Number.isSafeInteger(manifest.contextSize) || manifest.contextSize <= 0
    || !Number.isSafeInteger(metadata.nativeContextSize) || metadata.nativeContextSize < manifest.contextSize) {
    throw new Error('模型原生上下文不足或缺失，无法提供配置的上下文');
  }
  return { ...metadata, sha256: actualSha256, verified: true };
}

/** Manual redirects enforce verified HTTPS on every hop, including before transfer. */
export async function fetchHttps(url, options = {}, redirectCount = 0) {
  url = new URL(url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('下载必须使用无明文凭据的 HTTPS 地址');
  let response;
  try { response = await fetch(url, { ...options, redirect: 'manual' }); }
  catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('下载已暂停');
    const code = error.cause?.code;
    const reason = ['ENOTFOUND', 'EAI_AGAIN'].includes(code) ? '域名无法解析'
      : /CERT|TLS/.test(code ?? '') ? 'TLS 证书验证失败'
      : /TIMEOUT/.test(code ?? '') ? '连接超时' : '网络或代理阻止连接';
    throw new Error(`无法连接下载源 ${url.hostname}：${reason}`, { cause: error });
  }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirectCount >= 8) throw new Error('下载重定向缺失或次数过多');
    const next = new URL(location, url);
    const headers = new Headers(options.headers);
    if (next.origin !== url.origin) { headers.delete('authorization'); headers.delete('cookie'); headers.delete('proxy-authorization'); }
    return fetchHttps(next, { ...options, headers }, redirectCount + 1);
  }
  return response;
}

async function publishFileLock(lockPath, manifest) {
    const temporary = lockPath + '.owner-' + process.pid + '-' + randomUUID();
    let lock;
    try {
      lock = await open(temporary, 'wx', 0o600);
      await lock.writeFile(JSON.stringify({ pid: process.pid, sha256: manifest.sha256, createdAt: Date.now() }));
      await lock.sync();
      await link(temporary, lockPath);
      await rm(temporary).catch(() => {});
      return lock;
    } catch (error) {
      await lock?.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
}

/** Publish fully initialized metadata; serialize stale recovery before re-reading ownership. */
export async function acquireFileLock(lockPath, manifest) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await publishFileLock(lockPath, manifest); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt > 0) throw new Error('该模型正在下载或准备，请等待当前任务结束');
      const recoveryPath = lockPath + '.recovery.lock';
      let guard;
      try { guard = await publishFileLock(recoveryPath, manifest); }
      catch (guardError) {
        if (guardError.code === 'EEXIST') throw new Error('下载锁正在恢复，请稍后重试；异常退出后的恢复标记可在下载缓存中清理');
        throw guardError;
      }
      let recovered = false;
      try {
      let previous;
      try { previous = JSON.parse(await readFile(lockPath, 'utf8')); }
      catch (readError) { if (readError.code === 'ENOENT') recovered = true; }
      if (Number.isSafeInteger(previous?.pid) && previous.pid > 0) {
        try { process.kill(previous.pid, 0); }
        catch (pidError) {
          if (pidError.code === 'ESRCH') { await rm(lockPath, { force: true }); recovered = true; }
        }
      }
      // Legacy malformed locks predate atomic initialization. Preserve a recent writer's lock.
      if (!recovered && (!Number.isSafeInteger(previous?.pid) || previous.pid <= 0)) {
        const details = await stat(lockPath);
        if (details.isFile() && Date.now() - details.mtimeMs > 60 * 60 * 1000) {
          await rename(lockPath, lockPath + '.abandoned-' + randomUUID());
          recovered = true;
        }
      }
      } finally { await guard.close(); await rm(recoveryPath, { force: true }); }
      if (recovered) continue;
      throw new Error('该模型正在下载，请等待当前任务结束');
    }
  }
  throw new Error('模型下载锁冲突，请稍后重试');
}

/** A cancelled/failed network transfer keeps .part; a completed corrupt transfer is removed. */
export async function downloadModel({ destination, manifest = defaultModel, onProgress = () => {}, signal } = {}) {
  if (!destination) throw new Error('请指定模型保存路径');
  if (!/^[0-9a-f]{64}$/i.test(manifest.sha256 ?? '')) throw new Error('没有可信模型校验值，禁止安装');
  if (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes <= 0) throw new Error('模型大小缺失');
  const url = new URL(manifest.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('模型下载来源必须是无明文凭据的 HTTPS 地址');
  destination = resolve(destination);
  await mkdir(dirname(destination), { recursive: true });
  const part = destination + '.part';
  const lockPath = destination + '.download.lock';
  const lock = await acquireFileLock(lockPath, manifest);
  try {
    try { await stat(destination); return await verifyModel(destination, manifest); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let received = 0;
    try { received = (await stat(part)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (received > manifest.sizeBytes) { await rm(part); received = 0; }
    const disk = await statfs(dirname(destination));
    if (disk.bavail * disk.bsize < manifest.sizeBytes - received + 64 * 1024 * 1024) throw new Error('模型存储空间不足');
    if (received < manifest.sizeBytes) {
      const response = await fetchHttps(url, { headers: received ? { Range: `bytes=${received}-` } : {}, signal });
      if (response.status !== 200 && response.status !== 206) { await response.body?.cancel(); throw new Error(`模型下载失败 HTTP ${response.status}`); }
      if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
        if (!range || Number(range[1]) !== received || Number(range[3]) !== manifest.sizeBytes) {
          await response.body?.cancel(); throw new Error('服务器断点续传范围与模型清单不一致');
        }
      } else received = 0;
      const output = await open(part, received ? 'a' : 'w', 0o600);
      try {
        for await (const chunk of Readable.fromWeb(response.body)) {
          if (signal?.aborted) throw signal.reason ?? new Error('下载已暂停');
          received += chunk.length;
          if (received > manifest.sizeBytes) throw new Error('下载数据超过模型清单大小');
          let written = 0;
          while (written < chunk.length) {
            const { bytesWritten } = await output.write(chunk, written, chunk.length - written);
            if (!bytesWritten) throw new Error('模型写入存储失败');
            written += bytesWritten;
          }
          onProgress({ receivedBytes: received, totalBytes: manifest.sizeBytes, percentage: received / manifest.sizeBytes * 100 });
        }
      } finally { await output.close(); }
    }
    if (received !== manifest.sizeBytes) throw new Error('下载中断，已保留进度，可继续下载');
    let verification;
    try { verification = await verifyModel(part, manifest); }
    catch (error) { await rm(part, { force: true }); throw error; }
    await rename(part, destination);
    onProgress({ receivedBytes: received, totalBytes: manifest.sizeBytes, percentage: 100, verified: true });
    return verification;
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const languageModel = args.includes('--desktop') ? await readDesktopManifest() : defaultModel;
  const manifest = args.includes('--speech') ? await readSpeechManifest() : args.includes('--vision') ? languageModel.visionProjector : languageModel;
  const destination = resolve(args.find((arg) => !arg.startsWith('--')) ?? '.local-models/' + manifest.filename);
  let last = -1;
  try {
    const result = args.includes('--verify') ? await verifyModel(destination, manifest) : await downloadModel({ destination, manifest,
      onProgress: ({ percentage }) => { const percent = Math.floor(percentage); if (percent !== last && percent % 5 === 0) { last = percent; console.log(`模型下载 ${percent}%`); } } });
    console.log(JSON.stringify({ path: destination, ...result }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
