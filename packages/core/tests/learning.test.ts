import test from 'node:test';
import assert from 'node:assert/strict';
import { addOriginalPhrases,deleteOriginalPhrase,analyzeLearning,applyLearningSuggestions,buildPrompt,computeReplyDelay,createDefaultProfile,createDefaultRule,QueueEngine,retrieveExamples,retrieveOriginalPhrases,rollbackProfile,trimContext,validateProfileEnhancements,validateReplyTiming,type Scope,type StyleProfile,type PersonalOriginal } from '../src/index.ts';
const a:Scope={accountId:'qq',conversationId:'a',contactId:'a'}, b:Scope={accountId:'qq',conversationId:'b',contactId:'b'};
const original=(id:string,text:string,scope:Scope=a):PersonalOriginal=>({id,text,scope,confirmed:true,shareable:false,source:'self'});
const message={id:'incoming',scope:a,role:'peer' as const,text:'摄影展几点开始？',kind:'text' as const,createdAt:100000};
const timedProfile=():StyleProfile=>({...createDefaultProfile(),examples:[1000,3000,7000].map((duration,i)=>({id:String(i),received:'你好',reply:'收到啦',note:'实际本人记录',confirmed:true,origin:'self' as const,scope:a,receivedAt:1000+i*10000,repliedAt:1000+i*10000+duration}))});
const auto=()=>({...createDefaultRule(a.accountId),mode:'auto' as const,autoAuthorized:true,cooldownMs:0});
const sendContext={now:100000,canSend:true,currentDeviceId:'test',responsibleDeviceId:'test'};

