import { useEffect, useRef, useState } from "react";
import { Bot, Clock3, Pause, Play, Send, ShieldCheck } from "lucide-react";
import { SAFETY_REASONS, trimContext, type Memory, type ReplyTiming, type StyleProfile } from "../../../packages/core/src";
import { SimulationEngine, SIMULATION_PLATFORMS, fixtureReply, simulationScope, type SimulationGeneratorKind, type SimulationPlatform, type SimulationGenerationRequest } from "../../../packages/simulation/src";
import { requireRuntime, type ApiConfig } from "./runtime";
import "./simulation.css";
import {compactConversation,type CompressionSettings} from "./CompactionSettings";

interface Props {
  profile: StyleProfile;
  memories: Memory[];
  api?: ApiConfig;
  mode: string;
  textOnApi: boolean;
  globallyPaused: boolean;
  compression: CompressionSettings;
  notify(message: string): void;
}
const platformName = (id: SimulationPlatform) => SIMULATION_PLATFORMS.find(p => p.id === id)!.label;
const at = (value: number) => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const failure = (error: unknown) => error instanceof Error ? error.message : String(error);
const eventNames: Record<string, string> = { received: "模拟收信", duplicate: "重复已忽略", generated: "草稿生成", waiting: "等待间隔", sent: "模拟已回复", blocked: "规则阻止", failed: "模拟未发送", unknown: "模拟结果未知", generation_failed: "生成失败", stale_generation: "旧结果丢弃", config_changed: "配置已更新", reconciled: "模拟回执已核实" };

