# QQ 独立机器人适配边界

本模块是官方事件解析及受控被动回复预留器，**没有获取凭据、建立真实连接或发网络请求**。测试使用显式 fixture，不代表 QQ 联调成功。个人账号、个人扫码登录、任意历史、群全量消息和主动推送均不提供。

研究依据及限制见 [平台能力表](../../docs/PLATFORM_CAPABILITIES.md)。官方源码 commit 固定为 `645787a45937e5d9c4f0f61afefdffde0f38696e`；更新真实连接前复核平台当前要求。

`parseQqBotEvent(envelope, appId, receivedAt)` 处理 `C2C_MESSAGE_CREATE` 和 `GROUP_AT_MESSAGE_CREATE`。账号 ID 来自本机已配置的机器人 AppID，C2C 按用户 openid 隔离，群按 group openid 隔离且保留发送者身份。图片／语音产生待确认消息，视频／文件等未支持类型阻止发送。解析器不会下载附件；未来下载器必须验证 HTTPS、域名／地址和每次重定向，不能因链接来自聊天而取得任意网络访问权限。

未来真实宿主的调用顺序：

1. 先按平台要求认证事件来源／签名并确认 AppID。JSON 解析本身不验证来源。
2. 持久化并去重平台事件；保留 `sourceMessageId`，不要把派生附件消息 ID 用作平台 msg_id。
3. 生成草稿，经 QueueEngine 程序规则、审核、接管、暂停、会话版本及发送负责人检查。
4. 用 `QqPassiveReplyLedger.reserve` 构造一次被动文本回复。C2C 60 分钟、群 @ 5 分钟；额外保留 5 秒发送余量。产品选择每个源事件仅回复一次，固定 `msg_seq=1`。
5. **将 QQ ledger 的 pending 预留和 QueueEngine 的 inFlight 状态作为同一个事务持久化，然后才能发送。** 再次确认暂停及会话版本没有变化。没有持久化宿主时不得调用平台发送。
6. 已验证的 HTTP/API 成功返回才能 `markAccepted`；网络超时／返回不明使用 `markUnknown`，并在 QueueEngine 同步相应状态。恢复期间 pending 自动变成 unknown；没有平台核对证据不得重发。

API token 只存在宿主系统安全存储和原生请求层，不能加入 planner、日志、源文件或事件快照。联网发送前必须取得真实凭据、获批权限和受控联调，UI 才能将该账号的 `canSend` 置为真。`QQ_BOT_CAPABILITIES` 是文档能力声明，其 `realIntegrationVerified=false` 必须保持到实际联调通过。

测试命令（开发者）：`npx tsx --test packages/connectors/tests/*.test.ts`。它验证事件隔离、未知附件、窗口、规则、重复预留及重启结果未知；不替代平台联调。
