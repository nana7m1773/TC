import {test,expect,type Page} from '@playwright/test';
const baseUrl=process.env.TC_UI_BASE_URL??'http://127.0.0.1:5173';
const nav=(page:Page,label:string)=>page.locator('nav').getByRole('button',{name:new RegExp(`^${label}`)}).click();
async function open(page:Page){await page.goto(baseUrl);await nav(page,'平台模拟测试');await expect(page.getByRole('heading',{name:'五平台收信与自动回复模拟'})).toBeVisible();}
async function enable(page:Page){await page.getByRole('button',{name:'启用模拟自动回复',exact:true}).click();}
const sent=(page:Page)=>page.getByLabel('模拟回复记录',{exact:true}).locator('article');

test('five simulated platforms automatically reply only after the configured virtual-clock deadline',async({page})=>{
  await open(page);await page.getByRole('button',{name:'五平台同时收信',exact:true}).click();await expect(sent(page)).toHaveCount(0);
  await enable(page);await page.getByRole('button',{name:'五平台同时收信',exact:true}).click();await expect(sent(page)).toHaveCount(0);
  await page.getByLabel('推进模拟时间（秒）',{exact:true}).fill('4');await page.getByRole('button',{name:'推进时钟并处理',exact:true}).click();await expect(sent(page)).toHaveCount(0);
  await page.getByLabel('推进模拟时间（秒）',{exact:true}).fill('1');await page.getByRole('button',{name:'推进时钟并处理',exact:true}).click();await expect(sent(page)).toHaveCount(5);
  for(const name of ['QQ','微信','哔哩哔哩私信','微博私信','WhatsApp']) await expect(page.getByLabel('模拟回复记录',{exact:true})).toContainText(`${name} · 模拟已回复`);
  await expect(page.getByLabel('模拟回复记录',{exact:true})).toContainText('固定测试文本');expect(await page.evaluate(()=>localStorage.length)).toBe(0);
});
test('duplicate simulated QQ events cannot create a second automatic reply',async({page})=>{
  await open(page);await enable(page);await page.getByLabel('模拟场景',{exact:true}).selectOption('duplicate');
  await page.getByRole('button',{name:'模拟收信并处理',exact:true}).click();await page.getByRole('button',{name:'推进时钟并处理',exact:true}).click();await expect(sent(page)).toHaveCount(1);
  await page.getByRole('button',{name:'模拟收信并处理',exact:true}).click();await page.getByRole('button',{name:'推进时钟并处理',exact:true}).click();await expect(sent(page)).toHaveCount(1);
  await expect(page.getByLabel('模拟流程事件',{exact:true})).toContainText('重复已忽略');
});
test('pause and user takeover each prevent the pending simulated automatic reply',async({page})=>{
  await open(page);await enable(page);await page.getByRole('button',{name:'模拟收信并处理',exact:true}).click();
  await page.getByRole('button',{name:'暂停模拟',exact:true}).click();await page.getByRole('button',{name:'推进时钟并处理',exact:true}).click();await expect(sent(page)).toHaveCount(0);
  await page.getByRole('button',{name:'本人接管此模拟会话',exact:true}).click();await page.getByRole('button',{name:'恢复模拟',exact:true}).click();await page.getByRole('button',{name:'推进时钟并处理',exact:true}).click();await expect(sent(page)).toHaveCount(0);
  await expect(page.getByLabel('模拟流程事件',{exact:true})).toContainText('本人接管');
});
test('resetting the simulation cannot bypass the app-wide pause',async({page})=>{
  await open(page);await page.getByRole('button',{name:'一键暂停',exact:true}).click();await page.getByRole('button',{name:'重置模拟会话',exact:true}).click();await enable(page);await page.getByRole('button',{name:'模拟收信并处理',exact:true}).click();await page.getByRole('button',{name:'推进时钟并处理',exact:true}).click();await expect(sent(page)).toHaveCount(0);await expect(page.getByLabel('模拟流程事件',{exact:true})).toContainText('已一键暂停');
});
test('unknown simulated outcome never blindly retries after time advances or a new incoming message',async({page})=>{
  await open(page);await enable(page);await page.getByLabel('模拟场景',{exact:true}).selectOption('unknown');await page.getByRole('button',{name:'模拟收信并处理',exact:true}).click();await page.getByRole('button',{name:'推进时钟并处理',exact:true}).click();
  await expect(page.locator('.simulation-draft')).toContainText('结果待核实');await expect(sent(page)).toHaveCount(0);
  await page.getByLabel('模拟事件 ID',{exact:true}).fill('later-event');await page.getByLabel('模拟场景',{exact:true}).selectOption('normal');await page.getByRole('button',{name:'模拟收信并处理',exact:true}).click();await page.getByLabel('推进模拟时间（秒）',{exact:true}).fill('60');await page.getByRole('button',{name:'推进时钟并处理',exact:true}).click();await expect(sent(page)).toHaveCount(0);
  await expect(page.getByLabel('模拟流程事件',{exact:true})).toContainText('不自动重试');
});
test('real-generation UI calls a clearly identified native test double at context 12800 while transport remains simulated',async({page})=>{
  await page.addInitScript(()=>{
    const target=window as unknown as {assistant:unknown;__simulationContexts:number[]};target.__simulationContexts=[];
    target.assistant={loadState:async()=>({state:null}),saveState:async()=>({saved:true}),modelStatus:async()=>({loaded:true,contextSize:12800}),tokenize:async()=>({count:500}),infer:async({contextSize}:{contextSize:number})=>{target.__simulationContexts.push(contextSize);return {text:'明确的原生桥测试替身回复',inputTokens:500,outputTokens:20,contextSize,tokensPerSecond:1};}};
  });
  await open(page);await page.getByRole('combobox',{name:/^模拟回复生成器/}).selectOption('local');await enable(page);await page.getByRole('button',{name:'五平台同时收信',exact:true}).click();await page.getByRole('button',{name:'推进时钟并处理',exact:true}).click();await expect(sent(page)).toHaveCount(5);
  expect(await page.evaluate(()=>(window as unknown as {__simulationContexts:number[]}).__simulationContexts)).toEqual([12800,12800,12800,12800,12800]);await expect(page.getByLabel('模拟回复记录',{exact:true})).toContainText('测试替身回复');
});
