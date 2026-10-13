import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const baseUrl = process.env.TC_UI_BASE_URL ?? 'http://127.0.0.1:5173';
const navigate = (page: Page, label: string) => page.locator('nav').getByRole('button', { name: new RegExp(`^${label}`) }).click();
async function pngFixture(page: Page): Promise<Buffer> {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
    const context = canvas.getContext('2d')!; context.fillStyle = '#73916a'; context.fillRect(0, 0, 4, 4);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  return Buffer.from(data, 'base64');
}
function wavFixture(): Buffer {
  const samples = 4_000, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16_000, 24); data.writeUInt32LE(32_000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  return data;
}
async function fixtureDraft(page: Page) {
  await page.getByText('手写草稿 / 查看模拟示例', { exact: true }).click();
  await page.getByRole('button', { name: '载入模拟草稿（不调用 AI）', exact: true }).click();
}

/** Explicit test double: exercises UI contracts; never asserts real engine or device performance. */
async function installNativeTestDouble(page: Page, options: { deferInference?: boolean; multimodal?: boolean; storageFailure?: 'invalid' | 'decrypt'; replyWithTone?: boolean } = {}) {
  await page.addInitScript(({ deferInference, multimodal, storageFailure, replyWithTone }) => {
    const target = window as unknown as {
      assistant: unknown;
      __bridgeCalls: { prompts: string[]; counts: string[]; requests: number; contexts: number[]; media: { kind: string; data: string; contextSize?: number }[]; stops: number };
      __releaseInference?: () => void;
      __storageFixture: { stored: string; original: string; writes: string[]; loads: number };
    };
    target.__bridgeCalls = { prompts: [], counts: [], requests: 0, contexts: [], media: [], stops: 0 };
    const original = JSON.stringify({ version: 99, metadata: 'retained-original-fixture-data' });
    target.__storageFixture = { stored: original, original, writes: [], loads: 0 };
    target.assistant = {
      loadState: async () => {
        target.__storageFixture.loads++;
        if (storageFailure === 'decrypt') throw new Error('测试替身模拟解密失败');
        return { state: storageFailure === 'invalid' ? target.__storageFixture.stored : null };
      },
      saveState: async ({ state }: { state: string }) => {
        target.__storageFixture.writes.push(state); target.__storageFixture.stored = state; return {};
      },
      modelStatus: async () => ({ loaded: true, contextSize: 12800 }),
      tokenize: async ({ text }: { text: string }) => { target.__bridgeCalls.counts.push(text); return { count: 400 }; },
      infer: async ({ prompt, contextSize }: { prompt: string; contextSize: number }) => {
        target.__bridgeCalls.prompts.push(prompt); target.__bridgeCalls.contexts.push(contextSize);
        const style = replyWithTone ? JSON.parse(prompt.split('个人表达偏好及必要判断规则：\n')[1]!.split('\n以下 JSON')[0]!) as { tone: string } : undefined;
        const result = { text: '桥接测试回复（测试替身）' + (style ? `：${style.tone}` : ''), inputTokens: 400, outputTokens: 20, tokensPerSecond: 1, contextSize };
        if (deferInference) return new Promise(resolve => { target.__releaseInference = () => resolve(result); });
        return result;
      },
      request: async () => { target.__bridgeCalls.requests++; throw new Error('测试禁止外部请求'); },
      saveApiKey: async () => ({}), hasApiKey: async () => ({ present: false }), deleteApiKey: async () => ({}),
      stop: async () => { target.__bridgeCalls.stops++; return {}; },
    };
    if (multimodal) {
      const bridge = target.assistant as Record<string, unknown>;
      bridge.analyzeImage = async ({ image, contextSize }: { image: { data: string }; contextSize: number }) => {
        target.__bridgeCalls.media.push({ kind: 'image', data: image.data, contextSize });
        return { text: '视觉测试分析：这是图形，细节存在不确定性。' };
      };
      bridge.transcribeLocal = async ({ audio }: { audio: { data: string } }) => {
        target.__bridgeCalls.media.push({ kind: 'audio', data: audio.data });
        return { text: '语音测试转写：下周一起吃饭吗？' };
      };
    }
  }, { deferInference: options.deferInference === true, multimodal: options.multimodal === true, storageFailure: options.storageFailure, replyWithTone: options.replyWithTone === true });
}

