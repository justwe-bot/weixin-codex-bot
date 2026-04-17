# weixin-codex-bot

`weixin-codex-bot` 把腾讯 iLink 协议单独抽出来，做成两层能力：

- 一个给 Codex 用的本地 MCP 插件
- 一个可选的微信桥接进程，把收到的微信消息转给本机 `codex exec`

这套实现不依赖 OpenClaw。

## 从 Git 仓库安装到 Codex

如果这个仓库被推到 GitHub、Gitea 或任何可访问的 Git 地址，其他 Codex 客户端可以把它当成一个 marketplace 仓库来接入：

```bash
codex marketplace add <git-repo-url>
```

这个仓库已经包含了标准的 marketplace 描述文件：

- `/.agents/plugins/marketplace.json`
- `/plugins/weixin-codex-bot/.codex-plugin/plugin.json`

也就是说，后续别人只需要拿到仓库地址，就可以把这个仓库登记成 Codex marketplace 源，再启用 `weixin-codex-bot` 插件。

首次使用时，推荐直接调用插件里的 `wechat_ilink_ensure_login` 工具。
如果还没有绑定微信，它会返回：

- `qrContent`: 需要扫码的二维码内容/地址
- `terminalQr`: 终端可显示的 ASCII 二维码
- `nextAction`: 下一步该做什么

这样客户端既可以直接展示二维码文本，也可以把二维码地址抛给用户，引导扫码绑定。

## 项目结构

- `.codex-plugin/plugin.json`: Codex 插件清单
- `.mcp.json`: MCP 启动配置
- `src/ilink/*`: 独立 iLink 协议层
- `src/mcp/server.ts`: 提供给 Codex 的 MCP tools
- `src/cli/login.ts`: 终端扫码登录微信
- `src/cli/bridge.ts`: 微信消息桥接到本机 Codex CLI

## 本地开发安装

```bash
git clone <your-git-url>
cd weixin-codex-bot
npm install
npm run build
```

如果只是给其他 Codex 客户端当插件源使用，仓库里已经提交了插件运行所需的 bundle，
客户端通过 `codex marketplace add <git-repo-url>` 接入后，不需要额外先跑 `npm install`。

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
- `WEIXIN_CODEX_BOT_HOME`: 覆盖默认状态目录 `~/.weixin-codex-bot`

## MCP 工具

构建后，插件会暴露这些工具给 Codex：

- `wechat_ilink_ensure_login`
- `wechat_ilink_start_login`
- `wechat_ilink_check_login`
- `wechat_ilink_status`
- `wechat_ilink_pull_updates`
- `wechat_ilink_send_text`
- `wechat_ilink_send_typing`
- `wechat_ilink_clear_codex_session`
- `wechat_ilink_logout`

## 设计说明

- iLink 登录和消息收发完全独立，不依赖 OpenClaw
- MCP 层只暴露微信协议能力，不在工具里递归调用 Codex
- 首次使用优先走 `wechat_ilink_ensure_login`，自动返回二维码或二维码地址
- 自动回复走独立 bridge 进程，直接调用本机 `codex exec`
- 多轮会话优先复用 `codex exec resume <session_id>`

## 注意事项

- iLink 目前仍然更像实验性协议，没有稳定 SLA
- 微信消息建议使用纯文本回复，不要依赖 Markdown 渲染
- 如果想让 Codex 自动改代码，请把 `CODEX_WORKSPACE` 指到真实项目目录
