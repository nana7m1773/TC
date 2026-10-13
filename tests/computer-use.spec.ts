import {test,expect,type Page} from '@playwright/test';

const baseUrl=process.env.TC_UI_BASE_URL??'http://127.0.0.1:5173';
const received='周末下午有空吗？';
const fullWindow='导航区域 WHOLE_WINDOW_ONLY\n张三\n我：我之前说过下周再聊。\n对方：周末下午有空吗？';
/** Native/model test doubles verify the web contract. These tests do not run Windows, PowerShell, UIA or a real model. */
async function installComputerDouble(page:Page,options:{canSend?:boolean;deferInference?:boolean;prepareFailure?:boolean;commitFailure?:boolean;deferReservation?:boolean}={}){
  await page.addInitScript(options=>{
    const target=window as unknown as {
      assistant:Record<string,unknown>;
      __computer:{calls:{reads:unknown[];prepares:unknown[];commits:unknown[];prompts:string[];saves:string[];requests:number;media:string[]};snapshot:string;inputFingerprint:string;canSend:boolean;releaseInference?:()=>void;releaseReservation?:()=>void;reservationWaiting:boolean};
    };
    const state=target.__computer={calls:{reads:[],prepares:[],commits:[],prompts:[],saves:[],requests:0,media:[]},snapshot:'a'.repeat(64),inputFingerprint:'empty-input-fingerprint',canSend:options.canSend!==false,reservationWaiting:false} as typeof target.__computer;
    const windows=[{selection:'test-selected-wechat',title:'微信 · 工作讨论',process:'wechat',handle:'201',kind:'client'},{selection:'test-selected-qq',title:'QQ · 工作讨论',process:'qq',handle:'202',kind:'client'}];
    target.assistant={
      loadState:async()=>({state:null}),
      saveState:async({state:json}:{state:string})=>{
        state.calls.saves.push(json);
        const parsed=JSON.parse(json) as {queue?:{inFlight?:string[]}};
        if(options.deferReservation&&parsed.queue?.inFlight?.length&&!state.reservationWaiting){state.reservationWaiting=true;await new Promise<void>(resolve=>{state.releaseReservation=resolve;});}
        return {saved:true};
      },
      modelStatus:async()=>({loaded:true,contextSize:12800}),loadModel:async()=>({loaded:true}),
      tokenize:async()=>({count:480}),
      infer:async({prompt,contextSize}:{prompt:string;contextSize:number})=>{
        state.calls.prompts.push(prompt);
        if(options.deferInference)await new Promise<void>(resolve=>{state.releaseInference=resolve;});
        return {text:'好的，我确认时间后回复你。',inputTokens:480,outputTokens:20,tokensPerSecond:1,contextSize};
      },
      stop:async()=>({}),
      request:async()=>{state.calls.requests++;throw new Error('本地窗口测试禁止外部 API。');},
      listSocialWindows:async()=>({supported:true,windows}),
      readSocialWindow:async(args:{selection:string;expectedTitle:string;consent:boolean})=>{
        state.calls.reads.push(args);const selected=windows.find(w=>w.selection===args.selection);if(!selected||args.expectedTitle!==selected.title||!args.consent)throw new Error('测试替身拒绝未授权窗口。');
        return {...selected,text:'导航区域 WHOLE_WINDOW_ONLY\n张三\n我：我之前说过下周再聊。\n对方：周末下午有空吗？',snapshot:state.snapshot,inputFingerprint:state.inputFingerprint,capability:{canSend:state.canSend,reason:state.canSend?'测试替身提供指定 ValuePattern 和 InvokePattern':'此测试客户端没有 ValuePattern 或 InvokePattern'},conversationTitle:null};
      },
      prepareSocialReply:async(args:Record<string,unknown>)=>{
        state.calls.prepares.push(args);if(options.prepareFailure)throw new Error('测试替身：当前客户端不支持空输入框 ValuePattern／发送按钮 InvokePattern。');
        if(args.expectedSnapshot!==state.snapshot||args.selection!=='test-selected-wechat')throw new Error('测试替身拒绝变化的窗口。');
        return {ticket:'single-use-test-ticket',expiresAt:Date.now()+30_000,requiresReview:true,input:{method:'uia-value-pattern',imeBypassed:true,imeLayout:'test-ime-only'}};
      },
      commitSocialReply:async(args:Record<string,unknown>)=>{state.calls.commits.push(args);if(options.commitFailure)throw new Error('测试替身：调用后的状态无法确认');return {status:'unknown',message:'测试替身已尝试触发发送；必须本人核对，未确认送达'};},
      captureSocialWindow:async()=>{const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;return {image:{data:canvas.toDataURL('image/png')}};},
      analyzeImage:async()=>{state.calls.media.push('local-image');return {text:'本地视觉测试替身转录；仍需本人核对。'};},
      transcribeLocal:async()=>{state.calls.media.push('local-audio');return {text:'本地转写测试替身：周末下午有空吗？'};},
    };
  },options);
}
async function openComputer(page:Page){await page.goto(baseUrl);await page.locator('nav').getByRole('button',{name:'桌面界面接入',exact:true}).click();}
async function previewWindow(page:Page){
  await page.getByRole('button',{name:'刷新可选窗口',exact:true}).click();
  await page.getByLabel('明确选择要操作的应用窗口',{exact:true}).selectOption('test-selected-wechat');
  await page.getByLabel('我明确允许本次读取所选窗口的可访问文字，可能包含私人内容',{exact:true}).check();
  await page.getByRole('button',{name:'读取所选窗口文字',exact:true}).click();
  await expect(page.getByLabel('窗口文字／本地分析结果（请本人核对）',{exact:true})).toHaveValue(fullWindow);
}
async function authorizeOnce(page:Page){
  await page.getByLabel('本人确认的当前会话名称',{exact:true}).fill('工作讨论 / 张三');
  await page.getByLabel('本人圈选／核对的本次收到内容',{exact:true}).fill(received);
  await page.getByLabel('启用本窗口本次回复规则',{exact:true}).check();
  await page.getByLabel('允许的会话名称',{exact:true}).fill('工作讨论 / 张三');
  await page.getByLabel('本次回复延迟（秒）',{exact:true}).fill('0');
  await page.getByLabel('我已核对当前会话名称和上方最近可见文字，确认本次收到内容属于该会话的对方消息',{exact:true}).check();
  await page.getByLabel('我授权本次对已确认会话和消息生成本地草稿，并在规则复核后自动写入、触发发送（仅此一次）',{exact:true}).check();
}
const startButton=(page:Page)=>page.getByRole('button',{name:'执行已确认消息的一次自动回复',exact:true});
const stateOf=(page:Page)=>page.evaluate(()=> (window as unknown as {__computer:{calls:{reads:unknown[];prepares:unknown[];commits:unknown[];prompts:string[];saves:string[];requests:number;media:string[]};reservationWaiting:boolean}}).__computer);

