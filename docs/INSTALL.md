# L-BOT 安装教程

主作者：**Hebe**；赞助商：**Zijie**。

本文面向 `0.2.0` 开发验收版本。仓库为 [nana7m1773/TC](https://github.com/nana7m1773/TC)，应用名为 **L-BOT**。Windows 安装器未签名，Android APK 使用调试签名；安装包构建通过不代表目标设备已经运行验收。

## 取得文件与校验

下载见 [v0.2.0 Release](https://github.com/nana7m1773/TC/releases/tag/v0.2.0)。请选择与你的平台对应的安装包，并核对校验清单。

| 平台／资料 | 固定下载入口 |
| --- | --- |
| Windows 10/11 x64 | [L-BOT-Setup-0.2.0-x64.exe](https://github.com/nana7m1773/TC/releases/download/v0.2.0/L-BOT-Setup-0.2.0-x64.exe) |
| Android arm64 | [L-BOT-Android-0.2.0-arm64-debug.apk](https://github.com/nana7m1773/TC/releases/download/v0.2.0/L-BOT-Android-0.2.0-arm64-debug.apk) |
| 源码 | [L-BOT-source-0.2.0.zip](https://github.com/nana7m1773/TC/releases/download/v0.2.0/L-BOT-source-0.2.0.zip) |
| 验证资料 | [L-BOT-validation-0.2.0.zip](https://github.com/nana7m1773/TC/releases/download/v0.2.0/L-BOT-validation-0.2.0.zip) |

下载后，使用 Release 提供的 `SHA256SUMS.txt` 核对对应文件。Windows PowerShell：

```powershell
Get-FileHash .\L-BOT-Setup-0.2.0-x64.exe -Algorithm SHA256
Get-FileHash .\L-BOT-Android-0.2.0-arm64-debug.apk -Algorithm SHA256
```

Linux：`sha256sum 文件名`；macOS：`shasum -a 256 文件名`。与校验清单逐字比较，文件名对应且哈希相同再使用。哈希能检查文件一致性，不能代替发布者代码签名。

## Windows 安装

1. 使用 Windows 10/11 x64。9B 模型建议至少 16 GiB 物理内存及 8.5 GB 可用存储；这是资源建议，尚无 Windows 实机性能保证。内置 Whisper x64 CPU 引擎要求 AVX2、FMA、F16C。
2. 运行 `L-BOT-Setup-0.2.0-x64.exe`，按中文向导安装到当前用户应用目录。当前开发包未签名，Windows 可能显示“未知发布者”；核对来源和 SHA-256 后按你的设备策略决定是否继续。
3. 缺少 Visual C++ x64 运行库时，安装器先核对固定 SHA-256 和 Microsoft Authenticode 签名，再通过正常 UAC 提示安装前置组件。检查失败时停止，不需要关闭系统校验。
4. 从桌面或开始菜单打开 L-BOT，在“本地模型”下载、校验并加载默认模型。托盘提供打开、暂停与退出入口。
5. 先使用手动消息生成草稿，核对表达偏好与审核规则。要操作社交窗口，再阅读 [Windows 窗口操作教程](COMPUTER_USE.md)。

本人在官方社交客户端或官方网页完成登录。L-BOT 不通过安装步骤获得个人私信 API 权限，也不会自动登录所有平台。

## Android 安装

1. 使用 arm64 Android 设备；构建最低 SDK 为 Android 6.0 / API 23，目标 SDK 为 35。设备、WebView、音频编码与后台行为仍需实测；8GB 物理 RAM 是验收目标。
2. 下载 `L-BOT-Android-0.2.0-arm64-debug.apk`，在系统提示中仅为用于安装的文件管理器／浏览器允许“安装未知应用”，然后安装。该包为调试签名开发版。
3. 打开 L-BOT，下载默认 2B 模型。建议至少保留 3 GB 存储余量；若也安装视觉和语音组件，需额外空间。
4. 麦克风只在你主动录音并允许系统权限后使用；文件由你通过系统选择器选择。Android 当前没有 Windows UIA 窗口操作能力，不会冒充已经接管其他应用。
5. 先检查手动文本生成、所选图片／音频处理和加密导出。系统省电、锁屏、后台恢复、温度及 30 分钟稳定性仍待设备验证，不能依赖进程被杀后继续代回。

同一 `applicationId` 的更新需要兼容签名。遇到签名冲突不要直接清数据：先在旧版导出加密备份，再按设备提示处理。更换签名或卸载可能丢失本地状态；API 密钥不会随备份导出。

## 首次模型准备

安装器包含 llama.cpp／mtmd 与 whisper.cpp 原生引擎，**不含模型权重**。模型下载来源、版本、大小和 SHA-256 固定在 `resources/` 清单中。

| 项目 | Windows | Android |
| --- | --- | --- |
| 默认文字模型 | HauhauCS Qwen3.5-9B Q4_K_M，5,627,044,224 bytes | HauhauCS Qwen3.5-2B Q4_K_M，1,270,808,032 bytes |
| 默认完整有效上下文 | 12,800 tokens | 12,800 tokens |
| 匹配视觉组件（可选） | 9B BF16 projector，921,704,448 bytes | 2B F16 projector，668,226,688 bytes |
| 语音组件（可选） | Whisper Base 多语言，147,951,465 bytes | 同左 |

在“本地模型”分别下载需要的组件，等待完整校验成功后加载。校验失败、中断、空间不足或引擎不可用时查看明确错误；半文件不算已安装。组件准备好后，本地处理可离线进行，首次下载模型不等于上传聊天。

可导入有权使用且在支持架构范围内的 GGUF 文字模型。导入检查与实际加载是两个步骤；其他模型的上下文能力受文件和引擎限制。当前视觉路径使用本平台默认模型的匹配 projector，不支持任意 GGUF 与任意 projector 组合。2B 与 9B 组件不要混用。

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

脚本准备固定且经 SHA-256 校验的 Windows CPU 引擎、Whisper 引擎和 VC++ 前置安装器，构建前端，再生成 `artifacts/windows/L-BOT-Setup-0.2.0-x64.exe`。Linux 可以进行交叉打包，但不能运行 Windows 安装验收；Windows 签名、DPAPI、托盘和 UIA 必须在目标系统检查。

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

脚本固定 JDK 21.0.8+9、Gradle 8.11.1、SDK / build-tools 35、NDK 28.2.13676358 和 CMake 3.22.1，下载保留官方校验，并接受 Android SDK 许可证。构建固定 llama.cpp／whisper.cpp ARM64 原生库，输出 `artifacts/android/L-BOT-Android-0.2.0-arm64-debug.apk`。

更多云机代理、缓存、工具链与许可信息见 [构建说明](BUILD.md)；仓库开发技能见 [SKILLS.md](SKILLS.md)。使用已有 checkout；云任务本身已隔离，除非使用者明确要求，不额外创建 worktree。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| Release 链接 404 | 先查看目标 Release 是否已公开并列出对应资产；不要将目标链接视作发布成功证据 |
| 模型下载／SHA-256 检查失败 | 检查网络、剩余空间与完整错误；重试经过校验的下载，不跳过校验 |
| 模型加载失败或内存不足 | 停止模型释放资源，检查硬件与兼容性；资源建议不保证所有设备可用 |
| Playwright 提示缺少浏览器 | 安装 Chromium，或配置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 后重跑 |
| 看不到社交窗口／发送按钮不可用 | 检查官方客户端、签名、窗口状态及 UIA 能力；按 [窗口操作说明](COMPUTER_USE.md) 手动处理 |
| 发送结果未知 | 到官方客户端核对；应用暂停且不会自动重试，不将未知状态当成发送成功 |
| 导入加密备份后不自动回复 | 导入后默认暂停，重新配置密钥并核对范围和规则后再授权 |

真实平台登录与权限的当前边界见 [LOGIN_AND_PERMISSIONS.md](LOGIN_AND_PERMISSIONS.md)，各类验证证据见 [VALIDATION.md](VALIDATION.md)。
