import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProfile, type Scope } from '../../core/src/index.ts';
import {
  SimulationEngine, SIMULATION_PLATFORMS, SIMULATION_CAPABILITY, fixtureReply, simulationScope,
  type SimulationGenerate, type SimulationPlatform,
} from '../src/index.ts';

function enabled(generate: SimulationGenerate = fixtureReply, platform: SimulationPlatform = 'qq') {
  const engine = new SimulationEngine({ generate, generatorKind: 'fixture', now: 1_000_000, random: () => 0.5 });
  engine.setRule(platform, { enabled: true, autoAuthorized: true, replyTiming: { mode: 'immediate' } });
  return engine;
}
const incoming = (platform: SimulationPlatform = 'qq', eventId = 'm1', text = '今天有空吗？') => ({ platform, eventId, text });

test('simulation capability is explicit, memory-only, and starts without automatic authorization', async () => {
  const engine = new SimulationEngine({ generate: fixtureReply, generatorKind: 'fixture' });
  assert.deepEqual(engine.capability, { transport: 'simulation', canSend: true, realPlatform: false });
  assert.ok(Object.isFrozen(SIMULATION_CAPABILITY));
  for (const rule of Object.values(engine.snapshot().rules)) { assert.equal(rule.enabled, false); assert.equal(rule.autoAuthorized, false); }
  engine.receive(incoming()); const result = await engine.run();
  assert.equal(result.sent.length, 0); assert.ok(result.events.some(event => event.reasons.includes('unauthorized')));
});

for (const { id, label, sampleText } of SIMULATION_PLATFORMS) {
  test(`${label}: receive -> fixture generation -> in-memory automatic receipt`, async () => {
    const engine = enabled(fixtureReply, id); engine.receive(incoming(id, 'sample', sampleText));
    const result = await engine.run();
    assert.equal(result.sent.length, 1); assert.equal(result.sent[0]!.platform, id);
    assert.equal(result.sent[0]!.transport, 'simulation'); assert.equal(result.sent[0]!.generatorKind, 'fixture');
    assert.equal(result.queue.drafts[0]!.status, 'accepted'); assert.equal(result.queue.inFlight.length, 0);
    assert.match(result.sent[0]!.scope.accountId, /^simulation:/);
    assert.ok(result.events.some(event => event.kind === 'generated' && event.detail.includes('未调用 AI')));
    assert.ok(result.events.some(event => event.kind === 'sent' && event.detail.includes('没有向真实平台发送')));
    assert.equal((await engine.run()).sent.length, 1);
  });
}

test('duplicate inbound events are ignored without a second reply', async () => {
  const engine = enabled(); assert.equal(engine.receive(incoming()).accepted, true);
  assert.equal(engine.receive(incoming()).accepted, false); await engine.run();
  assert.equal(engine.receive(incoming()).accepted, false); const result = await engine.advance(60_000);
  assert.equal(result.sent.length, 1); assert.equal(result.events.filter(event => event.kind === 'duplicate').length, 2);
});

test('same event ID on five platforms stays isolated', async () => {
  const engine = enabled();
  for (const { id } of SIMULATION_PLATFORMS) { engine.setRule(id, { enabled: true, autoAuthorized: true }); engine.receive(incoming(id, 'same-id')); }
  const result = await engine.run(); assert.equal(result.sent.length, 5);
  assert.equal(new Set(result.sent.map(item => item.scope.accountId)).size, 5);
  assert.equal(result.queue.messages.filter(message => message.role === 'peer').length, 5);
});

test('fixed interval cannot send before the deadline', async () => {
  const engine = enabled(); engine.setRule('qq', { replyTiming: { mode: 'fixed', delayMs: 5_000 } }); engine.receive(incoming());
  let result = await engine.run(); assert.equal(result.sent.length, 0); assert.equal(result.schedules[0]!.delayMs, 5_000);
  result = await engine.advance(4_999); assert.equal(result.sent.length, 0);
  result = await engine.advance(1); assert.equal(result.sent.length, 1); assert.equal(result.sent[0]!.acceptedAt, 1_005_000);
});

