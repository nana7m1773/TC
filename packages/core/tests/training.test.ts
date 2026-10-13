import test from 'node:test';
import assert from 'node:assert/strict';
import { importTrainingDataset, parseTrainingDataset, validateTrainingDataset, validateTrainingRecords, type TrainingDataset, type TrainingImportOptions } from '../src/training.ts';
import { analyzeLearning, buildPrompt, createDefaultProfile, retrieveExamples, retrieveOriginalPhrases, type Scope } from '../src/index.ts';

const scope: Scope = { accountId: 'account', conversationId: 'private', contactId: 'friend' };
const otherScope: Scope = { ...scope, conversationId: 'other' };
const approved = (): TrainingImportOptions => ({ confirmOwner: true, confirmHumanSource: true, scope: { ...scope } });
const json = (records: unknown) => parseTrainingDataset(JSON.stringify(records));

test('JSON arrays, record containers and single records produce unconfirmed editable previews', () => {
  for (const input of [[{ role: 'self', text: '收到啦' }], { records: [{ role: 'self', text: '收到啦' }] }, { role: 'self', text: '收到啦' }]) {
    const dataset = json(input);
    assert.equal(dataset.confirmed, false);
    assert.equal(dataset.format, 'json');
    assert.equal(dataset.records[0]!.role, 'self');
    assert.equal(dataset.records[0]!.text, '收到啦');
    assert.ok(dataset.records[0]!.id);
  }
  assert.notEqual(json([{ role: 'self', text: 'first file' }]).records[0]!.id, json([{ role: 'self', text: 'second file' }]).records[0]!.id);
});

test('JSONL auto detection and explicit file extensions preserve all rows and diagnose bad lines', () => {
  const content = '\uFEFF{"role":"self","text":"你好"}\r\n\r\n{"role":"peer","text":"再见"}\n';
  const dataset = parseTrainingDataset(content);
  assert.equal(dataset.format, 'jsonl');
  assert.deepEqual(dataset.records.map(record => record.role), ['self', 'peer']);
  assert.equal(parseTrainingDataset('{"role":"peer","text":"你好"}', { fileName: 'chat.NDJSON' }).format, 'jsonl');
  assert.throws(() => parseTrainingDataset('{"role":"self","text":"ok"}\n{"role":', { format: 'jsonl' }), /第2行/);
});

test('quoted CSV preserves commas, escaped quotes, multiline cells, CRLF and optional metadata', () => {
  const content = 'id,role,text,received,relationship,scenario,tags\r\n"my-id",self,"好呀, \"\"下次\"\"\n再聊","有空吗？",朋友,聊天,"轻松|简短"\r\npeer-1,peer,PEER_ONLY,,,,\r\n';
  const dataset = parseTrainingDataset(content, { fileName: 'sample.csv' });
  assert.equal(dataset.format, 'csv');
  assert.equal(dataset.records.length, 2);
  assert.deepEqual(dataset.records[0], { id: 'my-id', role: 'self', text: '好呀, "下次"\n再聊', received: '有空吗？', relationship: '朋友', scenario: '聊天', tags: ['轻松', '简短'] });
  assert.equal(dataset.records[1]!.role, 'peer');
});

test('TSV supports received/reply pairs and JSON tags while explicit formats override filenames', () => {
  const content = 'received\treply\ttags\n怎么说\t我想想再回你\t"[""思考"",""简短""]"';
  const dataset = parseTrainingDataset(content, { format: 'tsv', fileName: 'misleading.json' });
  assert.equal(dataset.format, 'tsv');
  assert.equal(dataset.records[0]!.role, 'self');
  assert.equal(dataset.records[0]!.received, '怎么说');
  assert.deepEqual(dataset.records[0]!.tags, ['思考', '简短']);
  assert.equal(parseTrainingDataset(content).format, 'tsv');
});

test('received/reply pairs have unambiguous ownership and text values', () => {
  assert.equal(json([{ received: '问题', reply: '我确认后回复' }]).records[0]!.text, '我确认后回复');
  assert.equal(json([{ role: '本人', text: '好呀' }]).records[0]!.role, 'self');
  for (const row of [{ role: 'peer', received: '问题', reply: '答复' }, { received: '', reply: '答复' }, { reply: '答复' }, { received: '问题', reply: '答复', text: '另一个答复' }]) assert.throws(() => json([row]), /第1条记录/);
});

