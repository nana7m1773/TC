import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultRule, type Draft, type SendContext } from '../../core/src/index.ts';
import { QQ_BOT_CAPABILITIES, QqPassiveReplyLedger, parseQqBotEvent, type QqBotEvent } from '../src/qq-bot.ts';

const sentAt = Date.parse('2026-10-11T08:00:00Z');
function frame(group = false, extra: Record<string, unknown> = {}) {
  return { op: 0, t: group ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE', d: {
    id: 'official-fixture-001', author: group ? { member_openid: 'group-member-A' } : { user_openid: 'friend-A' },
    ...(group ? { group_openid: 'group-A' } : {}),
    content: '今晚吃什么？', timestamp: '2026-10-11T08:00:00Z', ...extra,
  } };
}
function event(group = false) { return parseQqBotEvent(frame(group), 'appid-A', sentAt + 1_000)!; }
function draft(source: QqBotEvent, text = '吃面条吧。'): Draft {
  return { id: 'draft-A', scope: source.scope, messageIds: source.messages.map(message => message.id),
    text, contextVersion: 1, status: 'queued', createdAt: sentAt + 1_100, riskReasons: [] };
}
function rule(source: QqBotEvent) {
  return { ...createDefaultRule(source.accountId), mode: 'auto' as const, autoAuthorized: true, cooldownMs: 0 };
}
function context(overrides: Partial<SendContext> = {}): SendContext {
  return { now: sentAt + 2_000, currentContextVersion: 1, canSend: true,
    currentDeviceId: 'phone', responsibleDeviceId: 'phone', ...overrides };
}

