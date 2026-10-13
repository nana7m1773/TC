---
name: lbot-local-validation
description: 校验 L-BOT 固定模型与原生引擎，运行真实本地推理、上下文预算和多模态检查，并区分模拟、云机与目标设备证据。
---

# L-BOT 本地模型验证

## 先确定验证对象

使用已有 checkout；云任务已隔离，除非使用者明确要求，不创建 worktree。读取适用仓库指令、`git status --short`、`docs/INSTALL.md` 和实际验证脚本。明确当前平台、CPU、内存、模型、引擎、样例及输出路径，保留用户文件与已有报告。

Windows 默认使用 `resources/default-model.windows.json` 的 HauhauCS 9B Q4_K_M，Android 使用 `resources/default-model.json` 的 2B Q4_K_M。两端应用预算均为 12,800 tokens，包含最终模板提示词与输出预留，不使用字符数估计 tokenizer。

## 准备与校验

1. 根目录安装依赖：`npm ci`。复用已校验的同版制品，不重复昂贵构建。
2. 核对固定来源 revision、字节大小、SHA-256、GGUF 架构与上下文；必须完整校验后加载。不要改期望哈希或关闭 TLS 来绕过失败。
3. CLI 下载／校验入口是 `scripts/prepare-model.mjs`：默认 2B，`--desktop` 选择 9B，`--vision` 选择该模型的匹配 projector，`--speech` 选择 Whisper，`--verify` 只校验已有文件。未给路径时写入 `.local-models/`。
4. Linux x64 引擎准备命令为 `node scripts/prepare-engine.mjs --platform linux-x64`；默认可移植 CPU 构建。`--native` 只用于当前兼容 CPU 的验证，不将它当作通用分发引擎。
5. 不混用 2B／9B projector，不将兼容 GGUF 文字导入当成视觉能力验证。Whisper 源码准备脚本只取得固定源码，不代表已构建可执行文件或安装语音模型。

## 真实 9B 模拟与近满上下文

`scripts/validate-simulation-9b.mts` 支持 `TC_MODEL_CACHE`、`TC_VALIDATION_ENGINE` 和 `TC_VALIDATION_REPORT`。在 Linux 项目根目录可按下列步骤准备独立输出；先确认时间和内存预算，近满 CPU 处理可能持续数分钟。

```bash
node scripts/prepare-model.mjs --desktop
node scripts/prepare-engine.mjs --platform linux-x64
export TC_MODEL_CACHE="$PWD/.local-models"
export TC_VALIDATION_ENGINE="$PWD/apps/desktop/resources/engines/linux-x64/llama-server"
export TC_VALIDATION_REPORT="$PWD/artifacts/validation/local-simulation-9b-new-linux.json"
npx tsx scripts/validate-simulation-9b.mts
```

脚本使用公开合成消息、真实本地 9B 生成、内存模拟 transport，检查五平台隔离及近满上下文。核对报告时间、model hash、configured context、tokenizer 是否匹配、生成数量、模拟接受数量、`failure`、预算与输出；某条生成被审核规则阻止时不能伪写为已发送。

## 图片、语音与压缩

`scripts/validate-windows-features.mts` 包含真实 9B 模拟、固定事实压缩、合成窗口图片和公开双语音频。它使用云机缓存及部分固定样例／Whisper 路径，先读源码确认这些前提存在再运行；不要将该脚本误写为任意新机器的一键验收。图片需要 Chromium 与匹配 projector，音频需要已构建 Whisper 可执行文件、语音模型和样例。

评估内容而非仅检查有文本：转录时间、地点、物品、图形颜色是否正确；语音是否对应预期原文；固定事实是否保留、原始消息是否完整、压缩来源哈希是否验证。幻觉、误听与不确定结果分别记录，模型成功返回不能证明样例质量通过。

## 交付证据

报告真实命令、当前运行时间、引擎／模型校验、输入／输出 token、输出预留、耗时、内存、样例质量与失败原因。Linux CPU 不代表 Windows／Android 性能；公开合成截图不代表真实客户端读取；模拟回执不代表平台接收。缺少 Windows／8GB Android 验收时保持待验证，保留历史报告，不覆盖旧结果来掩盖失败。
