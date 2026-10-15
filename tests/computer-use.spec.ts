import {test,expect,type Page} from '@playwright/test';

const baseUrl=process.env.TC_UI_BASE_URL??'http://127.0.0.1:5173';
const received='周末下午有空吗？';
const fullWindow='导航区域 WHOLE_WINDOW_ONLY\n张三\n我：我之前说过下周再聊。\n对方：周末下午有空吗？';
const primary='1'.repeat(64),keyboard='2'.repeat(64);
/** Explicit native/model doubles validate the web contract, not real Windows, UIA, keyboard input or platform delivery. */
async function installComputerDouble(page:Page,options:{canSend?:boolean;noText?:boolean;noSnapshot?:boolean;deferInference?:boolean;prepareFailure?:boolean;commitFailure?:boolean;deferReservation?:boolean}={}){
  await page.addInitScript(options=>{
    const target=window as unknown as {assistant:Record<string,unknown>;__computer:{calls:{reads:unknown[];prepares:unknown[];commits:unknown[];prompts:string[];saves:string[];requests:number;media:string[]};snapshot:string;inputFingerprint:string;canSend:boolean;releaseInference?:()=>void;releaseReservation?:()=>void;reservationWaiting:boolean}};
    const state=target.__computer={calls:{reads:[],prepares:[],commits:[],prompts:[],saves:[],requests:0,media:[]},snapshot:'a'.repeat(64),inputFingerprint:'empty-input-fingerprint',canSend:options.canSend!==false,reservationWaiting:false} as typeof target.__computer;
    const windows=[{selection:'test-selected-wechat',title:'微信 · 工作讨论',process:'wechat',handle:'201',kind:'client'},{selection:'test-selected-qq',title:'QQ · 工作讨论',process:'qq',handle:'202',kind:'client'}];
    const inputTargets=[{id:'1'.repeat(64),label:'消息输入框',method:'uia-value-pattern',sendAction:'button'},{id:'2'.repeat(64),label:'另一个输入框',method:'unicode-keyboard',sendAction:'ctrl-enter'}];
    target.assistant={
      loadState:async()=>({state:null}),saveState:async({state:json}:{state:string})=>{state.calls.saves.push(json);const parsed=JSON.parse(json) as {queue?:{inFlight?:string[]}};if(options.deferReservation&&parsed.queue?.inFlight?.length&&!state.reservationWaiting){state.reservationWaiting=true;await new Promise<void>(resolve=>{state.releaseReservation=resolve;});}return {saved:true};},
      modelStatus:async()=>({loaded:true,contextSize:12800}),loadModel:async()=>({loaded:true}),tokenize:async()=>({count:480}),
      infer:async({prompt,contextSize}:{prompt:string;contextSize:number})=>{state.calls.prompts.push(prompt);if(options.deferInference)await new Promise<void>(resolve=>{state.releaseInference=resolve;});return {text:'好的，我确认时间后回复你。',inputTokens:480,outputTokens:20,tokensPerSecond:1,contextSize};},
      stop:async()=>{state.releaseInference?.();return {};},request:async()=>{state.calls.requests++;throw new Error('本地窗口测试禁止外部 API。');},
      listSocialWindows:async()=>({supported:true,windows}),
      readSocialWindow:async(args:{selection:string;expectedTitle:string;consent:boolean;inputTarget?:string})=>{
        state.calls.reads.push(args);const selected=windows.find(w=>w.selection===args.selection);if(!selected||args.expectedTitle!==selected.title||!args.consent)throw new Error('测试替身拒绝未授权窗口。');
        const selectedInputTarget=args.inputTarget??null;
        return {...selected,text:options.noText?'':'导航区域 WHOLE_WINDOW_ONLY\n张三\n我：我之前说过下周再聊。\n对方：周末下午有空吗？',snapshot:options.noSnapshot?'':state.snapshot,inputFingerprint:selectedInputTarget?`${state.inputFingerprint}:${selectedInputTarget}`:null,inputTargets:options.canSend===false?[]:inputTargets,selectedInputTarget,
          capability:{canRead:!options.noText,canCapture:true,canType:state.canSend,canSend:state.canSend&&!!selectedInputTarget,reason:state.canSend?'':'此测试客户端没有可定位的输入控件'},conversationTitle:null};
      },
      prepareSocialReply:async(args:Record<string,unknown>)=>{state.calls.prepares.push(args);if(options.prepareFailure)throw new Error('WINDOWS_UI_DRAFT_PRESENT：输入框已有草稿。');if(args.expectedSnapshot!==state.snapshot||args.selection!=='test-selected-wechat'||!inputTargets.some(t=>t.id===args.inputTarget))throw new Error('测试替身拒绝窗口或控件变化。');return {ticket:'single-use-test-ticket',expiresAt:Date.now()+30_000,requiresReview:true};},
      commitSocialReply:async(args:Record<string,unknown>)=>{state.calls.commits.push(args);if(options.commitFailure)throw new Error('测试替身：调用后的状态无法确认');return {status:'unknown',message:'测试替身已尝试触发发送；必须本人核对，未确认送达'};},
      captureSocialWindow:async()=>{const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;return {image:{data:canvas.toDataURL('image/png')}};},
      analyzeImage:async()=>{state.calls.media.push('local-image');return {text:'本地视觉测试替身转录；仍需本人核对。'};},
      transcribeLocal:async()=>{state.calls.media.push('local-audio');return {text:'本地转写测试替身：周末下午有空吗？'};},
    };
  },options);
}
async function openComputer(page:Page){await page.goto(baseUrl);await page.locator('nav').getByRole('button',{name:'桌面界面接入',exact:true}).click();}
async function selectWindow(page:Page){await page.getByRole('button',{name:'刷新可选窗口',exact:true}).click();await page.getByLabel('明确选择要操作的应用窗口',{exact:true}).selectOption('test-selected-wechat');}
async function previewWindow(page:Page,{noText=false,canSend=true}:{noText?:boolean;canSend?:boolean}={}){
  await selectWindow(page);await page.getByRole('button',{name:'授权读取所选窗口',exact:true}).click();await expect(page.getByLabel('窗口文字／本地分析结果（请本人核对）',{exact:true})).toHaveValue(noText?'':fullWindow);
  if(canSend){await page.getByLabel('本人选择输入框与发送方式',{exact:true}).selectOption(primary);await expect(page.getByRole('button',{name:'授权读取所选窗口',exact:true})).toBeEnabled();}
}
async function authorize(page:Page){await page.getByLabel('本人确认的当前会话名称',{exact:true}).fill('工作讨论 / 张三');await page.getByLabel('本人圈选／核对的本次收到内容',{exact:true}).fill(received);await page.getByLabel('我已在目标应用核对当前会话和本次对方消息，允许本地生成本次草稿',{exact:true}).check();}
const generateButton=(page:Page)=>page.getByRole('button',{name:'生成本地回复草稿',exact:true});
const sendButton=(page:Page)=>page.getByRole('button',{name:'核对草稿并发送一次',exact:true});
const stateOf=(page:Page)=>page.evaluate(()=>(window as unknown as {__computer:{calls:{reads:unknown[];prepares:unknown[];commits:unknown[];prompts:string[];saves:string[];requests:number;media:string[]};reservationWaiting:boolean}}).__computer);
async function generateDraft(page:Page){await authorize(page);await generateButton(page).click();await expect(page.getByLabel('本次本地模型草稿',{exact:true})).toHaveValue('好的，我确认时间后回复你。');}

