import type { PersonalExample, PersonalOriginal, Scope } from './index';

export type TrainingFormat = 'auto' | 'json' | 'jsonl' | 'csv' | 'tsv';
export interface TrainingRecord {
  id: string;
  role: 'self' | 'peer';
  text: string;
  received?: string;
  relationship?: string;
  scenario?: string;
  tags?: string[];
  /** Retained during preview so changing a role cannot turn AI output into a self sample. */
  provenance?: 'human' | 'generated';
  scope?: Scope;
}
export interface TrainingDataset {
  format: Exclude<TrainingFormat, 'auto'>;
  records: TrainingRecord[];
  /** Parsing previews data; only the explicit import confirmations authorize learning. */
  confirmed: false;
}
export interface TrainingParseOptions { format?: TrainingFormat; fileName?: string }
export interface TrainingImportOptions { confirmOwner: boolean; confirmHumanSource: boolean; scope: Scope }
export interface TrainingImportResult {
  originals: PersonalOriginal[];
  examples: PersonalExample[];
  roleplayRecords: TrainingRecord[];
}
export const TRAINING_LIMITS = { bytes: 2 * 1024 * 1024, rows: 2000, field: 8000, original: 6000 } as const;

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const rawFields = new Set(['id', 'role', 'text', 'received', 'reply', 'relationship', 'scenario', 'tags', 'provenance', 'source', 'origin', 'automated', 'generated', 'isAI']);
const canonicalFields = new Set(['id', 'role', 'text', 'received', 'relationship', 'scenario', 'tags', 'provenance', 'scope']);
const formats = ['auto', 'json', 'jsonl', 'csv', 'tsv'];
function error(message: string, row?: number): never { throw new Error(`${row === undefined ? '' : `第${row}条记录：`}${message}`); }
function stringField(value: unknown, field: string, max: number, row?: number, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) error(`${field}必须是${required ? '非空、' : ''}最多${max}字的文本。`, row);
  return value;
}
function privateScope(value: unknown): Scope {
  if (!object(value)) error('私有导入必须指定账号和会话作用域。');
  const accountId = stringField(value.accountId, '账号', 256, undefined, true)!;
  const conversationId = stringField(value.conversationId, '会话', 256, undefined, true)!;
  const contactId = value.contactId === undefined ? undefined : stringField(value.contactId, '联系人', 256, undefined, true);
  return { accountId, conversationId, ...(contactId === undefined ? {} : { contactId }) };
}
function checkByteSize(text: string): void {
  if (new TextEncoder().encode(text).byteLength > TRAINING_LIMITS.bytes) error('训练文件不能超过2 MiB。');
}
function checkRows(records: unknown): asserts records is unknown[] {
  if (!Array.isArray(records) || records.length === 0) error('训练数据必须包含至少一条记录。');
  if (records.length > TRAINING_LIMITS.rows) error('训练记录不能超过2000条。');
}
function tags(value: unknown, row: number): string[] | undefined {
  if (value === undefined) return undefined;
  // Delimited files may store a JSON array or use | to separate simple labels.
  if (typeof value === 'string') {
    if (value.trim().startsWith('[')) {
      try { value = JSON.parse(value); } catch { error('tags中的JSON数组无效。', row); }
    } else value = value.split('|').map(tag => tag.trim());
  }
  if (!Array.isArray(value) || value.length > 20 || value.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80)) error('tags最多20个非空标签，每个最多80字。', row);
  return [...value] as string[];
}
function provenance(value: Record<string, unknown>, row: number): 'human' | 'generated' | undefined {
  let result: 'human' | 'generated' | undefined;
  for (const name of ['provenance', 'source', 'origin']) {
    const raw = value[name];
    if (raw === undefined) continue;
    if (typeof raw !== 'string') error(`${name}来源标记无效。`, row);
    const normalized = raw.toLowerCase().trim();
    const next = ['generated', 'assistant', 'ai', 'model', 'synthetic', 'bot', 'llm'].includes(normalized) ? 'generated'
      : ['human', 'self', 'peer', 'user', 'user-confirmed', 'imported-self', 'manual'].includes(normalized) ? 'human' : undefined;
    if (!next) error(`${name}必须明确标记human或generated来源。`, row);
    // A generated marker always wins over a conflicting human marker.
    result = result === 'generated' || next === 'generated' ? 'generated' : 'human';
  }
  for (const name of ['automated', 'generated', 'isAI']) {
    const raw = value[name];
    if (raw === undefined) continue;
    if (typeof raw !== 'boolean') error(`${name}必须是布尔值。`, row);
    if (raw) result = 'generated';
  }
  return result;
}
function normalizeRecord(value: unknown, index: number, prefix: string): TrainingRecord {
  const row = index + 1;
  if (!object(value)) error('记录必须是对象。', row);
  for (const [key, field] of Object.entries(value)) {
    if (!rawFields.has(key)) error(`不支持字段“${key}”。`, row);
    if (typeof field === 'string' && field.length > TRAINING_LIMITS.field) error(`字段“${key}”不能超过8000字。`, row);
  }
  const pair = value.reply !== undefined;
  let role: TrainingRecord['role'];
  if (value.role === undefined && pair) role = 'self';
  else if (['self', '本人', '我'].includes(String(value.role))) role = 'self';
  else if (['peer', '他人', '对方'].includes(String(value.role))) role = 'peer';
  else error('role必须明确为self（本人）或peer（对方）。', row);
  if (pair && role !== 'self') error('received/reply配对只能标记为本人self回复。', row);
  if (pair && value.text !== undefined && value.text !== value.reply) error('text和reply不能提供不同的回复。', row);
  const text = stringField(pair ? value.reply : value.text, pair ? 'reply' : 'text', TRAINING_LIMITS.field, row, true)!;
  const received = stringField(value.received, 'received', TRAINING_LIMITS.field, row, pair);
  const id = value.id === undefined ? `${prefix}:${index + 1}` : stringField(value.id, 'id', 256, row, true)!;
  const relationship = stringField(value.relationship, 'relationship', 120, row);
  const scenario = stringField(value.scenario, 'scenario', TRAINING_LIMITS.field, row);
  const recordTags = tags(value.tags, row);
  const recordProvenance = provenance(value, row);
  return { id, role, text, ...(received === undefined ? {} : { received }), ...(relationship === undefined ? {} : { relationship }),
    ...(scenario === undefined ? {} : { scenario }), ...(recordTags === undefined ? {} : { tags: recordTags }),
    ...(recordProvenance === undefined ? {} : { provenance: recordProvenance }) };
}

