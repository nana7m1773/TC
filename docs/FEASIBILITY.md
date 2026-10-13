# 可行性、模型与阶段范围

研究日期：**2026-10-11**，实现状态更新至 **2026-10-13**。这是实现与验收边界说明。官方模型能力、软件构建成功和真实设备验收是三个不同结论；完成情况以实际构建产物、测试记录和验收报告为准。

## 简明结论

- Android 与 Windows 可以共享中文界面、账号能力声明、个人风格、记忆隔离、规则、消息状态和模型适配逻辑；本地推理、安全存储、生命周期和桌面托盘应分别实现原生接口。
- 根据使用者最新指定，**Android 默认 HauhauCS Qwen3.5-2B Q4_K_M，Windows 默认 HauhauCS Qwen3.5-9B Q4_K_M**，均为 GGUF、默认完整上下文 12,800。Android 2B 保持原文件与哈希，上轮已完整下载校验并在 Linux 云机实际加载、完成接近预算的生成。Windows 9B 的固定发布者元数据已核实，完整制品与推理另行验证；2B 结果不能外推至 9B，8GB 手机与真实 Windows 仍须实测。
- 本地引擎采用 **llama.cpp** 的 CPU 兼容路径。Android 通过 Java / JNI 调用内置原生库，Windows 由安装包管理内置 `llama-server` 子进程。普通使用者无需 Python、命令行或独立模型服务器。
- 本人日常社交账号的完整聊天读写当前未获验证；[平台能力表](PLATFORM_CAPABILITIES.md)说明可核实的 QQ 机器人和 WhatsApp Business 路线及其他缺口。首版明确标识模拟／导入／粘贴。
- **8GB 真实 Android 设备、接近 12,800 tokens 和 30 分钟连续交互尚待实机验证**。模型制品下载阻塞已解决；真实设备和平台凭据仍未具备，独立模块验证不能替代这些未通过项。
- Qwen3.5 读图需要主 GGUF 与匹配的 `mmproj`；语音使用独立 Whisper Base 多语言组件。两条本地路径已实现，并用真实制品在 Linux 云机运行。完全本地模式缺少组件时提示安装，不能自动改用外部服务。OCR 不能代替图片语义理解。

## 技术选型及边界

| 模块 | 方案 | 理由及需验证的边界 |
| --- | --- | --- |
| 共用界面与业务 | React / TypeScript；触控窄屏与桌面多栏适配 | 能共享档案、规则、队列、能力表和 API 设置；不依赖 WebView 实现本地大模型计算 |
| Android 外壳 | Capacitor；原生 Java 插件；JNI / llama.cpp | Android NDK 可编译 CPU 引擎；实机内存、热管理、生命周期和后台权限需分别验收 |
| Windows 外壳 | Electron；受限 IPC；安装包随附 llama-server | 进程隔离、取消任务与托盘可独立管理；引擎只监听 loopback，使用随机端口及临时鉴权，禁止暴露公网 |
| 本地文本／选装视觉 | Android 2B Q4_K_M、Windows 9B Q4_K_M；各自匹配 mmproj；手机约 4B 兼容模型选装 | 上轮 2B 文字及视觉路径已在 Linux 云机实跑；新增 9B 单独核对制品及运行；4B 不默认在 8GB 手机启用，9B 不改为手机默认；设备兼容性仍须验收 |
| 本地语音 | 内置 whisper.cpp；Whisper Base 多语言模型按需下载 | 短中文及英文样本已在 Linux 云机实际转写；真实手机编码、录音、资源和代表性准确率仍须验收 |
| 外部模型 | 独立 OpenAI 兼容适配器 | URL、模型 ID、超时、上下文和各模态支持均由用户配置；模型列表可选，手填 ID 必须可用 |
| 个性化 | 可编辑档案、本人示例检索和判断原则；版本化反馈 | 第一版不做手机权重微调；只有本人确认的纠正加入示例，不能自动把 AI 草稿当作正确答案 |
| 记忆／存储 | 低常驻内存检索、账号／会话／联系人作用域；加密敏感数据 | 凭据使用 Android Keystore、Windows 系统保护；日志脱敏；跨联系人共享必须显式确认 |
| 平台连接 | 能力声明 + 分离的连接器 | 按实际授权开放按钮；个人授权、机器人、业务客服、手动输入和模拟类型不能合并 |

本期不要求 macOS、iOS、云同步或模型权重微调。两个设备可独立使用保护后的导入／导出；没有可靠协调机制时，同一账号只允许一台设备成为自动发送负责人。

