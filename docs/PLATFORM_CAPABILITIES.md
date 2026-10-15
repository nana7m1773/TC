# 社交平台能力核实

产品状态更新：**0.3.0，2026-10-15**。Windows 已实现隔离的官方网页登录窗口／本机客户端唤起，以及“桌面界面接入”的窗口读取、截图、本人选定输入框、生成编辑和一次审核发送。Android 已实现系统通知监听及通知提供 RemoteInput 动作时的一次审核回复；无动作时复制草稿到原 App。操作步骤见 [使用指南](USER_GUIDE.md) 和 [窗口操作](COMPUTER_USE.md)。

以下官方 API 调查保留 **2026-10-11** 的来源及网络观察；后续补充见 [2026-10-13 调查](LOGIN_AND_PERMISSIONS.md)。官方接口事实未因产品更新而扩展。表内“0.3.0 产品状态”已更新，完整历史读取、真实账号登录及逐客户端发送验收仍须与实际记录区分。

## 0.3.0 产品能力与官方 API 的区别

QQ、微信、哔哩哔哩、微博和 WhatsApp 的个人聊天官方 API 尚未在本项目完成权限核实与真实联调；0.3.0 的可操作路线是本人授权的客户端窗口或系统通知。Windows 可打开哔哩哔哩、微博、WhatsApp、微信的官方网页，本机客户端按安装状态唤起；QQ 个人号使用本机客户端，微信网页版能否登录由账号决定。打开窗口不会被标成已取得消息权限。Android 只处理系统实际投递的通知，不能据此读取完整聊天历史或保证五个平台均可回写。

QQ 的官方机器人文档能够通过腾讯官方 GitHub 文档源码核实；Meta 当前官方文档核实 WhatsApp Business 的 webhook、媒体、业务群及 Business App 共存路线。它们是业务身份，不能因此读取本人在普通个人账号中的其他聊天。**QQ 独立机器人受控被动回复**仍是另行申请与联调的路线，须取得平台审核及实际凭据；它不替代当前客户端／通知入口。

## 官方 API 调查表（2026-10-11 历史记录）

下表接收、历史和回复列描述官方 API 范围；不用于否定下文已实现的窗口／通知能力。“待确认”表示该轮没有可用的官方材料或实测，“文档有”仍须实际申请权限和联调。历史栏中的“本地”仅表示从本产品收到的事件开始自行存储。

| 平台及账号类型 | 登录／申请条件 | 接收文字 | 读取历史 | 图片／语音 | 私聊回复 | 群聊回复 | 接口边界与 0.3.0 产品状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QQ 本人个人账号／QQ 互联身份授权 | QQ 互联是需单独核实 scope 的身份授权路线；其当前官网被代理阻断 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 个人好友聊天 API 未核实；不模拟登录成功。0.3.0 使用本机 QQ 窗口／Android 通知路线 |
| QQ 官方独立机器人 | 开放平台注册机器人、平台批准的发布范围、AppID 和 AppSecret；官方文档有开发配置路线 | 文档有：C2C 用户给机器人；群内 @ 机器人；频道按获准事件订阅 | 未核实任意个人聊天历史接口；机器人事件本地历史可保存 | 文档有：事件 attachments 包含图片、语音、视频、文件及 URL；实际下载格式和时效须联调 | 文档有：机器人身份被动回复；必须使用收到的有效 msg_id | 文档有：群内 @ 机器人被动回复；不能据此读取群全量消息 | 已核实官方源码；本期未取得机器人凭据。主动推送自 2025-04-21 不再提供；限流见下文 |
| 微信本人个人账号／微信开放平台授权登录 | 微信开放平台网站／移动应用授权路线须审核，当前文档无法读取 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 不把身份授权解释为好友消息 API 授权。0.3.0 已有官方网页／本机微信窗口及 Android 通知入口 |
| 微信公众号／企业微信／微信客服 | 是不同业务产品及账号类型，各自申请接口权限；本期未核实当前申请条件 | 待确认业务身份对应消息能力 | 待确认 | 待确认 | 待确认业务身份回复 | 待确认 | 不能替代个人微信好友聊天；未实现或联调这些通道 |
| 哔哩哔哩本人账号私信 | 开放平台授权、私信接口范围和审核条件均待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 该轮开放平台网站被代理阻断。0.3.0 已有官方网页及 Android 通知入口；未使用逆向私信端点、cookie 导入或二维码模拟授权 |
| 微博本人账号私信 | OAuth 和 direct_messages 权限的当前开放情况、应用审核均待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 历史接口名称不证明当前可申请；该轮官网请求被阻断。0.3.0 已有官方网页及 Android 通知入口，不宣称已获私信 API 权限 |
| WhatsApp 本人个人账号 | 个人客户端登录及 linked devices 不等于业务 API 授权 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 个人账号 API 未实现；0.3.0 已有官方网页／本机窗口与 Android 通知操作，不能把 Business 连接显示为个人账号接管 |
| WhatsApp Business Platform / Cloud API | 官方要求 business portfolio、WABA、业务电话号码和令牌；messaging/management permissions；只访问自有业务数据与服务他人时的审核要求不同 | 文档有：发给业务号码的消息及发送状态 webhook | 本地事件可保存；普通个人历史没有据此开放 | 文档有图片、音频、视频、文档等；通过媒体 ID 和 bearer token 获取；URL 有效 5 分钟 | 文档有：24 小时客户服务窗内 free-form；窗外只可发获批模板；必须取得收件人同意 | 文档有 Groups API：仅 OBA，最多 8 人，业务创建及邀请加入的群；不是任意现有个人群 | 当前官方页面已读取；没有业务凭据，未联调。单收件人通常 1 条／6 秒；具体业务限额需后台核实 |
| WhatsApp Business App + Cloud API 共存 | 本人拥有 Business App 账号／号码；合作接入方必须是 Solution Partner 或 Tech Provider、满足 Embedded Signup 和 webhook 要求；不是普通个人 App linked devices | 文档有：授权后的 1:1 消息镜像 | 本人同意后可同步入驻前 180 天的 1:1；不含群；历史媒体只提供近 14 天资源 | 文档有业务媒体；历史可用期和不支持类型有额外限制 | Cloud API 仍受 24 小时窗／模板约束 | 共存号码不支持 Groups API，原有群不同步 | Business App 版本至少 2.24.17；共存固定 20 mps；本期未接入；既有个人 WhatsApp 不因此获得授权 |
| 模拟消息／记录导入／粘贴 | 使用者确认有权使用数据，导入时指定本人身份 | 本产品输入 | 已导入本地历史 | 本产品选择的文件，不等于平台媒体获取 | 生成草稿、复制文本；模拟发送只写本地状态 | 同左 | 明确显示“模拟／手动导入”，不能显示平台已接收 |

