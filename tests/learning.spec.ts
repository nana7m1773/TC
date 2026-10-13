import { test, expect, type Page } from "@playwright/test";

const baseUrl = process.env.TC_UI_BASE_URL ?? "http://127.0.0.1:5173";
const navigate = (page: Page, label: string) => page.locator("nav").getByRole("button", { name: new RegExp(`^${label}`) }).click();
const learning = (page: Page) => page.getByTestId("learning-settings");

// These are browser-memory UI contract tests. They neither call a real model nor claim social-platform sends.
async function openLearning(page: Page) {
  await page.goto(baseUrl);
  await expect(page.getByText("浏览器演示 · 仅内存保存", { exact: false })).toBeVisible();
  await navigate(page, "我的表达");
  await expect(learning(page).getByRole("heading", { name: "本人表达学习", exact: true })).toBeVisible();
}
async function saveOriginals(page: Page, text: string, shared = false) {
  const settings = learning(page);
  await settings.getByLabel("本人原句（每行一句）", { exact: true }).fill(text);
  await settings.getByLabel("我确认这些原句出自本人，且有权使用", { exact: true }).check();
  if (shared) await settings.getByLabel("我明确允许这些原句跨联系人／会话使用", { exact: true }).check();
  await settings.getByRole("button", { name: "确认并保存本人原句", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
}

test("confirmed personal originals batch, edit and delete stay in the current scope until explicitly shared", async ({ page }) => {
  await openLearning(page);
  await learning(page).getByLabel("原句适用关系", { exact: true }).fill("朋友");
  await learning(page).getByLabel("原句场景标签（逗号分隔）", { exact: true }).fill("邀约,时间确认");
  await learning(page).getByLabel("本人原句（每行一句）", { exact: true }).fill("好呀，我看一下时间再告诉你。\n谢谢提醒，我晚点处理。");
  await expect(learning(page).getByRole("button", { name: "确认并保存本人原句", exact: true })).toBeDisabled();
  await learning(page).getByLabel("我确认这些原句出自本人，且有权使用", { exact: true }).check();
  await learning(page).getByRole("button", { name: "确认并保存本人原句", exact: true }).click();
  await expect(learning(page).getByTestId("personal-original")).toHaveCount(2);
  for (const text of ["朋友", "邀约 / 时间确认", "仅当前会话"]) await expect(learning(page).getByTestId("personal-original").first()).toContainText(text);

  await navigate(page, "消息中心");
  await page.locator(".conversation").filter({ hasText: "周五项目讨论" }).click();
  await navigate(page, "我的表达");
  await expect(learning(page).getByTestId("personal-original")).toHaveCount(0);
  await saveOriginals(page, "收到，谢谢提醒。", true);
  await expect(learning(page).getByTestId("personal-original")).toHaveCount(1);
  await expect(learning(page).getByTestId("personal-original")).toContainText("本人明确允许跨会话使用");

  await navigate(page, "消息中心");
  await page.locator(".conversation").filter({ hasText: "林夏" }).click();
  await navigate(page, "我的表达");
  await expect(learning(page).getByTestId("personal-original")).toHaveCount(3);
  await learning(page).getByRole("button", { name: "编辑原句：好呀，我看一下时间再告诉你。", exact: true }).click();
  await learning(page).getByLabel("本人原句（每行一句）", { exact: true }).fill("好呀，我确认时间后回你。");
  await learning(page).getByLabel("我确认这些原句出自本人，且有权使用", { exact: true }).check();
  await learning(page).getByRole("button", { name: "确认并更新本人原句", exact: true }).click();
  await expect(learning(page).getByTestId("personal-original")).toHaveCount(3);
  await expect(learning(page).getByTestId("personal-original").first()).toContainText("好呀，我确认时间后回你。");
  await learning(page).getByRole("button", { name: "删除原句：谢谢提醒，我晚点处理。", exact: true }).click();
  await expect(learning(page).getByTestId("personal-original")).toHaveCount(2);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});

test("learning counts, recent preference and extended styles are editable and can be reviewed then rolled back", async ({ page }) => {
  await openLearning(page);
  const initialTone = await page.getByLabel("表达基调", { exact: true }).inputValue();
  const settings = learning(page);
  await settings.getByLabel("每次最多引用回复示例（0–12）", { exact: true }).fill("6");
  await settings.getByLabel("每次最多引用本人原句（0–12）", { exact: true }).fill("8");
  await settings.getByLabel("近期样本偏好（0–1）", { exact: true }).fill("0.35");
  await settings.getByLabel("正式程度", { exact: true }).fill("朋友随意，同事礼貌");
  await settings.getByLabel("称呼习惯", { exact: true }).fill("称名字，不用亲昵称呼");
  await settings.getByLabel("直接程度", { exact: true }).fill("先说结论，不绕弯子");
  await settings.getByLabel("分段与回复结构", { exact: true }).fill("一到两段，短句为主");
  await settings.getByRole("button", { name: "保存学习配置与扩展风格", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("学习检索配置与扩展风格已保存");
  await expect(page.getByLabel("表达基调", { exact: true })).toHaveValue(initialTone);
  await navigate(page, "消息中心"); await navigate(page, "我的表达");
  await expect(settings.getByLabel("每次最多引用回复示例（0–12）", { exact: true })).toHaveValue("6");
  await expect(settings.getByLabel("每次最多引用本人原句（0–12）", { exact: true })).toHaveValue("8");
  await expect(settings.getByLabel("近期样本偏好（0–1）", { exact: true })).toHaveValue("0.35");
  await expect(settings.getByLabel("分段与回复结构", { exact: true })).toHaveValue("一到两段，短句为主");
  const previous = settings.getByTestId("learning-version-panel").locator("details").first();
  await previous.locator("summary").click();
  await expect(previous).toContainText("原句检索上限：4；回复示例上限：4");
  await previous.getByRole("button", { name: "恢复此学习版本", exact: true }).click();
  await expect(settings.getByLabel("正式程度", { exact: true })).toHaveValue("");
  await expect(settings.getByLabel("每次最多引用本人原句（0–12）", { exact: true })).toHaveValue("4");
});

test("confirmed sample analysis is a preview and explicit selection applies only the selected style fields", async ({ page }) => {
  await openLearning(page);
  const initialTone = await page.getByLabel("表达基调", { exact: true }).inputValue();
  const initialLength = await page.getByLabel("句子长度", { exact: true }).inputValue();
  await saveOriginals(page, "好呀，确认时间再说。\n谢谢提醒，我会处理。\n今天不方便，改天吧。");
  await learning(page).getByRole("button", { name: "分析已确认的本人样本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("尚未修改个人档案");
  await expect(learning(page).getByTestId("learning-analysis-result")).toContainText("合格表达样本");
  await expect(learning(page).getByTestId("learning-analysis-result").locator(".learning-stat").first()).toContainText("3");
  await expect(learning(page).getByTestId("learning-analysis-result").locator(".learning-evidence")).toHaveCount(3);
  await expect(page.getByLabel("句子长度", { exact: true })).toHaveValue(initialLength);
  await expect(page.getByLabel("表达基调", { exact: true })).toHaveValue(initialTone);
  await expect(learning(page).getByLabel("应用建议：表达基调", { exact: true })).not.toBeChecked();
  await learning(page).getByRole("button", { name: "应用勾选的风格建议", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("仅已勾选的风格建议已应用");
  await expect(page.getByLabel("句子长度", { exact: true })).not.toHaveValue(initialLength);
  await expect(page.getByLabel("表达基调", { exact: true })).toHaveValue(initialTone);
  await expect(learning(page).getByTestId("learning-analysis-result")).toHaveCount(0);
});

test("manual actual reply timing is evidence only, supports optional timestamps and reports insufficient samples", async ({ page }) => {
  await openLearning(page);
  const settings = learning(page);
  const sample = settings.getByTestId("timed-example-panel");
  for (const [reply, seconds] of [["好呀，确定了再联系。", "30"], ["收到，我晚点回复你。", "90"]]) {
    await sample.getByLabel("实际收到的消息", { exact: true }).fill("周末有空吗？");
    await sample.getByLabel("本人实际回复原文", { exact: true }).fill(reply!);
    await sample.getByLabel("收到消息的时间", { exact: true }).fill("2025-01-10T10:00");
    await sample.getByLabel("实际本人回复间隔（秒）", { exact: true }).fill(seconds!);
    await sample.getByLabel("回复样本适用关系", { exact: true }).fill("朋友");
    await expect(sample.getByRole("button", { name: "确认并保存真实回复样本", exact: true })).toBeDisabled();
    await sample.getByLabel("我确认这是本人实际回复，时间与间隔为实际记录", { exact: true }).check();
    await sample.getByRole("button", { name: "确认并保存真实回复样本", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("不会自动开启发送");
  }
  await expect(settings.getByTestId("timed-example")).toHaveCount(2);
  await expect(settings.getByTestId("timed-example").filter({ hasText: "好呀，确定了再联系。" })).toContainText("实际记录间隔 30 秒");
  await settings.getByRole("button", { name: "分析已确认的本人样本", exact: true }).click();
  for (const text of ["来自 2 条实际时间记录", "中位数 1.0 分钟", "最短 30 秒", "最长 1.5 分钟"]) await expect(settings.getByTestId("reply-timing-summary")).toContainText(text);
  await expect(settings.getByTestId("learning-analysis-result")).toContainText("样本不足：当前只有 2 条合格样本");
  await navigate(page, "联系人规则");
  await expect(page.getByLabel("冷却时间（秒）", { exact: true })).toHaveValue("30");
});