## Android 默认 2B 的已记录核实状态

| 项目 | 结论 | 证据／待完成项 |
| --- | --- | --- |
| 参数规模 | 原版 Qwen3.5-2B 是 2B dense、24 层、混合线性／全注意力架构；带视觉编码器 | 已读取 [Qwen 官方模型卡](https://huggingface.co/Qwen/Qwen3.5-2B/blob/main/README.md)和 [官方 config](https://huggingface.co/Qwen/Qwen3.5-2B/blob/main/config.json)；默认实际制品来自社区 HauhauCS，不称为 Qwen 官方量化 |
| 原生上下文 | 原版官方列 262,144；社区卡列 262K；不需 YaRN 才能设置 12,800 | 官方 config 的 `max_position_embeddings=262144`；实际默认 GGUF 已由固定引擎加载，Linux 两条同源路径已按 12,800 有效上下文实跑，tokenizer 与输入计数一致 |
| 实际量化 | Q4_K_M，不是全部张量严格 4 bits | 发布者文件为 1,270,808,032 bytes；完整文件已下载、核对固定 SHA-256 并用于 Linux 本地生成，具体 revision／SHA-256 见下方 |
| 模型分发／许可证 | 原版与社区卡标注 Apache 2.0 | 随包保存社区来源、实际制品许可、版本和哈希；社区“零能力损失”等描述没有作为本产品验收结论 |
| 引擎能力 | 固定 llama.cpp 支持 GGUF、CPU、qwen35、mtmd、chat template、tokenize 和 server API | Android ARM64 已真实编译；桌面固定引擎及 Android 同源 JNI 在 Linux 实跑。Windows 安装运行与 Android 设备 ABI 仍须实机验证 |
| 8GB 手机加载和速度 | 待实机验证 | 没有真实手机测量；不引用其他模型、模拟器、云 CPU 或宣传页速度作为通过证据 |
| 满上下文预算 | Linux 接近完整预算生成已通过；8GB 手机待实测 | DesktopModelManager 为 12,719 + 64 / 12,800，同源 JNI 为 12,758 + 32 / 12,800；设备 n_ctx、内存、温度和稳定性仍须独立记录 |
| 默认安装路径 | 已在云机完成实际下载、固定哈希校验和本地生成 | 目标设备的应用内下载／导入仍待实测，不能由云机替代 |

默认制品锁定信息（2026-10-11 从发布者仓库 API 核实）：

- 仓库：[HauhauCS/Qwen3.5-2B-Uncensored-HauhauCS-Aggressive](https://huggingface.co/HauhauCS/Qwen3.5-2B-Uncensored-HauhauCS-Aggressive)。这是社区修改／量化版本，原版来源为 [Qwen/Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B)。
- Revision：`2bcf35c1ebf62c837c12c1aa90b578ff4717e831`。
- 文件：`Qwen3.5-2B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf`，**1,270,808,032 bytes**（约 1.27 GB／1.18 GiB）。
- 发布者文件 LFS SHA-256：`be3ccca13a9d1bc8b67165ea80bd103cd6151a37ad131183cc7ca388f78d9517`。
- 选装视觉：`mmproj-Qwen3.5-2B-Uncensored-HauhauCS-Aggressive-f16.gguf`，**668,226,688 bytes**（约 668 MB／637 MiB），SHA-256 `a86ac75fbd9a11d1883c688969d88a11d3d24a729cc7e181833fd2e1b3865c9d`。已接入 mtmd 并以实际下载校验的文件完成 Linux 图片语义验证；新设备未安装该组件时仍不能读图。

最初请求被代理403拒绝；网络状态变化后已读取元数据，并于2026-10-12实际下载、核对三个组件完整SHA并完成本地推理。详见VALIDATION。**云机成功不等于8GB手机验收**。本产品的程序规则、权限和审核保持独立于模型；“uncensored”标签不会改变自动发送权限或记忆隔离。

引擎已固定为 `llama.cpp b11429`，commit `d81235049384534c167caea52b85a694f6103d14`。旧 `b6838/b6839` 早于该架构，不再作为默认模型兼容依据；当前 Android 原生构建和 Windows 随包引擎均使用该固定版本，后续更换版本必须重新构建／校验。

## Windows 0.2 默认 9B 的独立核实

Windows 默认制品来自 [HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive](https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive)，固定 revision `0a41c68809d375475f954be12ba7c40efa56c2a9`。Q4_K_M 文件为 **5,627,044,224 bytes**（约 5.63 GB／5.24 GiB），SHA-256 `2ca636d9e81d3d23ca9b60c234fe185d30ec082eeba69ce770fdb0c76559a4f5`。原版来自 Qwen；官方固定 config 的原生上下文为 262,144，应用仍设为完整 **12,800 tokens**。

匹配的 **BF16 视觉 projector** 为 **921,704,448 bytes**，SHA-256 `05f662501f8bd45607b079723a3e238a4e888fd085a10a53f4057a0e250f6934`。它与 Android 2B 的 F16 projector 分开管理，不混用。准确文件名、来源、许可和校验 URL 见 [Windows manifest](../resources/default-model.windows.json)。

建议至少 16 GiB 物理内存和 8.5 GB 可用存储，这是制品与工作空间的资源建议，未作为进程峰值或设备通过结论。发布者元数据核实、完整文件哈希／GGUF 检查、实际本地生成及真实 Windows 安装运行分别记录；本轮状态见 [验收记录](VALIDATION.md)。保留上轮 2B 的婉拒、截图用途猜测及转写词误差等失败质量证据。

## 安装、下载与兼容性

预期日常操作为“本地模型 → 默认模型 → 查看体积和存储要求 → 下载 → 校验 → 加载”。模型安装后的生成无需外部网络。首次下载访问制品源不等于上传聊天；完全本地模式不调用外部推理。

发布默认下载项前必须完成以下条件：

1. 从所选发布者仓库获取并固定具体 revision、文件名、完整字节数和发布元数据的 SHA-256 / LFS OID；显示量化、许可、目标上下文和额外空间。社区制品明确写明社区发布者，不能称为 Qwen 官方校验。不能捏造哈希，也不能把用户随便填的哈希当作发布者验证。
2. 下载使用 TLS 证书验证和独立临时文件。断点续传验证 Range、ETag / revision、Content-Range 与现有字节一致；源文件发生变化时重新开始。
3. 下载完成核对完整字节数及哈希，再原子移到模型库。失败不准标为可加载，不关闭 TLS 或放宽 checksum 验证。
4. 导入仅接受当前引擎实际支持的 GGUF：检查文件头、架构、tokenizer、chat template、量化及原生 context，然后尝试受限加载。扩展名检查不能代替引擎验证。
5. 删除／切换前取消推理并释放 model、context 和 KV 缓存；磁盘空间不足、校验失败、加载失败和组件缺失显示具体原因。

无法取得可信默认制品时，允许用户选择有权使用且经本机校验的兼容 GGUF；默认一键方案只有在完整下载、哈希与实际离线生成通过后才标为已验证。不能在安装包内放占位模型并声称离线推理成功。

## 12,800 tokens 的实际配置和预算

默认总预算为 **12,800**，包括系统指令、档案、检索记忆、历史、当前输入、chat template / 特殊 tokens、多模态占用及保留输出。首版文字生成默认预留 768 tokens，但输入上限须由完整模板计数决定，不能按字符数裁剪并宣称满足 token 预算。

- Windows 引擎配置单槽 `--ctx-size 12800 --parallel 1 --n-gpu-layers 0`；禁用无限上下文移位以便显式预算。参数以固定版本的 `--help` 验证。
- Android JNI 设置 `llama_context_params.n_ctx = 12800`，单一模型任务；读取引擎实际 `n_ctx`，而非只展示 UI 设置。
- 使用 GGUF 匹配的 tokenizer 和 chat template。Windows 可用 `/apply-template` 再 `/tokenize`；JNI 使用相同 engine tokenizer。计入 BOS、结束标志、assistant prefix 以及 reasoning 输出的占用。字符数估算只用于输入预警，不得作为验收计数或精确预算。
- 每次生成前先保留当前消息、必要规则和当前会话有权使用的记忆，再裁剪／摘要较早历史；原始消息不从数据库删除。历史摘要也是不可信聊天数据，不能变成权限指令或本人事实。
- 输出额度占用同一上下文；展示已用／总量和最大回复长度。原版 Qwen3.5-2B 官方说明默认 non-thinking，且不支持 Qwen3 的 `/think`、`/nothink` soft switch；不得注入旧 `/no_think` 来假设关闭思考。实际社区模板与默认关闭thinking参数已在两种同源引擎路径核验，token计数与实际输入一致；设备质量仍需验证。
- 自愿降低至 8,192 或 4,096 时显式展示实际值；该运行不能计入 12,800 验收。API 模式使用服务的实际上下文限制。

llama.cpp 官方 server 文档已核实 `/tokenize`、`/apply-template`、上下文与并发参数、cache type 和 prompt timing 字段。KV 量化、Flash Attention 或分块预填充是否可用，须对固定引擎和 CPU 后端实测后启用。

## 8GB 手机资源策略

8GB 物理 RAM 不是 8GB 应用可用内存。Android、社交客户端、WebView、缓存、音频／图像缓冲和内核都占用资源。依据当时 `availableMem`、系统低内存阈值和温度决策，不能只看设备总内存。

默认 GGUF 发布者记录磁盘文件 1.27 GB；**磁盘大小不是进程峰值内存**。Qwen3.5-2B 是 18 层线性注意力 + 6 层 full attention，原版 full attention 为 2 KV heads、head_dim 256。仅这 6 层的 F16 KV 粗估 `2 × 6 × 12800 × 2 × 256 × 2` 约 150 MiB，此外还有线性状态、计算图、预填充工作区、tokenizer、WebView 等；这不是总内存估计或实测值。不能套用旧 Qwen3 的全部层标准 KV 公式。

资源策略：模型按需加载；单任务推理；图片／语音完成后释放组件再加载文本；预填充分块降低工作区峰值；保留系统及其他应用所需资源；内存不足取消任务、释放缓存并提示。默认 CPU，只有针对实际芯片验证后才开放 GPU / Vulkan 等加速选项。

F16 KV 是兼容基线；Q8_0 / Q4 类 KV 属于需实验的优化，分别记录支持情况、峰值内存、速度、摘要质量和中文回复变化。缓存类型与权重量化不同。不要在加载失败时静默降低上下文或自动上传 API。

温度过高、低电量、省电模式及系统低内存触发暂停。持续后台运行遵循 Android 允许的服务／通知机制；系统终止进程后不保证持续自动回复。Windows 托盘应明确区分待命、暂停、离线和故障。

## 图片和语音的分阶段方案

| 输入 | 首版兼容路线 | 完全本地的要求及状态 |
| --- | --- | --- |
| 文字 | 内置 GGUF 文本模型或用户 API | 真正使用本地引擎生成；模型未安装时提示安装，不伪造回复成功 |
| 图片 | 内置 mtmd + 匹配 mmproj；或用户配置并确认支持视觉的 API | 额外 668 MB projector 已固定许可、版本、大小和哈希。Linux 已完成真实图片语义生成；截图用例仍有用途猜测和截断，见验收记录；目标设备资源和图片质量仍待实测 |
| 语音／音频 | 内置 whisper.cpp + Whisper Base 多语言；或用户明确允许的转写 API | 已对短中英文样本实际转写，允许查看、修正和确认；不能将 `.en` 模型当作中文组件。真实 Android 编码／录音、Windows CPU 兼容性及代表性准确率仍待验证；small 未作为本期已验证组件 |

官方 [llama.cpp 多模态文档](https://github.com/ggml-org/llama.cpp/blob/master/tools/mtmd/README.md)明确主 GGUF 和匹配 `mmproj` 是不同组件，并说明多模态接口变化较大。需要固定支持 Qwen3.5 的版本，不能把其他模型 projector 混用。

官方 [whisper.cpp README](https://github.com/ggml-org/whisper.cpp)给出 base 模型约 142 MiB 磁盘／约 388 MB 内存、small 约 466 MiB／约 852 MB 的项目估算；这是上游参考值，**不是本产品手机进程实测**。实际转码、波形缓存和 Java / WebView 会增加总占用。

首版每次处理一个附件，单文件不超过 5 MB；图片在解码前检查不超过 400 万原始像素，再缩至最长边 1280；音频最长 60 秒，在本机转换为 16 kHz 单声道 PCM WAV。视觉占用由实际引擎计数并与输出共用预算。这些限制不代表手机性能验收，也不能拿 OCR 结果冒充语义理解。媒体字节、分析／转写、会话和原消息 ID 保持关联，处理结果先显示为未确认；本人修正并确认后才用于文字回复，不自动写入事实记忆。

混合模式允许文字生成、图片理解与语音转写分别选择本机或当前 API，默认三项均在本机；API 模式使用所选服务。任何外部处理均需明确上传授权，本地失败不自动回退 API。完全本地缺少视觉或转写组件时，任务停止并显示缺失项。

## 实机验收记录模板

当前所有设备性能字段均**待实机验证**，不能填入云环境测试值。测试最低一台 8GB **物理** RAM 手机，不借助云推理、额外硬件或大容量虚拟内存。

| 记录项 | 待记录内容 |
| --- | --- |
| 设备 | 品牌型号、SoC、CPU、8GB 物理 RAM 证明、Android／系统版本；虚拟内存状态 |
| 前置状态 | 电池／充电状态、室温、初始温度、后台应用、测试前可用内存、系统低内存阈值 |
| 软件与模型 | APK hash、应用版本、引擎 commit、CPU / 加速后端、线程数、模型 revision／文件 hash／量化／大小 |
| 上下文 | 引擎实际 n_ctx=12800；完整模板 input tokens、保留输出、实际输出、缓存类型、batch／ubatch |
| 性能 | 加载时间、首 token 时间、prefill tokens/s、生成 tokens/s、完整请求耗时、峰值 RSS／PSS、最终及最高温度 |
| 输入覆盖 | 短对话、中等历史、输入加保留输出接近 12800；文字、真实图像语义、中文及英文真实音频分别运行 |
| 持续运行 | 至少 30 分钟实际交互；崩溃、OOM、取消、暂停、回前台及重启恢复记录 |
| 系统场景 | 锁屏、省电、前后台、进程回收、低电、热状态和网络切换；记录系统停止服务时实际结果 |

验收还必须测试 API 自定义、档案修改影响、联系人隔离、重复事件、一键暂停、接管取消旧草稿和本地模式无聊天外传。性能结论只适用于记录的设备、模型和配置。模拟文件、UI 演示、Linux 单元测试、短上下文或 API 请求都不能替代这些实机条目。

## 阶段划分

1. **基础版本**：Android / Windows 外壳与中文工作流、内置文字／视觉／语音路径、兼容模型及组件管理、用户 API、档案与检索、隔离规则、审核和持久队列。三个本地制品已完成 Linux 功能验证；目标设备与广泛质量验收仍未完成。媒体 API 使用用户明确配置的支持服务，本地组件缺失明确显示。
2. **真实连接**：选一个可核实并获批的平台业务身份联调，优先 QQ 独立机器人被动回复；严格按实际权限接收、去重、审查和发送。同时继续核实 QQ、微信个人账号目标的官方路线；无法获得权限时保留手动导入和复制。
3. **稳定性与设备覆盖**：8GB 真机满上下文、30 分钟、热与后台测试，本地视觉／转写的设备内存、质量和耗电优化，Windows 安装／签名、单设备发送负责人、其他获批连接器。未经实机验收不能称最低设备目标通过。

## 已读取官方技术资料

在 2026-10-11，通过官方 GitHub raw HTTPS 获取 Qwen3.5 README、llama.cpp `tools/server/README.md`、`docs/android.md`、`tools/mtmd/README.md`、whisper.cpp README；通过 Hugging Face 获取 Qwen 官方 Qwen3.5-2B 模型卡／config 和社区 HauhauCS 发布者元数据。未关闭 TLS 校验。

- [Qwen3.5 官方仓库](https://github.com/QwenLM/Qwen3.5)、[2B 官方模型卡](https://huggingface.co/Qwen/Qwen3.5-2B/blob/main/README.md)和 [config](https://huggingface.co/Qwen/Qwen3.5-2B/blob/main/config.json)：2B、262144、视觉、混合线性注意力、non-thinking 默认及旧 soft switch 不兼容。
- [社区制品锁定版本](https://huggingface.co/HauhauCS/Qwen3.5-2B-Uncensored-HauhauCS-Aggressive/tree/2bcf35c1ebf62c837c12c1aa90b578ff4717e831)：量化文件、mmproj、字节数和 LFS SHA-256。社区卡中“thinking 默认”和“至少 128K”与本期原版 2B non-thinking 说明不同，产品不将社区建议作为 12800 验收通过或必须提高默认上下文的依据。
- [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)：上下文、CPU 配置、tokenizer、chat template、缓存选项与 OpenAI 兼容接口。
- [llama.cpp Android](https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md)：原生集成和 NDK 构建；文档提醒过大上下文可能导致内存峰值和进程终止。
- [llama.cpp multimodal](https://github.com/ggml-org/llama.cpp/blob/master/tools/mtmd/README.md)：组件分离、匹配 projector 和版本兼容边界。
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)：本地转写候选和上游内存参考。

`master` / `main` 的文档会变化；生产构建必须固定引擎和模型版本，复查该固定版本，不能只依据研究日期推断后续版本兼容。
