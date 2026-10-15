# L-BOT · 本地 AI 社交助理

**主作者：Hebe · 赞助商：Zijie**

L-BOT `0.3.0` 为 Windows / Android 提供从真实应用取得消息、用 AI 起草、本人审核再回复的操作入口；“我的表达”可直接进入风格试用。默认使用本地模型，也保留 DeepSeek、豆包／火山方舟、千问／百炼和其他 OpenAI 兼容 API。仓库为 [nana7m1773/TC](https://github.com/nana7m1773/TC)。

Windows 从“账号连接”打开官方网页登录窗口或已安装客户端，再到“桌面界面接入”选择聊天窗口，确认消息、生成、编辑并发送一次。Android 从“账号连接”授权系统通知，对实际收到的通知生成回复；只有通知提供回复动作时才能提交，没有回复动作就复制草稿并打开原 App。五个平台的可用能力取决于实际客户端和通知，打开登录窗口不会自动取得完整聊天记录。

## 三步开始

1. 从 [v0.3.0 Release](https://github.com/nana7m1773/TC/releases/tag/v0.3.0) 下载对应安装包，按 `SHA256SUMS.txt` 校验后安装；已有 `0.2.0` 请升级。
2. 在“本地模型”下载、校验并加载默认模型；也可在“自定义 API”保存服务配置并测试。模型权重不包含在安装器中，应用已带原生引擎，无需另装 Python 或模型服务器。
3. 在“账号连接”按本机提示打开聊天应用；或先到“我的表达”保存本人原句，点击“试用我的表达生成回复”。具体步骤见 [安装教程](docs/INSTALL.md) 和 [使用指南](docs/USER_GUIDE.md)。

| 文件 | 下载 |
| --- | --- |
| Windows 10/11 x64 | [L-BOT-Setup-0.3.0-x64.exe](https://github.com/nana7m1773/TC/releases/download/v0.3.0/L-BOT-Setup-0.3.0-x64.exe) |
| Android arm64 | [L-BOT-Android-0.3.0-arm64-debug.apk](https://github.com/nana7m1773/TC/releases/download/v0.3.0/L-BOT-Android-0.3.0-arm64-debug.apk) |
| 源码 | [L-BOT-source-0.3.0.zip](https://github.com/nana7m1773/TC/releases/download/v0.3.0/L-BOT-source-0.3.0.zip) |
| 验证资料 | [L-BOT-validation-0.3.0.zip](https://github.com/nana7m1773/TC/releases/download/v0.3.0/L-BOT-validation-0.3.0.zip) |

Windows 安装器未签名，Android APK 使用调试签名。`0.2.0` 的旧安装器已移除，历史源码及报告保留；它的模拟结果不代表 `0.3.0` 已在真实社交客户端发送成功。

## 实际操作入口

| 功能 | 操作方法与当前范围 |
| --- | --- |
| Windows 账号接入 | 哔哩哔哩、微博、WhatsApp、微信可打开各自隔离的官方网页窗口；本机客户端可按安装状态唤起。QQ 个人账号使用本机官方客户端，没有个人网页私信扫码入口；微信网页版能否登录由账号决定。 |
| Windows 桌面界面接入 | 选择窗口并读取或截图，核对会话与消息；从检测到的候选项明确选择输入框和发送方式，再生成、编辑、审核并发送一次。支持直接写入或单行 Unicode 键盘输入，发送按钮／Enter／Ctrl+Enter 由本人选择。详见 [窗口操作](docs/COMPUTER_USE.md)。 |
| Android 通知接入 | 开启系统通知使用权，打开官方 App 后返回 L-BOT，等待真实新通知；生成本地回复并编辑审核，有 RemoteInput 回复动作才可发送。无动作时复制草稿到原 App。每个应用的“仅前台自动回复”默认关闭，离页或后台撤销；不承诺系统杀进程后继续回复。 |
| 我的表达与风格试用 | 保存本人确认的原句和真实回复，再点“试用我的表达生成回复”，在“建议与演练”输入假设收到的消息。页面显示模型准备情况和本次实际引用样本数，生成结果供本人审核。检索学习不修改模型权重。 |
| 图片、语音与上下文 | 安装匹配组件后理解所选图片、转写所选音频；处理结果需核对。带来源的历史节选可减少提示词长度，原始消息保留；记忆和样本按账号／会话隔离。 |

发送调用后统一显示“结果待核实”，只锁定相应会话，应用不会自动重试。在原应用检查后填写核实依据；离页或重启后仍可在“待审核回复”处理。Windows 尚无持续识别各客户端新消息和发送者的通用适配器；Android 通知也不是完整聊天记录。

## 模型与 API

| 平台 | 默认本地模型 | 默认完整上下文 | 资源建议 |
| --- | --- | --- | --- |
| Windows | HauhauCS Qwen3.5-9B **Q4_K_M**，约 5.63 GB | **12,800 tokens**，包含输入与输出预留 | 至少 16 GiB 物理内存、8.5 GB 可用存储；速度取决于设备 |
| Android | HauhauCS Qwen3.5-2B **Q4_K_M**，约 1.27 GB | **12,800 tokens**，包含输入与输出预留 | 至少 3 GB 可用存储；8GB 物理 RAM 目标仍待实机验收 |

默认模型版本与校验清单保持不变。Windows 9B 匹配视觉组件约 922 MB，Android 2B 匹配组件约 668 MB；Whisper Base 多语言模型约 148 MB，均独立下载并校验，2B 与 9B projector 不能混用。导入其他兼容 GGUF 后需实际加载，生成沿用已加载的模型路径及实际上下文；导入文字模型不会自动获得视觉能力。

API 配置支持编辑地址、模型 ID、模型列表和固定测试消息。使用 API 前明确允许本次内容上传；本地失败不会自动改用云端。付费服务需使用者自己的有效凭据，适配器测试不能代替供应商联调。

## 验证资料

`0.3.0` 的 Android Java／JNI 构建及 lint 已通过（0 错误、6 警告）；Windows 窗口脚本已完成语法检查、.NET Framework 4.8／C# 5 兼容编译及 41 项窗口协议测试。214 项模块测试和 64 项完整浏览器流程通过，另有新回归的定向测试；真实 Linux Electron / preload / IPC / 本地 9B 已完成建议生成。浏览器测试用于核对交互与桥接参数。这些检查没有证明五个 Windows／Android 真实客户端均已完成登录和发送，具体执行记录见本版验证包。

`0.2.0` 的 Linux CPU 真实 9B 五平台模拟、近满上下文、图片和 Whisper 报告保留作历史证据；发送回执来自模拟通道，不能当作真实客户端回执，也不能当作 Windows 速度或 Android 内存验收。参见 [验收记录](docs/VALIDATION.md)、[登录与平台权限](docs/LOGIN_AND_PERMISSIONS.md) 和 [平台能力表](docs/PLATFORM_CAPABILITIES.md)，其中旧版说明应结合本页与本版操作指南阅读。

## 开发

需要 Node.js 22+、npm 和 Git。在项目根目录执行：

```bash
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:ui
```

`npm run dev` 启动界面开发。浏览器仅保留内存状态；原生模型、密钥存储、通知和窗口控制需运行原生应用。Windows 构建：`npm run build:windows`；Android 构建：`npm run build:android`。工具链见 [安装教程](docs/INSTALL.md) 和 [构建说明](docs/BUILD.md)。

开发代理工作流：[日常开发](skills/lbot-development/SKILL.md)、[本地模型验证](skills/lbot-local-validation/SKILL.md)、[Windows 窗口操作](skills/lbot-computer-use/SKILL.md)；用法见 [技能说明](docs/SKILLS.md)。

原生状态使用版本化加密 JSON：Android Keystore AES-GCM、Electron safeStorage。密钥不随配置导出；导入后暂停并关闭自动发送，日志省略正文与凭据。源码采用 [Apache-2.0](LICENSE)，模型和引擎遵循各自许可，见 [依赖及许可](docs/DEPENDENCIES.md)。
