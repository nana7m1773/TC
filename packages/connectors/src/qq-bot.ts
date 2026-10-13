import {
  evaluateSafety, sameScope, type Draft, type Message, type Rule, type Scope, type SendContext,
} from '../../core/src/index';

/** Describes an official independent bot, never the owner's ordinary QQ account. */
export const QQ_BOT_CAPABILITIES = Object.freeze({
  accountType: 'independent-bot', personalAccountLogin: false, qrPersonalLogin: false,
  receivePrivate: true, receiveGroup: 'mentions-only', arbitraryHistory: false,
  receiveImages: true, receiveAudio: true, replyPrivate: 'passive-only', replyGroup: 'passive-only',
  proactiveSend: false, realIntegrationVerified: false,
  verifiedAt: '2026-10-11',
  documentCommit: '645787a45937e5d9c4f0f61afefdffde0f38696e',
} as const);

export interface QqAttachment {
  kind: 'image' | 'audio' | 'unsupported'; contentType: string; filename?: string;
  /** Never downloaded by this parser; the native downloader must validate destination and redirects. */
  url?: string; size?: number;
}
export interface QqBotEvent {
  accountId: string; type: 'C2C_MESSAGE_CREATE' | 'GROUP_AT_MESSAGE_CREATE';
  sourceMessageId: string; dedupeKey: string; targetType: 'c2c' | 'group'; targetOpenId: string;
  senderOpenId: string; scope: Scope; createdAt: number; receivedAt: number;
  messages: Message[]; attachments: QqAttachment[]; requiresReview: boolean;
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name}格式无效。`);
  return value as Record<string, unknown>;
}
function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value))
    throw new Error(`${name}缺失或格式无效。`);
  return value;
}
function optionalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8_192) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Missing/unsupported media remains uncertain; never fetch an invalid URL. */ }
}
function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[^\s]+(?:Z|[+-]\d{2}:\d{2})$/u.test(value))
    throw new Error('平台消息时间必须是带时区的 RFC3339。');
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('平台消息时间无效。');
  return result;
}

/** Call only AFTER the authenticated transport verifies source/signature; JSON is not authentication. */
export function parseQqBotEvent(envelope: unknown, appId: string, receivedAt: number): QqBotEvent | null {
  const frame = object(envelope, '事件');
  if (frame.t !== 'C2C_MESSAGE_CREATE' && frame.t !== 'GROUP_AT_MESSAGE_CREATE') return null;
  const knownAppId = identifier(appId, '已配置的机器人 AppID');
  if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) throw new Error('接收时间无效。');
  const data = object(frame.d, '消息'), author = object(data.author, '消息作者');
  const type = frame.t, sourceMessageId = identifier(data.id, '平台消息 ID');
  const targetType = type === 'C2C_MESSAGE_CREATE' ? 'c2c' : 'group';
  const senderOpenId = identifier(targetType === 'c2c' ? author.user_openid : author.member_openid, '发送者 openid');
  const targetOpenId = targetType === 'c2c' ? senderOpenId : identifier(data.group_openid, '群 openid');
  const createdAt = timestamp(data.timestamp), accountId = `qqbot:${knownAppId}`;
  const scope: Scope = {
    accountId, conversationId: `${targetType}:${targetOpenId}`,
    ...(targetType === 'c2c' ? { contactId: senderOpenId } : {}),
  };
  if (data.content !== undefined && typeof data.content !== 'string') throw new Error('文本消息格式无效。');
  const content = typeof data.content === 'string' ? data.content : '';
  if (content.length > 100_000) throw new Error('文本消息超过接入上限。');
  if (data.attachments !== undefined && !Array.isArray(data.attachments)) throw new Error('媒体附件格式无效。');
  const sourceAttachments = data.attachments as unknown[] | undefined;
  if ((sourceAttachments?.length ?? 0) > 16) throw new Error('附件数量超过接入上限。');
  const attachments: QqAttachment[] = (sourceAttachments ?? []).map(raw => {
    const attachment = object(raw, '媒体附件');
    const contentType = typeof attachment.content_type === 'string' ? attachment.content_type : '';
    const kind: QqAttachment['kind'] = /^image\/(?:jpeg|png|gif|webp)$/u.test(contentType) ? 'image'
      : contentType === 'voice' || /^audio\//u.test(contentType) ? 'audio' : 'unsupported';
    return { kind, contentType, url: optionalUrl(attachment.url),
      ...(typeof attachment.filename === 'string' ? { filename: attachment.filename.slice(0, 1_024) } : {}),
      ...(typeof attachment.size === 'number' && Number.isSafeInteger(attachment.size) && attachment.size >= 0
        ? { size: attachment.size } : {}) };
  });
  const messages: Message[] = content.trim() ? [{
    id: `${sourceMessageId}:text`, scope, role: 'peer', text: content, kind: 'text', createdAt,
  }] : [];
  attachments.forEach((attachment, index) => {
    if (attachment.kind === 'unsupported') return;
    messages.push({ id: `${sourceMessageId}:attachment:${index}`, scope, role: 'peer',
      text: attachment.kind === 'image' ? '收到图片（尚未分析）' : '收到语音（尚未转写）',
      kind: attachment.kind, createdAt, attachmentConfirmed: false });
  });
  if (!content.trim() && !attachments.length) throw new Error('平台消息没有可处理的内容。');
  return { accountId, type, sourceMessageId, targetType, targetOpenId, senderOpenId, scope,
    createdAt, receivedAt, messages, attachments,
    dedupeKey: JSON.stringify([accountId, targetType, targetOpenId, sourceMessageId]),
    requiresReview: attachments.length > 0 };
}

export interface QqReplyReservation {
  key: string; accountId: string; sourceMessageId: string; targetType: 'c2c' | 'group'; targetOpenId: string;
  msgSeq: 1; draftId: string; reservedAt: number; status: 'pending' | 'accepted' | 'unknown'; platformMessageId?: string;
}
export interface QqReplyLedgerState { version: 1; records: QqReplyReservation[] }
export interface QqPassiveReplyPlan {
  method: 'POST'; url: string; reservation: QqReplyReservation;
  body: { content: string; msg_type: 0; msg_id: string; msg_seq: 1 };
}

/**
 * Pure reservation/state module, not a live connector. A host MUST atomically persist both this
 * ledger and QueueEngine's inFlight state before performing network I/O. One reply per source event.
 */
export class QqPassiveReplyLedger {
  private records: QqReplyReservation[];
  constructor(state?: QqReplyLedgerState) {
    if (state && (state.version !== 1 || !Array.isArray(state.records))) throw new Error('QQ 回复记录版本无效。');
    this.records = state ? structuredClone(state.records) : [];
    const keys = new Set<string>();
    for (const record of this.records) {
      if (typeof record.key !== 'string' || keys.has(record.key)
        || !['pending', 'accepted', 'unknown'].includes(record.status)) throw new Error('QQ 回复记录损坏。');
      keys.add(record.key);
      // Crash between persistence and a network result is ambiguous: never blindly resend.
      if (record.status === 'pending') record.status = 'unknown';
    }
  }
  snapshot(): QqReplyLedgerState { return { version: 1, records: structuredClone(this.records) }; }
  reserve(event: QqBotEvent, draft: Draft, rule: Rule, context: SendContext): QqPassiveReplyPlan {
    if (draft.status !== 'queued') throw new Error('草稿未进入有效发送队列，不能预留回复。');
    if (!sameScope(event.scope, draft.scope) || draft.scope.accountId !== event.accountId)
      throw new Error('草稿不属于该机器人会话。');
    if (event.attachments.some(attachment => attachment.kind === 'unsupported')) throw new Error('消息包含尚未支持的媒体，需手动处理。');
    if (!draft.messageIds.length || draft.messageIds.length !== event.messages.length
      || event.messages.some(message => !draft.messageIds.includes(message.id))) throw new Error('草稿没有覆盖该平台消息的全部内容。');
    const decision = evaluateSafety(draft, event.messages, rule, context);
    if (!decision.allowed) throw new Error(`程序规则阻止发送：${decision.reasons.join('、')}`);
    if (!Number.isSafeInteger(context.now) || context.now < event.createdAt || context.now < event.receivedAt)
      throw new Error('消息时间尚未到达或本机时间无效，不能确认回复窗口。');
    const windowMs = event.targetType === 'c2c' ? 60 * 60_000 : 5 * 60_000;
    // Reserve a small margin so payload construction at the exact expiry cannot allow a late send.
    if (context.now >= event.createdAt + windowMs - 5_000) throw new Error('平台被动回复窗口已过期或即将过期。');
    if (this.records.some(record => record.key === event.dedupeKey)) throw new Error('该消息已有发送预留或结果，需要核对，不能重复发送。');
    const reservation: QqReplyReservation = {
      key: event.dedupeKey, accountId: event.accountId, sourceMessageId: event.sourceMessageId,
      targetType: event.targetType, targetOpenId: event.targetOpenId, msgSeq: 1,
      draftId: draft.id, reservedAt: context.now, status: 'pending',
    };
    this.records.push(structuredClone(reservation));
    const segment = event.targetType === 'c2c' ? 'users' : 'groups';
    return { method: 'POST', url: `https://api.sgroup.qq.com/v2/${segment}/${encodeURIComponent(event.targetOpenId)}/messages`,
      reservation: structuredClone(reservation),
      body: { content: draft.text, msg_type: 0, msg_id: event.sourceMessageId, msg_seq: 1 } };
  }
  markAccepted(key: string, response: unknown): void {
    const record = this.pending(key), result = object(response, '平台返回');
    // Call only for a verified successful HTTP/API result, not an error object or a local draft.
    record.platformMessageId = identifier(result.id, '平台发送消息 ID'); record.status = 'accepted';
  }
  markUnknown(key: string): void { this.pending(key).status = 'unknown'; }
  private pending(key: string): QqReplyReservation {
    const record = this.records.find(item => item.key === key);
    if (!record || record.status !== 'pending') throw new Error('没有对应的待发送预留。');
    return record;
  }
}
