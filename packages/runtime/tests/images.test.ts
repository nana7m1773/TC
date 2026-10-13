import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateLocalImage} from '../images.mjs';
import {DesktopModelManager} from '../desktop-models.mjs';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlAAAAABJRU5ErkJggg==';
test('image allocation limits are checked from original headers',()=>{
  assert.equal(validateLocalImage({data:png}).width,1);
  const bomb=Buffer.from(png.split(',')[1],'base64');bomb.writeUInt32BE(50000,16);bomb.writeUInt32BE(50000,20);
  assert.throws(()=>validateLocalImage({data:'data:image/png;base64,'+bomb.toString('base64')}),{code:'IMAGE_DIMENSIONS'});
  assert.throws(()=>validateLocalImage({data:'data:image/svg+xml;base64,AAAA'}),{code:'IMAGE'});
});
test('missing local visual component never attempts external processing',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tc-vision-missing-'));
  try {
    const manager=new DesktopModelManager({directory,enginePath:'unused',tools:{defaultModel:{id:'default',visionProjector:{filename:'missing.gguf'}}}});
    let requested=false;manager.engineRequest=async()=>{requested=true;};
    await assert.rejects(manager.analyzeImage({image:{data:png},prompt:'describe'}),{code:'COMPONENT_MISSING'});
    assert.equal(requested,false);assert.equal(manager.visionActive,false);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('actual visual-token count reserves output before image generation',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tc-vision-budget-'));
  try {
    await writeFile(path.join(directory,'projector.gguf'),'test fixture; model execution is stubbed');
    const manager=new DesktopModelManager({directory,enginePath:'unused',tools:{defaultModel:{id:'default',visionProjector:{filename:'projector.gguf'}}}});
    manager.loadModelLocked=async()=>{manager.process={};manager.current={state:'ready',contextSize:12800};};
    let stopped=false;
    manager.stop=async()=>{stopped=true;manager.process=null;manager.epoch++;};
    const routes:string[]=[];
    manager.engineRequest=async(route:string)=>{routes.push(route);return {input_tokens:12700};};
    await assert.rejects(manager.analyzeImage({image:{data:png},prompt:'describe',maxTokens:256}),{code:'BUDGET'});
    assert.deepEqual(routes,['/v1/chat/completions/input_tokens']);assert.equal(stopped,true);assert.equal(manager.visionActive,false);
  }finally{await rm(directory,{recursive:true,force:true});}
});
