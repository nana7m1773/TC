import {
  QueueEngine, createDefaultProfile, createDefaultRule, sameScope, scopeKey,
  type Composition, type Draft, type Memory, type MessageKind, type QueueState, type Rule,
  type Scope, type StyleProfile,
} from '../../core/src';

/** These adapters have no credentials, sockets or real social-platform transport. */
export type SimulationPlatform = 'qq' | 'wechat' | 'bilibili' | 'weibo' | 'whatsapp';
export type SimulationGeneratorKind = 'fixture' | 'local' | 'api';
export const SIMULATION_PLATFORMS: ReadonlyArray<{
  id: SimulationPlatform; label: string; sampleText: string;
}> = [
  { id: 'qq', label: 'QQ', sampleText: '周末一起吃个饭？' },
  { id: 'wechat', label: '微信', sampleText: '最近忙吗？有空聊聊。' },
  { id: 'bilibili', label: '哔哩哔哩私信', sampleText: '你分享的视频很有意思，谢谢！' },
  { id: 'weibo', label: '微博私信', sampleText: '看到你发的照片了，拍得很好。' },
  { id: 'whatsapp', label: 'WhatsApp', sampleText: 'Hi! Are you free to chat this weekend?' },
];
export const SIMULATION_CAPABILITY = Object.freeze({ transport: 'simulation' as const, canSend: true, realPlatform: false });
export interface SimulatedInboundEvent {
  platform: SimulationPlatform; eventId: string; text: string;
  conversationId?: string; senderId?: string; kind?: MessageKind; createdAt?: number;
  direction?: 'incoming' | 'self'; automated?: boolean; attachmentConfirmed?: boolean; analysisText?: string;
}
export interface SimulationGenerationRequest {
  composition: Composition; platform: SimulationPlatform; profile: StyleProfile; memories: Memory[]; now: number;
}
export type SimulationGenerate = (request: SimulationGenerationRequest) => string | Promise<string>;
export interface SimulationSentRecord {
  transport: 'simulation'; platform: SimulationPlatform; draftId: string; receiptId: string;
  messageIds: string[]; scope: Scope; text: string; acceptedAt: number; generatorKind: SimulationGeneratorKind;
}
export type SimulationEventKind = 'received' | 'duplicate' | 'generated' | 'waiting' | 'sent' | 'blocked'
  | 'failed' | 'unknown' | 'generation_failed' | 'stale_generation' | 'config_changed' | 'reconciled';
export interface SimulationLogEvent {
  id: string; at: number; kind: SimulationEventKind; platform?: SimulationPlatform; draftId?: string;
  messageIds: string[]; reasons: string[]; detail: string; dueAt?: number;
}
export interface SimulationSnapshot {
  transport: 'simulation'; now: number; generatorKind: SimulationGeneratorKind; queue: QueueState;
  sent: SimulationSentRecord[]; events: SimulationLogEvent[]; rules: Record<SimulationPlatform, Rule>;
  schedules: Array<{ draftId: string; dueAt: number; delayMs: number }>;
}
export interface SimulationEngineOptions {
  generate: SimulationGenerate; generatorKind: SimulationGeneratorKind; profile?: StyleProfile; memories?: Memory[];
  now?: number; random?: () => number; mergeWindowMs?: number;
}
export interface SimulationReceiveResult { accepted: boolean; scope: Scope; contextVersion: number }
export type SimulationSendOutcome = 'accepted' | 'failed' | 'unknown';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const validPlatform = (value: string): value is SimulationPlatform => SIMULATION_PLATFORMS.some(platform => platform.id === value);
export function simulationScope(platform: SimulationPlatform, conversationId = 'demo-contact', senderId = conversationId): Scope {
  if (!validPlatform(platform)) throw new Error('未知的模拟平台。');
  if (!conversationId.trim() || !senderId.trim()) throw new Error('模拟会话和联系人标识不能为空。');
  return { accountId: `simulation:${platform}`, conversationId, contactId: senderId };
}
export function fixtureReply({ composition, platform }: SimulationGenerationRequest): string {
  const last = composition.messages.filter(message => message.role === 'peer').at(-1);
  return platform === 'whatsapp' ? 'Thanks for your message. I will check and get back to you.'
    : `收到${last?.kind === 'text' ? '你的消息' : '你发来的内容'}啦，我先看看，稍后回复你。`;
}

