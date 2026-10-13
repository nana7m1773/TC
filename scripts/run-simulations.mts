import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {SimulationEngine,SIMULATION_PLATFORMS,fixtureReply} from '../packages/simulation/src/index.ts';
const now=1_000_000;
const engine=new SimulationEngine({generate:fixtureReply,generatorKind:'fixture',now,random:()=>0.5});
for(const p of SIMULATION_PLATFORMS){
  engine.setRule(p.id,{enabled:true,autoAuthorized:true,replyTiming:{mode:'fixed',delayMs:5000},cooldownMs:30000});
  assert.equal(engine.receive({platform:p.id,eventId:'same-platform-scoped-id',text:p.sampleText}).accepted,true);
  assert.equal(engine.receive({platform:p.id,eventId:'same-platform-scoped-id',text:p.sampleText}).accepted,false);
}
const before=await engine.run();assert.equal(before.sent.length,0);
const early=await engine.advance(4999);assert.equal(early.sent.length,0);
const result=await engine.advance(1);assert.equal(result.sent.length,5);
assert.equal((await engine.advance(60000)).sent.length,5);
const report={date:new Date().toISOString(),transport:'simulation',generator:'fixture (fixed test replies; no AI inference)',realPlatformConnection:false,
  virtualClock:true,contextModelCalled:false,checks:{fivePlatformsReplied:true,duplicateEventReplies:0,sentBeforeDeadline:0,lateReprocessingDuplicates:0},
  platforms:SIMULATION_PLATFORMS.map(p=>({platform:p.label,receivedMessage:p.sampleText,reply:result.sent.find(s=>s.platform===p.id)!.text,delayMs:5000,receipt:result.sent.find(s=>s.platform===p.id)!.receiptId})),
  events:result.events,automaticLearning:false};
await mkdir('artifacts/validation',{recursive:true});
await writeFile('artifacts/validation/simulation-fixtures.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,platforms:5,transport:'simulation',generatorKind:'fixture',report:'artifacts/validation/simulation-fixtures.json'}));