test('browser labels simulation and never pretends to generate with an absent native engine', async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.getByText('模拟通道', { exact: true })).toBeVisible();
  await expect(page.getByText('这些是示例会话。', { exact: false })).toBeVisible();
  await expect(page.getByText('浏览器演示 · 仅内存保存', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('不会伪装模型推理');
  await expect(page.locator('.draft-card')).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});

test('manual receive and explicit fixture review never claim platform acceptance or add training data', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByLabel('待回复的消息', { exact: true }).fill('手动输入：下班后聊一下吧。');
  await page.getByRole('button', { name: '添加消息', exact: true }).click();
  await expect(page.locator('.chat-history .bubble').filter({ hasText: '手动输入：下班后聊一下吧。' })).toHaveCount(1);
  await fixtureDraft(page);
  await expect(page.locator('.reply-panel')).toContainText('未发送');
  await page.getByRole('button', { name: '审核通过', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('没有平台发送权限');
  await expect(page.locator('.reply-panel .draft-card')).toContainText('等待发送');
  await expect(page.locator('.draft-card')).not.toContainText('平台接收');
  await navigate(page, '我的表达');
  await expect(page.getByRole('heading', { name: '本人回复示例 · 0', exact: true })).toBeVisible();
  await navigate(page, '运行与数据');
  await expect(page.locator('.log-row')).toContainText(['本人审核通过；仍未发送', '载入了明确标注的示例草稿，未调用 AI']);
  await page.reload();
  await expect(page.locator('.chat-history')).not.toContainText('手动输入：下班后聊一下吧。');
});

test('one-click pause blocks generation and manual takeover permanently cancels old drafts', async ({ page }) => {
  await page.goto(baseUrl);
  await fixtureDraft(page);
  await page.getByRole('button', { name: '一键暂停', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成个性化回复', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '恢复运行', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成个性化回复', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '手动接管', exact: true }).click();
  await expect(page.locator('.reply-panel .draft-card')).toHaveCount(0);
  await navigate(page, '待审核回复');
  await expect(page.locator('.draft-card')).toContainText('已取消');
  await expect(page.getByRole('button', { name: '审核通过', exact: true })).toHaveCount(0);
  await navigate(page, '消息中心');
  await page.getByRole('button', { name: '结束接管', exact: true }).click();
  await expect(page.locator('.reply-panel .draft-card')).toHaveCount(0);
});

test('preferences persist through navigation and rollback restores the previous editable profile', async ({ page }) => {
  await page.goto(baseUrl);
  await navigate(page, '我的表达');
  const before = await page.getByLabel('表达基调', { exact: true }).inputValue();
  await page.getByLabel('表达基调', { exact: true }).fill('少用形容词，先问清时间。');
  await page.getByLabel(/判断偏好/).fill('比较选项时先考虑实际费用');
  await page.getByRole('button', { name: '保存我的偏好', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('没有进行模型权重训练');
  await navigate(page, '消息中心'); await navigate(page, '我的表达');
  await expect(page.getByLabel('表达基调', { exact: true })).toHaveValue('少用形容词，先问清时间。');
  await page.getByRole('button', { name: '恢复', exact: true }).first().click();
  await expect(page.getByLabel('表达基调', { exact: true })).toHaveValue(before);
});

test('private contact memory stays isolated while explicit shared memory crosses conversations', async ({ page }) => {
  await page.goto(baseUrl);
  await navigate(page, '联系人规则');
  await page.getByLabel('本人确认的信息', { exact: true }).fill('林夏的私人信息 fixture-only');
  await page.getByRole('button', { name: '本人确认并保存', exact: true }).click();
  await expect(page.locator('.memory')).toContainText('仅本会话');
  await navigate(page, '消息中心');
  await page.locator('.conversation').filter({ hasText: '周五项目讨论' }).click();
  await navigate(page, '联系人规则');
  await expect(page.getByRole('heading', { name: '隔离记忆 · 周五项目讨论', exact: true })).toBeVisible();
  await expect(page.locator('.memory')).toHaveCount(0);
  await page.getByLabel('本人确认的信息', { exact: true }).fill('本人允许共享的喜好 fixture-only');
  await page.getByLabel('我明确允许跨会话共享这条信息', { exact: true }).check();
  await page.getByRole('button', { name: '本人确认并保存', exact: true }).click();
  await navigate(page, '消息中心');
  await page.locator('.conversation').filter({ hasText: '家人' }).click();
  await navigate(page, '联系人规则');
  await expect(page.locator('.memory')).toHaveCount(1);
  await expect(page.locator('.memory')).toContainText('本人允许共享的喜好 fixture-only');
  await expect(page.locator('.memory')).not.toContainText('林夏的私人信息');
});

test('chat import requires an explicit self identity and learns only the selected author', async ({ page }) => {
  await page.goto(baseUrl); await navigate(page, '我的表达');
  const scope = { accountId: 'manual', conversationId: 'lin', contactId: 'lin' };
  await page.getByLabel(/JSON 记录/).fill(JSON.stringify([
    { id: 'fixture-peer', authorId: 'friend', scope, text: '对方表达', createdAt: 1 },
    { id: 'fixture-self', authorId: 'me', scope, text: '这是本人回复 fixture-only', createdAt: 2 },
  ]));
  await page.getByRole('button', { name: '本人有权使用并确认导入', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('必须明确选择');
  await page.getByLabel('本人 authorId（必须明确指定）', { exact: true }).fill('me');
  await page.getByRole('button', { name: '本人有权使用并确认导入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本人回复示例 · 1', exact: true })).toBeVisible();
  await expect(page.locator('.example p')).toHaveText('这是本人回复 fixture-only');
});

test('protected export hides plaintext, rejects wrong passwords and restores with automatic sending disabled', async ({ page }) => {
  await page.goto(baseUrl); await navigate(page, '我的表达');
  await page.getByLabel('表达基调', { exact: true }).fill('受保护的偏好 fixture-only');
  await page.getByRole('button', { name: '保存我的偏好', exact: true }).click();
  await navigate(page, '运行与数据');
  await page.getByLabel(/导出 \/ 导入口令/).fill('short');
  await page.getByRole('button', { name: '加密导出', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('至少需要 12 个字符');
  await page.getByLabel(/导出 \/ 导入口令/).fill('fixture-password-12345');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '加密导出', exact: true }).click();
  const download = await downloadPromise;
  const bytes = await readFile((await download.path())!);
  const content = bytes.toString('utf8');
  expect(JSON.parse(content).format).toBe('tc-protected-config');
  expect(content).not.toContain('受保护的偏好'); expect(content).not.toContain('摄影展');
  const file = page.locator('input[type="file"][accept=".tcconfig,application/json"]');
  await page.getByLabel(/导出 \/ 导入口令/).fill('incorrect-password-12345');
  await file.setInputFiles({ name: 'fixture.tcconfig', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByRole('status')).toContainText('口令不正确');
  await page.getByLabel(/导出 \/ 导入口令/).fill('fixture-password-12345');
  await file.setInputFiles({ name: 'fixture.tcconfig', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByRole('status')).toContainText('已暂停并关闭自动发送');
  await expect(page.getByRole('button', { name: '恢复运行', exact: true })).toBeVisible();
  await navigate(page, '联系人规则');
  await expect(page.getByRole('combobox', { name: '回复模式', exact: true })).toHaveValue('suggest');
  await page.getByRole('combobox', { name: '回复模式', exact: true }).selectOption('auto');
  await expect(page.getByRole('status')).toContainText('不能启用自动模式');
  await expect(page.getByRole('combobox', { name: '回复模式', exact: true })).toHaveValue('suggest');
});

test('browser does not save API keys and sensitive custom headers cannot enter ordinary configuration', async ({ page }) => {
  await page.goto(baseUrl); await navigate(page, '自定义 API');
  await page.getByLabel('模型 ID', { exact: true }).fill('fixture-model');
  await page.getByLabel(/^API Key/).fill('fixture-secret-do-not-persist');
  await page.getByRole('button', { name: '保存配置与密钥', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('没有系统安全存储');
  await page.getByText('高级设置', { exact: true }).click();
  await page.getByRole('textbox', { name: '自定义非敏感请求头（JSON）', exact: true }).fill('{"Authorization":"fixture-only"}');
  await page.getByRole('button', { name: '保存配置与密钥', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('敏感请求头');
  await navigate(page, '运行与数据');
  await expect(page.locator('main')).not.toContainText('fixture-secret-do-not-persist');
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('native bridge test double receives updated preferences, scoped memory and matching tokenizer budget without external fallback', async ({ page }) => {
  await installNativeTestDouble(page); await page.goto(baseUrl);
  await navigate(page, '我的表达');
  await page.getByLabel('表达基调', { exact: true }).fill('桥接验证：先问安排再承诺');
  await page.getByRole('button', { name: '保存我的偏好', exact: true }).click();
  await navigate(page, '联系人规则');
  await page.getByLabel('本人确认的信息', { exact: true }).fill('仅林夏会话的确认信息 fixture-only');
  await page.getByRole('button', { name: '本人确认并保存', exact: true }).click();
  await navigate(page, '消息中心');
  await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
  await expect(page.locator('.draft-card')).toContainText('桥接测试回复（测试替身）');
  const first = await page.evaluate(() => (window as unknown as { __bridgeCalls: { prompts: string[]; counts: string[]; requests: number; contexts: number[] } }).__bridgeCalls);
  expect(first.prompts[0]).toContain('桥接验证：先问安排再承诺');
  expect(first.prompts[0]).toContain('仅林夏会话的确认信息 fixture-only');
  expect(first.counts[0]).toBe(first.prompts[0]); expect(first.contexts).toEqual([12800]); expect(first.requests).toBe(0);
  await page.locator('.conversation').filter({ hasText: '周五项目讨论' }).click();
  await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
  const second = await page.evaluate(() => (window as unknown as { __bridgeCalls: { prompts: string[]; requests: number } }).__bridgeCalls);
  expect(second.prompts).toHaveLength(2); expect(second.prompts[1]).not.toContain('仅林夏会话的确认信息 fixture-only');
  expect(second.requests).toBe(0);
  await navigate(page, '我的表达');
  await expect(page.getByRole('heading', { name: '本人回复示例 · 0', exact: true })).toBeVisible();
});

test('imported image in fully local mode stops at missing component and never reaches external inference', async ({ page }) => {
  await installNativeTestDouble(page); await page.goto(baseUrl);
  const png = await pngFixture(page);
  await page.locator('input[type="file"][accept="image/*,audio/*"]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.attachment')).toContainText('fixture.png');
  await page.getByRole('button', { name: '添加消息', exact: true }).click();
  await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('本地视觉组件尚未安装');
  const calls = await page.evaluate(() => (window as unknown as { __bridgeCalls: { prompts: string[]; requests: number } }).__bridgeCalls);
  expect(calls.requests).toBe(0); expect(calls.prompts).toHaveLength(0);
});

test('China provider presets fill editable endpoints and model IDs without implying credentials or connection', async ({ page }) => {
  await page.goto(baseUrl); await navigate(page, '自定义 API');
  const presets = [
    { name: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { name: '豆包 / 火山方舟', url: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
    { name: '千问 / 阿里云百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  ];
  for (const preset of presets) {
    await page.getByRole('button', { name: preset.name, exact: true }).click();
    await expect(page.getByRole('textbox', { name: /^Base URL/ })).toHaveValue(preset.url);
    await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue(preset.model);
    await expect(page.getByLabel(/^API Key/)).toHaveValue('');
    await page.getByLabel('模型 ID', { exact: true }).fill('user-edited-model-or-endpoint-id');
    await page.getByRole('textbox', { name: /^Base URL/ }).fill('https://user-configured.example/v1');
    await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('user-edited-model-or-endpoint-id');
    await expect(page.getByRole('textbox', { name: /^Base URL/ })).toHaveValue('https://user-configured.example/v1');
  }
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('draft feedback learns nothing from likes alone and requires explicit confirmation of a scoped ideal reply', async ({ page }) => {
  await installNativeTestDouble(page); await page.goto(baseUrl);
  await fixtureDraft(page);
  await page.getByText('修改与「像我 / 不像我」反馈', { exact: true }).click();
  await page.getByRole('button', { name: '像我', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('只有你明确确认的例子才加入检索');
  await navigate(page, '我的表达');
  await expect(page.getByRole('heading', { name: '本人回复示例 · 0', exact: true })).toBeVisible();
  await navigate(page, '消息中心');
  await page.getByText('修改与「像我 / 不像我」反馈', { exact: true }).click();
  await page.getByLabel('修改后的理想回复', { exact: true }).fill('本人修正：请先确认具体时间 fixture-scoped-example');
  await page.getByRole('button', { name: '不像我', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认加入示例检索', exact: true })).toBeDisabled();
  await page.getByLabel('我确认这是本人理想回复，可作此会话示例', { exact: true }).check();
  await page.getByRole('button', { name: '确认加入示例检索', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('仅适用于这条会话');
  await navigate(page, '我的表达');
  await expect(page.getByRole('heading', { name: '本人回复示例 · 1', exact: true })).toBeVisible();
  await expect(page.locator('.example p')).toHaveText('本人修正：请先确认具体时间 fixture-scoped-example');
  await navigate(page, '消息中心');
  await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __bridgeCalls: { prompts: string[] } }).__bridgeCalls.prompts.length)).toBe(1);
  const ownPrompt = await page.evaluate(() => (window as unknown as { __bridgeCalls: { prompts: string[] } }).__bridgeCalls.prompts[0]);
  expect(ownPrompt).toContain('fixture-scoped-example');
  await page.locator('.conversation').filter({ hasText: '周五项目讨论' }).click();
  await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __bridgeCalls: { prompts: string[] } }).__bridgeCalls.prompts.length)).toBe(2);
  const otherPrompt = await page.evaluate(() => (window as unknown as { __bridgeCalls: { prompts: string[] } }).__bridgeCalls.prompts[1]);
  expect(otherPrompt).not.toContain('fixture-scoped-example');
  await navigate(page, '我的表达');
  await expect(page.getByRole('heading', { name: '本人回复示例 · 1', exact: true })).toBeVisible();
});

for (const interruption of ['pause', 'takeover', 'new-message', 'preferences'] as const) {
  test(`delayed native bridge test result is discarded after ${interruption}`, async ({ page }) => {
    await installNativeTestDouble(page, { deferInference: true }); await page.goto(baseUrl);
    await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __bridgeCalls: { prompts: string[] } }).__bridgeCalls.prompts.length)).toBe(1);
    if (interruption === 'pause') await page.getByRole('button', { name: '一键暂停', exact: true }).click();
    else if (interruption === 'takeover') await page.getByRole('button', { name: '手动接管', exact: true }).click();
    else if (interruption === 'new-message') {
      await page.getByLabel('待回复的消息', { exact: true }).fill('生成期间收到的新消息 fixture-only');
      await page.getByRole('button', { name: '添加消息', exact: true }).click();
    } else {
      await navigate(page, '我的表达');
      await page.getByLabel('表达基调', { exact: true }).fill('生成期间更新的表达偏好 fixture-only');
      await page.getByRole('button', { name: '保存我的偏好', exact: true }).click();
      await navigate(page, '消息中心');
    }
    await page.evaluate(() => (window as unknown as { __releaseInference?: () => void }).__releaseInference?.());
    await expect(page.getByRole('status')).toContainText(interruption === 'new-message' || interruption === 'preferences' ? '旧结果已丢弃' : '结果已丢弃');
    await expect(page.locator('.draft-card')).toHaveCount(0);
    await expect(page.locator('.message.self')).toHaveCount(0);
    const calls = await page.evaluate(() => (window as unknown as { __bridgeCalls: { requests: number } }).__bridgeCalls);
    expect(calls.requests).toBe(0);
    await navigate(page, '待审核回复');
    await expect(page.locator('.draft-card')).toHaveCount(0);
  });
}

test('attachments follow their own message and cannot become another conversation or newly selected file', async ({ page }) => {
  await installNativeTestDouble(page); await page.goto(baseUrl);
  const chooser = page.locator('input[type="file"][accept="image/*,audio/*"]');
  const png = await pngFixture(page);
  await chooser.setInputFiles({ name: 'lin-only-fixture.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.attachment')).toContainText('lin-only-fixture.png');
  await page.getByRole('button', { name: '添加消息', exact: true }).click();
  await expect(page.locator('.attachment')).toHaveCount(0);
  await chooser.setInputFiles({ name: 'unadded-fixture.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.locator('.attachment')).toContainText('unadded-fixture.wav');
  await page.locator('.conversation').filter({ hasText: '周五项目讨论' }).click();
  await expect(page.locator('.attachment')).toHaveCount(0);
  await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
  await expect(page.locator('.draft-card')).toContainText('桥接测试回复（测试替身）');
  await page.locator('.conversation').filter({ hasText: '林夏' }).click();
  await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('本地视觉组件尚未安装');
  const calls = await page.evaluate(() => (window as unknown as { __bridgeCalls: { prompts: string[]; requests: number } }).__bridgeCalls);
  expect(calls.prompts).toHaveLength(1); expect(calls.requests).toBe(0);
});

for (const kind of ['image', 'audio'] as const) {
  test(`staged local ${kind} bridge test preserves original input and requires checked analysis before tokenizer-budgeted reply`, async ({ page }) => {
    await installNativeTestDouble(page, { multimodal: true }); await page.goto(baseUrl);
    const name = kind === 'image' ? 'staged-fixture.png' : 'staged-fixture.wav';
    const buffer = kind === 'image' ? await pngFixture(page) : wavFixture();
    await page.locator('input[type="file"][accept="image/*,audio/*"]').setInputFiles({ name, mimeType: kind === 'image' ? 'image/png' : 'audio/wav', buffer });
    await expect(page.locator('.attachment')).toContainText(name);
    const original = `原始${kind}消息 fixture-only`;
    await page.getByLabel('待回复的消息', { exact: true }).fill(original);
    await page.getByRole('button', { name: '添加消息', exact: true }).click();
    await page.getByRole('button', { name: kind === 'image' ? '理解这张图片' : '转写这条语音', exact: true }).click();
    await expect(page.locator('.media-result')).toContainText('等待本人检查');
    await expect(page.locator('.chat-history .bubble').filter({ hasText: original })).toHaveCount(1);
    await expect(page.locator('.draft-card')).toHaveCount(0);
    await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('请先查看并确认');
    const correction = `本人修正的${kind}理解 fixture-corrected-analysis`;
    await page.getByLabel('附件处理结果', { exact: true }).fill(correction);
    await page.getByRole('button', { name: '修正并确认', exact: true }).click();
    await expect(page.locator('.media-result')).toContainText('本人已确认');
    await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
    await expect(page.locator('.draft-card')).toContainText('桥接测试回复（测试替身）');
    const calls = await page.evaluate(() => (window as unknown as { __bridgeCalls: { prompts: string[]; counts: string[]; contexts: number[]; media: { kind: string; data: string; contextSize?: number }[]; requests: number; stops: number } }).__bridgeCalls);
    expect(calls.media).toHaveLength(1); expect(calls.media[0]!.kind).toBe(kind);
    expect(calls.prompts).toHaveLength(1); expect(calls.prompts[0]).toContain(original); expect(calls.prompts[0]).toContain(correction);
    expect(calls.counts[0]).toBe(calls.prompts[0]); expect(calls.contexts).toEqual([12800]); expect(calls.requests).toBe(0);
    if (kind === 'image') { expect(calls.media[0]!.contextSize).toBe(12800); expect(calls.stops).toBe(1); }
    else {
      expect(calls.media[0]!.data).toMatch(/^data:audio\/wav;base64,/);
      const normalized = Buffer.from(calls.media[0]!.data.split(',')[1]!, 'base64');
      expect(normalized.toString('ascii', 0, 4)).toBe('RIFF'); expect(normalized.readUInt32LE(24)).toBe(16000); expect(normalized.readUInt16LE(22)).toBe(1);
    }
    await expect(page.locator('.chat-history .bubble').filter({ hasText: original })).toHaveCount(1);
    await navigate(page, '联系人规则'); await expect(page.locator('.memory')).toHaveCount(0);
    await navigate(page, '我的表达'); await expect(page.getByRole('heading', { name: '本人回复示例 · 0', exact: true })).toBeVisible();
  });
}

for (const failure of ['invalid', 'decrypt'] as const) {
  test(`native storage ${failure} failure keeps original stored data and never saves the in-memory fallback`, async ({ page }) => {
    await installNativeTestDouble(page, { storageFailure: failure }); await page.goto(baseUrl);
    await expect(page.getByRole('status')).toContainText('安全存储未就绪');
    await expect(page.getByRole('status')).toContainText(failure === 'invalid' ? '配置结构不受支持' : '测试替身模拟解密失败');
    await page.getByLabel('待回复的消息', { exact: true }).fill('保存失败期间的仅内存消息 fixture-only');
    await page.getByRole('button', { name: '添加消息', exact: true }).click();
    await navigate(page, '我的表达');
    await page.getByLabel('表达基调', { exact: true }).fill('保存失败期间的仅内存偏好 fixture-only');
    await page.getByRole('button', { name: '保存我的偏好', exact: true }).click();
    await page.getByRole('button', { name: '一键暂停', exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const stored = await page.evaluate(() => (window as unknown as { __storageFixture: { stored: string; original: string; writes: string[]; loads: number } }).__storageFixture);
    expect(stored.loads).toBeGreaterThan(0); expect(stored.writes).toHaveLength(0); expect(stored.stored).toBe(stored.original);
    expect(stored.stored).not.toContain('仅内存消息'); expect(stored.stored).not.toContain('仅内存偏好');
  });
}

test('editing personal preferences cancels obsolete drafts and regenerates a different visible reply for the same incoming message', async ({ page }) => {
  await installNativeTestDouble(page, { replyWithTone: true }); await page.goto(baseUrl);
  await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
  await expect(page.locator('.draft-card .draft-text')).toContainText('自然、简洁，先理解对方再回复');
  const incomingCount = await page.locator('.chat-history .bubble').count();
  await navigate(page, '我的表达');
  const newTone = '修改后先确认时间 fixture-tone-v2';
  await page.getByLabel('表达基调', { exact: true }).fill(newTone);
  await page.getByRole('button', { name: '保存我的偏好', exact: true }).click();
  await navigate(page, '待审核回复');
  await expect(page.locator('.draft-card')).toContainText('已取消');
  await expect(page.locator('.draft-card .draft-text')).toContainText('自然、简洁，先理解对方再回复');
  await navigate(page, '消息中心');
  await expect(page.locator('.reply-panel .draft-card')).toHaveCount(0);
  await expect(page.locator('.chat-history .bubble')).toHaveCount(incomingCount);
  await page.getByRole('button', { name: '生成个性化回复', exact: true }).click();
  await expect(page.locator('.reply-panel .draft-card .draft-text')).toContainText(newTone);
  await expect(page.locator('.reply-panel .draft-card .draft-text')).not.toContainText('自然、简洁，先理解对方再回复');
  const calls = await page.evaluate(() => (window as unknown as { __bridgeCalls: { prompts: string[]; requests: number } }).__bridgeCalls);
  expect(calls.prompts).toHaveLength(2); expect(calls.prompts[1]).toContain(newTone); expect(calls.requests).toBe(0);
});