test('range interval is sampled once and stable across clock advances', async () => {
  let randomCalls = 0;
  const engine = new SimulationEngine({ generate: fixtureReply, generatorKind: 'fixture', random: () => { randomCalls++; return 0.5; } });
  engine.setRule('qq', { enabled: true, autoAuthorized: true, replyTiming: { mode: 'range', minMs: 2_000, maxMs: 6_000 } });
  engine.receive(incoming()); const waiting = await engine.run(); assert.equal(waiting.schedules[0]!.delayMs, 4_000);
  await engine.advance(1_000); await engine.advance(1_000); assert.equal(randomCalls, 1);
  const sent = await engine.advance(2_000); assert.equal(sent.sent.length, 1); assert.equal(randomCalls, 1);
});

test('a short burst invalidates the first draft and regenerates from the complete latest batch', async () => {
  const receivedBatches: string[][] = [];
  const engine = enabled(({ composition }) => { receivedBatches.push([...composition.messageIds]); return `回复批次：${composition.messageIds.join(',')}`; });
  engine.setRule('qq', { replyTiming: { mode: 'fixed', delayMs: 3_000 } });
  engine.receive(incoming('qq', 'one', '下午有空吗？')); await engine.run(); await engine.advance(1_000);
  engine.receive(incoming('qq', 'two', '想找你聊聊视频。')); const revised = await engine.run();
  assert.equal(revised.queue.drafts[0]!.status, 'cancelled'); assert.deepEqual(receivedBatches, [['one'], ['one', 'two']]);
  assert.equal((await engine.advance(2_999)).sent.length, 0); const result = await engine.advance(1);
  assert.equal(result.sent.length, 1); assert.deepEqual(result.sent[0]!.messageIds, ['one', 'two']); assert.match(result.sent[0]!.text, /one,two/);
});

test('pause immediately before the deadline prevents sending, resume keeps the pending batch', async () => {
  const engine = enabled(); engine.setRule('qq', { replyTiming: { mode: 'fixed', delayMs: 1_000 } });
  engine.receive(incoming()); await engine.run(); engine.pause();
  const paused = await engine.advance(2_000); assert.equal(paused.sent.length, 0); assert.ok(paused.events.some(event => event.reasons.includes('paused')));
  engine.pause(false); assert.equal((await engine.run()).sent.length, 1);
});

test('user takeover cancels pending automation and blocks later inbound until resume', async () => {
  const engine = enabled(); engine.setRule('qq', { replyTiming: { mode: 'fixed', delayMs: 1_000 } });
  engine.receive(incoming()); await engine.run(); const scope = simulationScope('qq'); engine.takeover(scope);
  engine.receive(incoming('qq', 'm2')); const takenOver = await engine.advance(3_000);
  assert.equal(takenOver.sent.length, 0); assert.equal(takenOver.queue.drafts[0]!.status, 'cancelled');
  assert.ok(takenOver.events.some(event => event.reasons.includes('takeover')));
  engine.resume(scope); await engine.run(); assert.equal((await engine.advance(1_000)).sent.length, 1);
});

test('simulated self-authored messages trigger actual core takeover', async () => {
  const engine = enabled(); engine.receive(incoming()); engine.receive({ ...incoming('qq', 'self'), direction: 'self' });
  const result = await engine.run(); assert.equal(result.sent.length, 0); assert.ok(result.queue.takenOver.length > 0);
});

test('style and timing changes invalidate old drafts, latest configuration governs the reply', async () => {
  let calls = 0; const engine = enabled(({ profile }) => { calls++; return profile.tone; });
  engine.setRule('qq', { replyTiming: { mode: 'fixed', delayMs: 1_000 } }); engine.receive(incoming()); await engine.run();
  const profile = createDefaultProfile(); profile.tone = '新的表达语气'; engine.setProfile(profile);
  engine.setRule('qq', { replyTiming: { mode: 'fixed', delayMs: 5_000 } }); await engine.run();
  assert.equal((await engine.advance(1_000)).sent.length, 0); const result = await engine.advance(4_000);
  assert.equal(result.sent.length, 1); assert.equal(result.sent[0]!.text, '新的表达语气'); assert.equal(calls, 2);
  assert.equal(result.queue.drafts[0]!.status, 'cancelled');
});

