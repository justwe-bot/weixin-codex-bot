import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import qrcodeTerminal from "qrcode-terminal";
import { checkQrLogin, DEFAULT_ILINK_BASE_URL, startQrLogin, toLoginResult } from "../ilink/auth.js";
import { ILinkClient } from "../ilink/client.js";
import {
  clearPendingLogin,
  clearAllState,
  clearCodexSession,
  getContextToken,
  loadCredentials,
  loadCursor,
  loadPendingLogin,
  saveCredentials,
  saveCursor,
  savePendingLogin,
  setContextToken,
} from "../state.js";
import { normalizeInboundMessage } from "../util/messages.js";

type JsonRecord = Record<string, unknown>;

const tools: Tool[] = [
  {
    name: "wechat_ilink_ensure_login",
    description: "Ensure WeChat iLink is logged in. If not yet bound, return QR content and a terminal QR to guide the user.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: {
          type: "string",
          description: "Optional iLink base URL. Defaults to Tencent's public iLink endpoint.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_start_login",
    description: "Start a WeChat iLink QR login flow and return the QR content to scan.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: {
          type: "string",
          description: "Optional iLink base URL. Defaults to Tencent's public iLink endpoint.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_check_login",
    description: "Poll the pending WeChat QR login session and save credentials when confirmed.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_status",
    description: "Inspect stored login status, pending QR state, and saved cursor state.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_pull_updates",
    description: "Long-poll WeChat iLink for new messages and persist the updated cursor.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of normalized messages returned to Codex.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_send_text",
    description: "Send a plain-text message to a WeChat user via iLink.",
    inputSchema: {
      type: "object",
      properties: {
        toUserId: {
          type: "string",
          description: "The iLink user id of the WeChat peer.",
        },
        text: {
          type: "string",
          description: "Plain-text content to send.",
        },
        contextToken: {
          type: "string",
          description: "Optional explicit context_token. If omitted, the saved token for the user is used.",
        },
      },
      required: ["toUserId", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_send_typing",
    description: "Send the WeChat typing indicator to a user.",
    inputSchema: {
      type: "object",
      properties: {
        toUserId: {
          type: "string",
          description: "The iLink user id of the WeChat peer.",
        },
        contextToken: {
          type: "string",
          description: "Optional explicit context_token. If omitted, the saved token for the user is used.",
        },
      },
      required: ["toUserId"],
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_clear_codex_session",
    description: "Forget the saved Codex multi-turn session for a WeChat user.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "The WeChat iLink user id.",
        },
      },
      required: ["userId"],
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_logout",
    description: "Clear saved WeChat credentials, QR state, cursor, and cached Codex sessions.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

function textResult(payload: unknown, isError = false): CallToolResult {
  return {
    isError,
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function renderTerminalQr(content: string): string {
  let rendered = "";
  qrcodeTerminal.generate(content, { small: true }, (output) => {
    rendered = output;
  });
  return rendered.trim();
}

function getClient(): ILinkClient {
  const credentials = loadCredentials();
  if (!credentials) {
    throw new Error("No saved WeChat credentials. Run the QR login flow first.");
  }

  const client = new ILinkClient({
    baseUrl: credentials.baseUrl,
    token: credentials.botToken,
  });
  client.cursor = loadCursor();
  return client;
}

async function handleStartLogin(args: JsonRecord): Promise<CallToolResult> {
  const baseUrl = typeof args.baseUrl === "string" && args.baseUrl ? args.baseUrl : DEFAULT_ILINK_BASE_URL;
  const qr = await startQrLogin(baseUrl);
  const pending = {
    qrcode: qr.qrcode,
    qrContent: qr.qrcode_img_content,
    baseUrl,
    refreshCount: 0,
    createdAt: new Date().toISOString(),
  };
  savePendingLogin(pending);

  return textResult({
    status: "waiting",
    loggedIn: false,
    baseUrl,
    qrContent: qr.qrcode_img_content,
    terminalQr: renderTerminalQr(qr.qrcode_img_content),
    nextAction: "Scan the QR in WeChat, then call wechat_ilink_check_login or wechat_ilink_ensure_login again.",
    note: "Scan qrContent with WeChat, then call wechat_ilink_check_login.",
  });
}

async function handleEnsureLogin(args: JsonRecord): Promise<CallToolResult> {
  const credentials = loadCredentials();
  if (credentials) {
    return textResult({
      loggedIn: true,
      status: "confirmed",
      accountId: credentials.accountId,
      baseUrl: credentials.baseUrl,
      userId: credentials.userId ?? null,
      savedAt: credentials.savedAt,
      nextAction: "Login is ready. You can now pull messages or send replies.",
    });
  }

  const pending = loadPendingLogin();
  if (!pending) {
    return handleStartLogin(args);
  }

  const status = await checkQrLogin(pending.baseUrl, pending.qrcode);

  if (status.status === "confirmed") {
    const saved = saveCredentials(toLoginResult(status, pending.baseUrl));
    clearPendingLogin();
    return textResult({
      loggedIn: true,
      status: "confirmed",
      accountId: saved.accountId,
      baseUrl: saved.baseUrl,
      userId: saved.userId ?? null,
      savedAt: saved.savedAt,
      nextAction: "Login is ready. You can now pull messages or send replies.",
    });
  }

  if (status.status === "expired") {
    return handleStartLogin({ baseUrl: pending.baseUrl });
  }

  return textResult({
    loggedIn: false,
    status: status.status === "scaned" ? "scanned" : "waiting",
    qrContent: pending.qrContent,
    terminalQr: renderTerminalQr(pending.qrContent),
    nextAction:
      status.status === "scaned"
        ? "The QR has been scanned. Ask the user to confirm inside WeChat, then call wechat_ilink_ensure_login again."
        : "Show the QR to the user and ask them to scan it with WeChat.",
  });
}

async function handleCheckLogin(): Promise<CallToolResult> {
  const pending = loadPendingLogin();
  if (!pending) {
    throw new Error("No pending login session. Start one with wechat_ilink_start_login.");
  }

  const status = await checkQrLogin(pending.baseUrl, pending.qrcode);

  if (status.status === "expired") {
    const refreshed = await startQrLogin(pending.baseUrl);
    savePendingLogin({
      qrcode: refreshed.qrcode,
      qrContent: refreshed.qrcode_img_content,
      baseUrl: pending.baseUrl,
      refreshCount: pending.refreshCount + 1,
      createdAt: new Date().toISOString(),
    });

    return textResult({
      status: "expired",
      loggedIn: false,
      refreshed: true,
      qrContent: refreshed.qrcode_img_content,
      terminalQr: renderTerminalQr(refreshed.qrcode_img_content),
      nextAction: "Scan the refreshed QR and call wechat_ilink_check_login again.",
      note: "QR expired and has been refreshed. Scan the new qrContent and check again.",
    });
  }

  if (status.status === "confirmed") {
    const credentials = saveCredentials(toLoginResult(status, pending.baseUrl));
    clearPendingLogin();
    return textResult({
      status: "confirmed",
      loggedIn: true,
      accountId: credentials.accountId,
      baseUrl: credentials.baseUrl,
      userId: credentials.userId ?? null,
      savedAt: credentials.savedAt,
      nextAction: "Login is ready. You can now pull messages or send replies.",
    });
  }

  return textResult({
    loggedIn: false,
    status: status.status === "scaned" ? "scanned" : status.status,
    qrContent: pending.qrContent,
    terminalQr: renderTerminalQr(pending.qrContent),
    nextAction:
      status.status === "scaned"
        ? "The QR has been scanned. Ask the user to confirm inside WeChat."
        : "Show the QR to the user and ask them to scan it with WeChat.",
    note: status.status === "scaned" ? "QR has been scanned; confirm on the phone." : "Waiting for scan.",
  });
}

async function handleStatus(): Promise<CallToolResult> {
  const credentials = loadCredentials();
  const pending = loadPendingLogin();
  const cursor = loadCursor();

  return textResult({
    loggedIn: Boolean(credentials),
    accountId: credentials?.accountId ?? null,
    baseUrl: credentials?.baseUrl ?? null,
    savedAt: credentials?.savedAt ?? null,
    hasPendingLogin: Boolean(pending),
    pendingCreatedAt: pending?.createdAt ?? null,
    pendingBaseUrl: pending?.baseUrl ?? null,
    pendingQrContent: pending?.qrContent ?? null,
    pendingTerminalQr: pending?.qrContent ? renderTerminalQr(pending.qrContent) : null,
    hasCursor: cursor.length > 0,
    cursorLength: cursor.length,
  });
}

async function handlePullUpdates(args: JsonRecord): Promise<CallToolResult> {
  const limit = typeof args.limit === "number" ? args.limit : 20;
  const client = getClient();
  const response = await client.poll();
  saveCursor(client.cursor);

  const normalized = (response.msgs ?? []).map((message) => {
    if (message.from_user_id && message.context_token) {
      setContextToken(message.from_user_id, message.context_token);
    }
    return normalizeInboundMessage(message);
  });

  return textResult({
    ret: response.ret ?? 0,
    errcode: response.errcode ?? 0,
    errmsg: response.errmsg ?? "",
    cursorLength: client.cursor.length,
    messageCount: normalized.length,
    messages: normalized.slice(0, limit),
  });
}

async function handleSendText(args: JsonRecord): Promise<CallToolResult> {
  const toUserId = requireString(args.toUserId, "toUserId");
  const text = requireString(args.text, "text");
  const contextToken =
    (typeof args.contextToken === "string" && args.contextToken) || getContextToken(toUserId);

  if (!contextToken) {
    throw new Error(`No context token available for ${toUserId}`);
  }

  const client = getClient();
  const sent = await client.sendTextChunked(toUserId, text, contextToken);
  return textResult({
    ok: true,
    toUserId,
    chunks: sent,
  });
}

async function handleSendTyping(args: JsonRecord): Promise<CallToolResult> {
  const toUserId = requireString(args.toUserId, "toUserId");
  const contextToken =
    (typeof args.contextToken === "string" && args.contextToken) || getContextToken(toUserId);

  const client = getClient();
  await client.sendTyping(toUserId, contextToken);
  return textResult({
    ok: true,
    toUserId,
  });
}

async function handleClearCodexSession(args: JsonRecord): Promise<CallToolResult> {
  const userId = requireString(args.userId, "userId");
  clearCodexSession(userId);
  return textResult({
    ok: true,
    userId,
  });
}

async function handleLogout(): Promise<CallToolResult> {
  clearAllState();
  return textResult({
    ok: true,
    note: "All saved state has been cleared.",
  });
}

async function dispatchTool(name: string, args: JsonRecord): Promise<CallToolResult> {
  switch (name) {
    case "wechat_ilink_ensure_login":
      return handleEnsureLogin(args);
    case "wechat_ilink_start_login":
      return handleStartLogin(args);
    case "wechat_ilink_check_login":
      return handleCheckLogin();
    case "wechat_ilink_status":
      return handleStatus();
    case "wechat_ilink_pull_updates":
      return handlePullUpdates(args);
    case "wechat_ilink_send_text":
      return handleSendText(args);
    case "wechat_ilink_send_typing":
      return handleSendTyping(args);
    case "wechat_ilink_clear_codex_session":
      return handleClearCodexSession(args);
    case "wechat_ilink_logout":
      return handleLogout();
    default:
      return textResult(`Unknown tool: ${name}`, true);
  }
}

async function main(): Promise<void> {
  const server = new Server(
    {
      name: "weixin-codex-bot",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const name = request.params.name;
      const args = (request.params.arguments ?? {}) as JsonRecord;
      return await dispatchTool(name, args);
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), true);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
