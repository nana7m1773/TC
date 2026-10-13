# L-BOT 仓库开发技能

仓库提供三种 `SKILL.md`，供开发代理按任务读取和执行。它们是**开发操作工作流**，不授予社交平台登录／私信权限，不代表任何外部插件已安装，也不会被 L-BOT 自动注入本地模型的 system prompt。

| 技能 | 适合的任务 | 入口 |
| --- | --- | --- |
| `lbot-development` | 界面、档案学习、主动咨询、训练集预览、压缩、规则与跨端日常开发 | [SKILL.md](../skills/lbot-development/SKILL.md) |
| `lbot-local-validation` | 校验模型／引擎、真实本地推理、12,800 tokens 预算、多模态与模拟证据 | [SKILL.md](../skills/lbot-local-validation/SKILL.md) |
| `lbot-computer-use` | Windows UIA 预览、截图、prepare／commit、确认式一次回复和设备验收 | [SKILL.md](../skills/lbot-computer-use/SKILL.md) |

## 使用方式

在开发代理中明确要求读取对应文件，例如：“按 `skills/lbot-computer-use/SKILL.md` 检查这次窗口发送协议修改”。代理应先读取仓库自身指令与当前源码，再执行相关步骤；技能文件不是可独立运行的脚本。

如所用开发工具支持目录式技能，可把对应目录复制到该工具配置的技能目录后按其发现机制启用。例如 Codex 的本地技能目录可使用 `~/.codex/skills/lbot-development/SKILL.md`；其余两个目录同理。仓库交付这些文件不等于已经在你的开发工具中安装或启用。无需把文件内容粘进普通聊天回复模型的提示词。

## 共同约定

使用已有 checkout；云任务已隔离，除非使用者明确要求，不额外创建 worktree。先检查已有变更，保留用户数据，不打印凭据或代理值。依赖用 `npm ci`，保留 TLS、签名、制品哈希和锁文件校验。

选择能验证本次改动的现有测试；实际模型、测试替身、内存模拟、原生设备、真实平台必须分别报告。测试通过不能外推成平台授权，构建完成不能外推成安装运行，模型返回文本也不能外推成质量正确或消息送达。

应用名称为 L-BOT，仓库仍为 `nana7m1773/TC`。发布文件、模型默认值及上下文预算变更时，同时检查 [README](../README.md)、[安装教程](INSTALL.md) 和实际构建配置是否一致。
