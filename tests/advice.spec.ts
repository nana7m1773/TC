import { test, expect, type Page } from "@playwright/test";
import { createDefaultProfile, QueueEngine } from "../packages/core/src";

const baseUrl = process.env.TC_UI_BASE_URL ?? "http://127.0.0.1:5173";
const lab = (page: Page) => page.getByTestId("advice-lab");
const ownerLabel = "我已核对每条角色，self 是我本人，peer 是对方";
const humanLabel = "我确认这些记录来自人类真实表达且有权使用，本人记录不是 AI 生成";
const privateLabel = "仅保存到当前账号、会话和联系人，不跨会话共享";

// Native bridge and model doubles exercise UI contracts only. No real model, API or social send runs here.
async function installDouble(page: Page, cloud = false, activeModel?: { modelPath: string; contextSize: number }) {
  const api = { id: "advice-test-api", name: "测试 API 替身", protocol: "openai", baseUrl: "https://example.test/v1", modelId: "test-double", contextSize: 12800,
    maxTokens: 768, temperature: 0.6, timeoutMs: 60000, stream: false, headers: {}, extra: {}, capabilities: { text: true, image: false, audio: false } };
  const seed = cloud ? JSON.stringify({ version: 1, queue: new QueueEngine().snapshot(), profile: createDefaultProfile(), memories: [], rules: [], apis: [api], activeApiId: api.id,
    mode: "local", locations: { text: "local", image: "local", audio: "local" }, logs: [] }) : null;
  await page.addInitScript(({ seed, activeModel }) => {
    const target = window as unknown as { assistant: Record<string, unknown>; __advice: { saved: string[]; tokenized: string[]; inferred: Record<string, unknown>[]; requests: Record<string, unknown>[] } };
    const calls = target.__advice = { saved: [], tokenized: [], inferred: [], requests: [] };
    target.assistant = {
      loadState: async () => ({ state: seed }), saveState: async ({ state }: { state: string }) => { calls.saved.push(state); return { saved: true }; },
      modelStatus: async () => ({ loaded: true, contextSize: 12800, ...activeModel }), loadModel: async () => ({ loaded: true }),
      tokenize: async ({ text, modelPath }: { text: string; modelPath?: string }) => {
        if (activeModel && modelPath !== activeModel.modelPath) throw new Error("省略已导入模型路径会错误打开默认模型。");
        calls.tokenized.push(text); return { count: 600 };
      },
      infer: async (args: Record<string, unknown>) => {
        if (activeModel && (args.modelPath !== activeModel.modelPath || args.contextSize !== activeModel.contextSize)) throw new Error("推理路径或上下文与已加载模型不一致。");
        calls.inferred.push(args); return { text: String(args.prompt).includes("本次仅扮演") ? "AI 推测 · 对方：好的，可以再确认一下。" : String(args.prompt).includes("本次请给出") ? "AI 推测 · 演练反馈：可以先明确你的边界。" : "建议先确认期限，再回答能否协助。", inputTokens: 600, outputTokens: 25, tokensPerSecond: 1, contextSize: activeModel?.contextSize ?? 12800 };
      },
      request: async (args: Record<string, unknown>) => { calls.requests.push(args); return { text: "API 测试替身建议正文。" }; },
      stop: async () => ({}), hasApiKey: async () => ({ present: false }),
    };
  }, { seed, activeModel });
}
async function openAdvice(page: Page) {
  await page.goto(baseUrl);
  await page.locator("nav").getByRole("button", { name: "建议与演练", exact: true }).click();
  await expect(lab(page)).toBeVisible();
}
async function calls(page: Page) {
  return page.evaluate(() => (window as unknown as { __advice: { saved: string[]; tokenized: string[]; inferred: Record<string, unknown>[]; requests: Record<string, unknown>[] } }).__advice);
}
async function upload(page: Page, name: string, text: string) {
  await lab(page).getByLabel("选择训练集文件", { exact: true }).setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
}
async function latestState(page: Page) {
  await expect.poll(async () => (await calls(page)).saved.length).toBeGreaterThan(0);
  return JSON.parse((await calls(page)).saved.at(-1)!);
}

