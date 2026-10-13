# L-BOT · 本地 AI 社交助理

**主作者：Hebe · 赞助商：Zijie**

L-BOT 是中文 Windows / Android 应用，帮助你整理表达习惯、理解图片和语音、起草回复，并通过主动咨询和模拟对话练习表达。默认在本机运行模型；也保留 DeepSeek、豆包／火山方舟、千问／百炼及其他 OpenAI 兼容 API。仓库地址保持为 [nana7m1773/TC](https://github.com/nana7m1773/TC)，应用名称为 **L-BOT**。

`0.2.0` 是开发验收版本。Windows 窗口操作提供本人确认消息后的一次自动回复流程；尚未具备可靠的新消息区域与角色适配器，不能宣称已实现常驻监听个人号并持续代回。真实社交客户端、Windows 安装运行及 8GB Android 设备仍需各自验收。

## 下载与安装

下载见 [v0.2.0 Release](https://github.com/nana7m1773/TC/releases/tag/v0.2.0)。以下是该版本的固定下载入口，校验清单与完整测试资料见 Release。

| 文件 | 下载 | 用途 |
| --- | --- | --- |
| Windows x64 | [L-BOT-Setup-0.2.0-x64.exe](https://github.com/nana7m1773/TC/releases/download/v0.2.0/L-BOT-Setup-0.2.0-x64.exe) | 未签名的开发版安装器 |
| Android arm64 | [L-BOT-Android-0.2.0-arm64-debug.apk](https://github.com/nana7m1773/TC/releases/download/v0.2.0/L-BOT-Android-0.2.0-arm64-debug.apk) | 调试签名的开发版 APK |
| 源码 | [L-BOT-source-0.2.0.zip](https://github.com/nana7m1773/TC/releases/download/v0.2.0/L-BOT-source-0.2.0.zip) | 源码、锁文件及开发文档 |
| 验证资料 | [L-BOT-validation-0.2.0.zip](https://github.com/nana7m1773/TC/releases/download/v0.2.0/L-BOT-validation-0.2.0.zip) | 构建、制品校验和功能报告 |

从 [安装教程](docs/INSTALL.md) 开始。模型、匹配的视觉投影组件和 Whisper 语音模型**不包含在安装器中**，首次使用需联网独立下载并通过固定 SHA-256 校验；准备完成后本地推理可离线运行。应用内置原生引擎，无需普通使用者另装 Python 或模型服务器。

## 能做什么

- **表达学习与回复草稿**：保存本人确认的原句、理想回复、使用场景、关系差异和判断原则，检索相关示例后生成。上传训练集先预览本人／对方归属，再由本人确认；这是检索增强与档案学习，不修改模型权重。
- **主动咨询与角色练习**：输入假设收到的消息、场景、关系和对方表达例句，咨询如何回复，或进行模拟对话。反馈是 AI 推测，供本人判断，不直接向联系人发消息。
- **本地多模态**：使用匹配组件理解所选图片，使用 Whisper 转写本人选择的音频；结果需检查和修正。缺少组件时明确报错，不静默上传。
- **Windows computer use**：本人在官方客户端／网页完成登录，选择窗口并授权只读预览或整窗截图；核对会话与本次消息后，可授权一次本地生成、规则复核、UIA 写入和触发发送。提交后的结果记为未知并暂停，需本人回到客户端核对。详见 [窗口操作说明](docs/COMPUTER_USE.md)。
- **可追溯上下文压缩**：保留原始消息，使用带来源 ID、校验摘要和固定事实的历史节选减少提示词长度；原文与引用可核验。压缩不是无限上下文或语义完全无损。
- **隔离记忆与规则**：按账号／会话隔离，提供白名单、回复语言、等待时间、敏感内容审核、暂停与接管。偏好、记忆或窗口变化会使旧任务失效。

## 模型与 API

| 平台 | 默认本地模型 | 完整有效上下文 | 资源建议 |
| --- | --- | --- | --- |
| Windows | HauhauCS Qwen3.5-9B **Q4_K_M**，约 5.63 GB | **12,800 tokens**，包含提示词与输出预留 | 至少 16 GiB 物理内存、8.5 GB 可用存储；实际性能待设备验证 |
| Android | HauhauCS Qwen3.5-2B **Q4_K_M**，约 1.27 GB | **12,800 tokens**，包含提示词与输出预留 | 建议至少 3 GB 可用存储；8GB 物理 RAM 为尚待实机验收的目标 |

Windows 9B 的匹配视觉组件约 922 MB，Android 2B 的匹配组件约 668 MB；Whisper Base 多语言模型约 148 MB。2B 与 9B 的视觉组件不能混用。应用保留兼容 GGUF 文字模型导入；文件格式、架构和上下文检查通过后仍需实际加载验证。其他 GGUF 不会因导入而自动获得视觉能力，不能随意搭配 projector。

API 预设的地址与模型 ID 可编辑，支持模型列表、测试消息、能力设置和错误提示。使用 API 或混合模式前需明确允许本次内容上传；本地失败不会自动回退云端。未提供付费凭据的服务不能据适配器测试宣称真实联调通过。

## 验证边界

真实 9B 已在 Linux CPU 云机使用公开合成消息运行 QQ、微信、哔哩哔哩、微博、WhatsApp 五种模拟流程；发送回执属于内存模拟 transport。近满上下文报告记录 **12,757 输入 tokens + 32 输出预留**、推理约 **441.9 秒**、模型进程峰值 RSS **9,076,236 KiB**。这些数字不能代表 Windows 速度或 Android 内存表现。

新版功能报告已记录真实 9B 模拟生成、固定事实压缩检查与中英文 Whisper 转写。9B 对公开合成聊天截图正确转录了周六 14:30、北门和蓝色雨伞，并识别左红右蓝；这一个样例不能代表任意聊天截图准确率。Windows UIA 协议测试使用 PowerShell 替身，不能证明五个真实客户端的输入控件或发送行为已通过。正式登录也不会自动授予平台私信读写能力。

请结合 [验收记录](docs/VALIDATION.md)、[登录与平台权限](docs/LOGIN_AND_PERMISSIONS.md)、[平台能力表](docs/PLATFORM_CAPABILITIES.md) 阅读验证资料。原始报告保留在发布验证包的 `artifacts/validation/` 中。

## 开发

需要 Node.js 22+、npm 和 Git。在项目根目录执行：

```bash
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:ui
```

界面开发：`npm run dev`。浏览器演示仅保留内存状态，不能替代原生模型、密钥存储或窗口控制。Windows 构建：`npm run build:windows`。Android 工具链及构建、桌面启动与本地模型验证详见 [安装教程](docs/INSTALL.md) 和 [构建说明](docs/BUILD.md)。

仓库提供三种可供开发代理读取的操作技能：[日常开发](skills/lbot-development/SKILL.md)、[本地模型验证](skills/lbot-local-validation/SKILL.md)、[Windows 窗口操作开发](skills/lbot-computer-use/SKILL.md)。用法见 [开发技能说明](docs/SKILLS.md)；这些文件不会授予平台权限，也不会由应用自动加载进模型提示词。

```text
apps/web/             React 中文共享界面
apps/android/         Capacitor / Java / JNI / Keystore
apps/desktop/         Electron / 隔离 IPC / DPAPI / 托盘 / Windows UIA
packages/core/        档案、检索、学习、上下文压缩、规则与队列
packages/runtime/     本地模型、多模态、API 与窗口操作
packages/connectors/  QQ 官方独立机器人事件与被动回复规划
packages/simulation/  五平台内存模拟通道
resources/            固定模型与引擎清单
skills/               三种仓库开发工作流
docs/                 安装、操作、架构、权限与验收
```

原生状态使用版本化加密 JSON：Android Keystore AES-GCM、Electron safeStorage。密钥不随配置导出，导入后暂停并关闭自动发送；日志省略正文与凭据。源码采用 [Apache-2.0](LICENSE)，模型和引擎遵循各自许可，见 [依赖及许可](docs/DEPENDENCIES.md)。
