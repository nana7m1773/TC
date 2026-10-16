import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {DesktopModelManager} from '../desktop-models.mjs';
import {DesktopSpeechManager} from '../desktop-speech.mjs';
test('offline default and both components resolve from installation resources without copying or network and preserve imported models',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'lbot-bundled-'));
 try{
  const bundle=path.join(directory,'bundle'),user=path.join(directory,'user');await mkdir(bundle);await mkdir(user);
  const data=Buffer.from('explicit small transport fixture; not a real GGUF or inference claim');
  const base={id:'selected-default',filename:'model.gguf',sizeBytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),nativeContextSize:12800,contextSize:12800};
  const vision={...base,id:'vision',filename:'projector.gguf'},speech={...base,id:'speech',filename:'voice.bin'};
  const manifest={...base,visionProjector:vision};let verified=0;
  const tools={defaultModel:manifest,async downloadModel(){assert.fail('offline workflow reached network')},async verifyModel(file,m){assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),m.sha256);verified++;}};
  for(const m of [manifest,vision,speech])await writeFile(path.join(bundle,m.filename),data);
  const manager=new DesktopModelManager({directory:user,bundledDirectory:bundle,enginePath:null,manifest,tools});await manager.initialize();
  await manager.writeRecords([{id:'custom',filename:'custom.gguf'}]);await writeFile(path.join(user,'custom.gguf'),data);
  assert.equal((await manager.resolveModel()).path,path.join(bundle,base.filename));
  assert.equal((await manager.resolveModel({modelPath:path.join(bundle,base.filename)})).bundled,true);
  assert.equal((await manager.resolveModel({id:'custom'})).path,path.join(user,'custom.gguf'));
  assert.equal((await manager.listModels()).models.length,2);
  await manager.installDefault();await manager.installVision();
  const voice=new DesktopSpeechManager({directory:user,bundledDirectory:bundle,enginePath:null,manifest:speech,tools});await voice.initialize();await voice.installSpeech();assert.equal(await voice.modelPath(),path.join(bundle,speech.filename));assert.equal(verified,3);
  await assert.rejects(manager.deleteModel({id:base.id}),{code:'BUNDLED'});
  await writeFile(path.join(bundle,base.filename),'corrupt');await assert.rejects(manager.installDefault());
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('an incomplete offline installation never silently downloads missing text, vision or speech',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lbot-bundle-missing-'));
 try{const manifest={id:'m',filename:'m.gguf',visionProjector:{id:'v',filename:'v.gguf'}};
 const tools={defaultModel:manifest,async downloadModel(){assert.fail('unexpected network')}};
 const manager=new DesktopModelManager({directory:dir,bundledDirectory:path.join(dir,'missing'),enginePath:null,manifest,tools});await manager.initialize();
 await assert.rejects(manager.installDefault(),{code:'BUNDLED_MISSING'});await assert.rejects(manager.installVision(),{code:'BUNDLED_MISSING'});
 const voice=new DesktopSpeechManager({directory:dir,bundledDirectory:path.join(dir,'missing'),manifest:{filename:'speech.bin'},tools});await assert.rejects(voice.installSpeech(),{code:'BUNDLED_MISSING'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
