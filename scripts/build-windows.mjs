import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=(command,args)=>new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:root,stdio:'inherit',shell:false,env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false',
    ...((process.env.HTTPS_PROXY||process.env.HTTP_PROXY)?{NODE_USE_ENV_PROXY:process.env.NODE_USE_ENV_PROXY??'1'}:{}),
    ELECTRON_CACHE:process.env.ELECTRON_CACHE??path.join(root,'.cache/electron'),
    ELECTRON_BUILDER_CACHE:process.env.ELECTRON_BUILDER_CACHE??path.join(root,'.cache/electron-builder')}});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${command} 失败（${code}）`)));
});
try {
  await run(process.execPath,['scripts/prepare-engine.mjs','--platform','win-x64']);
  await run(process.execPath,['scripts/prepare-engine.mjs','--speech']);
  await run(process.execPath,['scripts/prepare-engine.mjs','--vc-runtime']);
  const prerequisiteScript=await fs.readFile(path.join(root,'apps/desktop/verify-vc-runtime.ps1'),'utf8');
  await fs.writeFile(path.join(root,'apps/desktop/resources/verify-vc-command.nsh'),
    `; Generated from apps/desktop/verify-vc-runtime.ps1 by the build script.\n!define TC_VC_COMMAND "${Buffer.from(prerequisiteScript,'utf16le').toString('base64')}"\n`);
  await run(process.execPath,['node_modules/vite/bin/vite.js','build']);
  await run(process.execPath,['node_modules/electron-builder/cli.js','--config','apps/desktop/electron-builder.json','--win','nsis','--x64']);
}catch(error){console.error(error.message);process.exitCode=1;}
