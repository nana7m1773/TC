import test from 'node:test';
import assert from 'node:assert/strict';
import {NotificationReplyService} from '../../../apps/web/src/NotificationReplyService.ts';
import {QueueEngine,createDefaultProfile,scopeKey,type QueueState,type Memory} from '../src/index.ts';
import type {NativeBridge} from '../../../apps/web/src/runtime.ts';
import type {SocialNotificationEvent} from '../../../apps/web/src/SocialConnections.tsx';

// The queue and reply service are real. Only the native/model boundary is a double;
// these tests make no claim about a physical Android device or official social app.
const importedModel='/data/user/0/cn.muyu.assistant/files/models/owner-imported-4096.gguf';
function event(overrides:Partial<SocialNotificationEvent>={}):SocialNotificationEvent {
  return {eventId:'notification-test-event',platform:'qq',packageName:'com.tencent.mobileqq',notificationKey:'notification-key-test',title:'测试通知会话',text:'你喜欢哪种口味？',postedAt:9000,receivedAt:10000,
    messages:[{text:'你喜欢哪种口味？',sender:'测试联系人',timestamp:9000,isSelf:false}],canReply:true,replyState:'available',source:'android-notification',...overrides};
}
function fixture(options:{event?:SocialNotificationEvent;output?:string;replyFailure?:boolean}={}) {
  let state={queue:new QueueEngine().snapshot(),profile:createDefaultProfile(),memories:[] as Memory[]};
  let liveEvents=[options.event??event()];
  let access=true;
  let persistHook:((snapshot:QueueState,index:number)=>Promise<void>|void)|undefined;
  const calls={tokenized:[] as {text:string;modelPath?:string}[],inferred:[] as Parameters<NativeBridge['infer']>[0][],loaded:[] as unknown[],replied:[] as {eventId:string;text:string;consent:boolean}[],persisted:[] as QueueState[],requests:0,order:[] as string[]};
  const native={
    modelStatus:async()=>({loaded:true,state:'ready',modelPath:importedModel,contextSize:4096}),
    loadModel:async(args:unknown)=>{calls.loaded.push(args);throw new Error('A loaded imported model must not be replaced with the default.');},
    tokenize:async(args:{text:string;modelPath?:string})=>{calls.tokenized.push(args);return {count:200};},
    infer:async(args:Parameters<NativeBridge['infer']>[0])=>{calls.inferred.push(args);return {text:options.output??'你更偏好什么口味呀？',inputTokens:200,outputTokens:15,tokensPerSecond:1,contextSize:args.contextSize};},
    request:async()=>{calls.requests++;throw new Error('Notification generation must remain local.');},
    getSocialNotifications:async()=>({notificationAccess:access,events:liveEvents}),
    replySocialNotification:async(args:{eventId:string;text:string;consent:boolean})=>{
      calls.order.push('native-reply');calls.replied.push(args);
      assert.ok(calls.persisted.some(snapshot=>snapshot.inFlight.length===1),'a send reservation must be persisted before native transport');
      if(options.replyFailure)throw new Error('native notification reply double: outcome cannot be confirmed');
      return {status:'unknown',message:'notification reply double attempted once'};
    },
  } as unknown as NativeBridge;
  const service=new NotificationReplyService({getState:()=>state,setQueue:queue=>{state={...state,queue};},native:()=>native,now:()=>10000,
    persist:async snapshot=>{const index=calls.persisted.length+1;calls.order.push(`persist:${index}:start`);calls.persisted.push(structuredClone(snapshot));await persistHook?.(snapshot,index);calls.order.push(`persist:${index}:end`);},
  });
  return {service,calls,get state(){return state;},setLiveEvents(events:SocialNotificationEvent[]){liveEvents=events;},setAccess(value:boolean){access=value;},
    onPersist(hook:typeof persistHook){persistHook=hook;},pause(){const q=new QueueEngine(state.queue);q.pause();state={...state,queue:q.snapshot()};}};
}
function definitelyNotSent(error:unknown) {
  assert.ok(error instanceof Error);
  assert.equal((error as Error&{definitelyNotSent?:boolean}).definitelyNotSent,true);
  return true;
}