/** Validate saved/edited records again, including retained provenance and private scopes. */
export function validateTrainingRecords(value: unknown): asserts value is TrainingRecord[] {
  checkRows(value);
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const record = value[index], row = index + 1;
    if (!object(record)) error('记录必须是对象。', row);
    for (const key of Object.keys(record)) if (!canonicalFields.has(key)) error(`不支持字段“${key}”。`, row);
    const id = stringField(record.id, 'id', 256, row, true)!;
    if (ids.has(id)) error(`id“${id}”重复。`, row);
    ids.add(id);
    if (record.role !== 'self' && record.role !== 'peer') error('role必须明确为self（本人）或peer（对方）。', row);
    stringField(record.text, 'text', TRAINING_LIMITS.field, row, true);
    stringField(record.received, 'received', TRAINING_LIMITS.field, row);
    stringField(record.relationship, 'relationship', 120, row);
    stringField(record.scenario, 'scenario', TRAINING_LIMITS.field, row);
    if (record.tags !== undefined && !Array.isArray(record.tags)) error('保存的tags必须是数组。', row);
    tags(record.tags, row);
    if (record.provenance !== undefined && record.provenance !== 'human' && record.provenance !== 'generated') error('provenance来源标记无效。', row);
    if (record.scope !== undefined) privateScope(record.scope);
  }
  checkByteSize(JSON.stringify(value));
}
export function validateTrainingDataset(value: unknown): asserts value is TrainingDataset {
  if (!object(value) || value.confirmed !== false || typeof value.format !== 'string' || !['json', 'jsonl', 'csv', 'tsv'].includes(value.format)
    || Object.keys(value).some(key => !['format', 'records', 'confirmed'].includes(key))) error('训练预览结构或确认标记无效。');
  validateTrainingRecords(value.records);
}
function jsonRecords(text: string): unknown[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { error('JSON格式无效，请检查引号、逗号和括号。'); }
  if (object(parsed) && 'records' in parsed && Object.keys(parsed).some(key => key !== 'records')) error('JSON records容器不能含未识别的字段或来源标记。');
  const records = object(parsed) && 'records' in parsed ? parsed.records : object(parsed) ? [parsed] : parsed;
  checkRows(records);
  return records;
}
function jsonLines(text: string): unknown[] {
  const lines = text.split(/\r?\n/u), records: unknown[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { error(`JSONL第${index + 1}行格式无效。`); }
    if (records.length > TRAINING_LIMITS.rows) error('训练记录不能超过2000条。');
  }
  checkRows(records);
  return records;
}
/** RFC-style quoted cells, escaped quotes, CRLF and embedded line breaks. */
function delimitedRecords(text: string, delimiter: ',' | '\t'): unknown[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closedQuote = false, atStart = true;
  const finishCell = () => { row.push(cell); cell = ''; atStart = true; closedQuote = false; };
  const finishRow = () => {
    finishCell();
    if (row.length !== 1 || row[0] !== '') rows.push(row);
    row = [];
    if (rows.length > TRAINING_LIMITS.rows + 1) error('训练记录不能超过2000条。');
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else cell += char;
    } else if (char === delimiter) finishCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      finishRow();
    } else if (closedQuote) error('带引号的单元格结束后只能接分隔符或换行。');
    else if (char === '"') {
      if (!atStart) error('单元格中的引号必须转义，或用双引号包住整个单元格。');
      quoted = true; atStart = false;
    } else { cell += char; atStart = false; }
    if (cell.length > TRAINING_LIMITS.field) error('单元格不能超过8000字。');
    if (row.length > rawFields.size) error('训练表格的字段过多。');
  }
  if (quoted) error('训练表格存在未闭合的引号。');
  if (cell !== '' || row.length || closedQuote) finishRow();
  const header = rows.shift()?.map(name => name.trim());
  if (!header?.length || header.some(name => !rawFields.has(name)) || new Set(header).size !== header.length) error('CSV/TSV表头必须使用唯一的受支持字段名（role/text或received/reply）。');
  if (!(header.includes('text') && header.includes('role')) && !(header.includes('received') && header.includes('reply'))) error('CSV/TSV需要role/text或received/reply表头。');
  const records = rows.map((cells, index) => {
    if (cells.length !== header.length) error('列数与表头不一致。', index + 1);
    const result: Record<string, unknown> = {};
    header.forEach((name, cellIndex) => {
      const value = cells[cellIndex]!;
      if (!value && !['role', 'text', 'reply', 'received'].includes(name)) return;
      if (['automated', 'generated', 'isAI'].includes(name)) {
        if (value !== 'true' && value !== 'false') error(`${name}必须为true或false。`, index + 1);
        result[name] = value === 'true';
      } else result[name] = value;
    });
    return result;
  });
  checkRows(records);
  return records;
}
function detectFormat(text: string, fileName?: string): Exclude<TrainingFormat, 'auto'> {
  const extension = fileName?.toLowerCase().split('.').at(-1);
  if (extension === 'ndjson' || extension === 'jsonl') return 'jsonl';
  if (extension && ['json', 'csv', 'tsv'].includes(extension)) return extension as 'json' | 'csv' | 'tsv';
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('{')) {
    try { JSON.parse(text); return 'json'; } catch {
      const lines = text.split(/\r?\n/u).filter(line => line.trim());
      if (lines.length > 1 && lines.every(line => { try { return object(JSON.parse(line)); } catch { return false; } })) return 'jsonl';
      return 'json';
    }
  }
  return text.split(/\r?\n/u, 1)[0]!.includes('\t') ? 'tsv' : 'csv';
}

