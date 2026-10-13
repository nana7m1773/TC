import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DesktopModelManager} from '../desktop-models.mjs';

test('missing local components produce explicit errors without any cloud call',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tc-model-test-'));
  try {
    const manager=new DesktopModelManager({directory,enginePath:null,tools:{defaultModel:{sha256:null}}});
    await manager.initialize();
    await assert.rejects(manager.installDefault(),{code:'CHECKSUM'});
    await assert.rejects(manager.loadModel(),{code:'ENGINE'});
    await assert.rejects(manager.infer({prompt:'hello'}),{code:'NOT_LOADED'});
    await assert.rejects(manager.tokenize({text:'hello'}),{code:'NOT_LOADED'});
    assert.equal(manager.status().contextSize,12800);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('a renderer-supplied arbitrary model path cannot select a file outside the model index',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tc-model-path-'));
  try {
    const manager=new DesktopModelManager({directory,enginePath:'unused',tools:{defaultModel:{}}});await manager.initialize();
    await writeFile(path.join(directory,'models.json'),JSON.stringify([{id:'known',filename:'known.gguf'}]));
    await assert.rejects(manager.resolveModel({modelPath:'/etc/passwd'}),{code:'MISSING'});
    await assert.rejects(manager.resolveModel({id:'../../etc/passwd'}),{code:'MISSING'});
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('the complete tokenized chat-template budget is checked before generation',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tc-model-budget-'));
  try {
    const manager=new DesktopModelManager({directory,enginePath:'unused',tools:{defaultModel:{}}});
    manager.process={};manager.current={state:'ready',contextSize:12800};
    let called=false;manager.engineRequest=async(route:string)=>{if(route==='/v1/chat/completions/input_tokens')return {input_tokens:12400};called=true;return {content:'should not generate'};};
    await assert.rejects(manager.infer({prompt:'hello',maxTokens:512,temperature:0.7}),{code:'BUDGET'});
    assert.equal(called,false);assert.equal(manager.status().state,'ready');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('local model rejects image or audio instead of silently uploading',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tc-local-mode-'));
  try {
    const manager=new DesktopModelManager({directory,enginePath:'unused',tools:{defaultModel:{}}});
    manager.process={};manager.current={state:'ready',contextSize:12800};
    await assert.rejects(manager.infer({prompt:'hello',image:{base64:'AA=='}}),{code:'COMPONENT'});
    await assert.rejects(manager.infer({prompt:'hello',audio:{base64:'AA=='}}),{code:'COMPONENT'});
  }finally{await rm(directory,{recursive:true,force:true});}
});
