import {QueueEngine,createDefaultRule,evaluateSafety,selectMemories,trimContext,scopeKey,SAFETY_REASONS,type QueueState,type StyleProfile,type Memory,type Scope,type Rule} from '../../../packages/core/src';
import {compactConversation,defaultCompression,type CompressionSettings} from './CompactionSettings';
import type {NativeBridge} from './runtime';
import type {ComputerReplyRequest} from './ComputerUseView';

interface State {queue:QueueState;profile:StyleProfile;memories:Memory[];compression?:CompressionSettings}
interface Job {id:string;scope:Scope;profile:StyleProfile;memories:Memory[];rules:string;reserved:boolean}
/** The model writes text only. Native window operations remain a separate, explicitly authorized transport. */
export class ComputerReplyService {
  private jobs=new Map<string,Job>();
  private generating=false;
  constructor(private options:{getState():State;setQueue(queue:QueueState):void;persist(queue:QueueState):Promise<void>;native():NativeBridge;now?:()=>number}){}
  private now(){return this.options.now?.()??Date.now();}
  private key(r:ComputerReplyRequest){return JSON.stringify([r.window.process,r.window.handle,r.conversationTitle,r.snapshot,r.text]);}
  private scope(r:ComputerReplyRequest):Scope{return {accountId:`computer-use:${r.window.process}:${r.window.handle}`,conversationId:r.conversationTitle};}
  private rule(r:ComputerReplyRequest):Rule {
    const scope=this.scope(r);
    return {...createDefaultRule(scope.accountId),conversationId:scope.conversationId,enabled:r.rules.enabled&&!r.rules.paused,
      mode:'auto',autoAuthorized:r.rules.enabled,whitelist:r.rules.whitelist.includes(r.conversationTitle)?[scope.conversationId]:['unapproved-conversation'],
      allowedKinds:['text'],cooldownMs:30_000,replyTiming:{mode:'fixed',delayMs:r.rules.delayMs}};
  }
  private checkInput(r:ComputerReplyRequest){
    if(!r.snapshot||!r.text.trim()||!r.conversationTitle.trim())throw new Error('请先读取窗口、核对会话并确认本次收到的消息。');
    if(r.conversationTitle.length>200||r.text.length>8000)throw new Error('会话名称或本次消息过长，请缩短后确认。');
    if(!r.rules.enabled||r.rules.paused||!r.rules.whitelist.includes(r.conversationTitle))throw new Error('此应用会话未获本次自动回复授权，或已暂停。');
    if(!Number.isSafeInteger(r.rules.delayMs)||r.rules.delayMs<0||r.rules.delayMs>604800000)throw new Error('回复间隔无效。');
    if(this.options.getState().queue.paused)throw new Error('已一键暂停。');
  }
  private reason(reasons:string[]){return reasons.map(x=>SAFETY_REASONS[x]??x).join('；');}
  async request(r:ComputerReplyRequest){
    this.checkInput(r);if(this.generating)throw new Error('另一个回复正在生成。');
    const key=this.key(r),scope=this.scope(r),s=this.options.getState();
    if(this.jobs.has(key)||s.queue.drafts.some(d=>scopeKey(d.scope)===scopeKey(scope)&&['unknown','queued'].includes(d.status)))throw new Error('本次消息已有任务，或此会话发送结果待核实，不能重复发送。');
    this.generating=true;
    try {
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),b=>b.toString(16).padStart(2,'0')).join('');
      const q=new QueueEngine(s.queue);
      if(!q.ingest({id:`computer:${digest}`,scope,role:'peer',text:r.text,kind:'text',createdAt:this.now()}).accepted)throw new Error('这条已确认消息已导入，不能作为新消息重发。');
      this.options.setQueue(q.snapshot());
      const composition=q.compose(scope,this.now(),Infinity),native=this.options.native();
      const status=await native.modelStatus();if(status.loaded!==true&&status.state!=='ready')await native.loadModel({contextSize:12800});
      const profile={...s.profile,replyLanguage:r.rules.replyLanguage||s.profile.replyLanguage};
      const memories=selectMemories(s.memories,scope,this.now()),settings=s.compression??defaultCompression;
      const compaction=settings.enabled?compactConversation(q.snapshot(),composition.messages,scope,memories,settings,composition.messageIds,this.now()):undefined;
      const budget=await trimContext({profile,memories,messages:composition.messages,compaction,currentMessageIds:composition.messageIds,now:this.now(),maxContextTokens:12800,outputReserve:384,countTokens:async prompt=>(await native.tokenize({text:prompt})).count});
      const result=await native.infer({prompt:budget.prompt,contextSize:12800,maxTokens:384,temperature:.3});
      if(!result.text.trim())throw new Error('本地模型未返回回复。');
      const latest=this.options.getState(),live=new QueueEngine(latest.queue);
      if(latest.profile!==s.profile||latest.memories!==s.memories||live.contextVersion(scope)!==composition.contextVersion||latest.queue.paused)throw new Error('生成期间偏好、记忆或会话已变化，结果已丢弃。');
      const draft=live.enqueue(composition,result.text,this.now()),rule=this.rule(r);
      live.scheduleDraft(draft.id,rule,profile,this.now());
      const scheduled=live.getDraft(draft.id)!;
      const decision=evaluateSafety(scheduled,live.snapshot().messages,rule,{now:this.now(),currentContextVersion:live.contextVersion(scope),canSend:true,currentDeviceId:'windows-computer',responsibleDeviceId:'windows-computer',profile,paused:latest.queue.paused,takenOver:latest.queue.takenOver.includes(scopeKey(scope)),lastSentAt:latest.queue.lastSentAt[scopeKey(scope)]});
      this.options.setQueue(live.snapshot());
      this.jobs.set(key,{id:draft.id,scope,profile:s.profile,memories:s.memories,rules:JSON.stringify(r.rules),reserved:false});
      const reasons=decision.reasons.filter(x=>x!=='reply_delay');
      return {text:result.text,allowed:reasons.length===0,reason:this.reason(reasons),notBefore:scheduled.notBefore};
    } finally {this.generating=false;}
  }
  async check(r:ComputerReplyRequest&{draft:string;priorNotBefore?:number}){
    this.checkInput(r);const job=this.jobs.get(this.key(r));if(!job)throw new Error('本次回复任务不存在，请重新确认收到的消息。');
    const s=this.options.getState(),q=new QueueEngine(s.queue),draft=q.getDraft(job.id);
    if(job.reserved||!draft||draft.text!==r.draft||s.profile!==job.profile||s.memories!==job.memories||JSON.stringify(r.rules)!==job.rules)throw new Error('草稿、偏好或本次授权已改变，禁止发送。');
    const decision=q.permitSend(job.id,this.rule(r),{now:this.now(),canSend:true,currentDeviceId:'windows-computer',responsibleDeviceId:'windows-computer',profile:s.profile});
    this.options.setQueue(q.snapshot());
    if(decision.allowed){job.reserved=true;try{await this.options.persist(q.snapshot());}catch(error){
        const latest=new QueueEngine(this.options.getState().queue);
        if(latest.getDraft(job.id)?.status==='unknown')latest.reconcileUnknown(job.id,'not-sent','发送前保存失败，控制器尚未调用原生 commit');
        if(['generated','review','queued'].includes(latest.getDraft(job.id)?.status??''))latest.cancel(job.id);
        this.options.setQueue(latest.snapshot());job.reserved=false;throw error;
      }
      const current=this.options.getState();
      if(current.queue.paused||current.profile!==job.profile||current.memories!==job.memories||!current.queue.inFlight.includes(job.id))return {allowed:false,reason:'保存期间已暂停或配置改变，禁止发送'};
    }
    return {allowed:decision.allowed,reason:this.reason(decision.reasons),notBefore:q.getDraft(job.id)?.notBefore};
  }
  async finish(r:ComputerReplyRequest&{draft:string;outcome:'unknown'|'not-attempted';reason?:string}){
    const job=this.jobs.get(this.key(r));if(!job?.reserved)return;
    const q=new QueueEngine(this.options.getState().queue);
    // Restore converts an interrupted in-flight attempt into unknown; either state is fail closed.
    const current=q.getDraft(job.id);
    if(current?.status==='unknown'&&r.outcome==='not-attempted'){
      q.reconcileUnknown(job.id,'not-sent','控制器确认本次未调用原生 commit；任务已停止');q.cancel(job.id);
    }else if(current?.status!=='unknown') {
      if(r.outcome==='not-attempted')q.markFailed(job.id,r.reason??'尚未调用原生发送',true);
      else q.markUnknown(job.id,r.reason??'界面已尝试发送，需在官方客户端核实');
    }
    q.pause(true);job.reserved=false;
    const snapshot=q.snapshot();if(r.outcome==='unknown'){const record=snapshot.drafts.find(d=>d.id===job.id);if(record?.status==='unknown')record.failureReason=r.reason??'界面已尝试发送，需在官方客户端核实';}
    this.options.setQueue(snapshot);await this.options.persist(snapshot);
  }
}
