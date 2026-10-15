# 官方登录、消息权限与 computer use 路线

产品状态更新：**0.3.0，2026-10-15**。Windows 已实现从“账号连接”打开隔离的官方网页登录窗口或本机客户端，再到“桌面界面接入”选窗、读取／截图、选择输入框、生成编辑并审核发送一次。Android 已实现真实系统通知接入；有 RemoteInput 回复动作时可审核提交，没有动作时复制草稿并打开原 App。

下文保留 **2026-10-13** 的官方 API 调查和网络观察，补充 [2026-10-11 能力调查](PLATFORM_CAPABILITIES.md)。该轮只读官方资料，没有登录社交账号或发送消息；不能把此历史调查范围误读成 0.3.0 仍只有模拟功能。当前操作见 [使用指南](USER_GUIDE.md)，逐设备登录及发送结果仍以真实验证记录为准。

## 登录能解决什么

可以在软件中发起平台提供的正式授权流程，由官方客户端、系统浏览器或平台认可的授权窗口完成登录，再返回本软件。**得到哪些权限，取决于平台对该应用开放的接口、获批权限和用户实际同意的 scope。** 扫码成功、网页登录成功、取得头像昵称或设备登录态，都不能单独证明本软件可以读取本人所有私信、聊天历史、附件或代本人发送。

必须分别确认：应用是否获批对应接口、用户授权的账号及范围、令牌实际可调用的接口，以及真实接收／发送联调结果。任何一项缺失，界面都应显示具体缺口。模拟账号和模拟发送不能填补这些条件。

## 五平台官方 API 调查与 0.3.0 产品入口

“未确认”保留该轮官方 API 调查结论，不代表接口不存在，也不代表窗口／通知功能未实现。Windows QQ 使用本机客户端，没有个人网页私信入口；微信网页版的登录资格由账号决定。Android 通知回复仅对实际提供动作的通知可用，不保证五个平台均可回写。

| 平台／账号类型 | 在软件中发起正式登录的可行性 | 登录之后能否接管本人私信 | 0.3.0 产品入口与 API 缺口 |
| --- | --- | --- | --- |
| QQ 本人个人号／QQ 互联 | QQ 互联官网本次仍被代理阻断；当前 scope、应用审核和移动／桌面接入条件未确认 | 未取得本人好友聊天、历史、附件与发送权限的官方核实或联调证据 | 已提供本机 QQ 客户端唤起／窗口操作及 Android 通知入口。QQ 互联 API 仍需核实当前文档及获批权限，不模拟个人号网页扫码 |
| QQ 官方独立机器人 | 腾讯官方源码可核实 AppID／clientSecret 换机器人 token；不是个人 QQ 扫码登录 | 不能据此接管本人好友聊天 | 可接收用户发给机器人的 C2C、群内 @ 机器人并在有效窗口被动回复；需平台审核、真实机器人凭据、事件来源验证及联调 |
| 微信本人个人号／开放平台登录 | 官方网站／移动应用授权文档本次仍被代理阻断 | 当前本人好友私聊、历史和自动发送权限未确认 | 已提供官方网页／本机微信窗口与 Android 通知入口；网页版不支持当前账号时使用本机客户端。个人聊天 API 权限仍未确认 |
| 微信公众号／企业微信／微信客服 | 是各自独立申请权限的业务路线；本次相关官网被代理阻断 | 不能把业务接口推广为个人微信好友聊天 | 如选择业务身份，先复核对应产品申请条件、消息范围、回复限制和实际权限；本次没有完成业务联调 |
| 哔哩哔哩本人账号私信 | `open.bilibili.com` 返回开放平台页面外壳，但具体文档的官方 CDN 被代理阻断 | 当前私信读写 scope、申请资格、历史和媒体范围未确认 | 已提供隔离官方网页窗口与 Android 通知入口；开放平台私信 API 仍需当前文档及权限。网页登录不是本软件获得私信 API 授权的证据 |
| 微博本人账号私信 | 当前官方 scope 页和私信列表页可读；OAuth 请求必须建立在应用已有接口权限上 | 不会因 scope 或登录成功自动获得私信权限 | 已提供隔离官方网页窗口与 Android 通知入口；API 私信列表仍标为 OAuth **高级接口**，原发送文档地址该轮为 404，当前 API 申请条件仍需微博确认 |
| 微博粉丝服务／独立智能体私信通道 | 官方有独立业务／智能体文档，不能与本人普通私信混同 | 没有证明可以接管本人好友私信 | 粉丝服务页为 2015 年文档，当前资格待确认；2026 年“微博龙虾助手”是独立智能体控制通道，应单独核实与标识 |
| WhatsApp 普通 Messenger 个人号 | 个人客户端／linked devices 登录不等于 Cloud API 业务授权 | 当前官方 Cloud API 资料没有提供保持普通 Messenger 身份的个人接管路线 | 已提供官方网页／本机客户端窗口及 Android 通知入口。官方 Cloud API 业务号码不能同时用于普通 Messenger；不要求将个人号码迁入业务平台或删除个人账号 |
| WhatsApp Business Platform | **有明确官方路线**：Embedded Signup 使用 Facebook Login for Business／JS SDK，桌面和移动设备可从按钮打开正式授权窗口 | 授权对象是 business portfolio、WABA、业务号码及业务接口；不是普通个人账号 | 接入方须符合 Solution Partner／Tech Provider 条件；HTTPS 授权域名与 redirect URI 要注册。授权返回的短期 code 必须由服务器兑换业务 token、注册号码并订阅 webhook；需实际业务资源、权限和联调 |
| WhatsApp Business App 共存 | 通过专门 Embedded Signup 流程授权 **Business App** 账号；不是普通个人 App 扫码关联 | 本人同意后可同步业务 App 的部分 1:1 数据，不含原有群 | 当前官方文档支持最长 180 天 1:1 历史、近 14 天历史媒体及共存消息镜像，仍受类型、窗口和接入条件限制；尚未接入或联调 |

