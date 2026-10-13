import test from 'node:test';
import assert from 'node:assert/strict';
import {QueueEngine,createDefaultRule,createDefaultProfile,evaluateSafety,trimContext} from '../src/index.ts';
const scope={accountId:'qq:test',conversationId:'friend'};
const rule={...createDefaultRule(scope.accountId),enabled:true,mode:'auto' as const,autoAuthorized:true,cooldownMs:0};
test('unverified personal state in Chinese or English requires human review, not model confidence',()=>{
  for(const text of ['最近还好，就是有点忙','我现在在家','这周末我暂时还没安排','I am busy today','I’m free now','I have no plans']){
    const q=new QueueEngine();q.ingest({id:'incoming',scope,role:'peer',text:'最近好吗？',kind:'text',createdAt:1});
    const draft=q.enqueue(q.compose(scope,2),text,2);
    const context={now:2,currentContextVersion:q.contextVersion(scope),canSend:true,currentDeviceId:'windows',responsibleDeviceId:'windows'};
    const decision=evaluateSafety(draft,q.snapshot().messages,rule,context);
    assert.equal(decision.allowed,false);assert.equal(decision.requiresReview,true);assert.ok(decision.reasons.includes('unverified_self_state'));
    assert.equal(evaluateSafety({...draft,approved:true},q.snapshot().messages,rule,context).allowed,true);
    assert.equal(evaluateSafety({...draft,approved:true},q.snapshot().messages,rule,{...context,paused:true}).allowed,false);
  }
});
test('expired same-scope pinned fact stops generation; a private other-scope pin does not block',async()=>{
  const messages=[{id:'incoming',scope,role:'peer' as const,text:'最近好吗？',kind:'text' as const,createdAt:1}];
  const input={profile:createDefaultProfile(),messages,now:3,countTokens:()=>100};
  const expired={id:'expired',scope,text:'旧日期',confirmed:true,required:true,shareable:false,source:'owner',updatedAt:1,expiresAt:2};
  await assert.rejects(trimContext({...input,memories:[expired]}),/必要记忆/);
  const result=await trimContext({...input,memories:[{...expired,scope:{...scope,conversationId:'other'}}]});
  assert.equal(result.keptMemoryIds.length,0);
});