test('browser exposes a disabled Windows action without pretending it can enumerate or send',async({page})=>{
  await openComputer(page);await expect(page.getByRole('button',{name:'刷新可选窗口',exact:true})).toBeDisabled();await expect(startButton(page)).toBeDisabled();
  await expect(page.getByText('当前没有可靠的新消息区域适配器',{exact:false})).toBeVisible();
});
test('native/model doubles stay idle until owner confirms one peer message and the exact conversation',async({page})=>{
  await installComputerDouble(page);await openComputer(page);await previewWindow(page);
  await expect(startButton(page)).toBeDisabled();expect((await stateOf(page)).calls.prompts).toHaveLength(0);
  await authorizeOnce(page);await startButton(page).click();
  await expect(page.getByTestId('computer-task-status')).toContainText('发送结果未知');
  await expect.poll(async()=>(await stateOf(page)).calls.commits.length).toBe(1);
  const state=await stateOf(page);expect(state.calls.prompts).toHaveLength(1);expect(state.calls.prompts[0]).toContain(received);expect(state.calls.prompts[0]).not.toContain('WHOLE_WINDOW_ONLY');expect(state.calls.prompts[0]).not.toContain('我之前说过');
  expect(state.calls.requests).toBe(0);expect(state.calls.prepares).toEqual([expect.objectContaining({selection:'test-selected-wechat',expectedTitle:'微信 · 工作讨论',expectedSnapshot:'a'.repeat(64),consent:true,text:'好的，我确认时间后回复你。'})]);
  expect(state.calls.reads.every((entry:unknown)=>(entry as {selection:string}).selection==='test-selected-wechat')).toBe(true);
  await expect(startButton(page)).toBeDisabled();
  await expect.poll(async()=>{const saves=(await stateOf(page)).calls.saves;return saves.some(json=>JSON.parse(json).queue?.drafts?.some((d:{status:string;scope:{accountId:string}})=>d.status==='unknown'&&d.scope.accountId.startsWith('computer-use:')));}).toBe(true);
});
test('unsupported UIA patterns remain preview only and do not call a model or commit',async({page})=>{
  await installComputerDouble(page,{canSend:false});await openComputer(page);await previewWindow(page);
  await expect(page.getByText('目前只能预览',{exact:false})).toBeVisible();
  await page.getByLabel('本人确认的当前会话名称',{exact:true}).fill('工作讨论 / 张三');await page.getByLabel('本人圈选／核对的本次收到内容',{exact:true}).fill(received);
  await expect(startButton(page)).toBeDisabled();expect((await stateOf(page)).calls.prompts).toHaveLength(0);expect((await stateOf(page)).calls.commits).toHaveLength(0);
});
for(const changed of ['snapshot','inputFingerprint'] as const){
  test(`native/model doubles stop when ${changed} changes during local generation`,async({page})=>{
    await installComputerDouble(page,{deferInference:true});await openComputer(page);await previewWindow(page);await authorizeOnce(page);await startButton(page).click();
    await expect.poll(async()=>(await stateOf(page)).calls.prompts.length).toBe(1);
    await page.evaluate(changed=>{const state=(window as unknown as {__computer:{snapshot:string;inputFingerprint:string;releaseInference?:()=>void}}).__computer;state[changed]=changed==='snapshot'?'b'.repeat(64):'manual-input-changed';state.releaseInference?.();},changed);
    await expect(page.getByTestId('computer-task-status')).toContainText('窗口内容或输入框已变化');const state=await stateOf(page);expect(state.calls.prepares).toHaveLength(0);expect(state.calls.commits).toHaveLength(0);
  });
}
test('switching the selected application revokes a late model result and cannot start a second in-flight action',async({page})=>{
  await installComputerDouble(page,{deferInference:true});await openComputer(page);await previewWindow(page);await authorizeOnce(page);await startButton(page).click();
  await expect.poll(async()=>(await stateOf(page)).calls.prompts.length).toBe(1);
  await page.getByLabel('明确选择要操作的应用窗口',{exact:true}).selectOption('test-selected-qq');
  await expect(page.getByLabel('我明确允许本次读取所选窗口的可访问文字，可能包含私人内容',{exact:true})).not.toBeChecked();await expect(startButton(page)).toBeDisabled();
  await page.evaluate(()=> (window as unknown as {__computer:{releaseInference?:()=>void}}).__computer.releaseInference?.());
  await expect(page.getByTestId('computer-task-status')).toContainText('窗口已切换');expect((await stateOf(page)).calls.prepares).toHaveLength(0);expect((await stateOf(page)).calls.commits).toHaveLength(0);
});
test('a final native capability rejection prevents sending despite an earlier readable preview',async({page})=>{
  await installComputerDouble(page,{prepareFailure:true});await openComputer(page);await previewWindow(page);await authorizeOnce(page);await startButton(page).click();
  await expect(page.getByTestId('computer-task-status')).toContainText('不支持空输入框');expect((await stateOf(page)).calls.commits).toHaveLength(0);
});
test('a commit exception remains unknown, persists a paused job, and never retries',async({page})=>{
  await installComputerDouble(page,{commitFailure:true});await openComputer(page);await previewWindow(page);await authorizeOnce(page);await startButton(page).click();
  await expect(page.getByTestId('computer-task-status')).toContainText('发送结果未知');await expect(startButton(page)).toBeDisabled();
  await page.getByRole('button',{name:'停止并撤销授权',exact:true}).click();await expect(startButton(page)).toBeDisabled();
  expect((await stateOf(page)).calls.commits).toHaveLength(1);expect((await stateOf(page)).calls.requests).toBe(0);
});
test('owner cancellation during the persisted send reservation releases the reservation without calling commit',async({page})=>{
  await installComputerDouble(page,{deferReservation:true});await openComputer(page);await previewWindow(page);await authorizeOnce(page);await startButton(page).click();
  await expect.poll(async()=>(await stateOf(page)).reservationWaiting).toBe(true);
  await page.getByRole('button',{name:'停止并撤销授权',exact:true}).click();
  await page.evaluate(()=> (window as unknown as {__computer:{releaseReservation?:()=>void}}).__computer.releaseReservation?.());
  await expect.poll(async()=>{const saves=(await stateOf(page)).calls.saves;return saves.some(json=>{const queue=JSON.parse(json).queue;return queue?.paused===true&&queue?.inFlight?.length===0;});}).toBe(true);
  expect((await stateOf(page)).calls.commits).toHaveLength(0);await expect(startButton(page)).toBeDisabled();
});
test('window screenshot analysis uses only the local model double and never establishes a conversation identity',async({page})=>{
  await installComputerDouble(page);await openComputer(page);await previewWindow(page);
  await page.getByLabel('我明确允许本次截取整个所选窗口，可能包含私人内容、草稿或登录界面',{exact:true}).check();await page.getByRole('button',{name:'截取所选窗口',exact:true}).click();
  await expect(page.getByAltText('明确选择的窗口截图，仅本次内存预览')).toBeVisible();await page.getByRole('button',{name:'用本地模型理解此窗口',exact:true}).click();
  await expect(page.getByLabel('窗口文字／本地分析结果（请本人核对）',{exact:true})).toHaveValue('本地视觉测试替身转录；仍需本人核对。');
  await expect(page.getByLabel('本人确认的当前会话名称',{exact:true})).toHaveValue('');expect((await stateOf(page)).calls.media).toEqual(['local-image']);expect((await stateOf(page)).calls.requests).toBe(0);expect((await stateOf(page)).calls.commits).toHaveLength(0);
});