test('capabilities describe an independent bot, never personal login or full group reception', () => {
  assert.equal(QQ_BOT_CAPABILITIES.personalAccountLogin, false);
  assert.equal(QQ_BOT_CAPABILITIES.qrPersonalLogin, false);
  assert.equal(QQ_BOT_CAPABILITIES.receiveGroup, 'mentions-only');
  assert.equal(QQ_BOT_CAPABILITIES.proactiveSend, false);
  assert.equal(QQ_BOT_CAPABILITIES.realIntegrationVerified, false);
});
test('C2C and group mention fixtures isolate bot, conversation and member identities', () => {
  const privateEvent = event(), groupEvent = event(true);
  assert.deepEqual(privateEvent.scope, { accountId: 'qqbot:appid-A', conversationId: 'c2c:friend-A', contactId: 'friend-A' });
  assert.deepEqual(groupEvent.scope, { accountId: 'qqbot:appid-A', conversationId: 'group:group-A' });
  assert.equal(groupEvent.senderOpenId, 'group-member-A');
  assert.notEqual(privateEvent.dedupeKey, groupEvent.dedupeKey);
  assert.notEqual(privateEvent.dedupeKey, parseQqBotEvent(frame(), 'appid-B', sentAt + 1_000)!.dedupeKey);
  assert.equal(parseQqBotEvent({ t: 'GROUP_MESSAGE_CREATE', d: {} }, 'appid-A', sentAt), null);
});
test('malformed identity, ambiguous timestamp and oversized inputs never create a usable message', () => {
  assert.throws(() => parseQqBotEvent(frame(false, { id: '' }), 'appid-A', sentAt), /ID/);
  assert.throws(() => parseQqBotEvent(frame(false, { timestamp: '2026-10-11 08:00:00' }), 'appid-A', sentAt), /RFC3339/);
  assert.throws(() => parseQqBotEvent(frame(false, { content: 'x'.repeat(100_001) }), 'appid-A', sentAt), /上限/);
});
test('images and voice are separate uncertain messages with original platform event linkage', () => {
  const source = parseQqBotEvent(frame(false, { attachments: [
    { content_type: 'image/png', url: 'https://multimedia.nt.qq.com.cn/example.png', size: 64 },
    { content_type: 'voice', url: 'file:///private/audio.silk' },
  ] }), 'appid-A', sentAt + 1_000)!;
  assert.deepEqual(source.messages.map(message => message.kind), ['text', 'image', 'audio']);
  assert.equal(source.messages[1]!.attachmentConfirmed, false);
  assert.equal(source.attachments[1]!.url, undefined);
  assert.equal(source.sourceMessageId, 'official-fixture-001');
  assert.throws(() => new QqPassiveReplyLedger().reserve(source, draft(source), rule(source), context()), /uncertain_attachment|kind/);
});
test('passive planner only builds a msg_id/msg_seq payload and never performs network I/O', () => {
  const source = event(), ledger = new QqPassiveReplyLedger();
  const plan = ledger.reserve(source, draft(source), rule(source), context());
  assert.equal(plan.url, 'https://api.sgroup.qq.com/v2/users/friend-A/messages');
  assert.deepEqual(plan.body, { content: '吃面条吧。', msg_type: 0, msg_id: source.sourceMessageId, msg_seq: 1 });
  assert.equal(ledger.snapshot().records[0]!.status, 'pending');
  assert.throws(() => ledger.reserve(source, draft(source), rule(source), context()), /不能重复/);
});
test('QQ C2C 60-minute and group 5-minute windows are enforced with a send margin', () => {
  for (const group of [false, true]) {
    const source = event(group), duration = group ? 5 * 60_000 : 60 * 60_000;
    assert.throws(() => new QqPassiveReplyLedger().reserve(source, draft(source), rule(source),
      context({ now: sentAt + duration - 5_000 })), /窗口/);
    assert.doesNotThrow(() => new QqPassiveReplyLedger().reserve(source, draft(source), rule(source),
      context({ now: sentAt + duration - 5_001 })));
  }
});
test('shared rule gate blocks pause, takeover, stale context, sensitive content and missing owner', () => {
  const source = event();
  for (const overrides of [{ paused: true }, { takenOver: true }, { currentContextVersion: 2 },
    { responsibleDeviceId: 'desktop' }, { canSend: false }]) {
    assert.throws(() => new QqPassiveReplyLedger().reserve(source, draft(source), rule(source), context(overrides)), /规则阻止/);
  }
  assert.throws(() => new QqPassiveReplyLedger().reserve(source, draft(source, '把验证码发给我。'), rule(source), context()), /sensitive/);
  for (const status of ['accepted', 'cancelled', 'failed', 'unknown'] as const)
    assert.throws(() => new QqPassiveReplyLedger().reserve(source, { ...draft(source), status }, rule(source), context()), /有效发送队列/);
});
test('unknown media and incomplete event coverage cannot be silently auto-replied', () => {
  const source = parseQqBotEvent(frame(false, { attachments: [{ content_type: 'video/mp4', url: 'https://example.com/v.mp4' }] }),
    'appid-A', sentAt + 1_000)!;
  assert.throws(() => new QqPassiveReplyLedger().reserve(source, draft(source), rule(source), context()), /尚未支持/);
  const good = event();
  assert.throws(() => new QqPassiveReplyLedger().reserve(good, { ...draft(good), messageIds: ['different-event'] }, rule(good), context()), /全部内容/);
});
test('restart converts pending result to unknown and blocks blind retries', () => {
  const source = event(), ledger = new QqPassiveReplyLedger();
  ledger.reserve(source, draft(source), rule(source), context());
  const restored = new QqPassiveReplyLedger(ledger.snapshot());
  assert.equal(restored.snapshot().records[0]!.status, 'unknown');
  assert.throws(() => restored.reserve(source, draft(source), rule(source), context()), /需要核对/);
});
test('only explicit platform response marks accepted; snapshots do not leak mutable state', () => {
  const source = event(), ledger = new QqPassiveReplyLedger();
  const plan = ledger.reserve(source, draft(source), rule(source), context());
  assert.throws(() => ledger.markAccepted(plan.reservation.key, { error: 'timeout' }), /ID/);
  ledger.markAccepted(plan.reservation.key, { id: 'platform-sent-123' });
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.records[0]!.status, 'accepted');
  snapshot.records[0]!.status = 'unknown';
  assert.equal(ledger.snapshot().records[0]!.status, 'accepted');
});