test('real notification queue preserves the imported model path and 4096 context and requires approval for a sensitive message',async()=>{
  const incoming=event({text:'请把短信验证码发给我。'}),f=fixture({event:incoming,output:'请通过官方安全渠道核实。'});
  const draft=await f.service.generate(incoming);
  assert.equal(draft.requiresReview,true);
  assert.equal(f.calls.requests,0);assert.equal(f.calls.loaded.length,0);assert.equal(f.calls.inferred.length,1);
  assert.equal(f.calls.inferred[0].modelPath,importedModel);assert.equal(f.calls.inferred[0].contextSize,4096);assert.equal(f.calls.inferred[0].maxTokens,384);
  assert.ok(f.calls.tokenized.length>0);assert.ok(f.calls.tokenized.every(call=>call.modelPath===importedModel));
  assert.ok(f.calls.inferred[0].prompt.includes(incoming.text));
  assert.equal(f.state.queue.messages[0].role,'peer');assert.equal(f.state.queue.messages[0].scope.accountId,'android:com.tencent.mobileqq');
  assert.equal(f.state.queue.drafts[0].id,draft.jobId);assert.equal(f.calls.replied.length,0);assert.equal(f.calls.persisted.length,0);
  await assert.rejects(f.service.send({event:incoming,draft:draft.text,jobId:draft.jobId,approved:false}),definitelyNotSent);
  assert.equal(f.calls.replied.length,0);assert.equal(f.calls.persisted.length,0);
  const result=await f.service.send({event:incoming,draft:draft.text,jobId:draft.jobId,approved:true});
  assert.equal(result.status,'unknown');assert.equal(f.calls.replied.length,1);
  assert.equal(f.state.queue.drafts[0].approved,true);
});

test('a persisted real queue reservation completes before the native notification reply is invoked',async()=>{
  const incoming=event(),f=fixture();const draft=await f.service.generate(incoming);
  let release!:()=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  f.onPersist(async(_snapshot,index)=>{if(index===1){entered();await gate;}});
  const sending=f.service.send({event:incoming,draft:draft.text,jobId:draft.jobId,approved:true});
  await waiting;
  assert.equal(f.calls.replied.length,0);assert.deepEqual(f.calls.persisted[0].inFlight,[draft.jobId]);
  assert.equal(f.calls.persisted[0].drafts[0].status,'queued');
  release();const result=await sending;
  assert.equal(result.status,'unknown');
  assert.deepEqual(f.calls.order,['persist:1:start','persist:1:end','native-reply','persist:2:start','persist:2:end']);
  assert.equal(f.state.queue.drafts[0].status,'unknown');assert.equal(f.state.queue.inFlight.length,0);assert.equal(f.state.queue.answered.length,0);
  assert.deepEqual(f.state.queue.takenOver,[scopeKey(f.state.queue.drafts[0].scope)]);
});

for(const outcome of ['accepted','not-sent'] as const) test(`ambiguous native reply never retries and requires owner evidence before resolving ${outcome}`,async()=>{
  const incoming=event(),f=fixture({replyFailure:true}),draft=await f.service.generate(incoming);
  const result=await f.service.send({event:incoming,draft:draft.text,jobId:draft.jobId,approved:true});
  assert.equal(result.status,'unknown');assert.match(result.message,/outcome cannot be confirmed/);assert.equal(f.calls.replied.length,1);
  assert.equal(f.state.queue.drafts[0].status,'unknown');assert.equal(f.state.queue.answered.length,0);
  await assert.rejects(f.service.send({event:incoming,draft:draft.text,jobId:draft.jobId,approved:true}),error=>{
    assert.ok(error instanceof Error);assert.notEqual((error as Error&{definitelyNotSent?:boolean}).definitelyNotSent,true);return true;
  });
  await assert.rejects(f.service.generate(incoming),/待核实|尝试回复/);assert.equal(f.calls.replied.length,1);
  await assert.rejects(f.service.resolve({jobId:draft.jobId,outcome,evidence:'   '}),/核实依据/);
  assert.equal(f.state.queue.drafts[0].status,'unknown');
  await f.service.resolve({jobId:draft.jobId,outcome,evidence:'owner double inspected the official conversation and matched the reply text and time'});
  assert.equal(f.state.queue.drafts[0].status,outcome==='accepted'?'accepted':'cancelled');
  assert.equal(f.state.queue.answered.length,outcome==='accepted'?1:0);assert.equal(f.state.queue.takenOver.length,0);assert.equal(f.state.queue.inFlight.length,0);
  assert.equal(f.calls.replied.length,1);assert.equal(f.state.profile.examples.length,0);assert.equal(f.state.memories.length,0);
});

