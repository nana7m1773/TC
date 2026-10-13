import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ContextBudgetError, QueueEngine, createDefaultProfile, trimContext, type Memory, type Message, type Scope } from '../src/index.ts';
import { createCompaction, verifyCompaction } from '../src/compaction.ts';

const scope: Scope = { accountId: 'qq:self', conversationId: 'alice', contactId: 'person:alice' };
const other: Scope = { ...scope, conversationId: 'bob', contactId: 'person:bob' };
const msg = (id: string, text: string, changes: Partial<Message> = {}): Message =>
  ({ id, scope, role: 'peer', text, kind: 'text', createdAt: 1_000, ...changes });
const fact = (id: string, changes: Partial<Memory> = {}): Memory =>
  ({ id, scope, text: `本人确认事实 ${id}：会议日期 2026-10-13，项目 TC。`, confirmed: true,
    shareable: false, source: '本人确认', updatedAt: 500, ...changes });
const history = (): Message[] => [
  msg('old-question', '你好。Project Atlas 的会议是 2026-10-13 09:30，在 Dr. Chen 的办公室，预算 12,800.50 元，编号 A-127。请确认日期和金额？', { createdAt: 1_000 }),
  msg('old-reply', '收到，我会先核对 Project Atlas 的日期和 12,800.50 元预算。', { role: 'self', origin: 'user', createdAt: 2_000 }),
  msg('current', '最新未决问题：2026-10-14 15:00 改到 Room B-12 可以吗？', { createdAt: 3_000 }),
];
const options = { keepRecentCount: 1, maxExcerptChars: 2_000, answeredMessageIds: ['old-question'], now: 4_000 };

test('compaction creates a smaller view while the complete original QueueState remains intact', () => {
  const queue = new QueueEngine();
  const originals = history(); originals[0]!.text += '\n' + '这段较长背景仍存于完整历史'.repeat(200);
  for (const message of originals) queue.ingest(message);
  const before = queue.snapshot(), snapshot = queue.snapshot();
  const record = createCompaction(snapshot.messages, scope, options);
  assert.deepEqual(queue.snapshot(), before);
  assert.deepEqual(snapshot, before, 'the caller-owned snapshot is not edited either');
  assert.deepEqual(record.archivedMessageIds, ['old-question', 'old-reply']);
  assert.deepEqual(record.retainedMessages.map(message => message.id), ['current']);
  assert.equal(record.retainedMessages[0]!.text, before.messages.at(-1)!.text);
  assert.ok(JSON.stringify({ summary: record.summaryText, messages: record.retainedMessages }).length < JSON.stringify(before.messages).length,
    'representative long history is reduced in the context view');
  assert.ok(record.summaryText.includes('不是已确认个人事实或本人原句'));
  assert.equal(verifyCompaction(JSON.parse(JSON.stringify(record)), before.messages, scope, { now: 4_000 }).valid, true);
  record.retainedMessages[0]!.text = 'edited output';
  assert.equal(before.messages.at(-1)!.text, history().at(-1)!.text, 'returned originals are detached clones');
});

test('account, conversation and contact isolation apply even to colliding source IDs and shareable foreign memories', () => {
  const foreign = [
    msg('old-question', 'FOREIGN conversation secret', { scope: other }),
    msg('other-account', 'FOREIGN account secret', { scope: { ...scope, accountId: 'qq:another' } }),
    msg('other-contact', 'FOREIGN contact secret', { scope: { ...scope, contactId: 'person:another' } }),
  ];
  const memories = [fact('own'), fact('foreign', { scope: other, text: 'FOREIGN personal fact', shareable: true }),
    fact('unconfirmed', { confirmed: false }), fact('expired', { expiresAt: 3_999 }), fact('unscoped', { scope: undefined })];
  const record = createCompaction([...foreign, ...history()], scope, { ...options, memories });
  assert.ok(!JSON.stringify(record).includes('FOREIGN'));
  assert.deepEqual(record.confirmedFacts.map(memory => memory.id), ['own']);
  assert.equal(record.excluded.otherScopeMessageCount, 3);
  assert.equal(verifyCompaction(record, [...foreign, ...history()], scope, { now: 4_000, memories }).valid, true);
  assert.ok(verifyCompaction(record, history(), other, { now: 4_000, memories }).reasons.includes('wrong_scope'));
  foreign[0]!.text = 'a foreign conversation may change independently';
  assert.equal(verifyCompaction(record, [...foreign, ...history()], scope, { now: 4_000, memories }).valid, true);
  assert.notEqual(createCompaction([], scope, options).id, createCompaction([], other, options).id,
    'even empty archived histories have a scope-specific record identity');
});