test("browser consultation reports unavailable inference without inventing a model reply", async ({ page }) => {
  await openAdvice(page);
  await lab(page).getByLabel("如果收到这句话，如何回复", { exact: true }).fill("如果收到邀请，我该如何婉拒？");
  await lab(page).getByRole("button", { name: "生成建议回复", exact: true }).click();
  await expect(lab(page).getByRole("alert")).toContainText("浏览器演示只验证界面与规则");
  await expect(lab(page).getByTestId("advice-result")).toHaveCount(0);
});

test("consultation keeps the explicitly loaded imported model path and its actual context", async ({ page }) => {
  const activeModel = { modelPath: "/data/user/0/cn.muyu.assistant/files/models/imported-small.gguf", contextSize: 4096 };
  await installDouble(page, false, activeModel); await openAdvice(page);
  await expect(lab(page).getByTestId("advice-model-status")).toContainText("4096 tokens");
  await lab(page).getByLabel("如果收到这句话，如何回复", { exact: true }).fill("这周能帮忙完成报告吗？");
  await lab(page).getByRole("button", { name: "生成建议回复", exact: true }).click();
  await expect(lab(page).getByTestId("advice-result")).toContainText("上下文 4096 tokens");
  const seen = await calls(page);
  expect(seen.inferred).toHaveLength(1);
  expect(seen.inferred[0]).toEqual(expect.objectContaining(activeModel));
  expect(seen.tokenized).toContain(seen.inferred[0].prompt);
  expect(seen.requests).toHaveLength(0);
});

test("a confirmed personal phrase is retrieved into the actual advice model input", async ({ page }) => {
  await installDouble(page); await openAdvice(page);
  await lab(page).getByRole("button", { name: "管理本人表达样本", exact: true }).click();
  const learning = page.getByTestId("learning-settings");
  await learning.getByLabel("本人原句（每行一句）", { exact: true }).fill("报告收到啦，我确认时间后回你。OWNER_STYLE_MARKER");
  await learning.getByLabel("我确认这些原句出自本人，且有权使用", { exact: true }).check();
  await learning.getByRole("button", { name: "确认并保存本人原句", exact: true }).click();
  await learning.getByRole("button", { name: "试用我的表达生成回复", exact: true }).click();
  await lab(page).getByLabel("如果收到这句话，如何回复", { exact: true }).fill("这份报告能帮忙确认时间吗？");
  await lab(page).getByRole("button", { name: "生成建议回复", exact: true }).click();
  await expect(lab(page).getByTestId("advice-result")).toContainText("本次引用本人原句 1 条");
  const seen = await calls(page);
  expect(seen.inferred).toHaveLength(1);
  expect(seen.inferred[0].prompt).toContain("OWNER_STYLE_MARKER");
  expect(seen.tokenized).toContain(seen.inferred[0].prompt);
  expect((await latestState(page)).profile.originalPhrases).toHaveLength(1);
});

