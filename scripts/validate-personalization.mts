import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import {buildPrompt,createDefaultProfile} from '../packages/core/src/index.ts';
import {DesktopModelManager} from '../packages/runtime/desktop-models.mjs';
import * as tools from './prepare-model.mjs';
const manager=new DesktopModelManager({directory:'/workspace/.cache/models/.validation-runtime',enginePath:'/workspace/.cache/engines/linux-x64-native/llama-server',tools});
const scope={accountId:'manual-validation',conversationId:'public-synthetic',contactId:'synthetic-friend'};
const messages=[{id:'one',scope,role:'peer' as const,text:'谢谢你提醒我，今天辛苦了。',kind:'text' as const,createdAt:Date.now()}];
const base=createDefaultProfile();
const profiles=[{id:'formal',profile:{...base,tone:'礼貌、正式、完整句子，不使用表情或波浪号。',commonPhrases:['感谢你的提醒'],
  examples:[{id:'formal-example',received:messages[0].text,reply:'感谢你的提醒，也谢谢你的关心。',note:'正式、简洁地表达感谢，不作承诺。',confirmed:true}]}},
  {id:'casual',profile:{...base,tone:'朋友之间的随意口语，短句，可以使用波浪号。',commonPhrases:['谢啦'],
  examples:[{id:'casual-example',received:messages[0].text,reply:'谢啦，你也辛苦啦～',note:'朋友间轻松表达，不编造经历或安排。',confirmed:true}]}}];
const report:any={verifiedAt:new Date().toISOString(),host:{platform:os.platform(),cpu:os.cpus()[0].model,totalMemoryBytes:os.totalmem()},model:{id:tools.defaultModel.id,sha256:tools.defaultModel.sha256},method:'Exact production buildPrompt, confirmed examples and identical public synthetic peer message. Local CPU, no external model API.',cases:[]};
try {
  await manager.loadModel({contextSize:12800});
  for(const item of profiles) {
    const prompt=buildPrompt(item.profile,[],messages);const count=await manager.tokenize({text:prompt});
    const result=await manager.infer({prompt,contextSize:12800,maxTokens:128,temperature:0});
    report.cases.push({id:item.id,profile:item.profile,tokenizerCount:count.count,result});console.log('真实个人表达验证',JSON.stringify(report.cases.at(-1)));
  }
  await fs.writeFile('artifacts/validation/local-personalization-linux.json',JSON.stringify(report,null,2));
  const imagePath='/tmp/tc-vision-fixture.png';const bytes=await fs.readFile(imagePath);const start=Date.now();
  const result=await manager.analyzeImage({image:{data:'data:image/png;base64,'+bytes.toString('base64')},prompt:'这是一张软件界面截图。请根据图片说明软件名称、界面用途以及左侧有哪些功能。看不清的字请明确说明不确定。',contextSize:12800,maxTokens:192,temperature:0.2});
  await fs.writeFile('artifacts/validation/local-ui-vision-linux.json',JSON.stringify({verifiedAt:new Date().toISOString(),host:report.host,model:report.model,
    input:{path:imagePath,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),groundTruth:'知己，私人AI社交助理，消息中心；示例好友与群聊，左栏模型/API/风格/联系人/待审核/运行记录。'},
    elapsedMs:Date.now()-start,result,limitations:['Linux CPU 云机验证，非 Windows 或 8 GB Android 实机。','这张截图含明确标识的模拟会话，没有真实平台登录或私聊联调。']},null,2));
  console.log('真实中文界面理解',JSON.stringify(result));
}finally {await manager.stop();}
