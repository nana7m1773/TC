import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DesktopModelManager} from '../packages/runtime/desktop-models.mjs';
import * as tools from './prepare-model.mjs';
import {SimulationEngine,SIMULATION_PLATFORMS} from '../packages/simulation/src/index.ts';
import {createDefaultProfile,buildPrompt,trimContext,type Message} from '../packages/core/src/index.ts';
const cache=process.env.TC_MODEL_CACHE??'/workspace/.cache/models';
const reportPath=process.env.TC_VALIDATION_REPORT??'artifacts/validation/local-simulation-9b-linux.json';
const directory=path.join(cache,'.validation-9b');
const enginePath=process.env.TC_VALIDATION_ENGINE??'/workspace/.cache/engines/linux-x64-native/llama-server';
const manifest=await tools.readDesktopManifest();
const verified=await tools.verifyModel(path.join(cache,manifest.filename),manifest);
await fs.mkdir(directory,{recursive:true});await fs.mkdir('artifacts/validation',{recursive:true});
try{await fs.symlink(path.join(cache,manifest.filename),path.join(directory,manifest.filename));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
await fs.writeFile(path.join(directory,'models.json'),JSON.stringify([{...manifest,sourceVerified:true}]));
const manager=new DesktopModelManager({directory,enginePath,tools,manifest});await manager.initialize();
const report:Record<string,unknown>={startedAt:new Date().toISOString(),host:{platform:os.platform(),cpu:os.cpus()[0]?.model,logicalCpuQuota:os.availableParallelism(),totalMemoryBytes:os.totalmem()},model:verified,configuredContextSize:12800,transport:'simulation',generator:'real local 9B',windowsDeviceTested:false,androidDeviceTested:false,fixturesArePublicSynthetic:true,stages:[]};
const generations:Array<Record<string,unknown>>=[];
let peakRssKiB=0;
const monitor=setInterval(async()=>{if(manager.process?.pid)try{const status=await fs.readFile(`/proc/${manager.process.pid}/status`,'utf8');const rss=/VmRSS:\s+(\d+)/.exec(status);if(rss)peakRssKiB=Math.max(peakRssKiB,Number(rss[1]));}catch{}},250);
const save=()=>fs.writeFile(reportPath,JSON.stringify({...report,generations,peakRssKiB},null,2)+'\n');
try{
  const start=Date.now();await manager.loadModel({id:manifest.id,contextSize:12800});report.loadMs=Date.now()-start;report.actualStatus=manager.status();await save();console.log('9B loaded at ctx 12800.');
  const profile=createDefaultProfile();profile.tone='自然、简短，友善回应，不凭空承诺时间';profile.formality='朋友口语，陌生人礼貌';profile.paragraphing='一到两句';
  profile.originalPhrases=[{id:'public-original',text:'谢啦，我确认一下再回你～',source:'self',confirmed:true,shareable:true}];
  profile.examples=[{id:'public-example',received:'最近有空吗',reply:'谢谢想着我，我先看看安排，你想聊什么呀？',note:'公开合成的确认式学习示例；不是真实用户记录',confirmed:true,origin:'self',shareable:true}];
  const simulation=new SimulationEngine({generatorKind:'local',profile,now:Date.now(),random:()=>.5,generate:async request=>{
    const budget=await trimContext({profile:request.profile,memories:request.memories,messages:request.composition.messages,currentMessageIds:request.composition.messageIds,now:request.now,maxContextTokens:12800,outputReserve:96,countTokens:async prompt=>(await manager.tokenize({text:prompt})).count});
    const result=await manager.infer({prompt:budget.prompt,contextSize:12800,maxTokens:96,temperature:.2});
    generations.push({platform:request.platform,incoming:request.composition.messages.map(m=>m.text),tokenizerInputTokens:budget.inputTokens,inputMatchesTokenizer:budget.inputTokens===result.inputTokens,result});await save();console.log(JSON.stringify({platform:request.platform,completed:true,inputTokens:result.inputTokens,outputTokens:result.outputTokens}));return result.text;
  }});
  for(const p of SIMULATION_PLATFORMS){simulation.setRule(p.id,{enabled:true,autoAuthorized:true,replyTiming:{mode:'fixed',delayMs:5000},cooldownMs:30000});simulation.receive({platform:p.id,eventId:'same-id-five-scopes',text:p.sampleText});}
  report.simulationBefore=await simulation.run();report.simulationAfter=await simulation.advance(5000);report.realGenerationCompletedPlatforms=generations.length;report.simulatedAcceptedPlatforms=simulation.snapshot().sent.length;await save();
  const scope={accountId:'simulation:context-test',conversationId:'public'};
  const unit='公开合成的旧聊天：讨论天气、摄影展与午饭，未决定任何实际安排。\n';
  const promptFor=(repeat:number)=>buildPrompt(profile,[],[{id:'old',scope,role:'peer',text:unit.repeat(repeat),kind:'text',createdAt:1},{id:'current',scope,role:'peer',text:'这是公开合成的上下文测试，请只回复“已收到”。',kind:'text',createdAt:2}] as Message[]);
  let low=1,high=1500;while(low<high){const mid=Math.ceil((low+high)/2);const {count}=await manager.tokenize({text:promptFor(mid)});if(count+32<=12800)low=mid;else high=mid-1;}
  const fullPrompt=promptFor(low),measured=await manager.tokenize({text:fullPrompt});report.nearFullBudget={inputTokens:measured.count,outputReserve:32,total:measured.count+32,contextSize:12800};await save();console.log(JSON.stringify({stage:'near-full-start',inputTokens:measured.count,reserve:32,contextSize:12800}));
  const nearStart=Date.now();const result=await manager.infer({prompt:fullPrompt,contextSize:12800,maxTokens:32,temperature:0});report.nearFull={...result,wallTimeMs:Date.now()-nearStart,inputMatchesTokenizer:measured.count===result.inputTokens,exactExpectedReply:result.text==='已收到'};report.completedAt=new Date().toISOString();await save();console.log(JSON.stringify({stage:'near-full-complete',inputTokens:result.inputTokens,outputTokens:result.outputTokens,text:result.text}));
}catch(error){report.failure={code:(error as {code?:string}).code??'VALIDATION',message:(error as Error).message,cause:(error as {cause?:{code?:string}}).cause?.code};await save();process.exitCode=1;}finally{clearInterval(monitor);await manager.stop();}