export function parseTrainingDataset(text: string, options: TrainingParseOptions = {}): TrainingDataset {
  if (typeof text !== 'string') error('训练文件必须是文本。');
  checkByteSize(text);
  if (!object(options) || (options.format !== undefined && (typeof options.format !== 'string' || !formats.includes(options.format)))
    || (options.fileName !== undefined && typeof options.fileName !== 'string')) error('训练文件格式选项无效。');
  const clean = text.replace(/^\uFEFF/u, '');
  if (!clean.trim()) error('训练文件为空。');
  const selectedFormat = options.format as TrainingFormat | undefined;
  const format: Exclude<TrainingFormat, 'auto'> = selectedFormat && selectedFormat !== 'auto' ? selectedFormat : detectFormat(clean, options.fileName);
  const rows = format === 'json' ? jsonRecords(clean) : format === 'jsonl' ? jsonLines(clean) : delimitedRecords(clean, format === 'tsv' ? '\t' : ',');
  // Content-based IDs keep unrelated file imports from overwriting each other's default IDs.
  let hash = 2166136261;
  for (let index = 0; index < clean.length; index++) hash = Math.imul(hash ^ clean.charCodeAt(index), 16777619);
  const dataset: TrainingDataset = { format, records: rows.map((row, index) => normalizeRecord(row, index, `training:${hash >>> 0}`)), confirmed: false };
  validateTrainingDataset(dataset);
  return dataset;
}

/** Self samples enter learning only after the owner confirms ownership and human source. */
export function importTrainingDataset(dataset: TrainingDataset, options: TrainingImportOptions): TrainingImportResult {
  validateTrainingDataset(dataset);
  if (!object(options) || options.confirmOwner !== true || options.confirmHumanSource !== true) error('导入前必须明确确认：self是本人实际表达，来源为真人而非AI。');
  const scope = privateScope(options.scope);
  const originals: PersonalOriginal[] = [], examples: PersonalExample[] = [], roleplayRecords: TrainingRecord[] = [];
  for (let index = 0; index < dataset.records.length; index++) {
    const record = dataset.records[index]!;
    const metadata = () => ({ scope: { ...scope }, ...(record.relationship === undefined ? {} : { relationship: record.relationship }), ...(record.tags === undefined ? {} : { tags: [...record.tags] }) });
    if (record.role === 'peer') {
      roleplayRecords.push({ ...record, ...metadata() });
      continue;
    }
    if (record.provenance === 'generated') error('AI生成内容不能导入本人学习；请使用本人实际表达。', index + 1);
    if (record.text.length > TRAINING_LIMITS.original) error('本人原句不能超过6000字，请明确拆分后重新导入。', index + 1);
    originals.push({ id: `imported-original:${record.id}`, text: record.text, source: 'imported-self', confirmed: true, shareable: false, ...metadata() });
    if (record.received?.trim()) examples.push({ id: `imported-example:${record.id}`, received: record.received, reply: record.text,
      note: record.scenario ?? '', origin: 'self', confirmed: true, shareable: false, ...metadata() });
  }
  return { originals, examples, roleplayRecords };
}
