import test from 'node:test';
import assert from 'node:assert/strict';
import {ComputerReplyService} from '../../../apps/web/src/ComputerReplyService.ts';
import {QueueEngine,createDefaultProfile} from '../src/index.ts';
import type {ComputerReplyRequest} from '../../../apps/web/src/ComputerUseView.tsx';
import type {NativeBridge} from '../../../apps/web/src/runtime.ts';
const request:ComputerReplyRequest={window:{selection:'token',process:'wechat',handle:'111',title:'friend · 微信',kind:'client'},conversationTitle:'friend',snapshot:'visible-snapshot',text:'周末一起吃饭吗？',rules:{enabled:true,whitelist:['friend'],selfSensitive:true,paused:false,replyLanguage:'中文',delayMs:1000}};
function fixture(output='谢谢想着我，想吃些什么呀？'){
  let now=10000,state={queue:new QueueEngine().snapshot(),profile:createDefaultProfile(),memories:[]},persisted=false,calls=0;
  const native={modelStatus:async()=>({loaded:true}),tokenize:async()=>({count:100}),infer:async()=>{calls++;return {text:output,inputTokens:100,outputTokens:10,tokensPerSecond:1,contextSize:12800};}} as unknown as NativeBridge;
  const service=new ComputerReplyService({getState:()=>state,setQueue:queue=>{state={...state,queue};},native:()=>native,now:()=>now,persist:async()=>{persisted=true;}});
  return {service,get state(){return state;},get persisted(){return persisted;},get calls(){return calls;},advance:()=>{now+=1000;},pause:()=>{state={...state,queue:{...state.queue,paused:true}};},editProfile:()=>{state={...state,profile:{...state.profile,tone:'正式'}};}};
}
test('computer reply uses local generation, enforces delay and saves reservation before transport',async()=>{
  const f=fixture(),d=await f.service.request(request);
  assert.equal(d.allowed,true);assert.equal(d.notBefore,11000);assert.equal(f.calls,1);
  const early=await f.service.check({...request,draft:d.text});assert.equal(early.allowed,false);assert.equal(f.persisted,false);
  f.advance();const check=await f.service.check({...request,draft:d.text});assert.equal(check.allowed,true);assert.equal(f.persisted,true);assert.equal(f.state.queue.inFlight.length,1);
  await f.service.finish({...request,draft:d.text,outcome:'unknown'});
  assert.equal(f.state.queue.paused,false);assert.equal(f.state.queue.takenOver.length,1);assert.equal(f.state.queue.drafts[0].status,'unknown');assert.equal(f.state.queue.answered.length,0);
  await assert.rejects(f.service.request({...request,snapshot:'another'}),/待核实/);
});
test('unapproved conversation, global pause, sensitive data or invented self-state never auto-send',async()=>{
  await assert.rejects(fixture().service.request({...request,rules:{...request.rules,whitelist:['other']}}),/未获/);
  const paused=fixture();paused.pause();await assert.rejects(paused.service.request(request),/暂停/);
  for(const text of ['请把验证码发给我','我最近有点忙']){
    const f=fixture(text),d=await f.service.request(request);assert.equal(d.allowed,false);assert.equal(f.persisted,false);
  }
});
test('draft edits, profile changes and replay refuse the native send reservation',async()=>{
  const f=fixture(),d=await f.service.request(request);f.advance();
  await assert.rejects(f.service.check({...request,draft:'edited'}),/改变/);
  const regenerated=await f.service.request(request);assert.equal(regenerated.text,d.text);assert.equal(f.calls,2);assert.equal(f.state.queue.messages.length,1);
  f.editProfile();await assert.rejects(f.service.check({...request,draft:d.text}),/改变/);
  assert.equal(f.persisted,false);
});
test('a reserved task canceled before calling native commit preserves no-send evidence',async()=>{
  const f=fixture(),d=await f.service.request(request);f.advance();await f.service.check({...request,draft:d.text});
  await f.service.finish({...request,draft:d.text,outcome:'not-attempted',reason:'owner canceled before commit'});
  assert.equal(f.state.queue.drafts[0].status,'cancelled');assert.equal(f.state.queue.inFlight.length,0);assert.equal(f.state.queue.answered.length,0);assert.equal(f.state.queue.paused,false);assert.equal(f.state.queue.takenOver.length,0);
});
