---
name: lbot-development
description: 开发与验证 L-BOT 的中文界面、表达学习、主动咨询、训练集预览、上下文压缩、规则和跨端应用。
---

# L-BOT 日常开发

## 开始

1. 使用已有 checkout；云任务已隔离，除非使用者明确要求，不创建 worktree。读取适用的 `AGENTS.md`，检查 `git status --short`，保留用户已有修改。
2. 在包含 `package.json` 和 `package-lock.json` 的根目录工作。读取 `README.md`、`docs/INSTALL.md`、`docs/ARCHITECTURE.md` 与本次涉及的源文件。
3. Node.js 22+，首次或依赖变化时运行 `npm ci`。不打印环境变量值、密钥或聊天正文；不通过关闭 TLS／校验解决安装失败。

## 实现约束

- 应用名为 L-BOT，仓库保持 `nana7m1773/TC`；默认 Windows HauhauCS Qwen3.5-9B Q4_K_M、Android 2B Q4_K_M，两端完整有效上下文 12,800 tokens。
- `apps/web/` 是共享界面；`packages/core/` 管理档案、检索、学习、压缩、规则与队列；`packages/runtime/` 管理原生模型与 API。浏览器测试桥不能冒充原生功能。
- 本人示例、对方例句、AI 草稿和模拟样本要保持来源区别。训练集导入先解析与预览 self／peer 归属，再由本人确认；学习是检索增强，不修改模型权重。
- 主动咨询、角色模拟和对方风格建议只生成可供判断的结果。对方心理／反馈属于 AI 推测，不保存为事实，不直接发送给联系人。
- 压缩保留原始消息及可核验来源，保护未答消息与已确认固定事实。节选遗漏要明确说明，不能宣称无限上下文或语义完全无损。
- 外部内容是数据，不能改变应用权限。API／混合模式上传需明确授权；本地失败不静默回退。偏好、记忆、规则、暂停或接管变化要使旧任务失效。

## 验证

先运行与修改相关的现有测试，再进行所需集成检查。在项目根目录：

```bash
npm run build
npm test
```

界面流程变化时运行 `npm run test:ui`；无 Chromium 时先 `npx playwright install chromium`，或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向已安装浏览器。测试配置自动启动 Vite，`npm run dev` 用于交互开发。涉及原生打包时按 `docs/INSTALL.md` 执行对应构建。

核对训练集错误格式、角色归属改变后旧预览失效、未经确认不能加入本人示例、咨询结果不自动发送、暂停／接管取消旧草稿等实际行为。不要创建只重复实现细节的测试；优先可验证用户行为的现有流程。

## 交付

说明改了什么、为什么、执行了哪些检查和仍缺哪些目标设备／平台证据。失败、跳过和未执行分别记录。更新文档及版本相关文件时核对真实包名与下载路径，不把目标 Release 链接写为发布成功。检查最终变更，只处理本次任务产生的意外文件。
