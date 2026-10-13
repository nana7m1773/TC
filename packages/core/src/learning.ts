import { MAX_REPLY_DELAY_MS, MIN_LEARNED_TIMING_SAMPLES, recordProfileVersion, sameScope, selectOriginalPhrases, validateProfileEnhancements, validateReplyTiming, type PersonalOriginal, type PersonalExample, type Rule, type ReplyTiming, type Scope, type StyleProfile } from './index';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const accessible = (e: PersonalExample,scope?: Scope) => e.confirmed && e.origin !== 'generated' && (!e.scope || e.shareable === true || (scope !== undefined && sameScope(e.scope,scope)));

export function addOriginalPhrases(profile: StyleProfile, additions: PersonalOriginal[], now = Date.now()): StyleProfile {
  validateProfileEnhancements(profile);
  if (!Array.isArray(additions) || additions.some(p => !p.confirmed || p.source === 'generated' || (!p.scope && !p.shareable))) throw new Error('只能保存本人确认的原句；私有原句必须指定会话。');
  const byId = new Map((profile.originalPhrases ?? []).map(p => [p.id,copy(p)]));
  for (const p of additions) byId.set(p.id,copy(p));
  const next = { ...copy(profile),originalPhrases:[...byId.values()] };
  validateProfileEnhancements(next);
  next.versions = recordProfileVersion(profile,now).versions;
  return next;
}
export function deleteOriginalPhrase(profile: StyleProfile,id: string,now = Date.now()): StyleProfile {
  if (!profile.originalPhrases?.some(p => p.id === id)) throw new Error('找不到本人原句。');
  return { ...copy(profile),originalPhrases:profile.originalPhrases.filter(p => p.id !== id).map(copy),versions:recordProfileVersion(profile,now).versions };
}

