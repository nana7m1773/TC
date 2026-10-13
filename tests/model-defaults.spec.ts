import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const baseUrl=process.env.TC_UI_BASE_URL??'http://127.0.0.1:5173';
for(const [target,file,size,title] of [['Windows','default-model.windows.json','5.63 GB','Qwen3.5 · 9B HauhauCS'],['Android manifest metadata','default-model.json','1.27 GB','Qwen3.5 · 2B HauhauCS']] as const){
  test(`${target} metadata renders the correct model and unchanged 12800 context (native UI bridge fixture)`,async({page})=>{
    const model=JSON.parse(await readFile(new URL(`../resources/${file}`,import.meta.url),'utf8'));
    await page.addInitScript(defaultModel=>{(window as unknown as {assistant:unknown}).assistant={loadState:async()=>({state:null}),saveState:async()=>({saved:true}),modelStatus:async()=>({defaultModel,loaded:false,contextSize:12800})};},model);
    await page.goto(baseUrl);await page.locator('nav').getByRole('button',{name:'本地模型',exact:true}).click();await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(page.locator('.model-card')).toContainText(size);await expect(page.locator('.model-card')).toContainText('12,800 tokens');
  });
}