test('personal originals require explicit self confirmation and a private scope or explicit sharing',()=>{
  const p=createDefaultProfile();
  assert.throws(()=>addOriginalPhrases(p,[{...original('x','收到'),confirmed:false}]));
  assert.throws(()=>addOriginalPhrases(p,[{...original('x','收到'),source:'generated'}]));
  assert.throws(()=>addOriginalPhrases(p,[{...original('x','收到'),scope:undefined}]));
  assert.equal(p.originalPhrases,undefined);
});
test('batch edits, deletion and rollback retain the prior actual original wording',()=>{
  const first=addOriginalPhrases(createDefaultProfile(),[original('x','好呀'),original('y','谢谢提醒')],1);
  const edited=addOriginalPhrases(first,[original('x','好呀，我确认后回你')],2);
  assert.equal(edited.originalPhrases?.length,2);assert.equal(first.originalPhrases?.[0]?.text,'好呀');
  const deleted=deleteOriginalPhrase(edited,'y',3);assert.equal(deleted.originalPhrases?.length,1);
  const restored=rollbackProfile(deleted,deleted.versions.at(-1)!.id,4);assert.equal(restored.originalPhrases?.length,2);
});
test('prompt and retrieval exclude private other-contact and unconfirmed/generated originals including their versions',()=>{
  const p={...createDefaultProfile(),originalPhrases:[original('a','摄影展我确认时间后回你'),original('b','OTHER_PRIVATE_SECRET',b),{...original('c','UNCONFIRMED'),confirmed:false},{...original('d','GENERATED'),source:'generated' as const}]};
  const prompt=buildPrompt(p,[],[message]);assert.match(prompt,/我确认时间/);assert.doesNotMatch(prompt,/OTHER_PRIVATE_SECRET|UNCONFIRMED|GENERATED|"originalLimit"/);
  assert.equal(retrieveOriginalPhrases(p,[{...message,scope:b}]).length,1);assert.equal(retrieveOriginalPhrases(p,'摄影展').length,0);
});
test('normalized Chinese BM25 retrieval deduplicates examples and respects opt-out and configurable counts',()=>{
  const p=createDefaultProfile();p.examples=[{id:'irrelevant',received:'工作进展如何',reply:'正在处理',note:'工作',confirmed:true},{id:'relevant',received:'摄影展几点开始',reply:'我确认时间后回你',note:'摄影',confirmed:true},{id:'duplicate',received:'摄影展几点开始？',reply:'我确认时间后回你。',note:'摄影',confirmed:true}];
  assert.equal(retrieveExamples(p,[message],12)[0]?.id,'relevant');assert.equal(retrieveExamples(p,[message],12).length,2);
  p.learning={examplesEnabled:false};assert.equal(retrieveExamples(p,[message]).length,0);
});
test('large originals are trimmed by the active tokenizer without truncating the current incoming message',async()=>{
  const p=addOriginalPhrases(createDefaultProfile(),[original('large','摄影展'.repeat(1200))]);
  const result=await trimContext({profile:p,memories:[],messages:[message],countTokens:s=>s.length,maxContextTokens:1500,outputReserve:100});
  assert.equal(result.keptOriginalIds.length,0);assert.equal(result.trimmed,true);assert.match(result.prompt,/摄影展几点开始/);assert.ok(result.inputTokens+result.outputReserve<=1500);
});
test('learning analysis describes only accessible confirmed self samples and does not mutate style',()=>{
  const p=timedProfile();p.examples.push({id:'generated',received:'hi',reply:'secret',note:'',confirmed:true,origin:'generated',scope:a});p.originalPhrases=[original('private','private-secret',b)];
  const before=JSON.stringify(p),analysis=analyzeLearning(p,a,100000);
  assert.equal(analysis.sampleCount,3);assert.equal(analysis.ignoredCount,2);assert.equal(analysis.metrics.replyTiming?.medianMs,3000);
  assert.doesNotMatch(JSON.stringify(analysis.evidence),/private-secret|secret/);assert.equal(JSON.stringify(p),before);
});
test('style suggestions require explicit application and stale previews cannot overwrite newer preferences',()=>{
  const p=timedProfile(),analysis=analyzeLearning(p,a,100000);
  const applied=applyLearningSuggestions(p,analysis,['sentence-length'],100001);assert.notEqual(applied.sentenceLength,p.sentenceLength);assert.equal(applied.tone,p.tone);
  const restored=rollbackProfile(applied,applied.versions.at(-1)!.id,100002);assert.equal(restored.sentenceLength,p.sentenceLength);
  assert.throws(()=>applyLearningSuggestions({...p,tone:'最新偏好'},analysis),/重新分析/);
});
test('forged preview values cannot inject a different style than the freshly recomputed approved suggestion',()=>{
  const p=timedProfile(),analysis=analyzeLearning(p,a,100000);analysis.suggestions[0]!.value='FORGED';
  assert.notEqual(applyLearningSuggestions(p,analysis,[analysis.suggestions[0]!.id]).sentenceLength,'FORGED');
});
test('future, reversed and generated timing data cannot become a learned interval',()=>{
  const p=timedProfile();p.examples[0]!.repliedAt=200000;p.examples[1]!.origin='generated';
  const result=computeReplyDelay({...auto(),replyTiming:{mode:'learned',strategy:'median'}},p,a,100000);
  assert.equal(result.sampleCount,1);assert.equal(result.fallback,true);
});
test('learned timing uses accessible actual sample median and cannot use other-contact private samples',()=>{
  const p=timedProfile(),rule={...auto(),replyTiming:{mode:'learned' as const,strategy:'median' as const}};
  assert.equal(computeReplyDelay(rule,p,a,100000).delayMs,3000);assert.equal(computeReplyDelay(rule,p,b,100000).fallback,true);
  p.examples=p.examples.map(e=>({...e,shareable:true}));assert.equal(computeReplyDelay(rule,p,b,100000).sampleCount,3);
});
test('fixed wait is enforced by actual permitSend even when the caller never scheduled the draft',()=>{
  const q=new QueueEngine();q.ingest(message);const d=q.enqueue(q.compose(a,100000,Infinity),'收到',100000),rule={...auto(),replyTiming:{mode:'fixed' as const,delayMs:5000}};
  assert.equal(q.permitSend(d.id,rule,sendContext).allowed,false);assert.ok(q.snapshot().drafts[0]!.riskReasons.includes('reply_delay'));
  assert.equal(q.permitSend(d.id,rule,{...sendContext,now:105000}).allowed,true);
});
test('actual generation time counts toward receive-to-reply delay instead of adding the learned wait twice',()=>{
  const q=new QueueEngine();q.ingest(message);const d=q.enqueue(q.compose(a,105000,Infinity),'收到',105000),rule={...auto(),replyTiming:{mode:'fixed' as const,delayMs:5000}};
  const scheduled=q.scheduleDraft(d.id,rule,createDefaultProfile(),105000);assert.equal(scheduled.notBefore,105000);assert.equal(q.permitSend(d.id,rule,{...sendContext,now:105000}).allowed,true);
});
test('range wait is sampled once and persists unchanged through queue restoration',()=>{
  const q=new QueueEngine();q.ingest(message);const d=q.enqueue(q.compose(a,100000,Infinity),'收到',100000),rule={...auto(),replyTiming:{mode:'range' as const,minMs:1000,maxMs:5000}};let calls=0;
  q.scheduleDraft(d.id,rule,createDefaultProfile(),100000,()=>{calls++;return .5;});const restored=new QueueEngine(q.snapshot());
  assert.equal(restored.permitSend(d.id,rule,{...sendContext,now:102999,random:()=>{calls++;return .9;}}).allowed,false);assert.equal(calls,1);
  assert.equal(restored.permitSend(d.id,rule,{...sendContext,now:103000}).allowed,true);
});
test('insufficient learned samples remain blocked after explicit approval and after a long wait',()=>{
  const q=new QueueEngine();q.ingest(message);const d=q.enqueue(q.compose(a,100000,Infinity),'收到',100000);q.approve(d.id);
  const decision=q.permitSend(d.id,{...auto(),replyTiming:{mode:'learned',strategy:'median'}},{...sendContext,now:900000,profile:createDefaultProfile()});
  assert.equal(decision.allowed,false);assert.ok(decision.reasons.includes('timing_unavailable'));
});
test('invalid counts, nonfinite intervals, reversed ranges and malformed historical metadata fail closed',()=>{
  for(const timing of [{mode:'fixed',delayMs:NaN},{mode:'range',minMs:5,maxMs:2},{mode:'fixed',delayMs:604800001}]) assert.throws(()=>validateReplyTiming(timing));
  assert.throws(()=>validateProfileEnhancements({...createDefaultProfile(),learning:{exampleLimit:13}}));
  assert.throws(()=>validateProfileEnhancements({...createDefaultProfile(),examples:[{...timedProfile().examples[0],receivedAt:20,repliedAt:10}]}));
});