export interface ReplyTimingStatistics { count: number; medianMs: number; p25Ms: number; p75Ms: number; minMs: number; maxMs: number }
function quantile(values: number[],fraction: number): number {
  const index=(values.length-1)*fraction, floor=Math.floor(index);
  return Math.round(values[floor]!+(values[Math.ceil(index)]!-values[floor]!)*(index-floor));
}
function timingStatistics(profile: StyleProfile,scope?: Scope,now = Date.now(),relationship?: string): ReplyTimingStatistics | undefined {
  const values = profile.examples.filter(e => accessible(e,scope) && (!relationship || e.relationship === relationship)
    && Number.isSafeInteger(e.receivedAt) && Number.isSafeInteger(e.repliedAt)
    && e.receivedAt! >= 0 && e.repliedAt! >= e.receivedAt! && e.repliedAt! <= now
    && e.repliedAt!-e.receivedAt! <= MAX_REPLY_DELAY_MS).map(e => e.repliedAt!-e.receivedAt!).sort((a,b) => a-b);
  if (!values.length) return undefined;
  return { count:values.length,medianMs:quantile(values,.5),p25Ms:quantile(values,.25),p75Ms:quantile(values,.75),minMs:values[0]!,maxMs:values.at(-1)! };
}
export type LearningField = 'sentenceLength' | 'punctuation' | 'emoji' | 'tone';
export interface LearningSuggestion { id: string; field: LearningField; value: string; evidence: string }
export interface LearningAnalysis {
  scope?: Scope; generatedAt: number; signature: string;
  sampleCount: number; originalCount: number; exampleCount: number; ignoredCount: number;
  metrics: { meanSentenceLength: number; emojiRatio: number; exclamationRatio: number; colloquialRatio: number; replyTiming?: ReplyTimingStatistics };
  suggestions: LearningSuggestion[];
  evidence: { id: string; source: 'original' | 'example'; text: string; scope?: Scope }[];
}
function signature(profile: StyleProfile,scope?: Scope): string {
  // Obsolete-preview guard only; this is not an identity or permission check.
  const { versions: _,...snapshot } = profile;
  const text=JSON.stringify({snapshot,scope});let hash=2166136261;
  for(let i=0;i<text.length;i++) hash=Math.imul(hash^text.charCodeAt(i),16777619);
  return `${text.length}:${hash>>>0}`;
}
export function analyzeLearning(profile: StyleProfile,scope?: Scope,now = Date.now()): LearningAnalysis {
  validateProfileEnhancements(profile);
  const originals=selectOriginalPhrases(profile,scope),examples=profile.examples.filter(e => accessible(e,scope));
  const evidence=[...originals.map(p=>({id:`original:${p.id}`,source:'original' as const,text:p.text,scope:p.scope})),...examples.map(e=>({id:`example:${e.id}`,source:'example' as const,text:e.reply,scope:e.scope}))];
  const texts=evidence.map(e=>e.text),sentences=texts.flatMap(t=>t.split(/[。！？.!?\n]+/u).map(s=>s.trim()).filter(Boolean));
  const meanSentenceLength=sentences.length?sentences.reduce((sum,s)=>sum+[...s].length,0)/sentences.length:0;
  const ratio=(pattern:RegExp)=>texts.length?texts.filter(t=>pattern.test(t)).length/texts.length:0;
  const emojiRatio=ratio(/\p{Extended_Pictographic}/u),exclamationRatio=ratio(/[!！]/u),colloquialRatio=ratio(/呀|啦|呢|哈哈|嘿嘿|[～~]/u);
  const suggestions:LearningSuggestion[]=[];
  if(texts.length>=3) {
    suggestions.push({id:'sentence-length',field:'sentenceLength',value:meanSentenceLength<=25?'短句为主，一次表达一个意思':meanSentenceLength<=60?'中等句长，必要时分句说明':'表达较完整，分段说明要点',evidence:`${sentences.length}个句段，平均${Math.round(meanSentenceLength)}字符；仅描述这些确认样本。`});
    suggestions.push({id:'punctuation',field:'punctuation',value:exclamationRatio>=.5?'样本中常用感叹号，按场景适量使用':'少用感叹号，标点自然克制',evidence:`${Math.round(exclamationRatio*100)}%确认样本含感叹号。`});
    suggestions.push({id:'emoji',field:'emoji',value:emojiRatio>=.5?'样本中常用表情，按关系和场景适量使用':emojiRatio>0?'偶尔使用表情，不强行添加':'这些样本未使用表情，默认不添加',evidence:`${Math.round(emojiRatio*100)}%确认样本含图形表情；不能据此推断其他场景。`});
    suggestions.push({id:'tone',field:'tone',value:colloquialRatio>=.5?'口语、轻松，保留本人常用语气词':'少用额外语气词，保留本人原句中的措辞',evidence:`${Math.round(colloquialRatio*100)}%确认样本包含口语语气词；这不是性格或情绪推断。`});
  }
  return {scope:scope?copy(scope):undefined,generatedAt:now,signature:signature(profile,scope),sampleCount:texts.length,originalCount:originals.length,exampleCount:examples.length,
    ignoredCount:(profile.originalPhrases?.length??0)+profile.examples.length-texts.length,
    metrics:{meanSentenceLength,emojiRatio,exclamationRatio,colloquialRatio,replyTiming:timingStatistics(profile,scope,now)},suggestions,evidence:copy(evidence)};
}
export function applyLearningSuggestions(profile: StyleProfile,analysis: LearningAnalysis,ids = analysis.suggestions.map(s=>s.id),now = Date.now()): StyleProfile {
  if(analysis.signature!==signature(profile,analysis.scope)) throw new Error('样本或偏好已变化，请重新分析后应用。');
  const fresh=analyzeLearning(profile,analysis.scope,analysis.generatedAt);
  if(ids.some(id=>!fresh.suggestions.some(s=>s.id===id))) throw new Error('所选风格建议无效。');
  const next=copy(profile);
  for(const s of fresh.suggestions) if(ids.includes(s.id)) next[s.field]=s.value;
  if(ids.length) next.versions=recordProfileVersion(profile,now).versions;
  return next;
}
export interface ReplyDelayResult { delayMs: number; source: ReplyTiming['mode']; sampleCount: number; fallback: boolean }
export function computeReplyDelay(rule: Rule,profile: StyleProfile,scope: Scope,now = Date.now(),random:()=>number = Math.random): ReplyDelayResult {
  validateReplyTiming(rule.replyTiming);validateProfileEnhancements(profile);
  const timing=rule.replyTiming??{mode:'immediate' as const};
  const choose=(min:number,max:number)=>{const value=random();if(!Number.isFinite(value)||value<0||value>1) throw new Error('间隔随机数无效。');return Math.round(min+value*(max-min));};
  if(timing.mode==='immediate') return {delayMs:0,source:timing.mode,sampleCount:0,fallback:false};
  if(timing.mode==='fixed') return {delayMs:timing.delayMs,source:timing.mode,sampleCount:0,fallback:false};
  if(timing.mode==='range') return {delayMs:choose(timing.minMs,timing.maxMs),source:timing.mode,sampleCount:0,fallback:false};
  const stats=timingStatistics(profile,scope,now,timing.relationship);
  if(!stats||stats.count<MIN_LEARNED_TIMING_SAMPLES) return {delayMs:0,source:timing.mode,sampleCount:stats?.count??0,fallback:true};
  const measured=timing.strategy==='median'?stats.medianMs:choose(stats.p25Ms,stats.p75Ms);
  return {delayMs:Math.max(timing.minMs??0,Math.min(timing.maxMs??MAX_REPLY_DELAY_MS,measured)),source:timing.mode,sampleCount:stats.count,fallback:false};
}
export function resolveReplyDelayMs(rule:Rule,profile:StyleProfile,scope:Scope,now=Date.now(),random?:()=>number):number {
  return computeReplyDelay(rule,profile,scope,now,random).delayMs;
}