test('CSV/TSV errors never skip partial rows, mismatched columns or invalid quoting', () => {
  for (const content of ['role,text\nself,ok\n,', 'role,text\nself,ok\npeer', 'role,text\nself,"open', 'role,text\nself,"closed"extra', 'role,text\nself,unescaped"quote', 'role,role,text\nself,self,hello', 'text\nhello', 'role,text,unknown\nself,ok,value']) assert.throws(() => parseTrainingDataset(content, { format: 'csv' }));
  assert.throws(() => parseTrainingDataset('role,text\nself,ok\npeer,', { format: 'csv' }), /第2条记录/);
});

test('invalid rows, duplicate IDs, unsupported fields and malformed metadata fail with record positions', () => {
  for (const row of [null, 'plain string', { text: 'missing role' }, { role: 'assistant', text: 'not owner' }, { role: 'self', text: 12 }, { role: 'self', text: ' ' }, { role: 'self', text: 'ok', hiddenSource: 'generated' }, { role: 'self', text: 'ok', tags: [''] }, { role: 'self', text: 'ok', tags: [3] }, { role: 'self', text: 'ok', relationship: 'a'.repeat(121) }, { role: 'self', text: 'ok', source: 'unknown' }, { role: 'self', text: 'ok', automated: 'true' }]) assert.throws(() => json([row]), /第1条记录/);
  assert.throws(() => json([{ id: 'same', role: 'self', text: 'one' }, { id: 'same', role: 'peer', text: 'two' }]), /重复/);
  assert.throws(() => json({ records: [{ role: 'self', text: 'ok' }], source: 'generated' }), /来源标记/);
  assert.throws(() => json([{ role: 'self', text: 'ok', tags: Array.from({ length: 21 }, () => 'tag') }]), /20/);
});

test('UTF-8 bytes, row count and field limits reject excess rather than truncating', () => {
  assert.throws(() => parseTrainingDataset('中'.repeat(700000)), /2 MiB/);
  assert.throws(() => json(Array.from({ length: 2001 }, () => ({ role: 'peer', text: 'ok' }))), /2000/);
  assert.equal(json(Array.from({ length: 2000 }, () => ({ role: 'peer', text: 'ok' }))).records.length, 2000);
  assert.throws(() => json([{ role: 'peer', text: 'a'.repeat(8001) }]), /8000/);
  assert.throws(() => json([{ role: 'self', text: 'ok', received: 'a'.repeat(8001) }]), /8000/);
  const peer = json([{ role: 'peer', text: 'a'.repeat(8000) }]);
  assert.equal(importTrainingDataset(peer, approved()).roleplayRecords[0]!.text.length, 8000);
  assert.throws(() => importTrainingDataset(json([{ role: 'self', text: 'a'.repeat(6001) }]), approved()), /6000/);
  assert.equal(importTrainingDataset(json([{ role: 'self', text: 'a'.repeat(6000) }]), approved()).originals[0]!.text.length, 6000);
});

test('empty files, malformed JSON, unknown formats and empty datasets are explicit errors', () => {
  for (const content of ['', ' \n', '[]', '{"records":[]}', '[{"role":"self","text":"ok"},]']) assert.throws(() => parseTrainingDataset(content));
  assert.throws(() => parseTrainingDataset('[]', { format: 'yaml' as 'auto' }), /格式选项/);
  assert.throws(() => parseTrainingDataset('role,text\n', { format: 'csv' }), /至少一条/);
});

test('ownership, human-source and private scope must each be explicitly confirmed', () => {
  const dataset = json([{ role: 'self', text: '实际本人表达' }]);
  const invalid = [{ ...approved(), confirmOwner: false }, { ...approved(), confirmHumanSource: false }, { ...approved(), confirmOwner: 'true' }, { ...approved(), scope: undefined }, { ...approved(), scope: { accountId: ' ', conversationId: 'room' } }, { ...approved(), scope: { accountId: 'account', conversationId: '' } }];
  for (const options of invalid) assert.throws(() => importTrainingDataset(dataset, options as TrainingImportOptions));
  assert.equal(dataset.confirmed, false);
  assert.equal(importTrainingDataset(dataset, approved()).originals[0]!.confirmed, true);
});