/** Isolated, memory-only virtual-clock harness. canSend is granted only to its own in-memory connector. */
export class SimulationEngine {
  readonly capability = SIMULATION_CAPABILITY;
  readonly queue = new QueueEngine();
  private now: number;
  private profile: StyleProfile;
  private memories: Memory[];
  private readonly rules: Record<SimulationPlatform, Rule>;
  private readonly events: SimulationLogEvent[] = [];
  private readonly sent: SimulationSentRecord[] = [];
  private readonly schedules = new Map<string, { dueAt: number; delayMs: number }>();
  private readonly outcomes = new Map<SimulationPlatform, SimulationSendOutcome[]>();
  private tail: Promise<unknown> = Promise.resolve();
  private eventSequence = 0;
  private logKeys = new Set<string>();
  private generationFailures = new Set<string>();

  constructor(private readonly options: SimulationEngineOptions) {
    if (typeof options.generate !== 'function') throw new Error('必须提供模拟回复生成函数。');
    this.now = options.now ?? 1_000_000;
    if (!Number.isSafeInteger(this.now) || this.now < 0) throw new Error('模拟时钟必须是非负整数。');
    this.profile = copy(options.profile ?? createDefaultProfile()); this.memories = copy(options.memories ?? []);
    this.rules = Object.fromEntries(SIMULATION_PLATFORMS.map(({ id }) => [id, {
      ...createDefaultRule(`simulation:${id}`), enabled: false, mode: 'auto', autoAuthorized: false, cooldownMs: 0,
      allowedKinds: ['text', 'image', 'audio'],
    }])) as Record<SimulationPlatform, Rule>;
  }
  snapshot(): SimulationSnapshot {
    return copy({ transport: 'simulation', now: this.now, generatorKind: this.options.generatorKind,
      queue: this.queue.snapshot(), sent: this.sent, events: this.events, rules: this.rules,
      schedules: [...this.schedules].map(([draftId, schedule]) => ({ draftId, ...schedule })) });
  }
  receive(event: SimulatedInboundEvent): SimulationReceiveResult {
    if (!validPlatform(event.platform)) throw new Error('未知的模拟平台。');
    if (!event.eventId.trim() || typeof event.text !== 'string') throw new Error('模拟事件标识和消息格式无效。');
    const scope = simulationScope(event.platform, event.conversationId, event.senderId);
    const createdAt = event.createdAt ?? this.now;
    if (!Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > this.now) throw new Error('入站时间不能超前于模拟时钟。');
    const result = this.queue.ingest({ id: event.eventId, scope, role: event.direction === 'self' ? 'self' : 'peer',
      origin: event.direction === 'self' ? 'user' : undefined, text: event.text, kind: event.kind ?? 'text', createdAt,
      automated: event.automated, attachmentConfirmed: event.attachmentConfirmed, analysisText: event.analysisText });
    this.log(result.accepted ? 'received' : 'duplicate', event.platform, [event.eventId], [],
      result.accepted ? '内存模拟收到消息。' : '同一模拟会话事件重复，已忽略。');
    return { ...result, scope };
  }
  setRule(platform: SimulationPlatform, changes: Partial<Rule>): void {
    const current = this.rules[platform]; if (!current) throw new Error('未知的模拟平台。');
    const next = { ...current, ...copy(changes), id: current.id, accountId: current.accountId };
    if (!Number.isFinite(next.cooldownMs) || next.cooldownMs < 0) throw new Error('回复冷却时间无效。');
    this.rules[platform] = next;
    for (const scope of this.scopes().filter(scope => this.platform(scope) === platform)) this.queue.invalidateGenerationContext(scope);
    this.log('config_changed', platform, [], [], '模拟规则已修改，旧草稿失效。');
  }
  setProfile(profile: StyleProfile): void { this.profile = copy(profile); this.queue.invalidateGenerationContext(); this.log('config_changed', undefined, [], [], '表达档案更新，旧草稿失效。'); }
  setMemories(memories: Memory[]): void { this.memories = copy(memories); this.queue.invalidateGenerationContext(); this.log('config_changed', undefined, [], [], '模拟可访问记忆更新，旧草稿失效。'); }
  pause(paused = true): void { this.queue.pause(paused); }
  takeover(scope: Scope): void { this.assertSimulationScope(scope); this.queue.takeover(scope); }
  resume(scope: Scope): void { this.assertSimulationScope(scope); this.queue.resumeConversation(scope); }
  setNextOutcome(platform: SimulationPlatform, outcome: SimulationSendOutcome): void {
    if (!validPlatform(platform) || !['accepted', 'failed', 'unknown'].includes(outcome)) throw new Error('模拟回执无效。');
    const pending = this.outcomes.get(platform) ?? []; pending.push(outcome); this.outcomes.set(platform, pending);
  }
  approve(draftId: string, editedText?: string): Draft { return this.queue.approve(draftId, editedText); }
  reconcileUnknown(draftId: string, outcome: 'accepted' | 'not-sent' | 'unconfirmed', evidence: string): Draft {
    const result = this.queue.reconcileUnknown(draftId, outcome, evidence, this.now);
    this.log('reconciled', this.platform(result.scope), result.messageIds, [], '人工核实模拟发送结果。', draftId);
    return result;
  }
  run(): Promise<SimulationSnapshot> { return this.serialize(() => this.process()); }
  advance(ms: number): Promise<SimulationSnapshot> {
    if (!Number.isSafeInteger(ms) || ms < 0) return Promise.reject(new Error('模拟时间增量必须是非负整数。'));
    return this.serialize(async () => { if (!Number.isSafeInteger(this.now + ms)) throw new Error('模拟时间超出范围。'); this.now += ms; return this.process(); });
  }
  private serialize(task: () => Promise<SimulationSnapshot>): Promise<SimulationSnapshot> {
    const pending = this.tail.then(task); this.tail = pending.catch(() => undefined); return pending;
  }
  private assertSimulationScope(scope: Scope): void {
    if (!scope.accountId.startsWith('simulation:') || !validPlatform(scope.accountId.slice(11))) throw new Error('仅支持模拟账号范围。');
  }
  private platform(scope: Scope): SimulationPlatform { this.assertSimulationScope(scope); return scope.accountId.slice(11) as SimulationPlatform; }
  private scopes(): Scope[] { return [...new Map(this.queue.snapshot().messages.map(message => [scopeKey(message.scope), message.scope])).values()]; }
  private log(kind: SimulationEventKind, platform: SimulationPlatform | undefined, messageIds: string[], reasons: string[], detail: string, draftId?: string, dueAt?: number, dedupKey?: string): void {
    if (dedupKey && this.logKeys.has(dedupKey)) return;
    if (dedupKey) this.logKeys.add(dedupKey);
    this.events.push({ id: `simulation-event:${++this.eventSequence}`, at: this.now, kind, platform, messageIds: [...messageIds], reasons: [...reasons], detail, draftId, dueAt });
  }
  private async process(): Promise<SimulationSnapshot> {
    const active = new Set(this.queue.snapshot().drafts.filter(draft => ['generated', 'queued', 'review'].includes(draft.status)).map(draft => draft.id));
    for (const id of this.schedules.keys()) if (!active.has(id)) this.schedules.delete(id);
    for (const scope of this.scopes()) {
      const platform = this.platform(scope);
      // A successful send may expose another pending batch, but failures never spin or retry.
      const maximumCycles = Math.min(1_024, this.queue.snapshot().messages.length + 1);
      for (let cycle = 0; cycle < maximumCycles; cycle++) {
        const composition = this.queue.compose(scope, this.now, this.options.mergeWindowMs ?? 3_000);
        if (!composition.messageIds.length) break;
        const state = this.queue.snapshot();
        const batchKey = `${scopeKey(scope)}:${composition.contextVersion}:${JSON.stringify(composition.messageIds)}`;
        const overlapping = state.drafts.filter(draft => sameScope(draft.scope, scope)
          && draft.messageIds.some(id => composition.messageIds.includes(id)));
        const unsafePrevious = overlapping.find(draft => draft.status === 'unknown' || draft.status === 'failed');
        if (unsafePrevious) {
          this.log('blocked', platform, composition.messageIds, [unsafePrevious.status],
            '之前的发送失败或结果未知，需要人工核实，不自动重试。', unsafePrevious.id, undefined, `terminal:${batchKey}:${unsafePrevious.id}`);
          break;
        }
        const rule = this.rules[platform];
        const preReasons = [state.paused ? 'paused' : '', state.takenOver.includes(scopeKey(scope)) ? 'takeover' : '',
          !rule.enabled ? 'disabled' : '', !rule.autoAuthorized && rule.mode === 'auto' ? 'unauthorized' : ''].filter(Boolean);
        if (preReasons.length) {
          this.log('blocked', platform, composition.messageIds, preReasons, '模拟自动回复尚未获得当前规则许可。',
            undefined, undefined, `pre:${batchKey}:${JSON.stringify(preReasons)}`);
          break;
        }
        let draft = overlapping.find(item => item.contextVersion === composition.contextVersion
          && item.messageIds.join('\0') === composition.messageIds.join('\0') && ['generated', 'queued', 'review'].includes(item.status));
        for (const obsolete of overlapping.filter(item => ['generated', 'queued', 'review'].includes(item.status) && item.id !== draft?.id)) {
          this.queue.cancel(obsolete.id); this.schedules.delete(obsolete.id);
        }
        if (!draft) {
          if (this.generationFailures.has(batchKey)) break;
          try {
            const text = await this.options.generate({ composition: copy(composition), platform, profile: copy(this.profile),
              memories: copy(this.memories), now: this.now });
            if (typeof text !== 'string' || !text.trim()) throw new Error('生成器没有返回回复正文。');
            const current = this.queue.snapshot();
            const changed = this.queue.contextVersion(scope) !== composition.contextVersion;
            if (changed || current.paused || current.takenOver.includes(scopeKey(scope))) {
              this.log('stale_generation', platform, composition.messageIds,
                [changed ? 'stale' : '', current.paused ? 'paused' : '', current.takenOver.includes(scopeKey(scope)) ? 'takeover' : ''].filter(Boolean),
                '生成期间上下文或发送许可已变化，结果不入队。');
              if (changed && !current.paused && !current.takenOver.includes(scopeKey(scope))) continue;
              break;
            }
            draft = this.queue.enqueue(composition, text.trim(), this.now);
            this.log('generated', platform, composition.messageIds, [], this.options.generatorKind === 'fixture'
              ? '固定测试生成器已产生回复；未调用 AI。' : '指定 AI 生成器已返回回复；平台发送仍为内存模拟。', draft.id);
          } catch {
            // Never expose callback exceptions: a provider error may contain secrets.
            this.generationFailures.add(batchKey);
            this.log('generation_failed', platform, composition.messageIds, ['generation_failed'], '生成失败；保留原消息，等待新输入或重新创建模拟。');
            break;
          }
        }
        try {
          if (!this.schedules.has(draft.id)) {
            const scheduled = this.queue.scheduleDraft(draft.id, rule, this.profile, this.now, this.options.random);
            this.schedules.set(draft.id, { dueAt: scheduled.notBefore ?? this.now, delayMs: scheduled.replyDelayMs ?? 0 });
          }
        } catch {
          this.log('blocked', platform, composition.messageIds, ['timing_invalid'], '回复间隔设置无效，模拟暂停发送。', draft.id, undefined, `timing:${draft.id}`);
          break;
        }
        const schedule = this.schedules.get(draft.id)!;
        if (this.now < schedule.dueAt) {
          this.log('waiting', platform, composition.messageIds, ['reply_delay'], '等待设定的回复间隔；尚未发送。', draft.id,
            schedule.dueAt, `waiting:${draft.id}:${schedule.dueAt}`);
          break;
        }
        const decision = this.queue.permitSend(draft.id, rule, { now: this.now, canSend: this.capability.canSend,
          currentDeviceId: 'simulation-device', responsibleDeviceId: 'simulation-device',
          localHour: new Date(this.now).getUTCHours(), profile: this.profile, random: this.options.random });
        if (!decision.allowed) {
          this.log('blocked', platform, composition.messageIds, decision.reasons,
            decision.requiresReview ? '程序安全规则要求本人审核。' : '程序安全规则阻止模拟发送。', draft.id,
            undefined, `gate:${draft.id}:${JSON.stringify(decision.reasons)}`);
          break;
        }
        // Reservation is snapshotted before the in-memory send, exactly as for a transport.
        const reserved = this.queue.snapshot();
        if (!reserved.inFlight.includes(draft.id)) throw new Error('模拟发送未获得队列预约。');
        const pendingOutcomes = this.outcomes.get(platform) ?? [];
        const outcome = pendingOutcomes.shift() ?? 'accepted';
        this.outcomes.set(platform, pendingOutcomes);
        if (outcome === 'failed') {
          this.queue.markFailed(draft.id, '模拟连接器明确返回：消息未发送。', true);
          this.log('failed', platform, composition.messageIds, ['definitely_not_sent'], '模拟发送失败；不会自动重试。', draft.id);
          break;
        }
        if (outcome === 'unknown') {
          this.queue.markUnknown(draft.id, '模拟发送之后丢失回执，结果未知。');
          this.log('unknown', platform, composition.messageIds, ['unknown'], '模拟回执丢失；等待人工核实，不盲目重发。', draft.id);
          break;
        }
        this.queue.markAccepted(draft.id, this.now);
        const receiptId = `simulation-receipt:${this.sent.length + 1}`;
        this.sent.push({ transport: 'simulation', platform, draftId: draft.id, receiptId,
          messageIds: [...draft.messageIds], scope: copy(scope), text: draft.text, acceptedAt: this.now,
          generatorKind: this.options.generatorKind });
        this.queue.ingest({ id: receiptId, scope, role: 'self', origin: 'assistant', text: draft.text, kind: 'text', createdAt: this.now });
        this.schedules.delete(draft.id);
        this.log('sent', platform, composition.messageIds, [], '内存模拟连接器已接受回复；没有向真实平台发送。', draft.id);
      }
    }
    return this.snapshot();
  }
}
