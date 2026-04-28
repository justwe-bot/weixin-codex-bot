# weixin-codex-bot

`weixin-codex-bot` 把腾讯 iLink 协议单独抽出来，做成两层能力：

- 一个给 Codex 用的本地 MCP 插件
- 一个可选的微信桥接进程，把收到的微信消息转给本机 `codex exec`

现在这条 bridge 既可以作为开发时的 `npm run bridge` CLI 运行，也可以作为插件管理的 macOS 后台服务运行。

这套实现不依赖 OpenClaw。

## Marketplace 结构

这个仓库的根目录现在只承担 **Codex marketplace root** 的角色。

- marketplace 描述文件在 `/.agents/plugins/marketplace.json`
- 真正可分发的插件包固定在 `/plugins/weixin-codex-bot`
- 插件运行 bundle 直接随仓库提交在 `/plugins/weixin-codex-bot/dist/mcp/server.js`

也就是说，Codex 安装这个仓库时，消费的是 `plugins/weixin-codex-bot` 这份完整插件包，而不是仓库根目录。

## 从 Git 仓库安装到 Codex

其他 Codex 客户端可以直接把这个仓库当成一个 marketplace 仓库来接入：

```bash
codex marketplace add https://github.com/justwe-bot/weixin-codex-bot.git
```

安装完成后，**请重启 Codex 桌面客户端**。重启之后，再去插件列表里查看 `WeChat iLink`。

插件消费者不需要再手工执行：

- `npm install`
- `npm run build`
- 手工把文件复制到 `~/.codex/plugins/cache`

fresh clone 之后，直接 `codex marketplace add <repo-url-or-local-path>` 即可。

首次使用时，推荐直接调用插件里的 `wechat_ilink_setup` 工具。
它会记住你选择的 `exec` / `queue` 模式，在未绑定时返回二维码，在登录确认后的下一次调用里自动启动 bridge。
如果还没有绑定微信，它会返回：

- `qrContent`: 需要扫码的二维码内容/地址
- `terminalQr`: 终端可显示的 ASCII 二维码
- `nextAction`: 下一步该做什么

这样客户端既可以直接展示二维码文本，也可以把二维码地址抛给用户，引导扫码绑定。
如果选择的是 `queue` 模式，`wechat_ilink_setup` 还会在 bridge 启动后返回一份 heartbeat automation 模板，供宿主 Codex 为当前线程创建自动化任务。

## 项目结构

- `.agents/plugins/marketplace.json`: 仓库级 marketplace 描述
- `plugins/weixin-codex-bot/.codex-plugin/plugin.json`: 插件清单
- `plugins/weixin-codex-bot/.mcp.json`: MCP 启动配置
- `plugins/weixin-codex-bot/dist/mcp/server.js`: 已提交的可运行 MCP bundle
- `plugins/weixin-codex-bot/dist/cli/bridge.js`: 已提交的 bridge 后台服务 runtime
- `plugins/weixin-codex-bot/skills/`: 插件内置 onboarding skill
- `src/ilink/*`: 独立 iLink 协议层
- `src/mcp/server.ts`: 提供给 Codex 的 MCP tools
- `src/cli/login.ts`: 终端扫码登录微信
- `src/cli/bridge.ts`: 微信消息桥接到本机 Codex CLI

## 开发者构建

```bash
git clone <your-git-url>
cd weixin-codex-bot
npm install
npm run build
```

`npm run build` 会做两件事：

- 校验 TypeScript
- 重新生成并覆盖插件里的 MCP runtime 和 bridge runtime

也就是说，插件分发产物的唯一输出目录就是 `plugins/weixin-codex-bot/`。发布 tag 或 release 前，需要确认这个 bundle 已经是最新版本。

## 微信登录

```bash
npm run login
```

登录成功后，凭证会保存到 `~/.weixin-codex-bot/credentials.json`。

## 运行微信 -> Codex 桥接

```bash
CODEX_WORKSPACE=/path/to/your/project \
CODEX_MODEL=gpt-5.2-codex \
npm run bridge
```

常用环境变量：

- `CODEX_WORKSPACE`: `codex exec` 的工作目录
- `CODEX_MODEL`: 可选，覆盖 Codex 模型
- `CODEX_FULL_AUTO`: 默认 `true`，等价于 `codex exec --full-auto`
- `CODEX_DANGEROUS_BYPASS`: 设为 `true` 时使用危险模式
- `CODEX_ADD_DIRS`: 逗号分隔，附加可写目录
- `BRIDGE_MULTI_TURN`: 默认 `true`，按微信用户维度保存 Codex session id
- `BRIDGE_STRIP_MARKDOWN`: 默认 `true`，把 Codex 输出压成更适合微信的纯文本
- `BRIDGE_SYSTEM_PROMPT`: 追加给 Codex 的微信桥接说明
- `BRIDGE_ALLOWED_USER_IDS`: 逗号分隔，只允许这些微信用户触发 bridge
- `BRIDGE_TRIGGER_PREFIX`: 可选消息前缀；设置后只有以此前缀开头的消息才会转给 Codex
- `BRIDGE_DELIVERY_MODE`: `exec` 或 `queue`，默认 `exec`
- `BRIDGE_QUEUE_ACK_TEXT`: `queue` 模式下，消息入队后立即回给微信的确认文本
- `WEIXIN_CODEX_BOT_HOME`: 覆盖默认状态目录 `~/.weixin-codex-bot`