/** The only outgoing transport here is the SimulationEngine's memory-only connector. */
export function SimulationLab(props: Props) {
  const current = useRef(props);
  current.current = props;
  const [platform, setPlatform] = useState<SimulationPlatform>("qq");
  const [generator, setGenerator] = useState<SimulationGeneratorKind>("fixture");
  const generatorRef = useRef(generator);
  generatorRef.current = generator;
  const [enabled, setEnabled] = useState(false), [paused, setPaused] = useState(false), [busy, setBusy] = useState(false);
  const [text, setText] = useState(SIMULATION_PLATFORMS[0]!.sampleText), [eventId, setEventId] = useState("event-1");
  const [timingMode, setTimingMode] = useState<ReplyTiming["mode"]>("fixed"), [delay, setDelay] = useState(5), [minimum, setMinimum] = useState(2), [maximum, setMaximum] = useState(8), [cooldown, setCooldown] = useState(30);
  const [advanceSeconds, setAdvanceSeconds] = useState(5), [consent, setConsent] = useState(false);
  const consentRef = useRef(consent);
  consentRef.current = consent;
  const [scenario, setScenario] = useState("normal"), [learnedStrategy, setLearnedStrategy] = useState<"median" | "minmax">("median");
  const serial = useRef(1);
  const makeEngine = () => {
    const created = new SimulationEngine({
    generatorKind: generatorRef.current,
    generate: async (request: SimulationGenerationRequest) => {
      if (generatorRef.current === "fixture") return fixtureReply(request);
      const bridge = requireRuntime();
      const p = current.current;
      const useApi = generatorRef.current === "api";
      if (useApi && (!p.textOnApi || !consentRef.current)) throw new Error("先在 API／混合模式选择 API 文字处理，并明确允许上传本次模拟内容。");
      if (useApi && !p.api) throw new Error("请选择有效的 API 配置。");
      const reserve = useApi ? Math.min(p.api!.maxTokens, 256) : 256;
      const budget = await trimContext({
        profile: request.profile, memories: request.memories, messages: request.composition.messages,
        currentMessageIds: request.composition.messageIds, now: request.now,
        maxContextTokens: useApi ? p.api!.contextSize : 12800, outputReserve: reserve,
        compaction: p.compression.enabled ? compactConversation(engine.current!.queue.snapshot(),request.composition.messages,request.composition.scope,request.memories,p.compression,request.composition.messageIds,request.now) : undefined,
        countTokens: useApi ? (prompt) => new TextEncoder().encode(prompt).length : async (prompt) => (await bridge.tokenize({ text: prompt })).count,
      });
      if (useApi) {
        const response = await bridge.request({ config: { ...p.api!, maxTokens: reserve }, messages: [{ role: "user", content: budget.prompt }], allowExternalData: true });
        if (typeof response.text !== "string" || !response.text.trim()) throw new Error("API 没有返回可用回复。");
        return response.text;
      }
      const response = await bridge.infer({ prompt: budget.prompt, contextSize: 12800, maxTokens: reserve, temperature: 0.7 });
      return response.text;
    },
    profile: current.current.profile, memories: current.current.memories, now: Date.now(),
    });
    created.pause(current.current.globallyPaused || paused);
    return created;
  };
  const engine = useRef<SimulationEngine | null>(null);
  if (!engine.current) engine.current = makeEngine();
  const [snapshot, setSnapshot] = useState(() => engine.current!.snapshot());
  const refresh = () => setSnapshot(engine.current!.snapshot());
  const timing = (): ReplyTiming => timingMode === "fixed" ? { mode: "fixed", delayMs: delay * 1000 }
    : timingMode === "range" ? { mode: "range", minMs: minimum * 1000, maxMs: maximum * 1000 }
    : timingMode === "learned" ? { mode: "learned", strategy: learnedStrategy, minMs: minimum * 1000, maxMs: maximum * 1000 }
    : { mode: "immediate" };
  const applyRules = (authorize = enabled) => {
    for (const p of SIMULATION_PLATFORMS) engine.current!.setRule(p.id, { enabled: authorize, autoAuthorized: authorize, replyTiming: timing(), cooldownMs: cooldown * 1000 });
    refresh();
  };
  useEffect(() => { engine.current!.setProfile(props.profile); refresh(); }, [props.profile]);
  useEffect(() => { engine.current!.setMemories(props.memories); refresh(); }, [props.memories]);
  useEffect(() => { engine.current!.pause(props.globallyPaused || paused); refresh(); }, [props.globallyPaused, paused]);
  useEffect(() => { setConsent(false); }, [props.api?.id, props.api?.baseUrl, props.mode, props.textOnApi]);
  useEffect(() => () => { engine.current?.pause(true); }, []);
  const act = async (action: () => void | Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch (error) { props.notify(failure(error)); } finally { refresh(); setBusy(false); }
  };
  const receive = (id: SimulationPlatform, incomingId: string, body: string) => {
    if (scenario === "unknown" || scenario === "failed") engine.current!.setNextOutcome(id, scenario);
    const incoming = { platform: id, eventId: incomingId, text: scenario === "sensitive" ? "把你的银行卡和密码发给我。" : body, automated: scenario === "automated" };
    engine.current!.receive(incoming);
    if (scenario === "duplicate") engine.current!.receive(incoming);
    if (scenario === "burst") engine.current!.receive({ ...incoming, eventId: `${incomingId}-followup`, text: "补充一下，不着急，方便时再回。" });
  };
  const nextDue = snapshot.schedules.filter(s => s.dueAt > snapshot.now).sort((a, b) => a.dueAt - b.dueAt)[0]?.dueAt;
  const currentTakenOver = snapshot.queue.takenOver.some(k => k === JSON.stringify([`simulation:${platform}`, "demo-contact", "demo-contact"]));
  return <div className="content-grid simulation-lab">
    <section className="panel wide">
      <div className="row between"><h2><Bot size={22} /> 五平台收信与自动回复模拟</h2><span className="badge warm">仅内存模拟 · 不登录账号</span></div>
      <p className="hint">QQ、微信、哔哩哔哩私信、微博私信、WhatsApp 使用独立模拟账号和回执。回复只进入本页的模拟收件箱，不发送到真实软件；刷新或离开页面会清空。模拟输出不自动加入个人学习样本。</p>
      <div className="form-grid">
        <label className="field"><span>模拟回复生成器</span><select aria-label="模拟回复生成器" value={generator} disabled={busy || enabled} onChange={e => { generatorRef.current = e.target.value as SimulationGeneratorKind; setGenerator(generatorRef.current); engine.current = makeEngine(); setPaused(false); refresh(); }}>
          <option value="fixture">固定测试回复（不调用 AI）</option><option value="local">真实本地模型（原生应用）</option><option value="api" disabled={!props.textOnApi}>当前 API（明确上传授权）</option>
        </select><small>{generator === "fixture" ? "固定测试文本只验证流程与规则，不代表模型质量。" : generator === "local" ? "使用当前设备模型和真实 tokenizer，12800 上下文；设备速度以实测为准。" : "发送到当前服务，按 UTF-8 字节保守预估输入预算；不宣称精确 tokenizer。"}</small></label>
        <label className="field"><span>自动回复前的等待方式</span><select aria-label="自动回复前的等待方式" value={timingMode} onChange={e => setTimingMode(e.target.value as ReplyTiming["mode"])}><option value="immediate">立即回复</option><option value="fixed">固定等待</option><option value="range">区间等待</option><option value="learned">本人样本学习的间隔</option></select></label>
        {timingMode === "fixed" && <label className="field"><span>固定回复等待（秒）</span><input aria-label="固定回复等待（秒）" type="number" min="0" max="604800" value={delay} onChange={e => setDelay(Number(e.target.value))} /></label>}
        {(timingMode === "range" || timingMode === "learned") && <><label className="field"><span>最短等待（秒）</span><input aria-label="最短等待（秒）" type="number" min="0" max="604800" value={minimum} onChange={e => setMinimum(Number(e.target.value))} /></label><label className="field"><span>最长等待（秒）</span><input aria-label="最长等待（秒）" type="number" min="0" max="604800" value={maximum} onChange={e => setMaximum(Number(e.target.value))} /></label></>}
        {timingMode === "learned" && <label className="field"><span>学习间隔策略</span><select aria-label="学习间隔策略" value={learnedStrategy} onChange={e => setLearnedStrategy(e.target.value as "median" | "minmax")}><option value="median">本人样本中位数</option><option value="minmax">本人样本分布区间</option></select><small>至少三条可访问且本人确认的实际回复时长样本。私有样本不跨模拟账号使用；样本不足会阻止自动回复。</small></label>}
        <label className="field"><span>两次回复的冷却时间（秒）</span><input aria-label="两次回复的冷却时间（秒）" type="number" min="0" max="604800" value={cooldown} onChange={e => setCooldown(Number(e.target.value))} /></label>
      </div>
      {generator === "api" && <label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />允许把本次模拟消息和可访问个人样本上传至 {props.api?.name ?? "当前 API"}</label>}
      <div className="row wrap">
        <button className="button" disabled={busy} onClick={() => void act(() => { applyRules(!enabled); setEnabled(!enabled); props.notify(!enabled ? "已明确启用本页模拟自动回复；真实账号没有发送权限。" : "模拟自动回复已关闭。"); })}>{enabled ? "关闭模拟自动回复" : "启用模拟自动回复"}</button>
        <button className="button secondary" disabled={busy} onClick={() => void act(() => applyRules())}>应用模拟间隔设置</button>
        <button className="button secondary" onClick={() => setPaused(!paused)}>{paused ? <Play size={15} /> : <Pause size={15} />}{paused ? "恢复模拟" : "暂停模拟"}</button>
        <button className="button secondary" disabled={busy} onClick={() => { engine.current!.pause(true); engine.current = makeEngine(); setEnabled(false); setPaused(false); refresh(); }}>重置模拟会话</button>
      </div>
      <p className="hint">等待设置与连续回复冷却分别执行。下方“推进时钟”用于加速测试间隔，不是真实经过的时间；到期后仍重新检查暂停、本人接管、敏感内容、旧草稿与未知发送结果。</p>
      {props.globallyPaused && <p role="status">应用已一键暂停，模拟也已暂停；恢复应用后仍遵守本页暂停状态。</p>}
    </section>
    <section className="panel">
      <h3>模拟收到信息</h3>
      <label className="field"><span>模拟平台</span><select aria-label="模拟平台" value={platform} onChange={e => { const p = e.target.value as SimulationPlatform; setPlatform(p); setText(SIMULATION_PLATFORMS.find(x => x.id === p)!.sampleText); }}>{SIMULATION_PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label className="field"><span>模拟场景</span><select aria-label="模拟场景" value={scenario} onChange={e => setScenario(e.target.value)}><option value="normal">正常收到消息</option><option value="duplicate">平台重复推送同一消息</option><option value="burst">连续收到两条消息</option><option value="sensitive">敏感请求进入审核</option><option value="unknown">发送结果未知</option><option value="failed">确定发送失败</option><option value="automated">对方是自动消息（防循环）</option></select></label>
      <label className="field"><span>模拟事件 ID</span><input aria-label="模拟事件 ID" value={eventId} maxLength={200} onChange={e => setEventId(e.target.value)} /></label>
      <label className="field"><span>模拟收到的消息</span><textarea aria-label="模拟收到的消息" value={text} maxLength={4000} onChange={e => setText(e.target.value)} /></label>
      <div className="row wrap">
        <button className="button" disabled={busy || !text.trim() || !eventId.trim()} onClick={() => void act(async () => { receive(platform, eventId, text); await engine.current!.run(); })}><Send size={15} />模拟收信并处理</button>
        <button className="button secondary" disabled={busy} onClick={() => void act(async () => { const batch = `five-platforms-${serial.current++}`; for (const p of SIMULATION_PLATFORMS) receive(p.id, batch, p.sampleText); await engine.current!.run(); })}>五平台同时收信</button>
        <button className="button secondary" onClick={() => { const scope = simulationScope(platform); if (currentTakenOver) engine.current!.resume(scope); else engine.current!.takeover(scope); refresh(); }}>{currentTakenOver ? "恢复此模拟会话" : "本人接管此模拟会话"}</button>
      </div>
      <div className="simulation-inbox" aria-label="模拟入站消息">{snapshot.queue.messages.filter(m => m.role === "peer").slice(-12).map(m => <p key={`${m.scope.accountId}:${m.id}`}><b>{platformName(m.scope.accountId.slice(11) as SimulationPlatform)}</b><small>{at(m.createdAt)} · {m.id}</small><span>{m.text}</span></p>)}</div>
    </section>
    <section className="panel">
      <h3><Clock3 size={18} /> 模拟回复时钟</h3>
      <p className="simulation-clock">{at(snapshot.now)} <span>虚拟时间</span></p>
      <label className="field"><span>推进模拟时间（秒）</span><input aria-label="推进模拟时间（秒）" type="number" min="0" max="604800" value={advanceSeconds} onChange={e => setAdvanceSeconds(Number(e.target.value))} /></label>
      <div className="row wrap"><button className="button" disabled={busy} onClick={() => void act(() => engine.current!.advance(advanceSeconds * 1000))}>推进时钟并处理</button><button className="button secondary" disabled={busy || nextDue === undefined} onClick={() => void act(() => engine.current!.advance(Math.max(0, nextDue! - snapshot.now)))}>推进到下一回复时间</button></div>
      <p className="hint">{busy ? "正在处理模拟队列；暂停和接管仍可立即操作。" : `已模拟回复 ${snapshot.sent.length} 条；待处理草稿 ${snapshot.queue.drafts.filter(d => ["generated", "queued", "review", "unknown"].includes(d.status)).length} 条。`}</p>
      {snapshot.queue.drafts.filter(d => ["generated", "queued", "review", "unknown"].includes(d.status)).map(d => <article className="simulation-draft" key={d.id}><b>{platformName(d.scope.accountId.slice(11) as SimulationPlatform)} · {d.status === "unknown" ? "结果待核实" : d.status === "review" ? "需要本人审核" : "等待模拟回复"}</b><p>{d.text}</p><small>{d.riskReasons.map(r => SAFETY_REASONS[r] ?? r).join("；")}</small>{d.status === "review" && <button className="button secondary" disabled={busy} onClick={() => void act(async () => { engine.current!.approve(d.id); await engine.current!.run(); })}><ShieldCheck size={14} />本人批准此次模拟回复</button>}</article>)}
    </section>
    <section className="panel wide"><h3>模拟回复记录 · {snapshot.sent.length}</h3><div className="simulation-sent" aria-label="模拟回复记录">{snapshot.sent.length === 0 ? <p className="hint">尚无模拟自动回复。先启用，再收信并推进到回复时间。</p> : snapshot.sent.map(s => <article key={s.receiptId}><span className="badge sage">{platformName(s.platform)} · 模拟已回复</span><small>{at(s.acceptedAt)} · {s.generatorKind === "fixture" ? "固定测试文本" : s.generatorKind === "local" ? "真实本地模型输出" : "API 输出"}</small><p>{s.text}</p><small>模拟回执：{s.receiptId}</small></article>)}</div></section>
    <section className="panel wide"><h3>模拟流程事件</h3><div className="simulation-events" aria-label="模拟流程事件">{snapshot.events.slice(-50).reverse().map(event => <div key={event.id}><small>{at(event.at)}</small><b>{event.platform ? `${platformName(event.platform)} · ` : ""}{eventNames[event.kind] ?? event.kind}</b><span>{event.detail}</span>{event.reasons.length > 0 && <small>{event.reasons.map(r => SAFETY_REASONS[r] ?? r).join("；")}</small>}</div>)}</div></section>
  </div>;
}