test('browser offers a working account entry and clearly describes the native window requirement',async({page})=>{
  await openComputer(page);await expect(page.getByText('按窗口操作需要 Windows 原生版。',{exact:false})).toBeVisible();await page.getByRole('button',{name:'查看账号与应用接入',exact:true}).click();await expect(page.getByRole('heading',{name:'账号连接',exact:true})).toBeVisible();
});
test('one owner confirmation generates only; reviewing and sending binds the exact native input target',async({page})=>{
  await installComputerDouble(page);await openComputer(page);await previewWindow(page);await expect(generateButton(page)).toBeDisabled();expect((await stateOf(page)).calls.prompts).toHaveLength(0);
  await generateDraft(page);let state=await stateOf(page);expect(state.calls.prepares).toHaveLength(0);expect(state.calls.commits).toHaveLength(0);expect(state.calls.prompts[0]).toContain(received);expect(state.calls.prompts[0]).not.toContain('WHOLE_WINDOW_ONLY');expect(state.calls.prompts[0]).not.toContain('我之前说过');
  await page.getByLabel('本次本地模型草稿',{exact:true}).fill('好的，周末时间我核对后告诉你。');await sendButton(page).click();await expect(page.getByTestId('computer-task-status')).toContainText('发送结果未知');
  state=await stateOf(page);expect(state.calls.requests).toBe(0);expect(state.calls.commits).toHaveLength(1);expect(state.calls.prepares).toEqual([expect.objectContaining({selection:'test-selected-wechat',expectedTitle:'微信 · 工作讨论',expectedSnapshot:'a'.repeat(64),inputTarget:primary,consent:true,text:'好的，周末时间我核对后告诉你。'})]);await expect(generateButton(page)).toBeDisabled();
});
test('no UIA text still allows selected-window capture, local vision and manually confirmed message generation',async({page})=>{
  await installComputerDouble(page,{noText:true});await openComputer(page);await previewWindow(page,{noText:true});await page.getByRole('button',{name:'授权截取所选窗口',exact:true}).click();await page.getByRole('button',{name:'用本地模型理解此窗口',exact:true}).click();
  await expect(page.getByLabel('窗口文字／本地分析结果（请本人核对）',{exact:true})).toHaveValue('本地视觉测试替身转录；仍需本人核对。');await expect(page.getByLabel('本人确认的当前会话名称',{exact:true})).toHaveValue('');
  await generateDraft(page);expect((await stateOf(page)).calls.commits).toHaveLength(0);expect((await stateOf(page)).calls.media).toEqual(['local-image']);await expect(sendButton(page)).toBeEnabled();
});
test('image analysis alone does not create a trusted snapshot or enable native generation',async({page})=>{
  await installComputerDouble(page,{noSnapshot:true});await openComputer(page);await selectWindow(page);await page.getByRole('button',{name:'授权截取所选窗口',exact:true}).click();await page.getByRole('button',{name:'用本地模型理解此窗口',exact:true}).click();
  await expect(page.getByAltText('明确选择的窗口截图，仅本次内存预览')).toBeVisible();await page.getByLabel('本人确认的当前会话名称',{exact:true}).fill('工作讨论 / 张三');await page.getByLabel('本人圈选／核对的本次收到内容',{exact:true}).fill(received);await expect(generateButton(page)).toBeDisabled();expect((await stateOf(page)).calls.prompts).toHaveLength(0);expect((await stateOf(page)).calls.requests).toBe(0);
});
test('a readable window without input controls can generate a manual draft and cannot commit',async({page})=>{
  await installComputerDouble(page,{canSend:false});await openComputer(page);await previewWindow(page,{canSend:false});await generateDraft(page);await expect(sendButton(page)).toBeDisabled();expect((await stateOf(page)).calls.commits).toHaveLength(0);
});
for(const changed of ['snapshot','inputFingerprint'] as const)test(`a changed ${changed} during inference invalidates the draft`,async({page})=>{
  await installComputerDouble(page,{deferInference:true});await openComputer(page);await previewWindow(page);await authorize(page);await generateButton(page).click();await expect.poll(async()=>(await stateOf(page)).calls.prompts.length).toBe(1);
  await page.evaluate(changed=>{const state=(window as unknown as {__computer:{snapshot:string;inputFingerprint:string;releaseInference?:()=>void}}).__computer;state[changed]=changed==='snapshot'?'b'.repeat(64):'manual-input-changed';state.releaseInference?.();},changed);
  await expect(page.getByTestId('computer-task-status')).toContainText('窗口内容或输入框已变化');expect((await stateOf(page)).calls.prepares).toHaveLength(0);expect((await stateOf(page)).calls.commits).toHaveLength(0);
});
test('changing the explicit editor and send key revokes the old draft and requires a new owner confirmation',async({page})=>{
  await installComputerDouble(page);await openComputer(page);await previewWindow(page);await generateDraft(page);await page.getByLabel('本人选择输入框与发送方式',{exact:true}).selectOption(keyboard);
  await expect(page.getByLabel('我已在目标应用核对当前会话和本次对方消息，允许本地生成本次草稿',{exact:true})).not.toBeChecked();await expect(page.getByLabel('本次本地模型草稿',{exact:true})).toHaveCount(0);await expect(generateButton(page)).toBeDisabled();
  await expect.poll(async()=>(await stateOf(page)).calls.reads.some(r=>(r as {inputTarget?:string}).inputTarget===keyboard)).toBe(true);expect((await stateOf(page)).calls.commits).toHaveLength(0);
});
test('native prepare errors name a concrete recovery action and never call commit',async({page})=>{
  await installComputerDouble(page,{prepareFailure:true});await openComputer(page);await previewWindow(page);await generateDraft(page);await sendButton(page).click();await expect(page.getByTestId('computer-task-status')).toContainText('先到官方应用处理已有草稿');expect((await stateOf(page)).calls.commits).toHaveLength(0);
});
test('cancellation while persisting the send reservation never commits',async({page})=>{
  await installComputerDouble(page,{deferReservation:true});await openComputer(page);await previewWindow(page);await generateDraft(page);await sendButton(page).click();await expect.poll(async()=>(await stateOf(page)).reservationWaiting).toBe(true);await page.getByRole('button',{name:'停止并撤销授权',exact:true}).click();await page.evaluate(()=>(window as unknown as {__computer:{releaseReservation?:()=>void}}).__computer.releaseReservation?.());
  await expect.poll(async()=>{const saves=(await stateOf(page)).calls.saves;return saves.some(json=>{const queue=JSON.parse(json).queue;return queue?.inFlight?.length===0&&queue?.drafts?.some((d:{status:string})=>d.status==='cancelled');});}).toBe(true);expect((await stateOf(page)).calls.commits).toHaveLength(0);
});
test('commit failure stays unknown until the owner records an explicit outcome and evidence',async({page})=>{
  await installComputerDouble(page,{commitFailure:true});await openComputer(page);await previewWindow(page);await generateDraft(page);await sendButton(page).click();await expect(page.getByTestId('computer-task-status')).toContainText('发送结果未知');await expect(generateButton(page)).toBeDisabled();
  await page.getByLabel('本人在目标应用核对的发送结果',{exact:true}).selectOption('accepted');await expect(page.getByRole('button',{name:'保存本人核对结果',exact:true})).toBeDisabled();await page.getByLabel('核对依据',{exact:true}).fill('本人已在张三会话消息列表看到对应回复，并核对时间。');await page.getByRole('button',{name:'保存本人核对结果',exact:true}).click();await expect(page.getByTestId('computer-task-status')).toContainText('已保存本人核对结果');
  expect((await stateOf(page)).calls.commits).toHaveLength(1);await expect(generateButton(page)).toBeDisabled();await expect.poll(async()=>(await stateOf(page)).calls.saves.some(json=>JSON.parse(json).queue?.drafts?.some((d:{status:string})=>d.status==='accepted'))).toBe(true);
});
