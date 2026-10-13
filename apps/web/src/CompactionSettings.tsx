import { useState } from "react";
import { createCompaction, scopeKey, sameScope, type CompactionRecord, type Memory, type QueueState, type Scope } from "../../../packages/core/src";
export interface CompressionSettings { enabled: boolean; keepRecentCount: number; maxExcerptChars: number }
export const defaultCompression: CompressionSettings = {enabled:true,keepRecentCount:8,maxExcerptChars:2400};
export function compactConversation(queue:QueueState,messages:QueueState['messages'],scope:Scope,memories:Memory[],settings:CompressionSettings,protectedMessageIds:string[]=[],now=Date.now()) {
  const answered=messages.filter(m=>m.role==='peer'&&sameScope(m.scope,scope)&&queue.answered.includes(JSON.stringify([scopeKey(scope),m.id]))).map(m=>m.id);
  return createCompaction(messages,scope,{keepRecentCount:settings.keepRecentCount,maxExcerptChars:settings.maxExcerptChars,answeredMessageIds:answered,protectedMessageIds,memories,now});
}
export function CompactionSettings({settings,setSettings,queue,scope,memories,notify}:{settings:CompressionSettings;setSettings(s:CompressionSettings):void;queue:QueueState;scope:Scope;memories:Memory[];notify(s:string):void}){
  const [preview,setPreview]=useState<CompactionRecord|null>(null);
  return <section className="panel wide" data-testid="compaction-settings"><h3>上下文压缩与完整原文</h3>
    <p className="hint">把较早、已经答复的对话整理为带来源的逐字节选；原始消息和本人确认记忆仍完整保存在加密状态中。最新消息、未答消息和必要资料保持原文。摘要可能遗漏细节，不能保证无限上下文中每条信息都被模型记住。</p>
    <label className="check-field"><input type="checkbox" checked={settings.enabled} onChange={e=>{setSettings({...settings,enabled:e.target.checked});setPreview(null);}}/>启用可追溯上下文压缩</label>
    <div className="form-grid"><label className="field"><span>保留最近原文消息数</span><input aria-label="保留最近原文消息数" type="number" min="1" max="100" value={settings.keepRecentCount} onChange={e=>{setSettings({...settings,keepRecentCount:Math.max(1,Math.min(100,Math.floor(Number(e.target.value)||1)))});setPreview(null);}}/></label><label className="field"><span>历史节选字符预算</span><input aria-label="历史节选字符预算" type="number" min="256" max="12000" value={settings.maxExcerptChars} onChange={e=>{setSettings({...settings,maxExcerptChars:Math.max(256,Math.min(12000,Math.floor(Number(e.target.value)||256)))});setPreview(null);}}/></label></div>
    <button className="button secondary" onClick={()=>{try{setPreview(compactConversation(queue,queue.messages.filter(m=>sameScope(m.scope,scope)),scope,memories,settings));notify('已生成当前会话压缩预览；原文与确认记忆没有删除。');}catch(e){notify(e instanceof Error?e.message:String(e));}}}>预览当前会话压缩</button>
    <p className="hint">这是上下文视图，不是清理历史。保留期限由另一项设置控制。实际输入仍由当前模型 tokenizer 验证完整 12,800 预算；必要资料放不下时提示错误，不静默截断。</p>
    {preview&&<div data-testid="compaction-preview"><p>保留原文 {preview.retainedMessages.length} 条；历史节选来源 {preview.sourceIds.length} 条；未纳入节选的句段 {preview.omittedEvidenceCount} 条。</p><details open><summary>历史节选与来源</summary><pre className="status-code">{preview.summaryText||'当前没有可压缩的已答旧消息；未答消息保持原文。'}</pre></details>{preview.sources.map(source=><details key={source.id}><summary>展开原始消息：{source.id} · 已引用 {source.excerptCount} 处</summary><p>{queue.messages.find(m=>m.id===source.id&&sameScope(m.scope,scope))?.text}</p><small>来源 SHA-256：{source.fingerprint}</small></details>)}</div>}
  </section>;
}
