import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {DesktopModelManager} from '../desktop-models.mjs';
import {defaultModel,readDesktopManifest} from '../../../scripts/prepare-model.mjs';

test('Windows selection leaves the Android manifest and default Linux validation unchanged',async()=>{
  const bytes=await readFile(new URL('../../../resources/default-model.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'57546542c2f08d0a6720508473b15ad5af7ef240b6933798a18ab587f06bb0a0');
  const desktop=await readDesktopManifest();
  const implicit=new DesktopModelManager({directory:'unused',enginePath:null,tools:{defaultModel}});
  const explicit=new DesktopModelManager({directory:'unused',enginePath:null,tools:{defaultModel},manifest:desktop});
  assert.equal(implicit.status().defaultModel.parameterCount,2_000_000_000);
  assert.equal(explicit.status().defaultModel.parameterCount,9_000_000_000);
  assert.equal(explicit.status().contextSize,12800);
  const rendererCopy=explicit.status();rendererCopy.defaultModel.sha256='renderer mutation';
  assert.equal(explicit.status().defaultModel.sha256,desktop.sha256);
  assert.notEqual(desktop.visionProjector.sha256,defaultModel.visionProjector.sha256);
});

test('default installation downloads the explicit Windows artifact rather than the shared Android artifact',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tc-selected-download-'));
  try {
    const desktop=await readDesktopManifest();
    const requested:string[]=[];
    const tools={defaultModel,async downloadModel({destination,manifest}) {
      requested.push(manifest.id);assert.equal(manifest.sha256,desktop.sha256);
      await writeFile(destination,'download test fixture; no inference or integrity claim');
    }};
    const manager=new DesktopModelManager({directory,enginePath:null,tools,manifest:desktop});await manager.initialize();
    const result=await manager.installDefault();
    assert.deepEqual(requested,[desktop.id]);assert.equal(result.model.filename,desktop.filename);
    const records=await manager.records();assert.equal(records[0].id,desktop.id);assert.equal(records[0].sha256,desktop.sha256);
    assert.equal(defaultModel.parameterCount,2_000_000_000);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('an upgraded desktop defaults to 9B and requires explicit selection to load an older installed 2B',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tc-selected-record-'));
  try {
    const desktop=await readDesktopManifest();
    const manager=new DesktopModelManager({directory,enginePath:'unused',tools:{defaultModel},manifest:desktop});await manager.initialize();
    await manager.writeRecords([defaultModel,desktop]);
    assert.equal((await manager.resolveModel()).id,desktop.id);
    assert.equal((await manager.resolveModel({id:defaultModel.id})).id,defaultModel.id);
    await manager.writeRecords([defaultModel]);
    await assert.rejects(manager.resolveModel(),{code:'MISSING_DEFAULT'});
    assert.equal((await manager.resolveModel({modelPath:path.join(directory,defaultModel.filename)})).id,defaultModel.id);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('Windows vision downloads its matching 9B projector and refuses pairing it with 2B weights',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tc-selected-projector-'));
  try {
    const desktop=await readDesktopManifest();let projectorSha='';
    const tools={defaultModel,async downloadModel({destination,manifest}) {
      projectorSha=manifest.sha256;assert.equal(manifest.kind,'vision-projector');
      await writeFile(destination,'projector test fixture; not an actual model');
    }};
    const manager=new DesktopModelManager({directory,enginePath:'unused',tools,manifest:desktop});await manager.initialize();
    await manager.installVision();assert.equal(projectorSha,desktop.visionProjector.sha256);
    const list=await manager.listModels();assert.equal(list.defaultModel.id,desktop.id);assert.equal(list.defaultModel.visionProjector.installed,true);
    await manager.writeRecords([defaultModel]);
    await assert.rejects(manager.loadModel({id:defaultModel.id,vision:true,contextSize:12800}),{code:'MATCH'});
  }finally{await rm(directory,{recursive:true,force:true});}
});