test('numbers, dates, proper names and questions survive as verifiable complete original excerpts', () => {
  const messages = history(), record = createCompaction(messages, scope, options);
  const important = record.evidence.find(evidence => evidence.sourceId === 'old-question' && evidence.quote.includes('Project Atlas'))!;
  assert.ok(important);
  assert.equal(important.quote, 'Project Atlas 的会议是 2026-10-13 09:30，在 Dr. Chen 的办公室，预算 12,800.50 元，编号 A-127。');
  for (const evidence of record.evidence) {
    const source = messages.find(message => message.id === evidence.sourceId)!;
    assert.equal(source[evidence.field]!.slice(evidence.start, evidence.end), evidence.quote);
    assert.equal(evidence.confirmedPersonalFact, false);
  }
  assert.ok(record.evidence.some(evidence => evidence.quote === '请确认日期和金额？'));
  assert.ok(!record.evidence.some(evidence => evidence.sourceId === 'current'));
  assert.deepEqual(record.confirmedFacts, [], 'source assertions are never automatically personal memories');
});

test('only explicitly answered peer history is eligible, and every unresolved input remains complete', () => {
  const messages = [...history(), msg('pending-later', 'Another unresolved message', { createdAt: 3_500 })];
  const unproven = createCompaction(messages, scope, { keepRecentCount: 0, maxExcerptChars: 10, now: 4_000 });
  assert.ok(unproven.retainedMessages.some(message => message.id === 'old-question'));
  assert.ok(unproven.retainedMessages.some(message => message.id === 'current'));
  assert.ok(unproven.retainedMessages.some(message => message.id === 'pending-later'));
  const proven = createCompaction(messages, scope, { ...options, protectedMessageIds: ['old-reply'] });
  assert.deepEqual(proven.archivedMessageIds, ['old-question']);
  assert.deepEqual(proven.retainedMessages.map(message => message.id), ['old-reply', 'current', 'pending-later']);
  assert.throws(() => createCompaction(messages, scope, { ...options, protectedMessageIds: ['foreign-id'] }), /必要原文/);
});

test('source modifications, deleted sources, newly arriving messages and edited summaries invalidate a persisted record', () => {
  const messages = history(), record = createCompaction(messages, scope, options);
  const changed = structuredClone(messages); changed[0]!.text = changed[0]!.text.replace('12,800.50', '128.50');
  const changedResult = verifyCompaction(record, changed, scope, { now: 4_000 });
  assert.equal(changedResult.valid, false); assert.ok(changedResult.reasons.includes('source_changed'));
  const noSource = verifyCompaction(record, messages.slice(1), scope, { now: 4_000 });
  assert.equal(noSource.valid, false); assert.ok(noSource.reasons.includes('source_missing'));
  const newInput = verifyCompaction(record, [...messages, msg('new', '最新补充', { createdAt: 4_000 })], scope, { now: 4_000 });
  assert.equal(newInput.valid, false); assert.ok(newInput.reasons.includes('context_changed'));
  const edited = structuredClone(record); edited.summaryText += '\n捏造个人事实';
  assert.ok(verifyCompaction(edited, messages, scope, { now: 4_000 }).reasons.includes('evidence_changed'));
  const changedRetained = structuredClone(record); changedRetained.retainedMessages[0]!.text = 'truncated';
  assert.ok(verifyCompaction(changedRetained, messages, scope, { now: 4_000 }).reasons.includes('retained_changed'));
  const changedEvidence = structuredClone(record); changedEvidence.evidence[0]!.quote = 'invented quote';
  assert.ok(verifyCompaction(changedEvidence, messages, scope, { now: 4_000 }).reasons.includes('evidence_changed'));
});

