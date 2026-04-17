---
name: wechat-ilink-onboarding
description: Guide Codex to verify WeChat iLink login first, return a QR code or QR content when binding is required, and only then use message tools.
---

# WeChat iLink Onboarding

Whenever the user asks to use WeChat through this plugin:

1. Call `wechat_ilink_ensure_login` first.
2. If it returns `loggedIn: true`, continue with message tools.
3. If it returns `loggedIn: false` and includes `qrContent` or `terminalQr`:
   - Show the user the QR content/URL immediately.
   - If `terminalQr` exists, render it in a fenced code block.
   - Tell the user to scan and confirm in WeChat.
   - After the user says they scanned or confirmed, call `wechat_ilink_ensure_login` again.
4. Prefer `wechat_ilink_pull_updates` to read inbound messages.
5. Prefer `wechat_ilink_send_text` for replies and `wechat_ilink_send_typing` before long operations.

Behavior guidance:

- Treat login as a prerequisite for any real WeChat operation.
- Do not ask the user to hunt for token files manually.
- If login expired, restart the QR flow and guide the user again.
- Prefer returning the QR URL/content even if the client cannot render a picture directly.