## MCP 工具

构建后，插件会暴露这些工具给 Codex：

- `wechat_ilink_ensure_login`
- `wechat_ilink_setup`
- `wechat_ilink_start_login`
- `wechat_ilink_check_login`
- `wechat_ilink_status`
- `wechat_ilink_pull_updates`
- `wechat_ilink_send_text`
- `wechat_ilink_send_typing`
- `wechat_ilink_list_conversations`
- `wechat_ilink_bridge_start`
- `wechat_ilink_bridge_stop`
- `wechat_ilink_bridge_status`
- `wechat_ilink_bridge_remove`
- `wechat_ilink_clear_codex_session`
- `wechat_ilink_logout`

## 推荐首启流程

推荐优先使用统一 setup 工具，而不是把登录、bridge、queue heartbeat 分开做：

1. `wechat_ilink_setup`
2. 如果返回 `qrContent` / `terminalQr`，引导用户扫码并在微信里确认
3. 用户确认后，再次调用 `wechat_ilink_setup`
4. 登录成功后，tool 会自动启动 bridge
5. 如果选择的是 `queue` 模式，tool 会返回 `heartbeatAutomation` 模板，宿主 Codex 应该立即为当前线程创建 heartbeat

默认建议：

- `deliveryMode="exec"`：后台 bridge 直接调用 `codex exec`
- `deliveryMode="queue"`：后台 bridge 只入队，当前 Desktop 线程通过 heartbeat 处理消息

## 通过插件启动实时 bridge

如果你不走统一 setup，也可以先完成登录，再由插件工具直接管理 bridge：

1. `wechat_ilink_ensure_login`
2. `wechat_ilink_bridge_start`

首次启动 `wechat_ilink_bridge_start` 时，至少传入：

- `workspaceRoot`: bridge 调用 `codex exec` 的工作目录

常见可选项：

- `codexBinary`: Codex 可执行文件路径
- `model`: 模型覆盖
- `triggerPrefix`: 只转发指定前缀的消息
- `allowedUserIds`: 只允许这些微信用户触发 bridge
- `deliveryMode`: `exec` 直接调用 `codex exec`，`queue` 只写入本地消息队列
- `queueAckMode`: `queue` 模式下的立即确认方式，默认 `typing`
- `queueAckText`: 仅在 `queueAckMode` 为 `text` 或 `both` 时发送的确认文本
- `multiTurn`: 是否按微信用户复用 Codex session
- `stripMarkdown`: 是否把输出压成更适合微信的纯文本

bridge 启动后会安装为当前 macOS 用户的 `launchd` 后台服务，并通过 `wechat_ilink_bridge_status` 返回运行状态和最近日志。

如果要让 Codex 主动给微信发消息，推荐先调用 `wechat_ilink_list_conversations` 找到最近活跃的 `userId`，再调用 `wechat_ilink_send_text`。

## Queue + Desktop Heartbeat

如果你想让微信消息由 **当前 Desktop 线程** 处理，而不是由后台 bridge 直接调用 `codex exec`，推荐把 bridge 切到 `queue` 模式：

1. 优先调用 `wechat_ilink_setup`
   把 `deliveryMode` 设为 `queue`
2. 登录确认后的下一次 `wechat_ilink_setup` 会自动启动 queue bridge
3. setup 返回 `heartbeatAutomation` 模板
4. 宿主 Codex 根据这个模板为当前线程创建 heartbeat automation
5. heartbeat 定时读取 state directory 里的 `message-queue.json`
6. 处理后通过 `src/cli/queue-reply.ts` 回微信

注意：

- queue heartbeat 不是插件进程自己直接创建的，而是由宿主 Codex 根据 `wechat_ilink_setup` 返回的模板创建
- state directory 不一定固定是 `~/.weixin-codex-bot`；请以 tool 返回的 `stateDirectory` 为准

辅助脚本：

- `npm run queue:list`: 查看当前微信队列状态
- `node --import tsx src/cli/queue-pop.ts --claimed-by desktop-heartbeat`: 领取一条待处理消息
- `node --import tsx src/cli/queue-reply.ts --id <queue-id> --text-file <file> --typing`: 发送回复并标记完成

## 设计说明

- iLink 登录和消息收发完全独立，不依赖 OpenClaw
- MCP 层只暴露微信协议能力，不在工具里递归调用 Codex
- 首次使用优先走 `wechat_ilink_setup`，自动串起登录、bridge 启动，以及 queue 模式下的 heartbeat 模板返回
- 自动回复既可以走独立 bridge 进程，也可以由插件安装成后台 bridge 服务，底层都直接调用本机 `codex exec`
- 多轮会话优先复用 `codex exec resume <session_id>`

## 注意事项

- iLink 目前仍然更像实验性协议，没有稳定 SLA
- 微信消息建议使用纯文本回复，不要依赖 Markdown 渲染
- 如果想让 Codex 自动改代码，请把 `CODEX_WORKSPACE` 指到真实项目目录