test('fingerprints cover even omitted source text and agree with the independent SHA-256 implementation', () => {
  const messages = history();
  messages[0]!.text += '\n' + '被预算排除但仍存原文的 Unicode 🍊片段'.repeat(300);
  const record = createCompaction(messages, scope, { ...options, maxExcerptChars: 0 });
  assert.equal(record.summaryText, ''); assert.ok(record.omittedEvidenceCount > 0);
  function canonical(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).filter(key => object[key] !== undefined).sort()
      .map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
  }
  const archived = messages.filter(message => record.archivedMessageIds.includes(message.id));
  assert.equal(record.sourcesFingerprint, 'sha256:' + createHash('sha256').update(canonical(archived), 'utf8').digest('hex'));
  const edited = structuredClone(messages); edited[0]!.text += '文字已修改';
  assert.equal(verifyCompaction(record, edited, scope, { now: 4_000 }).valid, false);
});

test('a tiny excerpt budget never truncates current inputs, protected originals or necessary confirmed facts', async () => {
  const messages = history(), memories = [fact('necessary', { text: '必要确认事实' + '完整正文'.repeat(200) })];
  for (const maxExcerptChars of [0, 1, 80, 320]) {
    const record = createCompaction(messages, scope, { ...options, maxExcerptChars, protectedMessageIds: ['old-reply'], memories, requiredMemoryIds: ['necessary'] });
    assert.ok(record.summaryText.length <= maxExcerptChars);
    assert.equal(record.retainedMessages.find(message => message.id === 'current')!.text, messages[2]!.text);
    assert.equal(record.retainedMessages.find(message => message.id === 'old-reply')!.text, messages[1]!.text);
    assert.deepEqual(record.confirmedFacts, memories);
    assert.equal(verifyCompaction(record, messages, scope, { now: 4_000, memories }).valid, true);
  }
  const record = createCompaction(messages, scope, { ...options, maxExcerptChars: 0, memories, requiredMemoryIds: ['necessary'] });
  // A real prompt budget remains an independent gate. An insufficient budget
  // rejects the operation instead of silently cutting the required fact/input.
  await assert.rejects(trimContext({ profile: createDefaultProfile(), memories: record.confirmedFacts,
    messages: record.retainedMessages, currentMessageIds: ['current'], requiredMemoryIds: ['necessary'],
    maxContextTokens: 100, outputReserve: 1, now: 4_000, countTokens: () => 500 }), ContextBudgetError);
  assert.deepEqual(messages, history()); assert.equal(memories[0]!.text.length, record.confirmedFacts[0]!.text.length);
});

test('budget selection favors exact facts and questions over filler and reports omitted evidence', () => {
  const messages = [msg('filler', '你好。好呀。哈哈。', { createdAt: 1_000 }),
    msg('specific', 'Project Atlas：2026-10-13，12800元。', { createdAt: 2_000 }),
    msg('latest', '继续', { createdAt: 3_000 })];
  const complete = createCompaction(messages, scope, { ...options, answeredMessageIds: ['filler', 'specific'], maxExcerptChars: 5_000 });
  const specific = complete.evidence.find(evidence => evidence.sourceId === 'specific')!;
  const fittingBudget = complete.summaryText.split('\n')[0]!.length + 1
    + complete.summaryText.split('\n').find(line => line.includes('"sourceId":"specific"'))!.length;
  const small = createCompaction(messages, scope, { ...options, answeredMessageIds: ['filler', 'specific'], maxExcerptChars: fittingBudget });
  assert.deepEqual(small.evidence, [specific]);
  assert.ok(small.omittedEvidenceCount > 0);
  assert.equal(small.sources.find(source => source.id === 'filler')!.excerptCount, 0);
  assert.equal(small.sources.find(source => source.id === 'filler')!.omittedExcerptCount, 3);
});