test("local model double supports consultation, multiple fictional turns and labeled feedback without creating drafts or samples", async ({ page }) => {
  await installDouble(page); await openAdvice(page);
  await lab(page).getByLabel("对方表达风格", { exact: true }).fill("PEER_STYLE_ONLY 简洁直接");
  await lab(page).getByLabel("对方例句（仅用于扮演对方）", { exact: true }).fill("PEER_EXAMPLE_ONLY 确认好告诉我。");
  await lab(page).getByLabel("练习关系", { exact: true }).fill("同事");
  await lab(page).getByLabel("练习场景", { exact: true }).fill("协助报告");
  await lab(page).getByLabel("如果收到这句话，如何回复", { exact: true }).fill("这周能帮忙完成报告吗？");
  await lab(page).getByRole("button", { name: "生成建议回复", exact: true }).click();
  await expect(lab(page).getByTestId("advice-result")).toContainText("AI 建议 · 待本人审核");
  for (const line of ["我需要先确认截止时间。", "可以先说明具体需要我负责什么吗？"]) {
    await lab(page).getByLabel("你的下一句练习台词", { exact: true }).fill(line);
    await lab(page).getByRole("button", { name: "让虚构对方回应", exact: true }).click();
    await expect(lab(page).getByLabel("你的下一句练习台词", { exact: true })).toHaveValue("");
  }
  await expect(lab(page).getByTestId("roleplay-turn")).toHaveCount(4);
  await expect(lab(page).getByTestId("roleplay-turn").nth(1)).toContainText("AI 推测 · 虚构对方");
  await lab(page).getByRole("button", { name: "获取演练反馈", exact: true }).click();
  await expect(lab(page).getByTestId("roleplay-feedback")).toContainText("AI 推测 · 演练反馈");
  const seen = await calls(page);
  expect(seen.inferred).toHaveLength(4); expect(seen.requests).toHaveLength(0);
  for (const inference of seen.inferred) {
    expect(inference.contextSize).toBe(12800); expect(inference.maxTokens).toBe(384);
    expect(seen.tokenized).toContain(inference.prompt);
    expect(inference.prompt).toContain("不能声称知道真实人的身份");
  }
  expect(seen.inferred[0].prompt).not.toContain("PEER_EXAMPLE_ONLY");
  for(const inference of seen.inferred.slice(1))expect(inference.prompt).toContain("PEER_EXAMPLE_ONLY");
  expect(seen.inferred[2].prompt).toContain("我需要先确认截止时间。");
  const state = await latestState(page);
  expect(state.queue.drafts).toHaveLength(0); expect(state.queue.messages).toHaveLength(3);
  expect(state.profile.originalPhrases ?? []).toHaveLength(0);
  expect(state.profile.examples.some((entry: { reply: string }) => entry.reply.includes("PEER_EXAMPLE_ONLY"))).toBe(false);
});

