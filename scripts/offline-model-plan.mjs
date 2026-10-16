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