test('confirmed memories remain distinct, must be provided for verification, and lose validity after expiry or edits', () => {
  const memories = [fact('necessary', { expiresAt: 5_000 }), fact('optional')];
  const record = createCompaction(history(), scope, { ...options, memories, requiredMemoryIds: ['necessary'], expiresAt: 6_000 });
  assert.deepEqual(record.confirmedFacts, memories);
  assert.ok(!record.summaryText.includes('本人确认事实'));
  assert.equal(verifyCompaction(record, history(), scope, { now: 4_000, memories }).valid, true);
  assert.ok(verifyCompaction(record, history(), scope, { now: 4_000 }).reasons.includes('facts_changed'));
  assert.ok(verifyCompaction(record, history(), scope, { now: 5_000, memories }).reasons.includes('facts_expired'));
  assert.ok(verifyCompaction(record, history(), scope, { now: 6_000, memories }).reasons.includes('expired'));
  const changed = structuredClone(memories); changed[0]!.confirmed = false;
  assert.ok(verifyCompaction(record, history(), scope, { now: 4_000, memories: changed }).reasons.includes('facts_changed'));
  assert.throws(() => createCompaction(history(), scope, { ...options, memories, requiredMemoryIds: ['missing'] }), /必要记忆/);
  assert.throws(() => createCompaction(history(), scope, { ...options, memories, requiredMemoryIds: ['necessary'], now: 5_000 }), /已失效/);
});

test('attachment analysis is a separately marked exact source quotation, even when the attachment was checked', () => {
  const messages = [msg('image', '[图片原文]', { kind: 'image', analysisText: 'OCR: Project Atlas 会议日期 2026-10-13。', attachmentConfirmed: true }),
    msg('latest', '你怎么看？', { createdAt: 2_000 })];
  const record = createCompaction(messages, scope, { ...options, answeredMessageIds: ['image'] });
  const analysis = record.evidence.find(evidence => evidence.field === 'analysisText')!;
  assert.equal(analysis.quote, messages[0]!.analysisText);
  assert.equal(analysis.attachmentConfirmed, true); assert.equal(analysis.confirmedPersonalFact, false);
  assert.deepEqual(record.confirmedFacts, []);
  const changed = structuredClone(messages); changed[0]!.attachmentConfirmed = false;
  assert.ok(verifyCompaction(record, changed, scope, { now: 4_000 }).reasons.includes('source_changed'));
});

test('malformed budgets, times and duplicate scoped IDs fail explicitly without altering the originals', () => {
  for (const maxExcerptChars of [-1, NaN, 1.5]) assert.throws(() => createCompaction(history(), scope, { ...options, maxExcerptChars }), /非负整数/);
  assert.throws(() => createCompaction(history(), scope, { ...options, expiresAt: 4_000 }), /有效期/);
  assert.throws(() => createCompaction(history(), scope, { ...options, now: -1 }), /时间/);
  assert.throws(() => createCompaction([history()[0]!, history()[0]!], scope, options), /重复/);
  assert.deepEqual(history().map(message => message.id), ['old-question', 'old-reply', 'current']);
});

test('verification rejects incomplete evidence, false confirmation labels and an archived unresolved input', () => {
  const messages = history(), record = createCompaction(messages, scope, options);
  const partial = structuredClone(record), excerpt = partial.evidence.find(evidence => evidence.sourceId === 'old-question' && evidence.quote.includes('Project Atlas'))!;
  excerpt.quote = excerpt.quote.slice(0, 5); excerpt.end = excerpt.start + excerpt.quote.length;
  assert.ok(verifyCompaction(partial, messages, scope, { now: 4_000 }).reasons.includes('evidence_changed'),
    'even an accurate substring must not masquerade as the original complete extract');
  const promoted = structuredClone(record); (promoted.evidence[0] as unknown as { confirmedPersonalFact: boolean }).confirmedPersonalFact = true;
  assert.ok(verifyCompaction(promoted, messages, scope, { now: 4_000 }).reasons.includes('evidence_changed'));
  const unprotected = structuredClone(record); unprotected.archivedMessageIds.push('current');
  assert.ok(verifyCompaction(unprotected, messages, scope, { now: 4_000 }).reasons.includes('invalid_record'));
  const malformedMemory = { ...fact('malformed'), confirmed: 'false' } as unknown as Memory;
  assert.deepEqual(createCompaction(messages, scope, { ...options, memories: [malformedMemory] }).confirmedFacts, []);
});