## QQ 已核实细节

官方文档源码在腾讯组织 `tencent-connect/bot-docs`，本次读取的提交为 `645787a45937e5d9c4f0f61afefdffde0f38696e`。

- [消息事件](https://github.com/tencent-connect/bot-docs/blob/645787a45937e5d9c4f0f61afefdffde0f38696e/docs/develop/api-v2/server-inter/message/send-receive/event.md)明确 `C2C_MESSAGE_CREATE` 是用户单聊发给机器人，`GROUP_AT_MESSAGE_CREATE` 是群内 @ 机器人。attachments 中有 `content_type`、大小、文件名和 URL。普通群全量消息段落明确标注暂不开放；不为此声明群全量读取能力。
- [发送消息](https://github.com/tencent-connect/bot-docs/blob/645787a45937e5d9c4f0f61afefdffde0f38696e/docs/develop/api-v2/server-inter/message/send-receive/send.md)顶部公告明确：**主动推送自 2025-04-21 不再提供**。文档下方仍残留旧主动消息配额，连接器不得据此启用主动推送。被动回复有效期：C2C 60 分钟，群聊 5 分钟，每个消息最多 5 次。发送前检查有效消息 ID、剩余窗口、去重记录和当前权限。
- 同一 `msg_id + msg_seq` 重复发送会失败；事件文档说明平台可能重复推送。产品必须先持久化消息唯一键和发送序号，不能只在内存去重。请求结果不明时进入人工核对，不盲目重发。
- [调用与鉴权](https://github.com/tencent-connect/bot-docs/blob/645787a45937e5d9c4f0f61afefdffde0f38696e/docs/develop/api-v2/dev-prepare/interface-framework/api-use.md)：`AppID + AppSecret` 换取 access token，请求 `Authorization: QQBot …`；凭据对应机器人，不是使用者个人密码或聊天登录态。
- [富媒体](https://github.com/tencent-connect/bot-docs/blob/645787a45937e5d9c4f0f61afefdffde0f38696e/docs/develop/api-v2/server-inter/message/send-receive/rich-media.md)将图片、视频、语音上传分开；该提交注明语音发送格式 silk、文件发送暂不开放、`file_data` 暂未支持。读取附件和发送附件是不同能力；第一版不需要语音发送。
- 机器人本地部署还须确认实际可用事件传输：该提交事件页仍描述 WebSocket；当前生产账号允许的 webhook / WebSocket 范围应在后台和联调中再次核实。不能仅凭旧 SDK 示例承诺长期连接可用。

## 0.3.0 客户端与通知能力

窗口操作和系统通知是已实现的独立路线，使用者按次授权；它们不等于平台开放私信 API。真实客户端版本、实际提供的控件／通知动作及相关平台条款仍需分别核实，不绕过登录或目标应用的访问边界。

| 路线 | 权限和技术边界 | 可靠性及维护成本 | 0.3.0 产品状态 |
| --- | --- | --- | --- |
| Android 通知监听 | 系统 NotificationListenerService 声明及使用者在系统设置明确授权；只能获得应用实际发出的通知内容。合并、静音、隐藏预览、锁屏、撤回、未通知的消息、历史和完整附件均可能缺失。通知快速回复只有目标通知暴露相应动作才可能使用 | 需按 Android／社交客户端版本测试。通知不是完整的聊天事件流，无法证明完整历史或媒体读取 | 已实现 NotificationListenerService、真实通知展示、本地生成编辑及 RemoteInput 一次审核回复；无回复动作时复制到原 App。每个应用前台自动回复默认关闭，离页／后台撤销，不承诺系统杀进程后继续 |
| Android 无障碍 UI 读取和操作 | AccessibilityService 需系统声明和本人在设置启用，可操作范围取决于客户端暴露的节点。Android 官方源码说明该服务应服务于残障用户；通用聊天自动化的适用性、分发许可和平台条款需另行确认 | 界面布局、WebView、弹窗、分页、输入焦点、锁屏、应用更新都会影响操作；误发风险较高。不可保证后台、锁屏或系统终止后工作 | 未实现 AccessibilityService 路线；当前使用系统通知接入 |
| Windows UI Automation | UIA 能访问客户端实际暴露的 UI 元素，取决于 provider 和运行权限；不代表拥有平台 API 权限。提升进程的跨权限访问边界必须按 Microsoft 安全要求评估 | 需运行并维护对应客户端，界面更新、虚拟列表、窗口状态、会话切换和多账号都会增加维护及错误成本 | 已实现选窗、UIA／截图、本人选择输入框与发送方式、本地生成编辑和一次审核发送；支持直接写入／单行 Unicode 输入，发送后待本人核实，失败可复制草稿 |
| Windows 通知监听 | Windows 通知访问存在单独 API／应用身份和授权要求；当前对应官方页面不可读取，Electron 是否适配待确认 | 不提供完整历史和平台确认；附件和快速回复能力不能预先假定 | 未实现，未声明通知接入 |

Android 通知权限、无障碍权限和本产品开启自动回复是三个不同授权；任何一个都不能自动推导另两个。无人值守的自动发送必须有经过验证的发送能力、白名单、冷却、敏感动作拦截、会话版本检查、一键暂停和唯一发送负责人。

## WhatsApp 当前官方边界

网络状态变化后，Meta 官方 overview 及其 `llms.txt` 指向的当前页面已成功读取；仅返回 Meta 空壳 HTML 的试探地址没有作为已核实文档。

- [平台概览](https://developers.facebook.com/docs/whatsapp/cloud-api/overview)和 [权限](https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions)：业务 portfolio、WABA、业务号码和访问令牌；`whatsapp_business_messaging` 用于发送和入站／状态 webhook；`whatsapp_business_management` 用于业务资源管理。自有业务开发与给客户提供服务的 Advanced Access／App Review 条件不同，不能一概承诺无需审核。
- [发送消息](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)：客户发消息／调用符合条件的来电后开启 24 小时窗口；窗口外只可发送获批模板；客户同意仍是前提。平台接口接收成功与 delivered/read webhook 是不同状态。
- [媒体](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media.md)：图片 JPEG／PNG 5 MB；音频 AAC／AMR／MP3／MP4／指定 OPUS OGG 16 MB。媒体 URL 有效 5 分钟，下载需 token；API 上传返回的媒体 ID 30 天、入站 webhook 媒体 ID 7 天。产品应及时取得授权附件并记录实际状态，不把过期或下载失败当作模型无法理解。
- [Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups.md)：仅 Official Business Account；最多 8 人、每个业务号码最多创建 10,000 群、每群最多一个 Cloud API 业务身份。群由业务创建、受邀加入，**不代表读取本人现有任意群**。共存 Business App 号码与 Multi-solution Conversations 号码不支持。Calling、view-once、disappearing 等类型及编辑／删除操作不支持。
- [Business App 共存](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users.md)和 [history webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/history.md)：Solution Partner／Tech Provider 路线可在本人业务授权后同步 Business App 1:1，最长入驻前 180 天；群不包含，历史媒体只提供近 14 天。该账号仍是 **Business App**，不是普通个人 App。共存会改变部分 Business App 功能，接入前须按文档向使用者说明实际变化。
- 当前共存文档提示 Embedded Signup **v2 于 2026-10-15 停用**，新开发应核实 v4 路线，不能直接复制旧示例。

上述是该轮官方业务 API 文档范围；没有业务凭据或真实联调记录，本产品不把相应 API 的发送、历史及群能力标为已验证。它不限制上文独立的客户端窗口／系统通知入口。

## 官方来源与读取状态

以下全部在 2026-10-11 尝试读取；HTTPS 证书验证始终保留。403 是**当前云环境网络代理拒绝该域名**，并非证明平台 API 本身不存在。未用非官方转载填补缺失材料。

| 官方来源 | 本次状态 | 本次能够支持的结论 |
| --- | --- | --- |
| [QQ 机器人官网](https://bot.q.qq.com/wiki/) | 代理 403 | 官网不可读取；改读对应腾讯官方源码 |
| [腾讯官方文档仓库](https://github.com/tencent-connect/bot-docs)、[官方 Python SDK](https://github.com/tencent-connect/botpy) | 官方 GitHub raw / Git HTTPS 读取成功 | 机器人账号、事件范围、媒体、被动回复和取消主动推送的公告 |
| [QQ 互联](https://wiki.connect.qq.com/) | 代理 403 | 当前个人身份授权 scope、聊天权限待确认 |
| [微信开放平台授权登录](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html) | 代理 403 | 当前身份授权详情及聊天权限待确认 |
| [微信公众号接收消息](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Receiving_standard_messages.html) | 代理 403 | 业务身份接口条件待确认，不能用于个人账号承诺 |
| [哔哩哔哩开放平台](https://open.bilibili.com/) | 代理 403 | 当前私信权限待确认 |
| [微博私信列表](https://open.weibo.com/wiki/2/direct_messages)、[发送](https://open.weibo.com/wiki/2/direct_messages/new) | 代理 403 | 这些地址的当前内容和开放范围均未核实 |
| [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/overview)、[官方文档索引](https://developers.facebook.com/documentation/business-messaging/whatsapp/llms.txt) | 最初代理 403；状态变化后读取成功 | 当前业务资源、webhook、发送窗口、媒体、Groups 和 Business App 共存范围见上文；没有个人账号接管证据 |
| [业务消息政策](https://business.whatsapp.com/policy) | 代理 403；已读 API 页面中的 opt-in／模板要求 | 完整业务政策仍需发布／真实接入前复核，不将 API 文档替代全部政策 |
| [Meta 官方 Cloud API 示例](https://github.com/fbsamples/whatsapp-api-examples) | GitHub raw / Git HTTPS 读取成功 | Business webhook、媒体、模板和发送示例；不支持个人账号接管结论 |
| [Android 通知监听文档](https://developer.android.com/reference/android/service/notification/NotificationListenerService)、[AOSP 官方源码](https://github.com/aosp-mirror/platform_frameworks_base/blob/master/core/java/android/service/notification/NotificationListenerService.java) | 官网代理 403；官方源码读取成功 | 系统通知服务机制，不能证明目标社交客户端的内容完整性 |
| [Android 无障碍文档](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)、[AOSP 官方源码](https://github.com/aosp-mirror/platform_frameworks_base/blob/master/core/java/android/accessibilityservice/AccessibilityService.java) | 官网代理 403；官方源码读取成功 | 用户启用、权限声明、UI 访问范围和服务用途说明 |
| [Microsoft UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32)、[Microsoft 官方文档源码](https://github.com/MicrosoftDocs/win32/blob/docs/desktop-src/WinAuto/entry-uiauto-win32.md) | 官网代理 403；官方源码读取成功 | UIA 是 UI 访问框架，不能证明社交客户端暴露全部内容 |
| [Windows 通知访问](https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/notification-listener) | 官网代理 403；本次尝试源码路径 404 | 当前通知访问适配要求待确认 |

## 官方 API 真实接入启用前的检查

1. 用实际获批账号记录申请条件、权限 scope、事件和 API 版本、测试联系人／群范围及平台允许的调用频率。
2. 接收一条真实文字和各支持的媒体消息；核实附件下载、历史边界及消息撤回处理。只启用实测支持的类型。
3. 以平台认可的业务身份发送一次审核回复，区分本地生成、待发送、平台接收、失败及结果未知。
4. 在授权白名单内验证重复事件、超时、限流、暂停、接管、旧草稿作废、机器人循环和同账号单设备发送限制。
5. 保留脱敏联调记录。没有完成上述步骤时，界面继续显示“待联调”，不得把草稿或模拟队列结果显示为平台确认。
