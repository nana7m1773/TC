import { useEffect, useState, cloneElement, isValidElement, type ReactNode, type ReactElement } from "react";
import { BookOpen, Check, Clock3, FileText, LockKeyhole, SlidersHorizontal, Sparkles } from "lucide-react";
import {
  addOriginalPhrases,
  analyzeLearning,
  applyLearningSuggestions,
  deleteOriginalPhrase,
  recordProfileVersion,
  resolveLearningOptions,
  rollbackProfile,
  sameScope,
  type LearningOptions,
  type PersonalOriginal,
  type Scope,
  type StyleProfile,
} from "../../../packages/core/src";
import "./learning.css";

type LearningAnalysis = ReturnType<typeof analyzeLearning>;
type AdvancedStyle = Pick<StyleProfile, "formality" | "addressing" | "directness" | "paragraphing" | "replyLanguage">;

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const control = isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { "aria-label": label }) : children;
  return <label className="field"><span>{label}</span>{control}{hint && <small>{hint}</small>}</label>;
}
function Action({ children, onClick, disabled, secondary = false }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; secondary?: boolean;
}) {
  return <button className={`button ${secondary ? "secondary" : ""}`} disabled={disabled} onClick={onClick}>{children}</button>;
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function advancedStyle(profile: StyleProfile): AdvancedStyle {
  return { formality: profile.formality ?? "", addressing: profile.addressing ?? "", directness: profile.directness ?? "", paragraphing: profile.paragraphing ?? "", replyLanguage: profile.replyLanguage ?? "跟随对方消息语言" };
}
function localDateTime(at: number): string {
  const date = new Date(at);
  return new Date(at - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function duration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} 分钟`;
  return `${(ms / 3_600_000).toFixed(1)} 小时`;
}
function tagsFrom(text: string): string[] {
  return [...new Set(text.split(/[，,\n]/).map(value => value.trim()).filter(Boolean))];
}
const suggestionLabels = { sentenceLength: "句子长度", punctuation: "标点习惯", emoji: "表情习惯", tone: "表达基调" };

/** Only explicit personal inputs reach the shared retrieval/profile layer; this component performs no model training. */
export function LearningSettings({ profile, setProfile, scope, notify }: {
  profile: StyleProfile; setProfile: (profile: StyleProfile) => void; scope: Scope; notify: (message: string) => void;
}) {
  const [batch, setBatch] = useState("");
  const [relationship, setRelationship] = useState("");
  const [tags, setTags] = useState("");
  const [originalConfirmed, setOriginalConfirmed] = useState(false);
  const [shareOriginal, setShareOriginal] = useState(false);
  const [editing, setEditing] = useState<PersonalOriginal | null>(null);
  const [learning, setLearning] = useState<LearningOptions>(() => resolveLearningOptions(profile));
  const [style, setStyle] = useState<AdvancedStyle>(() => advancedStyle(profile));
  const [received, setReceived] = useState("");
  const [reply, setReply] = useState("");
  const [sampleNote, setSampleNote] = useState("");
  const [sampleRelationship, setSampleRelationship] = useState("");
  const [sampleTags, setSampleTags] = useState("");
  const [receivedTime, setReceivedTime] = useState(() => localDateTime(Date.now() - 60_000));
  const [replySeconds, setReplySeconds] = useState("");
  const [sampleConfirmed, setSampleConfirmed] = useState(false);
  const [shareSample, setShareSample] = useState(false);
  const [analysis, setAnalysis] = useState<LearningAnalysis | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);

  useEffect(() => {
    setLearning(resolveLearningOptions(profile));
    setStyle(advancedStyle(profile));
    // A preview belongs to the exact confirmed data from which it was calculated.
    setAnalysis(null);
    setSelectedSuggestions([]);
  }, [profile]);
  useEffect(() => {
    setAnalysis(null);
    setSelectedSuggestions([]);
    setEditing(null);
    setBatch("");
    setOriginalConfirmed(false);
    setShareOriginal(false);
    setSampleConfirmed(false);
    setShareSample(false);
  }, [scope.accountId, scope.conversationId, scope.contactId]);

  const originals = (profile.originalPhrases ?? []).filter(original => original.shareable === true || (original.scope && sameScope(original.scope, scope)));
  const examples = profile.examples.filter(example => !example.scope || example.shareable === true || sameScope(example.scope, scope));
  const batchLines = batch.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const secondsValid = replySeconds === "" || (Number.isFinite(Number(replySeconds)) && Number(replySeconds) >= 0 && Number(replySeconds) <= 2_592_000);
  const scopeLabel = `${scope.accountId} / ${scope.conversationId}${scope.contactId ? ` / ${scope.contactId}` : ""}`;

  function saveOriginals() {
    try {
      if (!originalConfirmed) throw new Error("请先确认这些原句确实出自本人。 ");
      if (!batchLines.length) throw new Error("请至少填写一句本人原话。");
      if (batchLines.length > 200) throw new Error("每批最多导入 200 句，请分批保存。");
      if (editing && batchLines.length !== 1) throw new Error("编辑原句时只能填写一行；批量添加请先取消编辑。");
      const now = Date.now();
      const additions: PersonalOriginal[] = batchLines.map(text => ({
        id: editing?.id ?? crypto.randomUUID(), text, source: "self", confirmed: true,
        scope: editing?.scope ?? { ...scope }, shareable: shareOriginal,
        relationship: relationship.trim() || undefined, tags: tagsFrom(tags), createdAt: editing?.createdAt ?? now,
      }));
      setProfile(addOriginalPhrases(profile, additions, now));
      setBatch(""); setEditing(null); setOriginalConfirmed(false); setShareOriginal(false);
      notify(editing ? "本人原句已更新；保存了可回滚版本。" : `已保存 ${additions.length} 句本人原话；${shareOriginal ? "仅这些原句已明确允许跨会话使用" : "默认仅用于当前会话"}。`);
    } catch (error) { notify(errorText(error)); }
  }

  function saveOptions() {
    try {
      const next = { ...profile, learning, ...style, versions: recordProfileVersion(profile).versions };
      // This resolver validates counts/weights before they can reach prompt retrieval.
      resolveLearningOptions(next);
      setProfile(next);
      notify("学习检索配置与扩展风格已保存；没有改动其他表达、判断原则或模型权重。");
    } catch (error) { notify(errorText(error)); }
  }

  function saveSample() {
    try {
      if (!sampleConfirmed || !received.trim() || !reply.trim()) throw new Error("请填写收到的消息及本人真实回复，并明确确认来源。");
      if (!secondsValid) throw new Error("实际回复间隔需在 0 到 2,592,000 秒之间，或留空。");
      const receivedAt = replySeconds === "" ? undefined : new Date(receivedTime).getTime();
      if (receivedAt !== undefined && !Number.isFinite(receivedAt)) throw new Error("有间隔记录时必须填写有效的收到时间。");
      const repliedAt = receivedAt === undefined ? undefined : receivedAt + Number(replySeconds) * 1000;
      if (repliedAt !== undefined && repliedAt > Date.now() + 60_000) throw new Error("请填写过去实际发生的收到时间与回复间隔，不能把未来计划当作本人记录。");
      const next: StyleProfile = {
        ...profile, versions: recordProfileVersion(profile).versions,
        examples: [...profile.examples, {
          id: crypto.randomUUID(), received: received.trim(), reply: reply.trim(), note: sampleNote.trim(),
          confirmed: true, origin: "self", scope: { ...scope }, shareable: shareSample,
          relationship: sampleRelationship.trim() || undefined, tags: tagsFrom(sampleTags), receivedAt, repliedAt,
        }],
      };
      setProfile(next);
      setReceived(""); setReply(""); setSampleNote(""); setReplySeconds(""); setSampleConfirmed(false); setShareSample(false);
      notify("本人确认的真实回复样本已保存；间隔仅作为统计证据，不会自动开启发送或改写发送规则。");
    } catch (error) { notify(errorText(error)); }
  }

  function previewAnalysis() {
    try {
      const result = analyzeLearning(profile, scope);
      setAnalysis(result);
      // Filled fields are left unselected, so an existing personal preference stays intact unless explicitly chosen.
      setSelectedSuggestions(result.suggestions.filter(suggestion => !profile[suggestion.field]?.trim()).map(suggestion => suggestion.id));
      notify("已生成可审阅的样本统计和风格建议；尚未修改个人档案。");
    } catch (error) { notify(errorText(error)); }
  }

  return <div className="content-grid learning-settings" data-testid="learning-settings">
    <section className="panel wide">
      <div className="learning-intro">
        <BookOpen size={23} />
        <div>
          <h3>本人表达学习</h3>
          <p>将你确认过的原句与真实回复作为检索示例，并统计可审阅的表达习惯。对方的话、模拟回复和未经确认的 AI 草稿不会自动成为你的表达证据；这项功能不训练模型权重。</p>
        </div>
      </div>
      <div className="learning-actions"><span className="learning-scope"><LockKeyhole size={12} />当前会话：{scopeLabel}</span></div>
    </section>

    <section className="panel" data-testid="original-input-panel">
      <div className="learning-heading"><h3>{editing ? "编辑本人原句" : "添加更多本人原句"}</h3><FileText size={18} /></div>
      <Field label="本人原句（每行一句）" hint="保持你实际说过的措辞；一批最多 200 句。">
        <textarea value={batch} onChange={event => setBatch(event.target.value)} placeholder="好呀，我看一下时间再告诉你。&#10;谢谢提醒，我晚点处理。" />
      </Field>
      <div className="form-grid">
        <Field label="原句适用关系"><input value={relationship} onChange={event => setRelationship(event.target.value)} placeholder="如：朋友、家人、同事" /></Field>
        <Field label="原句场景标签（逗号分隔）"><input value={tags} onChange={event => setTags(event.target.value)} placeholder="如：邀约、婉拒、工作沟通" /></Field>
      </div>
      <label className="check-field"><input type="checkbox" checked={originalConfirmed} onChange={event => setOriginalConfirmed(event.target.checked)} />我确认这些原句出自本人，且有权使用</label>
      <label className="check-field"><input type="checkbox" checked={shareOriginal} onChange={event => setShareOriginal(event.target.checked)} />我明确允许这些原句跨联系人／会话使用</label>
      <div className="learning-actions">
        <Action disabled={!originalConfirmed || !batchLines.length} onClick={saveOriginals}><Check size={14} />{editing ? "确认并更新本人原句" : "确认并保存本人原句"}</Action>
        {editing && <Action secondary onClick={() => { setEditing(null); setBatch(""); setOriginalConfirmed(false); setShareOriginal(false); }}>取消编辑原句</Action>}
      </div>
      <p className="learning-limit-note">默认保存到当前账号、会话和联系人；只有勾选共享的条目可跨会话使用。每句是否进入实际提示词还取决于检索相关性、数量上限及完整上下文预算。</p>
    </section>

    <section className="panel" data-testid="original-list-panel">
      <h3>当前可管理的本人原句 · {originals.length}</h3>
      <div className="learning-list">
        {originals.map(original => <article className="learning-quote" key={original.id} data-testid="personal-original">
          <blockquote>{original.text}</blockquote>
          <small>{original.relationship || "未限定关系"} · {original.tags?.join(" / ") || "未限定场景"}</small>
          <small>{original.confirmed ? "本人已确认" : "待本人确认"} · {original.shareable ? "本人明确允许跨会话使用" : "仅当前会话"}{original.source === "generated" ? " · 生成内容不会作为学习证据" : ""}</small>
          <div className="row">
            <button className="text-button" aria-label={`编辑原句：${original.text}`} onClick={() => {
              setEditing(original); setBatch(original.text); setRelationship(original.relationship ?? ""); setTags(original.tags?.join(", ") ?? ""); setShareOriginal(original.shareable); setOriginalConfirmed(false);
            }}>编辑原句</button>
            <button className="text-button" aria-label={`删除原句：${original.text}`} onClick={() => {
              try { setProfile(deleteOriginalPhrase(profile, original.id)); if (editing?.id === original.id) { setEditing(null); setBatch(""); } notify("已删除原句；可从历史版本恢复。"); }
              catch (error) { notify(errorText(error)); }
            }}>删除原句</button>
          </div>
        </article>)}
        {!originals.length && <p className="learning-caption">当前会话尚无本人原句。其他联系人的私有原句不会显示在这里。</p>}
      </div>
    </section>

    <section className="panel wide" data-testid="learning-config-panel">
      <div className="learning-heading"><h3>学习检索与扩展回复风格</h3><SlidersHorizontal size={19} /></div>
      <p className="learning-caption">检索优先选择与当前消息相关的本人样本，再结合近期偏好；仍受会话隔离与 12,800 tokens 完整预算约束。</p>
      <div className="form-grid">
        <label className="check-field"><input type="checkbox" checked={learning.examplesEnabled} onChange={event => setLearning({ ...learning, examplesEnabled: event.target.checked })} />使用已确认回复示例检索</label>
        <label className="check-field"><input type="checkbox" checked={learning.originalsEnabled} onChange={event => setLearning({ ...learning, originalsEnabled: event.target.checked })} />使用已确认本人原句检索</label>
        <Field label="每次最多引用回复示例（0–12）"><input type="number" min="0" max="12" step="1" value={learning.exampleLimit} onChange={event => setLearning({ ...learning, exampleLimit: Number(event.target.value) })} /></Field>
        <Field label="每次最多引用本人原句（0–12）"><input type="number" min="0" max="12" step="1" value={learning.originalLimit} onChange={event => setLearning({ ...learning, originalLimit: Number(event.target.value) })} /></Field>
        <Field label="近期样本偏好（0–1）" hint="0 表示不加近期权重；相关性仍参与排序。"><input type="number" min="0" max="1" step="0.05" value={learning.recentBias} onChange={event => setLearning({ ...learning, recentBias: Number(event.target.value) })} /></Field>
        <Field label="正式程度"><input value={style.formality} onChange={event => setStyle({ ...style, formality: event.target.value })} placeholder="如：朋友随意，同事礼貌但不套话" /></Field>
        <Field label="称呼习惯"><input value={style.addressing} onChange={event => setStyle({ ...style, addressing: event.target.value })} placeholder="如：不用亲昵称呼；工作中叫名字" /></Field>
        <Field label="直接程度"><input value={style.directness} onChange={event => setStyle({ ...style, directness: event.target.value })} placeholder="如：先答问题；不同意时明确但友善" /></Field>
        <Field label="分段与回复结构"><input value={style.paragraphing} onChange={event => setStyle({ ...style, paragraphing: event.target.value })} placeholder="如：一到两段，先结论再解释" /></Field>
        <Field label="回复语言偏好" hint="默认跟随收到消息的语言，也可明确指定中文／英文等。"><input value={style.replyLanguage} onChange={event => setStyle({ ...style, replyLanguage: event.target.value })} /></Field>
      </div>
      <Action onClick={saveOptions}><Check size={14} />保存学习配置与扩展风格</Action>
    </section>

    <section className="panel" data-testid="timed-example-panel">
      <div className="learning-heading"><h3>记录本人真实回复与间隔</h3><Clock3 size={18} /></div>
      <Field label="实际收到的消息"><textarea value={received} onChange={event => setReceived(event.target.value)} /></Field>
      <Field label="本人实际回复原文"><textarea value={reply} onChange={event => setReply(event.target.value)} /></Field>
      <div className="form-grid">
        <Field label="收到消息的时间"><input type="datetime-local" value={receivedTime} onChange={event => setReceivedTime(event.target.value)} /></Field>
        <Field label="实际本人回复间隔（秒）" hint="留空仅保存表达样本；不猜测缺失时间。"><input type="number" min="0" max="2592000" value={replySeconds} onChange={event => setReplySeconds(event.target.value)} /></Field>
        <Field label="回复样本适用关系"><input value={sampleRelationship} onChange={event => setSampleRelationship(event.target.value)} placeholder="如：朋友" /></Field>
        <Field label="回复样本场景标签（逗号分隔）"><input value={sampleTags} onChange={event => setSampleTags(event.target.value)} placeholder="如：确认安排" /></Field>
      </div>
      <Field label="此回复的判断理由"><input value={sampleNote} onChange={event => setSampleNote(event.target.value)} placeholder="只填写你本人认可的理由" /></Field>
      <label className="check-field"><input type="checkbox" checked={sampleConfirmed} onChange={event => setSampleConfirmed(event.target.checked)} />我确认这是本人实际回复，时间与间隔为实际记录</label>
      <label className="check-field"><input type="checkbox" checked={shareSample} onChange={event => setShareSample(event.target.checked)} />我明确允许这个真实回复样本跨会话使用</label>
      <Action disabled={!sampleConfirmed || !received.trim() || !reply.trim() || !secondsValid} onClick={saveSample}><Check size={14} />确认并保存真实回复样本</Action>
      <p className="learning-limit-note">时间统计只描述这些已确认样本，不代表发送承诺。建议间隔需要你在联系人规则中另行设置；自动发送仍需真实连接器与显式授权。</p>
    </section>

    <section className="panel" data-testid="timed-example-list-panel">
      <h3>本会话可用的回复样本 · {examples.length}</h3>
      <div className="learning-list">
        {examples.slice(-20).reverse().map(example => <article className="learning-evidence" key={example.id} data-testid="timed-example">
          <small>收到：{example.received}</small>
          <p>{example.reply}</p>
          <small>{example.relationship || "未限定关系"} · {example.tags?.join(" / ") || "未限定场景"} · {example.shareable ? "明确共享" : example.scope ? "仅本会话" : "早期全局样本"}</small>
          <small>{example.confirmed ? "本人已确认" : "尚未确认"}{example.receivedAt !== undefined && example.repliedAt !== undefined ? ` · 实际记录间隔 ${duration(example.repliedAt - example.receivedAt)}` : " · 无有效间隔记录"}</small>
        </article>)}
        {!examples.length && <p className="learning-caption">确认自己的真实回复后，再生成统计与建议。</p>}
        {examples.length > 20 && <small>此处展示最近 20 条；统计会检查本会话全部合格样本。</small>}
      </div>
    </section>

    <section className="panel wide" data-testid="learning-analysis-panel">
      <div className="learning-heading"><h3>从确认样本分析表达习惯</h3><Sparkles size={19} /></div>
      <p className="learning-caption">这是对本人已确认样本的本地统计，不调用 AI，不推断人格。点击分析只生成预览；应用前可查看原句证据和选中的修改。</p>
      <Action secondary onClick={previewAnalysis}>分析已确认的本人样本</Action>
      {analysis && <div data-testid="learning-analysis-result">
        <div className="learning-stats">
          <div className="learning-stat"><b>{analysis.sampleCount}</b><small>合格表达样本</small></div>
          <div className="learning-stat"><b>{analysis.originalCount} / {analysis.exampleCount}</b><small>本人原句 / 回复示例</small></div>
          <div className="learning-stat"><b>{Math.round(analysis.metrics.meanSentenceLength)}</b><small>平均句子字符长度</small></div>
          <div className="learning-stat"><b>{analysis.metrics.replyTiming ? duration(analysis.metrics.replyTiming.medianMs) : "暂无记录"}</b><small>本人回复间隔中位数</small></div>
        </div>
        {analysis.sampleCount < 3 && <div className="learning-pending">样本不足：当前只有 {analysis.sampleCount} 条合格样本，建议补充不同场景的本人表达。这些统计不能代表稳定的个人习惯。</div>}
        {analysis.metrics.replyTiming ? <p className="learning-caption" data-testid="reply-timing-summary">
          回复间隔来自 {analysis.metrics.replyTiming.count} 条实际时间记录：中位数 {duration(analysis.metrics.replyTiming.medianMs)}；中间 50% 为 {duration(analysis.metrics.replyTiming.p25Ms)} 至 {duration(analysis.metrics.replyTiming.p75Ms)}；最短 {duration(analysis.metrics.replyTiming.minMs)}，最长 {duration(analysis.metrics.replyTiming.maxMs)}。样本不足时仅作为这些记录的描述，不会自动修改发送设置。
        </p> : <p className="learning-caption">没有合格的本人回复时间记录；系统不会根据消息内容猜测回复间隔。</p>}
        {analysis.ignoredCount > 0 && <p className="learning-caption">排除了 {analysis.ignoredCount} 条未确认、生成来源或不属于此会话的内容。</p>}
        <div className="learning-suggestions">
          <strong style={{ fontSize: 12, color: "#627d55" }}>可审阅风格建议 · 尚未应用</strong>
          <p className="learning-caption">应用会替换勾选字段；已填写的偏好默认不选中，其他编辑内容与判断原则保持原值。</p>
          {analysis.suggestions.map(suggestion => <div key={suggestion.id}>
            <label className="check-field"><input type="checkbox" aria-label={`应用建议：${suggestionLabels[suggestion.field]}`} checked={selectedSuggestions.includes(suggestion.id)} onChange={event => setSelectedSuggestions(event.target.checked ? [...selectedSuggestions, suggestion.id] : selectedSuggestions.filter(id => id !== suggestion.id))} />{suggestionLabels[suggestion.field]}：{suggestion.value}</label>
            <small>{suggestion.evidence}</small>
          </div>)}
          {!analysis.suggestions.length && <p className="learning-caption">当前没有可应用的风格建议；先补充本人确认的样本。</p>}
          <div className="learning-actions"><Action disabled={!selectedSuggestions.length} onClick={() => {
            try { setProfile(applyLearningSuggestions(profile, analysis, selectedSuggestions)); notify("仅已勾选的风格建议已应用；已保存应用前版本，可审阅并回滚。"); }
            catch (error) { notify(errorText(error)); }
          }}>应用勾选的风格建议</Action></div>
        </div>
        <details open><summary>查看本人样本证据 · {analysis.evidence.length}</summary>
          <div className="learning-list">{analysis.evidence.map(evidence => <article className="learning-evidence" key={evidence.id}>
            <small>{evidence.source === "original" ? "本人原句" : "本人回复示例"} · {evidence.scope ? `${evidence.scope.accountId} / ${evidence.scope.conversationId}` : "全局确认样本"}</small>
            <p>{evidence.text}</p>
          </article>)}</div>
        </details>
      </div>}
    </section>

    <section className="panel wide" data-testid="learning-version-panel">
      <h3>审阅并回滚学习变更</h3>
      <p className="learning-caption">以下保存的是变更前档案。恢复将同时还原该版本的个人原句、学习配置和风格，当前状态也会保存为可回滚版本。</p>
      {profile.versions.slice(-6).reverse().map(version => <details key={version.id}>
        <summary>{new Date(version.createdAt).toLocaleString("zh-CN")} · 原句 {version.profile.originalPhrases?.length ?? 0} · 回复示例 {version.profile.examples.length}</summary>
        <p className="learning-caption">表达基调：{version.profile.tone}<br />正式程度：{version.profile.formality || "未设置"}；直接程度：{version.profile.directness || "未设置"}<br />原句检索上限：{resolveLearningOptions(version.profile).originalLimit}；回复示例上限：{resolveLearningOptions(version.profile).exampleLimit}</p>
        <Action secondary onClick={() => { try { setProfile(rollbackProfile(profile, version.id)); notify("已恢复选定档案版本，当前状态已保留为新历史版本。"); } catch (error) { notify(errorText(error)); } }}>恢复此学习版本</Action>
      </details>)}
      {!profile.versions.length && <p className="learning-caption">保存原句、配置或应用建议后，可在这里审阅历史版本。</p>}
    </section>
  </div>;
}