test("training preview requires role, human-source and private-scope confirmations; peer records stay outside the owner profile", async ({ page }) => {
  await installDouble(page); await openAdvice(page);
  await upload(page, "human-training.json", JSON.stringify([
    { role: "self", text: "OWNER_ORIGINAL 确认后告诉你。", relationship: "朋友" },
    { received: "周末见吗？", reply: "OWNER_REPLY 确认时间后再联系。" },
    { role: "peer", text: "PEER_RECORD_ONLY 好的再说。" },
  ]));
  await expect(lab(page).getByTestId("training-preview-record")).toHaveCount(3);
  const importButton = lab(page).getByRole("button", { name: "确认角色并导入检索材料", exact: true });
  await expect(importButton).toBeDisabled();
  await lab(page).getByLabel(ownerLabel, { exact: true }).check();
  await lab(page).getByLabel(humanLabel, { exact: true }).check();
  await expect(importButton).toBeDisabled();
  await lab(page).getByLabel(privateLabel, { exact: true }).check();
  await importButton.click();
  await expect(lab(page).getByTestId("training-preview")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("模型权重未改变");
  await expect.poll(async () => (await latestState(page)).profile.originalPhrases?.length).toBeGreaterThan(0);
  const state = await latestState(page);
  expect(state.profile.originalPhrases.some((record: { text: string }) => record.text.includes("OWNER_ORIGINAL"))).toBe(true);
  expect(state.profile.examples.some((record: { reply: string }) => record.reply.includes("OWNER_REPLY"))).toBe(true);
  expect(JSON.stringify(state.profile)).not.toContain("PEER_RECORD_ONLY");
  expect(state.advice[JSON.stringify(["manual", "lin", "lin"])].roleplayRecords).toEqual([expect.objectContaining({ role: "peer", text: "PEER_RECORD_ONLY 好的再说。", scope: { accountId: "manual", conversationId: "lin", contactId: "lin" } })]);
  const imported = state.profile.originalPhrases.filter((record: { source: string }) => record.source === "imported-self");
  expect(imported.every((record: { shareable: boolean; scope: unknown; confirmed: boolean }) => !record.shareable && record.scope && record.confirmed)).toBe(true);
  const originalCount = state.profile.originalPhrases.length, exampleCount = state.profile.examples.length;
  await upload(page, "same-material.csv", 'role,text,received\nself,OWNER_ORIGINAL 确认后告诉你。,\nself,OWNER_REPLY 确认时间后再联系。,周末见吗？\npeer,PEER_RECORD_ONLY 好的再说。,');
  for (const label of [ownerLabel, humanLabel, privateLabel]) await lab(page).getByLabel(label, { exact: true }).check();
  await importButton.click();
  await expect(page.getByRole("status")).toContainText("跳过重复材料");
  const afterDuplicate = await latestState(page);
  expect(afterDuplicate.profile.originalPhrases).toHaveLength(originalCount);
  expect(afterDuplicate.profile.examples).toHaveLength(exampleCount);
  expect(afterDuplicate.advice[JSON.stringify(["manual", "lin", "lin"])].roleplayRecords).toHaveLength(1);
  await page.locator("nav").getByRole("button", { name: "消息中心", exact: true }).click();
  await page.locator(".conversation").filter({ hasText: "周五项目讨论" }).click();
  await page.locator("nav").getByRole("button", { name: "建议与演练", exact: true }).click();
  await expect(lab(page)).toContainText("本会话有 0 条对方演练材料");
  const seen = await calls(page); expect(seen.inferred).toHaveLength(0); expect(seen.requests).toHaveLength(0);
});

test("invalid training records expose an error and generated owner provenance cannot be confirmed into learning", async ({ page }) => {
  await installDouble(page); await openAdvice(page);
  await upload(page, "invalid.json", '[{"role":"unknown","text":"不可忽略此行"}]');
  await expect(lab(page).getByRole("alert")).toBeVisible();
  await expect(lab(page).getByTestId("training-preview")).toHaveCount(0);
  await upload(page, "generated.json", JSON.stringify([{ role: "self", text: "AI_GENERATED_OWNER 禁止自学。", provenance: "generated" }]));
  await expect(lab(page).getByTestId("training-preview")).toBeVisible();
  for (const label of [ownerLabel, humanLabel, privateLabel]) await lab(page).getByLabel(label, { exact: true }).check();
  await lab(page).getByRole("button", { name: "确认角色并导入检索材料", exact: true }).click();
  await expect(lab(page).getByRole("alert")).toContainText("生成");
  expect(JSON.stringify((await latestState(page)).profile)).not.toContain("AI_GENERATED_OWNER");
});

test("API model double requires fresh upload consent on every generation and uses saved config", async ({ page }) => {
  await installDouble(page, true); await openAdvice(page);
  await lab(page).getByLabel("使用已保存的 API 生成本次建议或演练", { exact: true }).check();
  await lab(page).getByLabel("如果收到这句话，如何回复", { exact: true }).fill("如何礼貌澄清时间？");
  const generate = lab(page).getByRole("button", { name: "生成建议回复", exact: true });
  await expect(generate).toBeDisabled(); expect((await calls(page)).requests).toHaveLength(0);
  await lab(page).getByLabel("我明确允许本次内容及引用资料上传到所选 API", { exact: true }).check();
  await generate.click();
  await expect(lab(page).getByTestId("advice-result")).toContainText("API 测试替身建议正文");
  await expect(lab(page).getByLabel("我明确允许本次内容及引用资料上传到所选 API", { exact: true })).not.toBeChecked();
  await expect(generate).toBeDisabled();
  const seen = await calls(page); expect(seen.inferred).toHaveLength(0); expect(seen.requests).toHaveLength(1);
  expect(seen.requests[0]).toEqual(expect.objectContaining({ allowExternalData: true, operation: "infer", config: expect.objectContaining({ id: "advice-test-api", modelId: "test-double", maxTokens: 384 }) }));
});
