import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {extractFile,listPackage} from '@electron/asar';
import {engineManifest} from './prepare-engine.mjs';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageInfo=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const installer=path.join(root,`artifacts/windows/L-BOT-Setup-${packageInfo.version}-x64.exe`);
const sevenZip=process.env.TC_7ZIP??'/workspace/.cache/electron-builder/7zip@1.0.0/7zip-linux-x64-16wjr/bin/7zz';
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const capture=(command,args)=>new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],shell:false});let output='',error='';
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);
  child.once('error',reject);child.once('exit',code=>code===0?resolve(output):reject(new Error(`包验证工具失败：${code} ${error.slice(-1000)}`)));
});
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'tc-package-verify-'));
const checks=[];
try {
  const bytes=await fs.readFile(installer);
  if(bytes.toString('ascii',0,2)!=='MZ'||bytes.length<50_000_000)throw new Error('安装器为空、不完整或格式无效。');
  const listing=await capture(sevenZip,['l','-slt',installer]);
  for(const expected of ['Type = Nsis','app.7z','vc_redist.x64.exe','Uninstall.exe'])if(!listing.includes(expected))throw new Error(`NSIS 缺少 ${expected}`);
  checks.push('完整 NSIS 安装器包含应用归档、Microsoft 前置安装器和卸载器。');
  await capture(sevenZip,['x','-y',`-o${scratch}`,installer]);
  const plugin=path.join(scratch,'$PLUGINSDIR');
  const vc=await fs.readFile(path.join(plugin,'vc_redist.x64.exe'));
  if(sha(vc)!==engineManifest.vcRuntimeWindows.sha256)throw new Error('嵌入的 Microsoft 运行库 SHA-256 不一致。');
  const application=path.join(scratch,'application');await fs.mkdir(application);
  await capture(sevenZip,['x','-y',`-o${application}`,path.join(plugin,'app.7z')]);
  const asar=path.join(application,'resources/app.asar');
  const entries=listPackage(asar);
  const sources=['apps/desktop/main.cjs','apps/desktop/preload.cjs','packages/runtime/openai.mjs','packages/runtime/desktop-models.mjs',
    'packages/runtime/desktop-speech.mjs','packages/runtime/images.mjs','packages/runtime/windows-ui.mjs','scripts/prepare-model.mjs','resources/default-model.json','resources/default-model.windows.json','resources/local-speech.json'];
  for(const relative of sources)if(sha(extractFile(asar,relative))!==sha(await fs.readFile(path.join(root,relative))))throw new Error(`打包源码不是最新：${relative}`);
  const windowsScript='apps/desktop/windows-ui.ps1';
  if(sha(await fs.readFile(path.join(application,'resources/app.asar.unpacked',windowsScript)))!==sha(await fs.readFile(path.join(root,windowsScript))))throw new Error('安装器的独立 Windows 窗口操作脚本不是最新。');
  await fs.access(path.join(application,'L-BOT.exe'));
  checks.push('L-BOT 主程序和独立解包的固定 PowerShell 窗口操作脚本存在，脚本 SHA 与最新源码一致。');
  // electron-builder intentionally strips development scripts/dependencies from the installed metadata.
  const installedPackage=JSON.parse(extractFile(asar,'package.json').toString('utf8'));
  for(const key of ['name','version','main','type'])if(installedPackage[key]!==packageInfo[key])throw new Error(`运行元数据不一致：${key}`);
  for(const [key,value] of Object.entries(packageInfo.dependencies??{}))if(installedPackage.dependencies?.[key]!==value)throw new Error(`生产依赖元数据不一致：${key}`);
  const dist=entries.filter(name=>name.startsWith('/dist/')&&!name.endsWith('/'));
  let assets=0;
  for(const relative of dist) {
    try {const local=await fs.readFile(path.join(root,relative.slice(1)));if(sha(extractFile(asar,relative.slice(1)))!==sha(local))throw new Error(`UI 资源不一致：${relative}`);assets++;}
    catch(error){if(error.code!=='EISDIR')throw error;}
  }
  if(!assets)throw new Error('安装器没有 UI 资源。');
  checks.push('嵌入的界面、preload、原生桥接、本地推理/API/图片/语音模块和模型清单与最新源码一致。');
  const androidModel=JSON.parse(extractFile(asar,'resources/default-model.json').toString('utf8'));
  const windowsModel=JSON.parse(extractFile(asar,'resources/default-model.windows.json').toString('utf8'));
  if(androidModel.parameterCount!==2_000_000_000||windowsModel.parameterCount!==9_000_000_000||androidModel.id===windowsModel.id||
      windowsModel.contextSize!==12800||windowsModel.quantization!=='Q4_K_M')throw new Error('Windows 与 Android 独立默认模型或 12,800 上下文配置不一致。');
  checks.push('Windows 默认 9B Q4_K_M 与 Android 默认 2B 清单独立；两者有效上下文仍为 12,800 tokens。');
  const engines=[];
  for(const [directory,manifest] of [['win-x64',engineManifest.windows],['whisper-win-x64',engineManifest.whisperWindows]]) {
    const folder=path.join(application,'resources/engines',directory);
    const receipt=JSON.parse(await fs.readFile(path.join(folder,'engine.json'),'utf8'));
    if(receipt.version!==manifest.version||receipt.sha256!==manifest.sha256||!receipt.archiveVerified)throw new Error(`引擎 receipt 不一致：${directory}`);
    if(sha(await fs.readFile(path.join(folder,receipt.executable)))!==receipt.executableSha256)throw new Error(`引擎执行文件不一致：${directory}`);
    const source=path.join(root,'apps/desktop/resources/engines',directory);
    for(const filename of await fs.readdir(source))if(sha(await fs.readFile(path.join(folder,filename)))!==sha(await fs.readFile(path.join(source,filename))))throw new Error(`引擎依赖或许可证不一致：${filename}`);
    engines.push({version:receipt.version,executableSha256:receipt.executableSha256,archiveSha256:receipt.sha256});
  }
  for(const required of ['llama-server-impl.dll','ggml-cpu-x64.dll','libomp.dll'])await fs.access(path.join(application,'resources/engines/win-x64',required));
  for(const required of ['whisper.dll','ggml.dll','ggml-base.dll','ggml-cpu.dll'])await fs.access(path.join(application,'resources/engines/whisper-win-x64',required));
  checks.push('内置 llama.cpp/Whisper 完整 DLL、独立 ABI 目录、许可证、官方版本及归档 SHA 校验一致。');
  const report={verifiedAt:new Date().toISOString(),installer:{path:installer,sizeBytes:bytes.length,sha256:sha(bytes)},dependencies:{electron:packageInfo.devDependencies.electron,electronBuilder:packageInfo.devDependencies['electron-builder']},
    uiAssetCount:assets,engines,defaultModels:{windows:{id:windowsModel.id,sizeBytes:windowsModel.sizeBytes,sha256:windowsModel.sha256,contextSize:windowsModel.contextSize},android:{id:androidModel.id,sha256:androidModel.sha256}},vcRuntime:{version:engineManifest.vcRuntimeWindows.version,sha256:engineManifest.vcRuntimeWindows.sha256},checks,
    limitations:['安装器和 Windows 进程未在真实 Windows 设备执行。','Microsoft Authenticode 与 UAC 检查在实际安装时执行；Linux 不宣称已完成此项。','8 GB Android 实机及平台真实消息联调仍待验收。']};
  await fs.mkdir(path.join(root,'artifacts/validation'),{recursive:true});await fs.writeFile(path.join(root,'artifacts/validation/windows-package.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally {await fs.rm(scratch,{recursive:true,force:true});}
