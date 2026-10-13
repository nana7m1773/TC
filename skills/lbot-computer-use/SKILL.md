---
name: lbot-computer-use
description: 开发和验证 L-BOT 的 Windows 所选窗口 UIA 预览、截图及准备提交协议，保持本人确认的一次回复与未知结果暂停。
---

# L-BOT Windows 窗口操作开发

## 读取与范围

使用已有 checkout；云任务已隔离，除非使用者明确要求，不创建 worktree。读取适用仓库指令、`git status --short`、`docs/COMPUTER_USE.md`、`docs/LOGIN_AND_PERMISSIONS.md`，以及：

- `packages/runtime/windows-ui.mjs` 与其测试；
- `apps/desktop/windows-ui.ps1`、`main.cjs`、`preload.cjs`；
- `apps/web/src/ComputerUseView.tsx`、`ComputerReplyService.ts`、`runtime.ts` 与相关界面测试。

这些文件是仓库开发工作流，不能授予平台私信权限，也不能使外部插件自动安装。本人在官方客户端／网页登录，账号身份与消息权限需要分别验证。

## 保持协议约束

1. 仅 Windows 原生版操作所选窗口。选择绑定进程、PID、启动时间、HWND 与标题，校验官方发布者签名；网页来源、当前账号和会话由本人核对，不能从浏览器签名推断。
2. 读取和整窗截图需分别明确授权，内容只交给本地组件。`PrintWindow` 只接收所选 HWND；受保护、不可访问控件及资源检查失败要明确停止，黑图或看不清的内容交由本人处理。
3. 没有可靠的新消息区域／角色适配器时，只处理本人确认的这一条消息。轮询用于核验窗口快照，不将整窗文字解析成未知新消息或猜收件人。
4. 本人确认会话、消息与精确白名单后才授权一次回复；规则包括启用、暂停、风险、回复语言和等待时间。切换、修改、暂停、接管或过期使旧任务失效。
5. `prepareSocialReply` 不写入；要求唯一空可写 ValuePattern 输入框和唯一 InvokePattern 发送按钮，返回绑定目标的 30 秒单次 ticket。前端与 IPC 对时间和字段类型必须一致。
6. `commitSocialReply` 在任何 await 前消耗 ticket，复验身份、快照与控件，要求原窗口后台且输入框无焦点，通过 Unicode ValuePattern 直接赋值，再 Invoke。发现已有草稿即拒绝；检查与写入非原子，保留部分写入后的草稿，不清空或恢复。不自动切换 IME，不使用全局 SendKeys、剪贴板、回车或猜坐标回退。
7. 调用原生发送后的状态只能是未知，保存未知任务并暂停，不自动重试。窗口／进程异常可能发生在部分操作后，不能当成“确定未发送”。

## 检查与测试

变更协议时检查桌面主进程、preload、共享类型、前端与服务所有边界，限制 IPC 输入和返回字段。重点覆盖：过期／重复／并发 ticket、窗口身份变化、预览变化、已有草稿、控件歧义、规则修改、暂停、等待中变化、提交后异常和未知记录保存失败。

根目录执行相关测试，例如：

```bash
npx tsx --test packages/runtime/tests/windows-ui.test.ts
npm run build
```

修改用户流程时执行 `npm run test:ui`；需要 Chromium 时按安装教程准备。Linux 中 PowerShell 测试替身只验证程序协议，不证明真实 PowerShell、UIA、输入法或客户端控件可用。

## Windows 设备验收

需要真实 Windows 设备和本人明确指定的测试账号／会话。先检查登录来源与控件，只读预览通过后再做授权范围内的一次操作。记录客户端版本、控件能力、输入法状态、DPI、截图保护、草稿、窗口切换、暂停和超时；本人到官方客户端核对实际输入与发送结果。未获测试范围授权不向联系人发送消息。

交付时分别写出模拟、替身、真实模型、Windows 设备与平台结果。只有真实设备记录支持的客户端版本才能写为通过，不能将五平台模拟宣传成个人号持续自动代回。
