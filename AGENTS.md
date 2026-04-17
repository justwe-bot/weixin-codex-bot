# weixin-codex-bot Instructions

This repository is a Codex plugin marketplace root.

## Install from this repo

If a user wants to install this plugin from the repository itself, prefer:

```bash
codex marketplace add <repo-url-or-local-path>
```

The marketplace descriptor lives at:

- `.agents/plugins/marketplace.json`

The actual plugin package lives at:

- `plugins/weixin-codex-bot`

## First-use flow

When helping someone use this plugin, treat WeChat binding as mandatory setup:

1. Call `wechat_ilink_ensure_login`.
2. If already logged in, continue normally.
3. If not logged in, show `qrContent` and `terminalQr` to the user and ask them to scan with WeChat.
4. Re-run `wechat_ilink_ensure_login` after the user confirms scanning.

## Operational note

This repo also contains a standalone bridge runner:

```bash
npm run bridge
```

That path turns inbound WeChat messages into local `codex exec` runs.
