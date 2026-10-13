# 固定依赖与许可

完整版本与 integrity 见 package-lock.json，直接版本见 package.json。

| 组件 | 版本 | 许可 |
| --- | --- | --- |
| React / React DOM | 19.0.0 | MIT |
| TypeScript | 5.7.2 | Apache-2.0 |
| Capacitor | 7.6.9 | MIT |
| Electron | 44.7.0 | MIT |
| electron-builder | 26.15.3 | MIT |
| Vite | 6.4.4 | MIT |
| Playwright | 1.56.1 | Apache-2.0 |
| lucide-react | 0.468.0 | ISC |
| llama.cpp | b11429 / d81235049384534c167caea52b85a694f6103d14 | MIT |
| HauhauCS Qwen3.5-2B Q4_K_M | 2bcf35c1ebf62c837c12c1aa90b578ff4717e831 | 原版／发布者标记 Apache-2.0，按具体模型仓库许可 |
| HauhauCS Qwen3.5-9B Q4_K_M（Windows 默认） | 0a41c68809d375475f954be12ba7c40efa56c2a9；大小／SHA 见 default-model.windows.json | 原版／发布者标记 Apache-2.0，按具体模型仓库许可 |
| whisper.cpp / Whisper Base | v1.8.7 / 48f628a84833905ee4a0658ee6d4a5c915ce1997；模型固定revision与SHA见local-speech.json | MIT |
| Microsoft VC++ x64 | 14.51.36247.0，官方SHA和安装时Microsoft签名核验 | Microsoft运行库许可 |
| Android SDK / NDK | SDK35 / NDK28.2.13676358 | Google SDK 条款及第三方许可 |
| Temurin JDK | 21.0.8+9 | GPLv2 + Classpath Exception |
| Gradle | 8.11.1 | Apache-2.0 |

模型与上游原生制品许可单独适用，本仓库 Apache 许可不覆盖全部第三方文件。正式分发前复查 NOTICE。

本期修复已发现的依赖问题：Capacitor 从7.4.3更新至7.6.9，Electron、builder、Vite 更新到当前修复版。审计最终状态见 VALIDATION。签名未提供不能等同于关闭 TLS 或 checksum。
