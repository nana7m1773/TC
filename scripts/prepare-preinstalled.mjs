import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyModel,downloadModel} from './prepare-model.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function preparePreinstalled({platform,cacheDirectory=process.env.LBOT_MODEL_CACHE??'/workspace/.cache/models',destination,download=false}){
 const model=JSON.parse(await fs.readFile(path.join(root,'resources',platform==='windows'?'default-model.windows.json':'default-model.json'),'utf8'));
 const speech=JSON.parse(await fs.readFile(path.join(root,'resources/local-speech.json'),'utf8'));
 const files=[model,{...model.visionProjector,kind:'vision-projector'},speech];
 await fs.mkdir(cacheDirectory,{recursive:true});if(destination)await fs.mkdir(destination,{recursive:true});
 for(const manifest of files){
  const source=path.join(cacheDirectory,manifest.filename);
  try{await fs.access(source);}catch(error){if(error.code!=='ENOENT'||!download)throw error;await downloadModel({destination:source,manifest});}
  await verifyModel(source,manifest);
  if(destination){const target=path.join(destination,manifest.filename);try{await fs.link(source,target);}catch(error){if(error.code==='EEXIST'){await verifyModel(target,manifest);}else if(error.code==='EXDEV')await fs.copyFile(source,target);else throw error;}}
 }
 const bundle={format:'lbot-preinstalled-v1',platform,contextSize:12800,models:files};
 if(destination)await fs.writeFile(path.join(destination,'bundle.json'),JSON.stringify(bundle,null,2)+'\n');
 return bundle;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const platform=process.argv.includes('--windows')?'windows':'android';
 const destination=platform==='android'?path.join(root,'apps/android/app/src/main/assets/preinstalled-models'):undefined;
 const bundle=await preparePreinstalled({platform,destination,download:process.argv.includes('--download')});
 console.log(JSON.stringify({platform,bytes:bundle.models.reduce((n,m)=>n+m.sizeBytes,0),files:bundle.models.map(m=>({filename:m.filename,sha256:m.sha256,sizeBytes:m.sizeBytes}))}));
}
