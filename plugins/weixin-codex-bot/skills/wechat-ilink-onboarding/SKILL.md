---
name: wechat-ilink-onboarding
description: Guide Codex through first-use WeChat iLink setup, QR login, bridge startup, and queue heartbeat follow-up when needed.
---

# WeChat iLink Onboarding

Whenever the user asks to use WeChat through this plugin:

1. Prefer `wechat_ilink_setup` for first-time setup or whenever the user wants to connect WeChat to Codex end-to-end.
2. Default to `deliveryMode="exec"` unless the user explicitly wants the current Desktop thread to process queued WeChat work; in that case use `deliveryMode="queue"`.
3. If `wechat_ilink_setup` returns `loggedIn: false` and includes `qrContent` or `terminalQr`:
   - Show the user the QR content/URL immediately.
   - If `terminalQr` exists, render it in a fenced code block.
   - Tell the user to scan and confirm in WeChat.
   - After the user says they scanned or confirmed, call `wechat_ilink_setup` again with the same setup arguments so it can finish bridge startup automatically.
4. If `wechat_ilink_setup` returns `heartbeatAutomation`, immediately create that heartbeat for the current thread using Codex automation tools.
5. Use `wechat_ilink_ensure_login` only for low-level login checks or troubleshooting.
6. If the user wants realtime WeChat -> Codex control without the guided setup flow, use `wechat_ilink_bridge_start` after login and provide `workspaceRoot` on the first start.
7. Use `deliveryMode="exec"` when the bridge should call `codex exec` directly.
8. Use `deliveryMode="queue"` when the bridge should only enqueue messages for a Desktop heartbeat thread to process.
9. Prefer `wechat_ilink_pull_updates` to read inbound messages when realtime bridge is not enabled.
10. Prefer `wechat_ilink_send_text` for replies and `wechat_ilink_send_typing` before long operations.
11. Prefer `wechat_ilink_list_conversations` before proactive outbound messaging if the target user id is not already known.

Behavior guidance:

- Treat login as a prerequisite for any real WeChat operation.
- Do not ask the user to hunt for token files manually.
- If login expired, restart the QR flow and guide the user again.
- Prefer returning the QR URL/content even if the client cannot render a picture directly.
- The realtime bridge is managed through plugin tools; do not tell the user to manually edit launchd files unless they ask for low-level details.
- When queue mode is selected, the plugin can suggest a heartbeat template but the host Codex assistant must create the actual thread automation.