test('only self human samples enter private originals and examples; peer records remain scoped roleplay material', () => {
  const dataset = json([{ id: 'owner', role: 'self', received: '摄影展什么时候？', text: '我确认时间后回你', relationship: '朋友', scenario: '询问时间', tags: ['摄影'] }, { id: 'peer', role: 'peer', text: 'PEER_SECRET摄影展' }]);
  const imported = importTrainingDataset(dataset, approved());
  assert.deepEqual(imported.originals[0], { id: 'imported-original:owner', text: '我确认时间后回你', source: 'imported-self', confirmed: true, shareable: false, scope, relationship: '朋友', tags: ['摄影'] });
  assert.equal(imported.examples[0]!.origin, 'self');
  assert.equal(imported.examples[0]!.note, '询问时间');
  assert.equal(imported.examples[0]!.shareable, false);
  assert.equal(imported.roleplayRecords.length, 1);
  assert.deepEqual(imported.roleplayRecords[0]!.scope, scope);
  const profile = { ...createDefaultProfile(), originalPhrases: imported.originals, examples: imported.examples };
  const message = { id: 'incoming', scope, role: 'peer' as const, text: '摄影展', kind: 'text' as const, createdAt: 1 };
  assert.equal(retrieveExamples(profile, [message]).length, 1);
  assert.equal(retrieveOriginalPhrases(profile, [message]).length, 1);
  assert.equal(retrieveExamples(profile, [{ ...message, scope: otherScope }]).length, 0);
  assert.equal(retrieveOriginalPhrases(profile, [{ ...message, scope: otherScope }]).length, 0);
  assert.doesNotMatch(buildPrompt(profile, [], [message]), /PEER_SECRET/);
  assert.doesNotMatch(JSON.stringify(analyzeLearning(profile, scope).evidence), /PEER_SECRET/);
});

test('generated provenance survives preview, role edits and conflicting source markers', () => {
  for (const source of [{ provenance: 'generated' }, { origin: 'assistant' }, { source: 'AI' }, { automated: true }, { generated: true }, { isAI: true }, { provenance: 'human', origin: 'generated' }]) {
    const dataset = json([{ role: 'peer', text: 'MODEL_OUTPUT', ...source }]);
    assert.equal(dataset.records[0]!.provenance, 'generated');
    dataset.records[0]!.role = 'self';
    assert.throws(() => importTrainingDataset(dataset, approved()), /AI生成内容不能导入本人学习/);
  }
  const imported = importTrainingDataset(json([{ role: 'peer', text: 'SIMULATED_PEER', provenance: 'generated' }]), approved());
  assert.equal(imported.originals.length, 0);
  assert.equal(imported.examples.length, 0);
  assert.equal(imported.roleplayRecords[0]!.provenance, 'generated');
});

test('saved and edited data are revalidated so forged confirmations or provenance cannot bypass import', () => {
  const dataset = json([{ role: 'self', text: 'human expression' }]);
  assert.throws(() => validateTrainingDataset({ ...dataset, confirmed: true }), /确认标记/);
  assert.throws(() => validateTrainingDataset({ ...dataset, source: 'generated' }), /结构/);
  assert.throws(() => validateTrainingDataset({ ...dataset, format: { toString: () => 'json' } }), /结构/);
  assert.throws(() => importTrainingDataset({ ...dataset, confirmed: true } as unknown as TrainingDataset, approved()));
  assert.throws(() => validateTrainingRecords([{ ...dataset.records[0], origin: 'generated' }]), /不支持字段/);
  assert.throws(() => validateTrainingRecords([{ ...dataset.records[0], role: 'assistant' }]));
  assert.throws(() => validateTrainingRecords([{ ...dataset.records[0], tags: 'bad saved tags' }]));
  assert.throws(() => validateTrainingRecords([{ ...dataset.records[0], scope: { accountId: 'account' } }]));
  validateTrainingRecords([{ ...dataset.records[0], scope }]);
});

test('import returns independent data and keeps caller-selected private scope for all record classes', () => {
  const dataset = json([{ role: 'self', text: 'owner', received: 'question', tags: ['owner-tag'] }, { role: 'peer', text: 'peer', tags: ['peer-tag'] }]);
  dataset.records[1]!.scope = otherScope;
  const options = approved(), imported = importTrainingDataset(dataset, options);
  dataset.records[0]!.text = 'changed';
  dataset.records[0]!.tags![0] = 'changed';
  dataset.records[1]!.tags![0] = 'changed';
  options.scope.accountId = 'changed';
  assert.equal(imported.originals[0]!.text, 'owner');
  assert.deepEqual(imported.originals[0]!.tags, ['owner-tag']);
  assert.deepEqual(imported.roleplayRecords[0]!.tags, ['peer-tag']);
  assert.deepEqual(imported.roleplayRecords[0]!.scope, scope);
  assert.deepEqual(imported.examples[0]!.scope, scope);
  imported.originals[0]!.scope!.accountId = 'original-only';
  imported.originals[0]!.tags![0] = 'original-only';
  assert.deepEqual(imported.examples[0]!.scope, scope);
  assert.deepEqual(imported.examples[0]!.tags, ['owner-tag']);
});