test('late asynchronous generation is discarded and regenerated when a new inbound changes context', async () => {
  let release: ((reply: string) => void) | undefined; let calls = 0;
  const engine = enabled(async ({ composition }) => { calls++; if (calls === 1) return new Promise<string>(resolve => { release = resolve; }); return composition.messageIds.join(','); });
  engine.receive(incoming('qq', 'first')); const running = engine.run();
  await Promise.resolve(); await Promise.resolve(); assert.ok(release);
  engine.receive(incoming('qq', 'second')); release!('old reply'); const result = await running;
  assert.equal(result.sent.length, 1); assert.equal(result.sent[0]!.text, 'first,second');
  assert.ok(result.events.some(event => event.kind === 'stale_generation'));
  assert.ok(!result.queue.drafts.some(draft => draft.text === 'old reply'));
});

test('pausing during asynchronous generation discards its result', async () => {
  let release: ((reply: string) => void) | undefined;
  const engine = enabled(() => new Promise<string>(resolve => { release = resolve; })); engine.receive(incoming()); const running = engine.run();
  await Promise.resolve(); await Promise.resolve(); engine.pause(); release!('late response'); const result = await running;
  assert.equal(result.sent.length, 0); assert.equal(result.queue.drafts.length, 0);
  assert.ok(result.events.some(event => event.kind === 'stale_generation' && event.reasons.includes('paused')));
});

for (const [name, changes, reason] of [
  ['payment', { text: '能转账给我吗？' }, 'sensitive'],
  ['image', { kind: 'image' }, 'uncertain_attachment'],
  ['audio', { kind: 'audio' }, 'uncertain_attachment'],
  ['automated peer', { automated: true }, 'automated_peer'],
] as const) {
  test(`${name} is routed to actual core review rather than automatic send`, async () => {
    const engine = enabled(); engine.receive({ ...incoming(), ...changes }); const result = await engine.run();
    assert.equal(result.sent.length, 0); assert.equal(result.queue.drafts[0]!.status, 'review');
    assert.ok(result.events.some(event => event.reasons.includes(reason)));
  });
}

test('explicit approval of a risky draft can proceed through the remaining safety gates', async () => {
  const engine = enabled(); engine.receive({ ...incoming(), kind: 'audio' }); const reviewed = await engine.run();
  engine.approve(reviewed.queue.drafts[0]!.id, '本人检查后的回复'); const sent = await engine.run();
  assert.equal(sent.sent.length, 1); assert.equal(sent.sent[0]!.text, '本人检查后的回复');
});

for (const outcome of ['failed', 'unknown'] as const) {
  test(`${outcome} does not retry automatically even after new inbound and clock advances`, async () => {
    let calls = 0; const engine = enabled(() => { calls++; return '安全回复'; }); engine.setNextOutcome('qq', outcome);
    engine.receive(incoming()); await engine.run(); engine.receive(incoming('qq', 'new')); await engine.advance(60_000); const result = await engine.run();
    assert.equal(result.sent.length, 0); assert.equal(calls, 1); assert.equal(result.queue.drafts[0]!.status, outcome);
    assert.equal(result.events.filter(event => event.kind === outcome).length, 1);
    assert.ok(result.events.some(event => event.kind === 'blocked' && event.reasons.includes(outcome)));
  });
}

test('unknown outcome needs explicit evidence before a manually reconciled retry', async () => {
  const engine = enabled(); engine.setNextOutcome('qq', 'unknown'); engine.receive(incoming()); const result = await engine.run();
  const id = result.queue.drafts[0]!.id; assert.throws(() => engine.reconcileUnknown(id, 'not-sent', ''), /核实依据/);
  engine.reconcileUnknown(id, 'unconfirmed', ''); assert.equal((await engine.run()).sent.length, 0);
  engine.reconcileUnknown(id, 'not-sent', '内存模拟连接器回执账本确认未发送'); assert.equal((await engine.run()).sent.length, 1);
});

