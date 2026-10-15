# 构建说明

云机为 Linux x64，Node 24，工作目录 `/workspace/TC`。直接使用已有 checkout，云任务已隔离，除非使用者明确要求，不创建 worktree。

```bash
cd /workspace/TC
export npm_config_cache=/workspace/.npm-cache
export XDG_CACHE_HOME=/workspace/.cache
export ELECTRON_CACHE=/workspace/.cache/electron
export ELECTRON_BUILDER_CACHE=/workspace/.cache/electron-builder
export NODE_USE_ENV_PROXY=1
export ELECTRON_GET_USE_PROXY=1
export GLOBAL_AGENT_HTTP_PROXY="$HTTPS_PROXY"
npm ci
npm run verify
npm run test:ui
```

代理仅读取运行时变量，不记录值；无代理开发机可省略对应配置。保留 TLS／制品校验。UI 测试优先系统 Chromium，其他机器可指定 PLAYWRIGHT_CHROMIUM_EXECUTABLE 或安装 Playwright 浏览器。

## Windows

`npm run build:windows` 准备经过官方 SHA-256 校验的 CPU 引擎、构建 UI、生成 NSIS x64 安装器至 `artifacts/windows/L-BOT-Setup-0.3.0-x64.exe`。文件名使用 `package.json` 的版本，electron-builder 按 `L-BOT-Setup-${version}-${arch}.${ext}` 生成。Linux 构建不等于 Windows 已安装运行。正式发布需签名和 Windows 安装／DPAPI／托盘测试，不伪造证书。

Linux 桌面开发先 `node scripts/prepare-engine.mjs --platform linux-x64`，再 build 和 desktop；需要图形环境和系统密钥环，缺密钥环不能保存明文。

## Android

```bash
bash scripts/install-android-toolchain.sh
source scripts/android-env.sh
npm run build:android
```

工具仅写 TC_TOOLING_DIR（默认 /workspace/.tooling），固定 Temurin JDK 21.0.8+9、Gradle 8.11.1、SDK35、build-tools35.0.0、NDK28.2.13676358、CMake3.22.1。JDK／Gradle 使用发布者 SHA-256，Google CLI 使用官方 metadata 校验，sdkmanager 保留验证。脚本接受 SDK 许可证，正式使用仍遵守适用许可。

android-env 使用系统 CA 与当前代理，保留 TLS。工具链、依赖、Gradle 缓存可留存，进程不能假设随快照恢复。

构建固定 llama.cpp 与 whisper.cpp tag/commit，通过真实 CMake/NDK 编译 ARM64 库，用两 Gradle workers。复制 dist 和 canonical manifest 到 generated assets，当前产物为 `artifacts/android/L-BOT-Android-0.3.0-arm64-debug.apk`。构建脚本从 `package.json` 动态读取版本，输出 `L-BOT-Android-<version>-arm64-debug.apk`；发布前同时核对 Gradle 的 `versionName`／`versionCode`，不要将旧版本 APK 改名冒充新构建。调试签名不等于正式签名；JNI 编译不是手机运行证明。

## 模型与网络

Android 使用 resources/default-model.json 的 2B Q4_K_M，Windows 使用 resources/default-model.windows.json 的 9B Q4_K_M；各自固定 revision、大小、LFS SHA-256 及匹配视觉组件。prepare-model.mjs 续传并完整校验，不安装半文件。必要来源为官方 GitHub release、Hugging Face 和 us.aws.cdn.hf.co。

`0.2.0` 的 2B／9B、匹配视觉、语音和近满上下文报告保留作历史记录；`0.3.0` 构建与运行结果以本版验证包为准，不能将旧包、旧版报告或 2B 验收当成当前 9B／目标设备结果。必要域名保留在配置草稿；草稿不等于已发布，也不能外推至新任务／目标设备。新机器需保存并发布环境后独立验证，不能降低校验绕过失败。

依赖安全补丁、模型/引擎 pin或 UI 更新后，重跑相关测试、两端构建并生成新 SHA256SUMS。复用通过校验的同版制品，不把旧包算作新结果。

Windows 包包含经过官方 SHA 校验的 Microsoft VC++ x64 前置安装器，安装时再次检查 Authenticode 和发布者；Linux 构建未执行 Windows 安装。APK关闭 WebView调试和 Capacitor控制台记录，导出使用原生SAF文件保存。
