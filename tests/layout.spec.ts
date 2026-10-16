import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
for(const [width,height] of [[1440,900],[1024,768],[960,640],[853,600],[390,844]]){
 test(`all navigation pages fit ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width,height});await page.goto('/');
  const nav=page.locator('nav');
  for(const name of ['消息中心','账号连接','本地模型','自定义 API','我的表达','建议与演练','联系人规则','平台模拟测试','桌面界面接入','待审核回复','运行与数据']){
   if(width<=800)await page.getByRole('button',{name:'打开菜单'}).click();
   await nav.getByRole('button',{name,exact:true}).click();
   await expect(page.locator('main')).toBeVisible();
   const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
   expect(size.scroll,`${name} overflow`).toBeLessThanOrEqual(size.viewport+1);
   if(name==='建议与演练'){
    const card=page.getByTestId('advice-consultation');
    const spacing=await card.evaluate(el=>({padding:parseFloat(getComputedStyle(el).paddingLeft),width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));
    expect(spacing.padding).toBeGreaterThanOrEqual(16);expect(spacing.scroll).toBeLessThanOrEqual(spacing.client+1);
    await mkdir('artifacts/validation',{recursive:true});await page.screenshot({path:`artifacts/validation/layout-advice-${width}.png`,fullPage:true});
   }
  }
 });
}
