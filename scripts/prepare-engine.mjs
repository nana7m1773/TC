import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { availableParallelism, platform as hostPlatform } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { acquireFileLock, fetchHttps } from './prepare-model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const engineManifest = {
  project: 'llama.cpp', license: 'MIT', source: 'https://github.com/ggml-org/llama.cpp',
  defaultContextSize: 12800,
  windows: {
    version: 'b11429', platform: 'win-x64', filename: 'llama-b11429-bin-win-cpu-x64.zip',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11429/llama-b11429-bin-win-cpu-x64.zip',
    sha256: '1283323272b04cd07905816a597a0da810918102de958f4ff6f7bbaa70ed2efe',
    checksumSource: 'https://github.com/ggml-org/llama.cpp/releases/expanded_assets/b11429',
    cpuCompatibility: 'Official CPU package contains baseline ggml-cpu-x64.dll and runtime-selected ISA variants.',
    licenseUrl: 'https://raw.githubusercontent.com/ggml-org/llama.cpp/b11429/LICENSE'
  },
  sourceBuild: { version: 'b11429', commit: 'd81235049384534c167caea52b85a694f6103d14',
    platform: 'linux-x64', backend: 'CPU', licenseUrl: 'https://raw.githubusercontent.com/ggml-org/llama.cpp/b11429/LICENSE' },
  whisperWindows: {
    project: 'whisper.cpp', version: 'v1.8.7', commit: '48f628a84833905ee4a0658ee6d4a5c915ce1997', platform: 'win-x64',
    filename: 'whisper-bin-x64.zip', cacheFilename: 'whisper-v1.8.7-bin-x64.zip',
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.7/whisper-bin-x64.zip',
    sha256: 'd9627486e1c34a03745880485593473e047294260ce9a3cb0aa8deaf15b99af6',
    checksumSource: 'https://github.com/ggml-org/whisper.cpp/releases/expanded_assets/v1.8.7',
    license: 'MIT', licenseUrl: 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/48f628a84833905ee4a0658ee6d4a5c915ce1997/LICENSE',
    executable: 'whisper-cli.exe', backend: 'CPU',
    cpuCompatibility: 'Official x64 CPU package enables AVX2/FMA/F16C. An AVX2-capable CPU and Windows device acceptance are required.',
    minimumCpuFeatures: ['AVX2', 'FMA', 'F16C'],
    runtimeDependencies: ['Microsoft Visual C++ x64 runtime: MSVCP140, VCRUNTIME140, VCRUNTIME140_1, VCOMP140', 'Windows 10/11 Universal CRT'],
    runtimeDocumentation: 'https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist',
    testedOnWindows: false
  },
  vcRuntimeWindows: {
    project: 'Microsoft Visual C++ Redistributable', version: '14.51.36247.0', platform: 'win-x64',
    filename: 'vc_redist.x64.exe', cacheFilename: 'vc_redist.x64-14.51.36247.0.exe',
    url: 'https://download.visualstudio.microsoft.com/download/pr/ebdab8e5-1d7b-4d9f-a11b-cbb1720c3b12/843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C/VC_redist.x64.exe',
    sha256: '843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c',
    source: 'https://github.com/microsoft/winget-pkgs', sourceRevision: '7d34dbe95888e81befcf61c174a6688fb574be9c',
    checksumSource: 'https://raw.githubusercontent.com/microsoft/winget-pkgs/7d34dbe95888e81befcf61c174a6688fb574be9c/manifests/m/Microsoft/VCRedist/2015%2B/x64/14.51.36247.0/Microsoft.VCRedist.2015%2B.x64.installer.yaml',
    publisher: 'Microsoft Corporation', license: 'Microsoft redistributable license',
    documentation: 'https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist',
    requiresSystemElevation: true, acceptedInstallerExitCodes: [0, 3010],
    requiredWindowsSignatureStatus: 'Valid', requiredWindowsSigner: 'Microsoft Corporation',
    testedOnWindows: false
  },
  thirdPartyLicenses: [
    { filename: 'LICENSE-httplib', path: 'vendor/cpp-httplib/LICENSE' },
    { filename: 'LICENSE-jsonhpp', path: 'licenses/LICENSE-jsonhpp' },
    { filename: 'LICENSE-sha256', path: 'vendor/hash/sha256/LICENSE' },
    { filename: 'LICENSE-xxhash', path: 'vendor/hash/xxhash/LICENSE' },
    { filename: 'LICENSE-rotate-bits', path: 'vendor/hash/rotate-bits/LICENSE.md' }
  ],
  verifiedAt: '2026-10-11',
  note: 'Current Qwen3.5-compatible engine is pinned across platforms. Windows binary execution still requires Windows acceptance.'
};

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false, ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`${command} 失败（${code ?? signal}）`)));
  });
}
function capture(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, ...options });
    let output = '', error = '';
    child.stdout.on('data', (chunk) => output += chunk);
    child.stderr.on('data', (chunk) => error += chunk);
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolvePromise(output.trim()) : reject(new Error(`${command} 失败：${error.slice(-2000)}`)));
  });
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function exists(file) { try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function fetchVerifiedHttps(url) {
  const response = await fetchHttps(url);
  if (!response.ok) { await response.body?.cancel(); throw new Error(`引擎下载 HTTP ${response.status}`); }
  return response;
}

async function verifiedArtifact(manifest, cache) {
  await mkdir(cache, { recursive: true });
  const artifact = join(cache, manifest.cacheFilename ?? manifest.filename);
  if (await exists(artifact)) {
    if (await sha256(artifact) !== manifest.sha256) throw new Error('缓存归档 SHA-256 不符，请删除损坏缓存后重新准备');
    return artifact;
  }
  const stage = await mkdtemp(join(cache, 'download-'));
  try {
    const part = join(stage, 'artifact.part');
    const { createWriteStream } = await import('node:fs');
    const response = await fetchVerifiedHttps(manifest.url);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part, { mode: 0o600 }));
    if (await sha256(part) !== manifest.sha256) throw new Error('下载归档 SHA-256 不符，禁止使用');
    try { await rename(part, artifact); }
    catch (error) { if (!await exists(artifact) || await sha256(artifact) !== manifest.sha256) throw error; }
    return artifact;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

async function preparedDirectory(destination, fingerprint, prepare) {
  destination = resolve(destination);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const lockPath = destination + '.prepare.lock';
  const lock = await acquireFileLock(lockPath, { sha256: fingerprint });
  let stage;
  let backup;
  try {
    stage = await mkdtemp(join(parent, '.' + basename(destination) + '.staging-'));
    const result = await prepare(stage);
    if (await exists(destination)) {
      if (!(await stat(destination)).isDirectory()) throw new Error('准备目标已存在且不是目录');
      // Retain the prior directory, including any user files, outside the published target.
      backup = join(parent, '.' + basename(destination) + '.previous-' + randomUUID());
      await rename(destination, backup);
    }
    try { await rename(stage, destination); }
    catch (error) { if (backup) await rename(backup, destination); throw error; }
    return { ...result, destination, ...(backup ? { previousDirectory: backup } : {}) };
  } finally {
    try { if (stage) await rm(stage, { recursive: true, force: true }); }
    finally { await lock.close(); await rm(lockPath, { force: true }); }
  }
}

async function prepareWindowsEngineUnpublished({ cache, destination }) {
  const archive = await verifiedArtifact(engineManifest.windows, cache);
  const extraction = await mkdtemp(join(cache, 'verified-win-'));
  try {
    if (hostPlatform() === 'win32') {
      const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
      const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead(${quote(archive)}); foreach($e in $z.Entries){if($e.FullName -match '[/\\\\]' -or $e.FullName -match '^\\.\\.'){$z.Dispose();throw 'Unsafe archive entry'}}; $z.Dispose(); [System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(archive)},${quote(extraction)})`;
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    } else {
      const files = (await capture('unzip', ['-Z1', archive])).split('\n');
      if (files.some((name) => !name || name.includes('/') || name.includes('\\') || name.startsWith('..'))) throw new Error('引擎 ZIP 包含不安全路径');
      await run('unzip', ['-q', archive, '-d', extraction]);
    }
    if (!await exists(join(extraction, 'llama-server.exe')) || !await exists(join(extraction, 'ggml-cpu-x64.dll'))) throw new Error('官方 CPU 引擎归档缺少服务端或兼容后端');
    const licenseResponse = await fetchVerifiedHttps(engineManifest.windows.licenseUrl);
    const license = await licenseResponse.text();
    if (!license.includes('MIT License')) throw new Error('无法确认 llama.cpp MIT 许可证');
    await mkdir(destination, { recursive: true });
    for (const name of await readdir(extraction)) {
      if (name === 'llama-server.exe' || name.endsWith('.dll') || name.startsWith('LICENSE-')) await copyFile(join(extraction, name), join(destination, name));
    }
    await writeFile(join(destination, 'LICENSE-llama.cpp'), license);
    for (const entry of engineManifest.thirdPartyLicenses) {
      const response = await fetchVerifiedHttps(`https://raw.githubusercontent.com/ggml-org/llama.cpp/${engineManifest.sourceBuild.commit}/${entry.path}`);
      await writeFile(join(destination, entry.filename), await response.text());
    }
    const receipt = { ...engineManifest.windows, license: engineManifest.license, verifiedAt: engineManifest.verifiedAt,
      executable: 'llama-server.exe', executableSha256: await sha256(join(destination, 'llama-server.exe')), archiveVerified: true };
    await writeFile(join(destination, 'engine.json'), JSON.stringify(receipt, null, 2) + '\n');
    return { destination, ...receipt };
  } finally { await rm(extraction, { recursive: true, force: true }); }
}
export async function prepareWindowsEngine({ cache = resolve(root, '.cache/engines'), destination = resolve(root, 'apps/desktop/resources/engines/win-x64') } = {}) {
  return preparedDirectory(destination, engineManifest.windows.sha256, (stage) => prepareWindowsEngineUnpublished({ cache, destination: stage }));
}

