import fs from 'node:fs/promises';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {chromium} from '@playwright/test';
import {DesktopModelManager} from '../packages/runtime/desktop-models.mjs';
import * as tools from './prepare-model.mjs';
const manifest=await tools.readDesktopManifest(),cache=process.env.TC_MODEL_CACHE??'/workspace/.cache/models',directory=path.join(cache,'.validation-9b');
const manager=new DesktopModelManager({directory,manifest,tools,enginePath:'/workspace/.cache/engines/linux-x64-native/llama-server'});await manager.initialize();
const report:any={startedAt:new Date().toISOString(),platform:'Linux CPU with browser native bridge forwarding to actual llama.cpp, not Windows IPC',model:{id:manifest.id,sha256:manifest.sha256},contextSize:12800,publicSyntheticOnly:true,realSocialTransport:false,inferences:[],screens:[]};
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
  await manager.loadModel({contextSize:12800,id:manifest.id});
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)});
  const page=await browser.newPage();let saved:string|null=null;
  await page.exposeFunction('__localValidation',async(method:string,args:any)=>{
    if(method==='loadState')return {state:null};if(method==='saveState'){saved=args.state;return {saved:true};}
    if(method==='modelStatus')return manager.status();if(method==='loadModel')return manager.loadModel(args);if(method==='tokenize')return manager.tokenize(args);
    if(method==='infer'){const result=await manager.infer(args);report.inferences.push({prompt:args.prompt,result});return result;}
    throw new Error('Validation bridge method unsupported');
  });
  await page.addInitScript(()=>{(window as any).assistant=Object.fromEntries(['loadState','saveState','modelStatus','loadModel','tokenize','infer'].map(method=>[method,(args:any)=>(window as any).__localValidation(method,args)]));});
  await page.goto(process.env.TC_UI_BASE_URL??'http://127.0.0.1:5173');await page.locator('nav').getByRole('button',{name:'建议与演练',exact:true}).click();
  await page.getByLabel('选择训练集文件',{exact:true}).setInputFiles({name:'public-human-authored-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{role:'self',received:'谢谢提醒，辛苦啦',text:'谢啦，记得早点休息～',source:'human'},{role:'peer',text:'好呀，你具体想几点见？',source:'human'}]))});
  await page.getByLabel('我已核对每条角色，self 是我本人，peer 是对方',{exact:true}).check();
  await page.getByLabel('我确认这些记录来自人类真实表达且有权使用，本人记录不是 AI 生成',{exact:true}).check();
  await page.getByLabel('仅保存到当前账号、会话和联系人，不跨会话共享',{exact:true}).check();
  await page.getByRole('button',{name:'确认角色并导入检索材料',exact:true}).click();
  await page.getByLabel('如果收到这句话，如何回复',{exact:true}).fill('谢谢提醒，辛苦啦');await page.getByRole('button',{name:'生成建议回复',exact:true}).click();
  await page.getByTestId('advice-result').waitFor({timeout:180000});report.advice=await page.getByTestId('advice-result').innerText();
  await page.getByLabel('对方表达风格',{exact:true}).fill('直率友好，简短问句');await page.getByLabel('练习关系',{exact:true}).fill('朋友');await page.getByLabel('练习场景',{exact:true}).fill('商量吃饭时间，不代表真实安排');
  await page.getByLabel('你的下一句练习台词',{exact:true}).fill('我想先看看时间，你更想中午还是晚上？');await page.getByRole('button',{name:'让虚构对方回应',exact:true}).click();
  await page.getByTestId('roleplay-turn').nth(1).waitFor({timeout:180000});report.roleplay=await page.getByTestId('roleplay-turn').nth(1).innerText();
  await page.getByRole('button',{name:'获取演练反馈',exact:true}).click();await page.getByTestId('roleplay-feedback').waitFor({timeout:180000});report.feedback=await page.getByTestId('roleplay-feedback').innerText();
  const state=saved?JSON.parse(saved):undefined;report.imported={originalCount:state?.profile.originalPhrases?.filter((x:any)=>x.source==='imported-self').length,exampleCount:state?.profile.examples?.filter((x:any)=>x.origin==='self').length,peerRecordCount:Object.values(state?.advice??{}).flatMap((x:any)=>x.roleplayRecords??[]).length,generatedOutputsAutoLearned:false,queueDraftCount:state?.queue.drafts.length};
  report.completedAt=new Date().toISOString();
}catch(error){report.failure={message:(error as Error).message};process.exitCode=1;}
finally{await browser?.close();await manager.stop();await fs.writeFile('artifacts/validation/advice-training-local-linux.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({saved:true,failure:report.failure,inferences:report.inferences.length}));}