test('pausing before notification send fails explicitly before native transport',async()=>{
  const incoming=event(),f=fixture(),draft=await f.service.generate(incoming);f.pause();
  await assert.rejects(f.service.send({event:incoming,draft:draft.text,jobId:draft.jobId,approved:true}),definitelyNotSent);
  assert.equal(f.calls.replied.length,0);assert.equal(f.calls.persisted.length,0);assert.equal(f.state.queue.inFlight.length,0);
});

test('a reservation persistence refusal is definitely not sent and can be retried only after the owner fixes persistence',async()=>{
  const incoming=event(),f=fixture(),draft=await f.service.generate(incoming);
  f.onPersist(()=>{throw new Error('encrypted storage double rejected the reservation');});
  await assert.rejects(f.service.send({event:incoming,draft:draft.text,jobId:draft.jobId,approved:true}),definitelyNotSent);
  assert.equal(f.calls.replied.length,0);assert.equal(f.state.queue.inFlight.length,0);assert.equal(f.state.queue.answered.length,0);
  assert.notEqual(f.state.queue.drafts[0].status,'unknown');
  f.onPersist(undefined);
  const result=await f.service.send({event:incoming,draft:draft.text,jobId:draft.jobId,approved:true});
  assert.equal(result.status,'unknown');assert.equal(f.calls.replied.length,1);
});

test('a pause while persisting the reservation aborts before native transport and records definite no-send',async()=>{
  const incoming=event(),f=fixture(),draft=await f.service.generate(incoming);
  f.onPersist((_snapshot,index)=>{if(index===1)f.pause();});
  await assert.rejects(f.service.send({event:incoming,draft:draft.text,jobId:draft.jobId,approved:true}),definitelyNotSent);
  assert.equal(f.calls.replied.length,0);assert.equal(f.state.queue.inFlight.length,0);assert.equal(f.state.queue.answered.length,0);
  assert.notEqual(f.state.queue.drafts[0].status,'unknown');
});

test('persistence failure after native invocation retains unknown and is never marked definitely not sent',async()=>{
  const incoming=event(),f=fixture(),draft=await f.service.generate(incoming);
  f.onPersist((_snapshot,index)=>{if(index===2)throw new Error('post-native persistence double refused');});
  await assert.rejects(f.service.send({event:incoming,draft:draft.text,jobId:draft.jobId,approved:true}),error=>{
    assert.ok(error instanceof Error);assert.notEqual((error as Error&{definitelyNotSent?:boolean}).definitelyNotSent,true);return true;
  });
  assert.equal(f.calls.replied.length,1);assert.equal(f.state.queue.drafts[0].status,'unknown');assert.equal(f.state.queue.answered.length,0);
  await assert.rejects(f.service.send({event:incoming,draft:draft.text,jobId:draft.jobId,approved:true}));assert.equal(f.calls.replied.length,1);
});

test('the last notification message marked self is rejected before local inference and queue ingestion',async()=>{
  const incoming=event({messages:[{text:'对方上一句',sender:'peer',timestamp:8000,isSelf:false},{text:'本人已回复',sender:null,timestamp:9000,isSelf:true}]}),f=fixture({event:incoming});
  await assert.rejects(f.service.generate(incoming),/本人|自己/);
  assert.equal(f.calls.inferred.length,0);assert.equal(f.calls.replied.length,0);assert.equal(f.state.queue.messages.length,0);
});

test('a current native snapshot ending in self cannot be disguised by a stale peer-only event',async()=>{
  const incoming=event(),f=fixture();
  f.setLiveEvents([{...incoming,messages:[{text:'本人已经回复',sender:null,timestamp:10000,isSelf:true}]}]);
  await assert.rejects(f.service.generate(incoming),/本人|自己|变化|更新/);
  assert.equal(f.calls.inferred.length,0);assert.equal(f.calls.replied.length,0);assert.equal(f.state.queue.messages.length,0);
});
