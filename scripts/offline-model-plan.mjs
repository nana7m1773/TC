import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function offlinePlan(){
 const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
 const model=JSON.parse(await fs.readFile(path.join(root,'resources/default-model.windows.json'),'utf8'));
 const speech=JSON.parse(await fs.readFile(path.join(root,'resources/local-speech.json'),'utf8'));
 let sequence=0;
 return {format:'lbot-offline-v1',version,models:[model,model.visionProjector,speech].map(m=>{
  let remaining=m.sizeBytes;const parts=[];
  while(remaining){const sizeBytes=Math.min(1_800_000_000,remaining);parts.push({name:`L-BOT-Models-${version}-${String(++sequence).padStart(2,'0')}.bin`,sizeBytes});remaining-=sizeBytes;}
  return {filename:m.filename,sizeBytes:m.sizeBytes,sha256:m.sha256,parts};
 })};
}

/** Keep NSIS's inline command below its 8192-character runtime string limit. */
export function offlineCommand(plan,source){
 const packed=plan.models.map(m=>[m.filename,m.sizeBytes,m.sha256,m.parts.map(p=>[p.name,p.sizeBytes])]);
 let script=source.split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')).join('\n');
 for(const [from,to] of [['$plan.models','$plan'],['$model.filename','$model[0]'],['$model.sizeBytes','$model[1]'],['$model.sha256','$model[2]'],['$model.parts','$model[3]'],['$part.name','$part[0]'],['$part.sizeBytes','$part[1]']])script=script.replaceAll(from,to);
 for(const [from,to] of [['$temporary','$tmp'],['$inputFile','$inp'],['$output','$out'],['$model','$m'],['$part','$p'],['$target','$dst'],['$source','$src'],['$entry','$e']])script=script.replaceAll(from,to);
 const payload="$env:LBOT_OFFLINE_PLAN = @'\n"+JSON.stringify(packed)+"\n'@\n"+script;
 const encoded=Buffer.from(payload,'utf16le').toString('base64');
 if(encoded.length>7700)throw new Error('Offline installer command exceeds the safe NSIS string budget');
 return encoded;
}
