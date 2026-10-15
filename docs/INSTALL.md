# L-BOT 安装教程

主作者：**Hebe**；赞助商：**Zijie**。

安装 `0.3.0` 后，Windows 可从“账号连接”打开官方聊天应用，再按窗口生成并审核回复；Android 可接收实际系统通知，在通知支持回复时审核提交。“我的表达”提供直接试用入口。仓库为 [nana7m1773/TC](https://github.com/nana7m1773/TC)。

快速开始：**下载安装 → 准备本地模型或 API → 接入真实应用并审核回复**。Windows 安装器未签名，Android APK 使用调试签名。

## 取得文件与校验

下载见 [v0.3.0 Release](https://github.com/nana7m1773/TC/releases/tag/v0.3.0)。请选择与你的平台对应的安装包，并核对校验清单。

| 平台／资料 | 固定下载入口 |
| --- | --- |
| Windows 10/11 x64 | [L-BOT-Setup-0.3.0-x64.exe](https://github.com/nana7m1773/TC/releases/download/v0.3.0/L-BOT-Setup-0.3.0-x64.exe) |
| Android arm64 | [L-BOT-Android-0.3.0-arm64-debug.apk](https://github.com/nana7m1773/TC/releases/download/v0.3.0/L-BOT-Android-0.3.0-arm64-debug.apk) |
| 源码 | [L-BOT-source-0.3.0.zip](https://github.com/nana7m1773/TC/releases/download/v0.3.0/L-BOT-source-0.3.0.zip) |
| 验证资料 | [L-BOT-validation-0.3.0.zip](https://github.com/nana7m1773/TC/releases/download/v0.3.0/L-BOT-validation-0.3.0.zip) |

下载后，使用 Release 提供的 `SHA256SUMS.txt` 核对对应文件。Windows PowerShell：

```powershell
Get-FileHash .\L-BOT-Setup-0.3.0-x64.exe -Algorithm SHA256
Get-FileHash .\L-BOT-Android-0.3.0-arm64-debug.apk -Algorithm SHA256
```

Linux：`sha256sum 文件名`；macOS：`shasum -a 256 文件名`。与校验清单逐字比较，文件名对应且哈希相同再使用。哈希能检查文件一致性，不能代替发布者代码签名。

## Windows 三步安装与接入

1. 在 Windows 10/11 x64 运行 `L-BOT-Setup-0.3.0-x64.exe`，按中文向导安装到当前用户目录。若缺少 Visual C++ x64 运行库，安装器核验固定 SHA-256 与 Microsoft 签名后通过正常 UAC 安装。9B 模型建议至少 16 GiB 物理内存及 8.5 GB 可用存储；Whisper x64 CPU 引擎要求 AVX2、FMA、F16C。
2. 打开“本地模型”，下载、校验并加载默认 9B；也可在“自定义 API”保存有效配置并测试。安装器含原生引擎，不含模型权重。首次加载及 CPU 生成可能需等待几分钟，可查看页面进度。
3. 打开“账号连接”，选择“打开官方网页登录”或“打开本机客户端”，由本人登录。再点“选择聊天窗口”，读取或截图，确认会话与消息，选择输入框和发送方式，生成、编辑并“核对草稿并发送一次”。详见 [窗口操作](COMPUTER_USE.md)。

哔哩哔哩、微博、WhatsApp、微信提供隔离的官方网页登录窗口；QQ 个人号没有官方网页私信入口，使用已安装 QQ 客户端。微信账号不能使用网页版时，改用本机微信。应用会区分“已请求打开窗口”和“登录未验证”，不会把打开网页当成消息已连接。

## Android 三步安装与接入

1. 在 arm64 Android 设备安装 `L-BOT-Android-0.3.0-arm64-debug.apk`。系统提示时，仅为用于安装的文件管理器／浏览器允许“安装未知应用”。最低 Android 6.0 / API 23，目标 SDK 35。
2. 在“本地模型”下载、校验并加载默认 2B，建议保留至少 3 GB 存储余量；视觉与语音组件另需空间。先用“建议与演练”生成一句回复，确认模型可用。
3. 在“账号连接”点“打开系统通知使用权设置”，为 L-BOT 授权；打开本机官方 App，确认登录和消息通知已启用，再回到 L-BOT 刷新接入状态，等待一条真实新通知。点“生成回复建议”，编辑审核；通知有 RemoteInput 回复动作才能“审核并发送一次”，否则“复制回复草稿”并打开原 App 粘贴发送。

通知只包含系统实际投递的内容，可能被客户端隐藏或合并；不读取完整聊天历史，也不保证五个平台都提供通知回复。每个应用的“仅前台自动回复”默认关闭；启用后仅处理本页前台收到的新通知，遇到需审核或结果未知即停止。离页、后台或暂停会撤销本次自动授权；系统省电杀进程后不承诺继续回复。麦克风仅在主动录音并允许系统权限后使用。

## 从 0.2.0 升级

`0.2.0` 已作为旧版保留，请安装 `0.3.0` 修正版。升级前在“运行与数据”导出加密备份，保留原有应用数据；Windows 继续使用原用户的数据位置。

Android 同一 `applicationId` 的更新需要兼容签名。签名冲突时不要直接清数据：先在旧版导出加密备份，再按系统提示处理。卸载或更换签名可能丢失本地状态；API Key 不随备份导出，恢复后重新填写。导入备份会暂停并关闭自动发送，重新核对规则后再授权。

## 首次模型准备

安装器包含 llama.cpp／mtmd 与 whisper.cpp 原生引擎，**不含模型权重**。模型下载来源、版本、大小和 SHA-256 固定在 `resources/` 清单中。

| 项目 | Windows | Android |
| --- | --- | --- |
| 默认文字模型 | HauhauCS Qwen3.5-9B Q4_K_M，5,627,044,224 bytes | HauhauCS Qwen3.5-2B Q4_K_M，1,270,808,032 bytes |
| 默认完整有效上下文 | 12,800 tokens | 12,800 tokens |
| 匹配视觉组件（可选） | 9B BF16 projector，921,704,448 bytes | 2B F16 projector，668,226,688 bytes |
| 语音组件（可选） | Whisper Base 多语言，147,951,465 bytes | 同左 |

在“本地模型”分别下载需要的组件，等待完整校验成功后加载。校验失败、中断、空间不足或引擎不可用时查看明确错误；半文件不算已安装。组件准备好后，本地处理可离线进行，首次下载模型不等于上传聊天。

可导入有权使用且在支持架构范围内的 GGUF 文字模型。导入检查与实际加载是两个步骤；其他模型的上下文能力受文件和引擎限制。加载自定义模型后，生成沿用其路径与实际上下文；页面显示有效长度，不把较短上下文算作默认 12,800 验收。当前视觉路径使用本平台默认模型的匹配 projector，不支持任意 GGUF 与任意 projector 组合。2B 与 9B 组件不要混用。

## 试用本人表达

在“我的表达”保存并确认本人原句或真实回复，点“试用我的表达生成回复”。在“建议与演练”填一句假设收到的消息，再点“生成建议回复”。页面显示本地模型状态、生成阶段和实际引用的本人样本数；缺少模型可点“准备本地模型”，也可进入“配置 API 生成”。API 每次生成前需明确允许上传。生成内容不会自动成为本人学习样本。

## API 设置

“自定义 API”保留 DeepSeek、豆包／火山方舟、千问／百炼预设，并支持其他 OpenAI 兼容服务。选择预设后填写实际地址、模型／接入点 ID、上下文、输出上限和 Key，保存到本机安全存储，再获取模型列表或发送固定测试消息。

预设地址分别为 `https://api.deepseek.com/v1`、`https://ark.cn-beijing.volces.com/api/v3`、`https://dashscope.aliyuncs.com/compatible-mode/v1`。模型 ID、地域与媒体协议以服务当前文档为准。按服务支持情况设置文字、图片与语音能力，不能用文字测试证明媒体可用。

API 模式或混合模式会在授权后将相应内容发送给所选服务。勾选明确上传授权前不传送聊天；本地组件失败不会自动改用云端。401、403、429 分别提示鉴权、权限与限流问题，请核对实际服务状态。

## 从源码运行

源码包解压后，进入**包含 `package.json`、`package-lock.json`、`apps/` 和 `packages/` 的项目根目录**。不要将 `apps/web/` 当成独立 npm 项目。也可通过 Git 取得仓库：

```bash
git clone https://github.com/nana7m1773/TC.git
cd TC
npm ci
npm run build
npm test
```

需要 Node.js 22+、npm、Git。使用锁文件安装，不手工替换锁定依赖。UI 测试需要 Chromium：

```bash
npx playwright install chromium
npm run test:ui
```

Linux 缺少浏览器系统库时可使用 Playwright 官方安装步骤，或通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定可用 Chromium。`npm run test:ui` 会按测试配置启动 Vite；它使用测试桥验证界面，不执行真实 Windows 发送。

`npm run dev` 启动界面开发服务器。浏览器模式只保存内存，刷新清空；原生模型、安全存储与 Windows 窗口操作需运行原生应用。

Windows 桌面开发先准备固定引擎，再启动：

```powershell
node scripts/prepare-engine.mjs --platform win-x64
node scripts/prepare-engine.mjs --speech
npm run build
npm run desktop
```

若系统缺少 Microsoft Visual C++ x64 运行库，使用 Microsoft 官方安装器补齐。`--speech` 准备语音引擎，语音模型仍需在应用中下载。

Linux 桌面开发需 CMake、C/C++ 构建工具、OpenSSL 开发库、图形会话和系统密钥环：

```bash
node scripts/prepare-engine.mjs --platform linux-x64
npm run build
npm run desktop
```

Linux 桌面启动用于开发；Windows UIA 入口会明确拒绝非 Windows 平台。无图形环境的云机使用构建、单元测试和 Playwright 验证，不能将其算作桌面启动成功。安全存储不可用时不能降级到明文。

## 从源码构建安装包

Windows x64 安装器：

```bash
npm run build:windows
```

脚本准备固定且经 SHA-256 校验的 Windows CPU 引擎、Whisper 引擎和 VC++ 前置安装器，构建前端，再生成 `artifacts/windows/L-BOT-Setup-0.3.0-x64.exe`。Linux 可以进行交叉打包，但不能运行 Windows 安装验收；Windows 签名、DPAPI、托盘和 UIA 必须在目标系统检查。

Android 当前提供 Linux 工具链脚本：

```bash
bash scripts/install-android-toolchain.sh
source scripts/android-env.sh
npm run build:android
```

云机默认工具目录为 `/workspace/.tooling`，引擎源码默认放在 `/workspace/.cache/`。普通 Linux 开发机可在上述步骤前把相关目录设置为自己可写的位置：

```bash
export TC_TOOLING_DIR="$PWD/.cache/android-toolchain"
export LLAMA_SOURCE_DIR="$PWD/.cache/llama.cpp-android"
export WHISPER_SOURCE_DIR="$PWD/.cache/whisper.cpp"
```

脚本固定 JDK 21.0.8+9、Gradle 8.11.1、SDK / build-tools 35、NDK 28.2.13676358 和 CMake 3.22.1，下载保留官方校验，并接受 Android SDK 许可证。构建固定 llama.cpp／whisper.cpp ARM64 原生库，输出 `artifacts/android/L-BOT-Android-0.3.0-arm64-debug.apk`。

更多云机代理、缓存、工具链与许可信息见 [构建说明](BUILD.md)；仓库开发技能见 [SKILLS.md](SKILLS.md)。使用已有 checkout；云任务本身已隔离，除非使用者明确要求，不额外创建 worktree。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| Release 链接 404 | 先查看目标 Release 是否已公开并列出对应资产；不要将目标链接视作发布成功证据 |
| 模型下载／SHA-256 检查失败 | 检查网络、剩余空间与完整错误；重试经过校验的下载，不跳过校验 |
| 模型加载失败或内存不足 | 停止模型释放资源，检查硬件与兼容性；资源建议不保证所有设备可用 |
| Playwright 提示缺少浏览器 | 安装 Chromium，或配置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 后重跑 |
| 看不到社交窗口／发送按钮不可用 | 先打开本机官方客户端并进入会话，刷新窗口并明确选择输入框和发送方式；窗口控件不支持时复制草稿到原应用。发布者信息仅供核对，不要求签名验证成功才能枚举 |
| Android 没有新通知 | 检查通知使用权、监听器连接、官方 App 的消息通知设置；返回本页并刷新后等待新消息，旧聊天记录不会自动补入 |
| Android 有通知却不能发送 | 查看是否提供 RemoteInput 回复动作；没有动作时复制草稿并打开原 App，不能凭通知正文获得发送能力 |
| 我的表达无法生成／一直等待 | 从“试用我的表达生成回复”查看模型状态；先下载并加载模型，或保存 API 并授权本次上传。9B CPU 加载和生成可能需几分钟 |
| 发送结果未知 | 到官方客户端核对；只锁定对应会话，不自动重试。在本页或“待审核回复”填写核实依据，重启后仍可处理 |
| 导入加密备份后不自动回复 | 导入后默认暂停，重新配置密钥并核对范围和规则后再授权 |

本版实际操作见 [USER_GUIDE.md](USER_GUIDE.md)。[登录与权限](LOGIN_AND_PERMISSIONS.md)、[历史验收记录](VALIDATION.md) 保留背景与旧版证据；以本版验证包区分当前检查、模拟结果和真实设备结果。