test('model callback errors are redacted and do not automatically repeat', async () => {
  let calls = 0; const engine = enabled(() => { calls++; throw new Error('secret-key=fixture-secret'); }); engine.receive(incoming());
  await engine.run(); const result = await engine.advance(30_000); assert.equal(calls, 1); assert.equal(result.sent.length, 0);
  assert.ok(result.events.some(event => event.kind === 'generation_failed')); assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});

test('concurrent runs serialize generation and sending without double acceptance', async () => {
  let active = 0; let maximum = 0; const engine = enabled(async () => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return '收到啦'; });
  engine.receive(incoming()); await Promise.all([engine.run(), engine.run(), engine.advance(0)]);
  assert.equal(maximum, 1); assert.equal(engine.snapshot().sent.length, 1);
});

test('fixture runs do not use fetch or permit real account scopes', async () => {
  const engine = enabled(); const oldFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('simulation must not use network'); }) as typeof fetch;
  try { engine.receive(incoming()); assert.equal((await engine.run()).sent.length, 1); }
  finally { globalThis.fetch = oldFetch; }
  assert.throws(() => engine.takeover({ accountId: 'qq:real', conversationId: 'friend' } as Scope), /仅支持模拟账号/);
});

test('snapshots are detached and simulation does not silently add training examples', async () => {
  const profile = createDefaultProfile(); let learned = -1; const engine = enabled(({ profile: input }) => { learned = input.examples.length; return '收到啦'; });
  engine.setProfile(profile); engine.receive(incoming()); await engine.run();
  const snapshot = engine.snapshot(); snapshot.sent[0]!.text = 'mutated'; snapshot.queue.messages.length = 0;
  assert.equal(engine.snapshot().sent[0]!.text, '收到啦'); assert.ok(engine.snapshot().queue.messages.length > 0); assert.equal(learned, 0); assert.equal(profile.examples.length, 0);
});

test('invalid or future inbound timestamps and invalid clock values fail explicitly', async () => {
  const engine = enabled(); assert.throws(() => engine.receive({ ...incoming(), createdAt: 1_000_001 }), /不能超前/);
  assert.throws(() => engine.receive({ ...incoming(), eventId: '' }), /格式无效/);
  await assert.rejects(engine.advance(-1), /非负整数/); await assert.rejects(engine.advance(0.1), /非负整数/);
});
test('learned intervals use three accessible confirmed personal records and respect the virtual deadline', async () => {
  const profile=createDefaultProfile();
  profile.examples=[1000,3000,7000].map((delay,i)=>({id:`actual-${i}`,received:'你好',reply:'收到啦',note:'公开合成样本',confirmed:true,origin:'self' as const,scope:simulationScope('qq'),receivedAt:1000,repliedAt:1000+delay}));
  const engine=new SimulationEngine({generate:fixtureReply,generatorKind:'fixture',profile,now:1_000_000});
  engine.setRule('qq',{enabled:true,autoAuthorized:true,replyTiming:{mode:'learned',strategy:'median'}});engine.receive(incoming());
  const before=await engine.run();assert.equal(before.schedules[0]!.delayMs,3000);assert.equal(before.sent.length,0);
  assert.equal((await engine.advance(2999)).sent.length,0);assert.equal((await engine.advance(1)).sent.length,1);
});
test('private timing examples from another platform cannot authorize a learned automatic interval', async () => {
  const profile=createDefaultProfile();profile.examples=[1000,2000,3000].map((delay,i)=>({id:`private-${i}`,received:'你好',reply:'收到',note:'',confirmed:true,origin:'self' as const,scope:simulationScope('qq'),shareable:false,receivedAt:1000,repliedAt:1000+delay}));
  const engine=new SimulationEngine({generate:fixtureReply,generatorKind:'fixture',profile,now:1_000_000});
  engine.setRule('wechat',{enabled:true,autoAuthorized:true,replyTiming:{mode:'learned',strategy:'median'}});engine.receive(incoming('wechat'));
  const result=await engine.advance(10000);assert.equal(result.sent.length,0);assert.ok(result.events.some(e=>e.reasons.includes('timing_unavailable')));
});