## 新核实的关键限制

### QQ

2026-10-13 重新读取腾讯官方 `tencent-connect/bot-docs`，默认分支 `main` 最新仍为提交 [`645787a45937e5d9c4f0f61afefdffde0f38696e`](https://github.com/tencent-connect/bot-docs/commit/645787a45937e5d9c4f0f61afefdffde0f38696e)，提交时间为 **2025-04-21**。这是当前可读官方源码的版本日期，不是 2026 年生产权限的实测。

- [事件文档](https://github.com/tencent-connect/bot-docs/blob/645787a45937e5d9c4f0f61afefdffde0f38696e/docs/develop/api-v2/server-inter/message/send-receive/event.md)将 C2C 定义为用户发给机器人，将普通群事件定义为 @ 机器人；它没有证明本人好友聊天或普通群全量消息已开放。普通群全量消息内容在源码注释中并写有“暂不开放”，不应当作当前网页公开承诺。
- [发送文档](https://github.com/tencent-connect/bot-docs/blob/645787a45937e5d9c4f0f61afefdffde0f38696e/docs/develop/api-v2/server-inter/message/send-receive/send.md)顶部公告明确主动推送自 **2025-04-21** 不再提供。该版本被动回复窗口为 C2C 60 分钟、群聊 5 分钟；每条消息最多 5 次。下方残留旧主动配额不能覆盖顶部公告。
- [鉴权文档](https://github.com/tencent-connect/bot-docs/blob/645787a45937e5d9c4f0f61afefdffde0f38696e/docs/develop/api-v2/dev-prepare/interface-framework/api-use.md)的令牌属于机器人。源码中的 WebSocket 描述还需与实际账号后台支持的事件传输方式复核。

### 微博

[官方 Scope 页](https://open.weibo.com/wiki/Scope)本次 HTTP 200，页内更新时间 **2025-12-05**。它明确要求应用先具备调用接口的权限，再通过 scope 请求用户授权；错误 `10014` 的说明指向联系微博商务申请。页面列出的 `all`、`email`、`invitation_write`、`follow_app_official_microblog`、`live_create` 不构成私信接口获批证明，`all` 也不能授予应用本来没有的接口权限。

[私信列表](https://open.weibo.com/wiki/2/direct_messages)本次 HTTP 200，页内更新时间 **2022-02-09**，仍标为需 OAuth token 的高级接口。该历史文档不足以确认本产品在 2026 年能申请哪些私信能力。[原发送地址](https://open.weibo.com/wiki/2/direct_messages/new)本次 HTTP 404；不得把旧接口名直接当作当前可用发送合同。

[授权机制](https://open.weibo.com/wiki/授权机制)及 [OAuth2 authorize](https://open.weibo.com/wiki/Oauth2/authorize)本次 HTTP 200，页内更新时间 **2022-10-11**。官方授权机制支持 `state` 和 `scope`，但“授权接口无需申请”仅指该授权机制，不能覆盖高级消息接口的获批要求。[API 目录](https://open.weibo.com/wiki/微博API)页内更新时间 **2025-05-09**，明确高级接口需申请；公开目录没有列私信不能被解读为全部私信能力不存在。

[接口访问频次权限](https://open.weibo.com/wiki/接口访问频次权限)本次 HTTP 200，页内更新时间 **2025-05-15**。该 API 规则页写明第三方服务器端不能存储用户数据、客户端缓存有不同边界；非用户主动行为的频繁调用即使未超频次限制也可能受封禁。真实 API 方案必须复核保存位置、缓存要求和轮询／自动代回授权。这里不把 API 规则直接推广为所有客户端截图／UI 操作的政策结论。

[粉丝服务平台](https://open.weibo.com/wiki/粉丝服务平台)及[发送消息](https://open.weibo.com/wiki/发送消息)为 2015 年业务账号文档；[微博龙虾助手](https://open.weibo.com/wiki/微博龙虾助手)页内更新 **2026-03-27**，是官方独立智能体私信控制通道。这些均不能证明可以读取或代回本人普通好友私信。

### WhatsApp

[Embedded Signup 概览](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview.md)及[实现文档](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation.md)本次 HTTP 200。官方明确支持 desktop／mobile；从软件提供的按钮发起正式授权窗口是可行的业务接入方案。完成授权返回 WABA ID、business phone number ID 和 exchangeable code；后者有效期 **30 秒**，要交给服务器进行 server-to-server 兑换，不能把 app secret 打包到 Android／Windows 客户端。实际实施仍需符合官方接入方资格、HTTPS 域名及 strict redirect URI 配置。

[默认授权流程](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/default-flow.md)的身份登录使用 Facebook 或 Meta Business Suite 凭据，授权的是业务资源。[业务号码文档](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers.md)明确注册号码不能用于普通 WhatsApp Messenger；已有 Messenger 号码不能直接在保持个人使用状态的情况下注册。

[当前权限文档](https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions.md)区分自有业务开发与为其他客户提供服务：仅访问自有业务数据的 direct developer 与后者的 App Review／Advanced Access 要求不同。Embedded Signup 的接入方资格不能被推广为所有自有业务 Cloud API 使用场景的统一条件。官方网页授权方案也没有证明任意 Electron 内嵌 WebView 都支持登录；Android／Windows 宿主方式还需正式登录组件文档和实际设备核实。

[Business App 共存](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users.md)及[历史 webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/history.md)提供的是 **Business App** 路线：版本至少 2.24.17、合作接入方资格、本人同意及历史同步时限；最长入驻前 180 天 1:1，群不包含，历史媒体只提供近 14 天。Cloud API 的发送仍受 [24 小时客服窗口及模板规则](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)约束；不能因为能同步历史就声明可无限制主动回复。

[版本文档](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions.md)提示 v2 于 **2026-10-15** 停用；新接入应按当前 v4 文档核实，不复制旧 v2 示例。

## 0.3.0 已实现的窗口与系统通知操作

Windows 使用者亲自在官方客户端／隔离官方网页窗口登录，本软件通过操作系统提供的窗口截图、UI 节点及本人选定的输入能力操作。Android 通过已授权的 NotificationListenerService 接收实际通知，并在通知提供 RemoteInput 时提交回复。**这是客户端界面操作能力，不是平台赋予本软件的私信 API 权限。** 它可能受客户端版本、窗口状态、锁屏、后台限制、系统权限和界面更新影响；不能预先保证五个平台均可读取完整消息、历史或确认发送结果。

| 路线 | 0.3.0 实现状态 | 需要核实的边界 |
| --- | --- | --- |
| Windows UI Automation＋选定客户端窗口截图 | 已实现窗口预览／截图、本人选定输入框与发送方式、本地生成编辑、一次审核写入和发送；实际结果待本人核实 | UIA 是否暴露正文、会话标题、输入框和实际发送状态必须逐个平台、版本实测；截图只能反映当时可见画面。高权限客户端与不同桌面会话存在额外访问边界 |
| Android 系统通知＋RemoteInput | 已实现通知权限入口、官方 App 唤起、真实通知展示与本地建议；通知有回复动作才可审核提交，没有时复制到原 App | 只取得应用实际投递的通知，不读取完整聊天历史；每个 App 的前台自动回复默认关闭，离页／后台撤销，系统杀进程后不承诺继续 |
| Android Accessibility | 未实现；属于独立路线，当前通知接入不需要启用无障碍服务 | 节点可能缺失、虚拟化或随更新改变；用途、应用分发要求及目标平台条款需单独复核。启用无障碍不等于授予所有聊天、账号和自动发送权限 |
| Android MediaProjection | 未实现；当前不以系统捕屏代替通知接入 | 截图不能直接获得历史、结构化消息或发送能力；授权、会话生命周期、前台服务及受保护内容限制必须按目标 Android 版本实现和实测 |

本次已读 [Microsoft UIA provider 官方源码](https://github.com/MicrosoftDocs/win32/blob/ca8274decead49403d70ceeed4af8d4ca74eaf11/desktop-src/WinAuto/uiauto-providersoverview.md)：自定义／第三方控件需要相应 provider；没有 provider／proxy 时控件对 UIA 大部分不可见，可能只得到窗口位置等基本信息。[UIA 安全文档](https://github.com/MicrosoftDocs/win32/blob/ca8274decead49403d70ceeed4af8d4ca74eaf11/desktop-src/WinAuto/uiauto-securityoverview.md)说明不同完整性等级与提升权限 UI 的访问限制，不能把提权或 UIAccess 当作通用解决方案。

[Microsoft Screen capture 官方文档源码](https://github.com/MicrosoftDocs/windows-dev-docs/blob/aabd22a9113af71e56bd6f5af8fde06df68162e0/hub/apps/develop/media-authoring-processing/screen-capture.md)讲的是 `Windows.Graphics.Capture` 画面帧；所述 picker 路线要求使用者选择目标并同意，捕获边框提示当前采集。其他截图 API 的行为不能直接从该路线推导。[窗口捕获排除 API](https://github.com/MicrosoftDocs/sdk-api/blob/656e9656bfaef34dd29cd7ee9e1146aec17e924c/sdk-api-src/content/winuser/nf-winuser-setwindowdisplayaffinity.md)说明窗口所有者可设置 `WDA_EXCLUDEFROMCAPTURE`；不能承诺任意窗口可截取。

本次已读 [AOSP AccessibilityService](https://github.com/aosp-mirror/platform_frameworks_base/blob/1cdfff555f4a21f71ccc978290e2e212e2f8b168/core/java/android/accessibilityservice/AccessibilityService.java)：服务由使用者在系统设置显式启用，应用需声明相应系统绑定及窗口内容能力；节点可能过时。[MediaProjectionManager](https://github.com/aosp-mirror/platform_frameworks_base/blob/1cdfff555f4a21f71ccc978290e2e212e2f8b168/media/java/android/media/projection/MediaProjectionManager.java)描述系统捕屏同意提示，[MediaProjection](https://github.com/aosp-mirror/platform_frameworks_base/blob/1cdfff555f4a21f71ccc978290e2e212e2f8b168/media/java/android/media/projection/MediaProjection.java)对 target SDK ≥34 的授权结果／projection instance 复用施加限制，新捕获会话需重新同意，不是每帧都弹窗。[FLAG_SECURE](https://github.com/aosp-mirror/platform_frameworks_base/blob/1cdfff555f4a21f71ccc978290e2e212e2f8b168/core/java/android/view/WindowManager.java)可阻止内容出现在截图或非安全显示中。

版本边界：本次读取的 MicrosoftDocs/win32、windows-dev-docs、sdk-api 提交分别为 **2026-10-08、2026-09-17、2026-10-09**；AOSP 镜像所读提交为 **2025-03-27**，不能替代 2026 年 Android 官网及目标设备对最新版本规则的复核。

0.3.0 Windows 已实现从选窗到生成、编辑、一次审核提交的完整操作链；多个输入框由本人选择，可用直接写入或单行 Unicode 键盘输入及本人选定的按钮／Enter／Ctrl+Enter。Android 已独立实现通知及 RemoteInput 路线。实现与构建测试不等于五个平台全部已在真实设备成功登录或发送；目标客户端的实际可用能力仍需逐一核实。

逐平台实机验证应回答：读取的是哪个账号与会话；最新正文和会话标题能否可靠对应；窗口焦点或内容变化时旧计划是否作废；执行动作后能否区分草稿、点击、平台接收、失败和结果未知。开放任何发送前，需要使用者明确选择操作范围和联系人，保留审核、暂停、接管及去重机制。账号登录、通知读取、截图、无障碍与自动发送分别授权；任何一个都不能自动推导其余权限。

平台条款的读取状态见下表。操作系统提供 UIA／截图接口，不能单独推出目标平台允许或禁止自动化；未读到条款时，应明确写“待复核”。本次没有尝试绕过验证码、登录验证、权限弹窗或目标客户端的访问边界。

## 官方来源与本次网络观察

所有请求均保留 HTTPS 证书验证。`Tunnel connection failed: 403 Forbidden` 指 **云环境代理拒绝 CONNECT 隧道**，不是目标平台的接口权限错误。HTTP 200 的 SPA 外壳也不算已经读到 API 文档。

| 官方来源 | 2026-10-13 观察 | 可以支持的结论 |
| --- | --- | --- |
| [QQ 互联](https://wiki.connect.qq.com/)、[QQ 机器人官网](https://bot.q.qq.com/wiki/) | 代理 CONNECT 403 | 当前官网内容不可读取；不能据此认定 API 不存在 |
| [腾讯 bot-docs](https://github.com/tencent-connect/bot-docs) | 官方 GitHub／raw 可读 | 指定提交中的独立机器人事件、鉴权与被动回复范围；当前实际权限仍须后台和联调 |
| [微信网站登录](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)、[移动登录](https://developers.weixin.qq.com/doc/oplatform/Mobile_App/WeChat_Login/Development_Guide.html) | 代理 CONNECT 403 | 当前 scope、审核条件和适用登录方式待复核 |
| [公众号接收消息](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Receiving_standard_messages.html)、[企业微信](https://developer.work.weixin.qq.com/document/path/92110)、[微信客服](https://kf.weixin.qq.com/api/doc/path/94670) | 代理 CONNECT 403 | 当前业务申请及消息能力待复核，不能用于本人个人聊天承诺 |
| [B 站开放平台](https://open.bilibili.com/)及 `/doc` | HTTP 200，均为 6468 字节同一 SPA 外壳 | 页面自述基础能力、内容、数据、服务及授权登录；没有读到私信 scope／权限正文 |
| B 站页面引用的官方 CDN `s1.hdslb.com`；[用户协议](https://www.bilibili.com/protocal/licence.html) | 代理 CONNECT 403 | 文档脚本及协议正文没有读到；不能对个人私信或自动化政策作肯定结论 |
| [微博 Scope](https://open.weibo.com/wiki/Scope)、[私信列表](https://open.weibo.com/wiki/2/direct_messages) | HTTP 200 | OAuth 用户授权不能替代应用接口权限；列表为历史高级接口文档 |
| [微博原私信发送](https://open.weibo.com/wiki/2/direct_messages/new) | HTTP 404 | 该地址当前内容不可用；不推断所有可能的微博发送接口都不存在 |
| [微博接口访问频次权限](https://open.weibo.com/wiki/接口访问频次权限)、[API 目录](https://open.weibo.com/wiki/微博API)、[微博龙虾助手](https://open.weibo.com/wiki/微博龙虾助手) | HTTP 200 | 当前 API 保存／调用规则、高级接口申请边界及独立智能体路线；不能据此接管好友私信 |
| Meta [权限](https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions.md)、Embedded Signup／共存／号码文档 | HTTP 200 | 当前业务资源、正式授权窗口、后端换码、共存及普通 Messenger 区别 |
| [WhatsApp 业务消息政策](https://business.whatsapp.com/policy) | 代理 CONNECT 403 | 完整业务政策尚未读到；已读 API 规则不能替代全部政策复核 |
| [Microsoft UIA 官网](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32)及 Windows capture 官网；[Android Accessibility](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)及 [MediaProjection](https://developer.android.com/media/grow/media-projection)官网 | 代理 CONNECT 403 | 官网不可读；以上 OS 技术依据来自固定版本的官方文档／源码，不是平台聊天联调 |
| MicrosoftDocs/win32、windows-dev-docs、sdk-api 的上述固定提交 | 官方 GitHub raw HTTP 200 | Windows UIA provider／访问边界、所述捕屏路线、捕获排除机制 |
| AOSP `platform_frameworks_base` 上述固定提交 | 官方 GitHub raw HTTP 200；源码日期 2025-03-27 | 无障碍启用及节点、捕屏同意及会话、保护内容边界；新版本规则待复核 |

## 0.3.0 怎样展示状态

官方网页／本机客户端入口区分启动请求、窗口已打开和登录未验证；不会因打开网页就把消息读写权限标为已取得。Android 分别显示通知使用权、监听器连接、实际通知来源和本条是否提供 RemoteInput 回复动作。业务 API 若另行接入，仍须单独展示实际授权对象、范围和联调状态。

“桌面界面接入”显示本人选定窗口、输入框、发送方式和可编辑草稿；通知页显示对应通知与审核草稿，不显示为个人 API 连接成功。调用发送后为结果待核实，只锁定对应会话，不自动重试；本人到原应用检查并填写依据，离页或重启后可在“待审核回复”处理。模拟工作流仍标为内存模拟，不能替代原应用的发送结果。
