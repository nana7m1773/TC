import {QueueEngine,createDefaultRule,evaluateSafety,selectMemories,trimContext,scopeKey,SAFETY_REASONS,type QueueState,type StyleProfile,type Memory,type Scope,type Rule} from '../../../packages/core/src';
import {prepareLocalInference} from './local-inference';
import {compactConversation,defaultCompression,type CompressionSettings} from './CompactionSettings';
import type {NativeBridge} from './runtime';
import type {SocialNotificationEvent} from './SocialConnections';
interface State {queue:QueueState;profile:StyleProfile;memories:Memory[];compression?:CompressionSettings}
interface Job {id:string;eventId:string;scope:Scope;profile:StyleProfile;memories:Memory[];attempted:boolean}
export class NotificationReplyService {
  private jobs=new Map<string,Job>();
  private working=false;
  constructor(private options:{getState():State;setQueue(q:QueueState):void;persist(q:QueueState):Promise<void>;native():NativeBridge;now?:()=>number}){}
  private now(){return this.options.now?.()??Date.now();}
  private rule(scope:Scope):Rule{return {...createDefaultRule(scope.accountId),conversationId:scope.conversationId,mode:'auto',enabled:true,autoAuthorized:true,allowedKinds:['text'],whitelist:[scope.conversationId],cooldownMs:30000};}
  private reason(reasons:string[]){return reasons.map(x=>SAFETY_REASONS[x]??x).join('；');}
  private async scope(event:SocialNotificationEvent):Promise<Scope>{
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([event.notificationKey,event.title])));
    return {accountId:`android:${event.packageName}`,conversationId:Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('')};
  }
  async generate(event:SocialNotificationEvent){
    if(this.working)throw new Error('另一个通知回复正在生成。');
    if(event.source!=='android-notification'||!event.eventId||!event.packageName||!event.text?.trim()||event.text.length>16000)throw new Error('这条通知没有可用的消息正文，请到原应用核对。');
    if(event.messages?.at(-1)?.isSelf===true)throw new Error('这条通知最后一条是本人的消息，不生成自动回复。');
    const initial=this.options.getState();if(initial.queue.paused)throw new Error('当前已暂停，请先点击“恢复运行”。');
    const native=this.options.native();
    if(!native.getSocialNotifications)throw new Error('当前安装包没有系统通知组件，请更新完整 Android 版本。');
    this.working=true;
    try{
      const active=await native.getSocialNotifications({limit:100});
      if(active.notificationAccess!==true||!Array.isArray(active.events)||!active.events.some((e:any)=>e.eventId===event.eventId&&e.text===event.text&&e.packageName===event.packageName))throw new Error('通知已更新、移除或权限已关闭，请刷新后再生成。');
      const liveEvent=active.events.find((e:any)=>e.eventId===event.eventId);
      if(liveEvent?.messages?.at(-1)?.isSelf===true)throw new Error('最新通知最后一条是本人的消息，不生成自动回复。');
      const scope=await this.scope(event),q=new QueueEngine(this.options.getState().queue);
      if(q.snapshot().drafts.some(d=>scopeKey(d.scope)===scopeKey(scope)&&d.status==='unknown'))throw new Error('这段会话的上次发送待核实，不能重复回复。');
      const old=[...this.jobs.values()].find(j=>j.eventId===event.eventId);
      if(old?.attempted)throw new Error('这条通知已经尝试回复，请先在原应用核实。');
      if(old){const d=q.getDraft(old.id);if(d&&['generated','review','queued'].includes(d.status))q.cancel(d.id);this.jobs.delete(old.id);}
      q.ingest({id:event.eventId,scope,role:'peer',text:event.text,kind:'text',createdAt:this.now()});
      const composition=q.compose(scope,this.now(),Infinity);if(!composition.messageIds.length)throw new Error('这条通知已经有确认的回复。');
      this.options.setQueue(q.snapshot());
      const s=this.options.getState(),local=await prepareLocalInference(native),reserve=Math.min(384,Math.floor(local.contextSize/4));
      const memories=selectMemories(s.memories,scope,this.now()),settings=s.compression??defaultCompression;
      const compaction=settings.enabled?compactConversation(s.queue,composition.messages,scope,memories,settings,composition.messageIds,this.now()):undefined;
      const budget=await trimContext({profile:s.profile,memories,messages:composition.messages,currentMessageIds:composition.messageIds,compaction,now:this.now(),maxContextTokens:local.contextSize,outputReserve:reserve,countTokens:async text=>(await native.tokenize({text,modelPath:local.modelPath})).count});
      const result=await native.infer({prompt:budget.prompt,modelPath:local.modelPath,contextSize:local.contextSize,maxTokens:reserve,temperature:.3});
      const latest=this.options.getState(),live=new QueueEngine(latest.queue);
      if(latest.queue.paused||latest.profile!==s.profile||latest.memories!==s.memories||live.contextVersion(scope)!==composition.contextVersion)throw new Error('生成期间暂停、偏好或会话已变化，请重新生成。');
      if(!result.text.trim())throw new Error('模型没有返回回复正文。');
      const draft=live.enqueue(composition,result.text,this.now());
      const safety=evaluateSafety(draft,live.snapshot().messages,this.rule(scope),{now:this.now(),currentContextVersion:live.contextVersion(scope),canSend:event.canReply,currentDeviceId:'android-notification',responsibleDeviceId:'android-notification',profile:s.profile,lastSentAt:latest.queue.lastSentAt[scopeKey(scope)]});
      this.jobs.set(draft.id,{id:draft.id,eventId:event.eventId,scope,profile:s.profile,memories:s.memories,attempted:false});this.options.setQueue(live.snapshot());
      return {jobId:draft.id,text:draft.text,requiresReview:safety.requiresReview||!safety.allowed,reason:this.reason(safety.reasons)};
    }finally{this.working=false;}
  }
  async send(input:{event:SocialNotificationEvent;draft:string;jobId:string;approved:boolean}){
    try{return await this.sendChecked(input);}catch(error){
      if(!this.jobs.get(input.jobId)?.attempted&&error instanceof Error)Object.assign(error,{definitelyNotSent:true});
      throw error;
    }
  }
  private async sendChecked(input:{event:SocialNotificationEvent;draft:string;jobId:string;approved:boolean}){
    const job=this.jobs.get(input.jobId),s=this.options.getState();
    if(!job||job.eventId!==input.event.eventId||job.attempted)throw new Error('这条通知没有可发送的本次草稿，或已经尝试发送。');
    if(s.profile!==job.profile||s.memories!==job.memories)throw new Error('本人档案已变化，请重新生成。');
    if(!input.draft.trim()||input.draft.length>4000)throw new Error('回复必须是 1 至 4000 字。');
    const native=this.options.native();if(!native.getSocialNotifications||!native.replySocialNotification)throw new Error('系统通知回复组件不可用。');
    const active=await native.getSocialNotifications({limit:100});
    const current=Array.isArray(active.events)?active.events.find((e:any)=>e.eventId===job.eventId&&e.canReply===true&&e.text===input.event.text):undefined;
    if(active.notificationAccess!==true||!current||current.messages?.at(-1)?.isSelf===true)throw new Error('通知已变化、最后一条是本人消息或没有系统回复按钮，请打开原应用处理。');
    const latest=this.options.getState(),q=new QueueEngine(latest.queue),draft=q.getDraft(job.id);
    if(!draft||(!input.approved&&draft.text!==input.draft))throw new Error('草稿已改变，需要本人重新审核。');
    if(input.approved)q.approve(job.id,input.draft);
    const decision=q.permitSend(job.id,this.rule(job.scope),{now:this.now(),canSend:true,currentDeviceId:'android-notification',responsibleDeviceId:'android-notification',profile:latest.profile});
    this.options.setQueue(q.snapshot());if(!decision.allowed)throw new Error(this.reason(decision.reasons));
    try{await this.options.persist(q.snapshot());}catch(error){
      const currentQueue=new QueueEngine(this.options.getState().queue);if(currentQueue.getDraft(job.id)?.status==='unknown')currentQueue.reconcileUnknown(job.id,'not-sent','保存失败，尚未调用系统通知发送');this.options.setQueue(currentQueue.snapshot());throw error;
    }
    const currentState=this.options.getState();
    if(currentState.queue.paused||currentState.profile!==job.profile||currentState.memories!==job.memories||!currentState.queue.inFlight.includes(job.id)){
      const canceled=new QueueEngine(currentState.queue);
      if(canceled.getDraft(job.id)?.status==='unknown')canceled.reconcileUnknown(job.id,'not-sent','发送前状态改变，尚未调用系统通知发送');
      this.options.setQueue(canceled.snapshot());throw new Error('保存期间已暂停或档案改变，尚未发送。');
    }
    job.attempted=true;let message='系统已尝试提交回复，请在原应用核实，未确认送达。';
    try{await native.replySocialNotification({eventId:job.eventId,text:input.draft,consent:true});}catch(error){message=error instanceof Error?error.message:'系统回复调用结果未知，请到原应用核实。';}
    const finished=new QueueEngine(this.options.getState().queue),snapshot=finished.snapshot();
    const record=snapshot.drafts.find(d=>d.id===job.id);if(record){record.status='unknown';record.failureReason=message;}
    snapshot.inFlight=snapshot.inFlight.filter(id=>id!==job.id);
    const stopped=new QueueEngine(snapshot);stopped.takeover(job.scope);this.options.setQueue(stopped.snapshot());await this.options.persist(stopped.snapshot());
    return {status:'unknown' as const,message};
  }
  async resolve(input:{jobId:string;outcome:'accepted'|'not-sent';evidence:string}){
    const job=this.jobs.get(input.jobId);if(!job||!input.evidence.trim())throw new Error('请填写原应用中的核实依据。');
    const q=new QueueEngine(this.options.getState().queue);q.reconcileUnknown(job.id,input.outcome,input.evidence,this.now());if(input.outcome==='not-sent')q.cancel(job.id);q.resumeConversation(job.scope);this.options.setQueue(q.snapshot());await this.options.persist(q.snapshot());
  }
}