/** Keep Whisper DLLs separate from llama.cpp DLLs: their ggml ABI/version differs. */
async function prepareWindowsSpeechEngineUnpublished({ cache, destination }) {
  const manifest = engineManifest.whisperWindows;
  const archive = await verifiedArtifact(manifest, cache);
  const extraction = await mkdtemp(join(cache, 'verified-whisper-'));
  try {
    if (hostPlatform() === 'win32') {
      const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
      const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead(${quote(archive)}); foreach($e in $z.Entries){if($e.FullName -notmatch '^Release/[A-Za-z0-9._-]+$' -and $e.FullName -ne 'Release/'){$z.Dispose();throw 'Unsafe archive entry'}}; $z.Dispose(); [System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(archive)},${quote(extraction)})`;
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    } else {
      const files = (await capture('unzip', ['-Z1', archive])).split('\n');
      if (files.some((name) => name !== 'Release/' && !/^Release\/[A-Za-z0-9._-]+$/.test(name))) throw new Error('Whisper ZIP 包含不安全路径');
      await run('unzip', ['-q', archive, '-d', extraction]);
    }
    const release = join(extraction, 'Release');
    if (!await exists(join(release, manifest.executable)) || !await exists(join(release, 'whisper.dll'))) throw new Error('Whisper 引擎归档缺少识别程序或动态库');
    await mkdir(destination, { recursive: true });
    for (const name of await readdir(release)) if (name === manifest.executable || ['whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll'].includes(name)) await copyFile(join(release, name), join(destination, name));
    await rm(join(destination, 'SDL2.dll'), { force: true });
    const license = await (await fetchVerifiedHttps(manifest.licenseUrl)).text();
    if (!license.includes('MIT')) throw new Error('Whisper MIT 许可证无法确认');
    await writeFile(join(destination, 'LICENSE-whisper.cpp'), license);
    const receipt = { ...manifest, archiveVerified: true, executableSha256: await sha256(join(destination, manifest.executable)),
      checksumVerifiedAt: engineManifest.verifiedAt };
    await writeFile(join(destination, 'engine.json'), JSON.stringify(receipt, null, 2) + '\n');
    return { destination, ...receipt };
  } finally { await rm(extraction, { recursive: true, force: true }); }
}
export async function prepareWindowsSpeechEngine({ cache = resolve(root, '.cache/engines'), destination = resolve(root, 'apps/desktop/resources/engines/whisper-win-x64') } = {}) {
  return preparedDirectory(destination, engineManifest.whisperWindows.sha256, (stage) => prepareWindowsSpeechEngineUnpublished({ cache, destination: stage }));
}

/** Prepares a fixed Microsoft installer; installation/elevation is handled by the Windows installer UI. */
async function prepareWindowsVCRuntimeUnpublished({ cache, destination }) {
  const manifest = engineManifest.vcRuntimeWindows;
  const artifact = await verifiedArtifact(manifest, cache);
  if (hostPlatform() === 'win32') {
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    const verification = `$s=Get-AuthenticodeSignature -LiteralPath ${quote(artifact)}; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch '(?:^|, ?)(?:CN|O)=Microsoft Corporation(?:,|$)'){throw 'Invalid Microsoft Authenticode signature'}`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(verification, 'utf16le').toString('base64')]);
  }
  await mkdir(destination, { recursive: true });
  await copyFile(artifact, join(destination, manifest.filename));
  const receipt = { ...manifest, sha256Verified: true, authenticodeVerified: hostPlatform() === 'win32',
    verification: 'SHA-256 checked against pinned Microsoft winget manifest. Windows installer must recheck the hash and a valid Microsoft Authenticode signature before execution.',
    sizeBytes: (await stat(artifact)).size };
  await writeFile(join(destination, 'vc-runtime.json'), JSON.stringify(receipt, null, 2) + '\n');
  return { destination, ...receipt };
}
export async function prepareWindowsVCRuntime({ cache = resolve(root, '.cache/prerequisites'), destination = resolve(root, 'apps/desktop/resources/prerequisites') } = {}) {
  return preparedDirectory(destination, engineManifest.vcRuntimeWindows.sha256, (stage) => prepareWindowsVCRuntimeUnpublished({ cache, destination: stage }));
}

async function prepareLinuxEngineUnpublished({ source, destination, cmake, jobs, native }) {
  if (hostPlatform() !== 'linux' || process.arch !== 'x64') throw new Error('当前本地构建只支持 Linux x64；Android 使用独立 NDK 脚本');
  if (!await exists(join(source, '.git'))) {
    await mkdir(dirname(source), { recursive: true });
    await run('git', ['clone', '--depth', '1', '--branch', engineManifest.sourceBuild.version, engineManifest.source, source]);
  }
  if (await capture('git', ['-C', source, 'rev-parse', 'HEAD']) !== engineManifest.sourceBuild.commit) throw new Error('llama.cpp 源码提交与固定版本不一致，不覆盖现有 checkout');
  if (await capture('git', ['-C', source, 'status', '--porcelain=v1', '--untracked-files=no'])) throw new Error('llama.cpp 存在已修改或暂存的源码，不能作为验证过的固定版本构建');
  const build = join(source, 'build');
  const flags = ['-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_CPU=ON', '-DGGML_CUDA=OFF', '-DGGML_VULKAN=OFF', '-DGGML_METAL=OFF',
    '-DLLAMA_OPENSSL=ON', '-DLLAMA_USE_PREBUILT_UI=OFF', '-DLLAMA_BUILD_UI=OFF', '-DLLAMA_BUILD_APP=OFF',
    '-DLLAMA_BUILD_TESTS=OFF', '-DLLAMA_BUILD_EXAMPLES=OFF', '-DLLAMA_BUILD_TOOLS=ON', '-DLLAMA_BUILD_SERVER=ON',
    '-DLLAMA_BUILD_NUMBER=11429', '-DLLAMA_BUILD_COMMIT=d812350', `-DGGML_NATIVE=${native ? 'ON' : 'OFF'}`];
  if (!native) flags.push('-DGGML_AVX=OFF', '-DGGML_AVX2=OFF', '-DGGML_AVX512=OFF', '-DGGML_FMA=OFF', '-DGGML_F16C=OFF', '-DGGML_BMI2=OFF', '-DGGML_SSE42=OFF');
  else flags.push('-DGGML_AVX=ON', '-DGGML_AVX2=ON', '-DGGML_FMA=ON', '-DGGML_F16C=ON', '-DGGML_BMI2=ON', '-DGGML_SSE42=ON');
  await run(cmake, ['-S', source, '-B', build, ...flags]);
  await run(cmake, ['--build', build, '--target', 'llama-server', '-j', String(Math.max(1, Math.min(8, jobs)))]);
  await mkdir(destination, { recursive: true });
  await copyFile(join(build, 'bin/llama-server'), join(destination, 'llama-server'));
  await copyFile(join(source, 'LICENSE'), join(destination, 'LICENSE-llama.cpp'));
  for (const name of await readdir(join(source, 'licenses'))) if (name.startsWith('LICENSE-')) await copyFile(join(source, 'licenses', name), join(destination, name));
  for (const entry of engineManifest.thirdPartyLicenses) await copyFile(join(source, entry.path), join(destination, entry.filename));
  const receipt = { ...engineManifest.sourceBuild, license: engineManifest.license, executable: 'llama-server',
    cpuCompatibility: native ? 'CPU native build; distribution restricted to matching CPU features.' : 'Portable x64 CPU build with optional ISA instructions disabled.',
    executableSha256: await sha256(join(destination, 'llama-server')), builtFromVerifiedCommit: true };
  await writeFile(join(destination, 'engine.json'), JSON.stringify(receipt, null, 2) + '\n');
  return { destination, ...receipt };
}
export async function prepareLinuxEngine({ source = resolve(root, '.cache/llama.cpp'), destination = resolve(root, 'apps/desktop/resources/engines/linux-x64'), cmake = process.env.CMAKE ?? 'cmake', jobs = Math.min(3, availableParallelism()), native = false } = {}) {
  // Serialize access to the shared build tree to avoid native/portable CMake configuration races.
  const lockPath = resolve(source) + '.build.lock';
  await mkdir(dirname(lockPath), { recursive: true });
  const lock = await acquireFileLock(lockPath, { sha256: engineManifest.sourceBuild.commit });
  try { return await preparedDirectory(destination, engineManifest.sourceBuild.commit, (stage) => prepareLinuxEngineUnpublished({ source, destination: stage, cmake, jobs, native })); }
  finally { await lock.close(); await rm(lockPath, { force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const equal = args.find((arg) => arg.startsWith(`--${name}=`)); if (equal) return equal.slice(name.length + 3); const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
  const target = option('platform', args.includes('win-x64') ? 'win-x64' : hostPlatform() === 'win32' ? 'win-x64' : 'linux-x64');
  try {
    const result = args.includes('--vc-runtime') ? await prepareWindowsVCRuntime({ cache: option('cache', undefined), destination: option('output', undefined) })
      : args.includes('--speech') ? await prepareWindowsSpeechEngine({ cache: option('cache', undefined), destination: option('output', undefined) })
      : target === 'win-x64' ? await prepareWindowsEngine({ cache: option('cache', undefined), destination: option('output', undefined) })
      : target === 'linux-x64' ? await prepareLinuxEngine({ source: option('source', undefined), destination: option('output', undefined), cmake: option('cmake', undefined), native: args.includes('--native') })
      : (() => { throw new Error('仅支持 win-x64 和 linux-x64'); })();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
