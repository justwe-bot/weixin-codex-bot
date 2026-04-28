import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import qrcodeTerminal from "qrcode-terminal";
import {
  BRIDGE_AGENT_LABEL,
  getBridgeAgentStatus,
  removeBridgeAgent,
  startBridgeAgent,
  stopBridgeAgent,
} from "../bridge/launchd.js";
import { checkQrLogin, DEFAULT_ILINK_BASE_URL, startQrLogin, toLoginResult } from "../ilink/auth.js";
import { ILinkClient } from "../ilink/client.js";
import { resolvePackagedBridgeEntrypoint } from "../runtime.js";
import {
  clearPendingLogin,
  clearPendingSetup,
  clearAllState,
  clearCodexSession,
  clearStoredBridgeConfig,
  getContextToken,
  getStateDirectory,
  listKnownConversations,
  loadCredentials,
  loadCursor,
  loadPendingLogin,
  loadPendingSetup,
  loadStoredBridgeConfig,
  recordInboundConversation,
  recordOutboundConversation,
  saveCredentials,
  saveCursor,
  savePendingLogin,
  savePendingSetup,
  saveStoredBridgeConfig,
  setContextToken,
  type BridgeDeliveryMode,
  type BridgeQueueAckMode,
  type CodexSandbox,
  type PendingSetup,
  type StoredBridgeConfig,
} from "../state.js";
import { normalizeInboundMessage } from "../util/messages.js";

type JsonRecord = Record<string, unknown>;

const SANDBOX_VALUES: CodexSandbox[] = ["read-only", "workspace-write", "danger-full-access"];
const DELIVERY_MODE_VALUES: BridgeDeliveryMode[] = ["exec", "queue"];
const QUEUE_ACK_MODE_VALUES: BridgeQueueAckMode[] = ["none", "typing", "text", "both"];
const DEFAULT_QUEUE_HEARTBEAT_INTERVAL_MINUTES = 1;

const tools: Tool[] = [
  {
    name: "wechat_ilink_setup",
    description:
      "Run the first-use WeChat setup flow end-to-end: remember exec or queue mode, guide QR login when needed, start the realtime bridge after login, and for queue mode return a heartbeat automation template for the current Codex thread.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: {
          type: "string",
          description: "Optional iLink base URL. Defaults to Tencent's public iLink endpoint.",
        },
        workspaceRoot: {
          type: "string",
          description: "Absolute or relative workspace path that the bridge should run Codex in.",
        },
        deliveryMode: {
          type: "string",
          enum: DELIVERY_MODE_VALUES,
          description:
            "Use exec to let the background bridge call codex exec directly, or queue to hand messages to the current Desktop thread.",
        },
        heartbeatIntervalMinutes: {
          type: "integer",
          minimum: 1,
          maximum: 60,
          description: "Queue mode only. Suggested thread heartbeat interval in minutes. Defaults to 1.",
        },
        heartbeatName: {
          type: "string",
          description: "Queue mode only. Optional display name for the suggested thread heartbeat automation.",
        },
        codexBinary: {
          type: "string",
          description: "Optional Codex executable path. Defaults to the current Codex binary if discoverable.",
        },
        model: {
          type: "string",
          description: "Optional Codex model override.",
        },
        sandbox: {
          type: "string",
          enum: SANDBOX_VALUES,
          description: "Codex sandbox mode used when full-auto is disabled.",
        },
        fullAuto: {
          type: "boolean",
          description: "Whether the bridge should run Codex with --full-auto.",
        },
        dangerousBypass: {
          type: "boolean",
          description: "Whether the bridge should run Codex with dangerous bypass approvals and sandbox.",
        },
        skipGitRepoCheck: {
          type: "boolean",
          description: "Whether to pass --skip-git-repo-check to Codex.",
        },
        addDirs: {
          type: "array",
          items: { type: "string" },
          description: "Extra writable directories passed to Codex with --add-dir.",
        },
        multiTurn: {
          type: "boolean",
          description: "Whether to reuse a Codex session per WeChat user.",
        },
        stripMarkdown: {
          type: "boolean",
          description: "Whether to flatten Markdown before replying to WeChat.",
        },
        triggerPrefix: {
          type: "string",
          description: "Optional command prefix that a message must start with before the bridge forwards it to Codex.",
        },
        allowedUserIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional allow-list of WeChat user ids that may trigger the bridge.",
        },
        systemPrompt: {
          type: "string",
          description: "Additional system prompt prepended to each Codex bridge request.",
        },
        idleRetryMs: {
          type: "integer",
          minimum: 1000,
          description: "Retry delay in milliseconds after a polling failure.",
        },
        queueAckMode: {
          type: "string",
          enum: QUEUE_ACK_MODE_VALUES,
          description: "Queue mode acknowledgement behavior. Defaults to typing so WeChat shows an input indicator.",
        },
        queueAckText: {
          type: "string",
          description: "Optional acknowledgement text used when queueAckMode is text or both.",
        },
      },
      additionalProperties: false,
    },
  },
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
    description: "Inspect stored login status, pending QR state, saved cursor state, and known conversations.",
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
    name: "wechat_ilink_list_conversations",
    description: "List recent WeChat conversations cached by the plugin so Codex can proactively message known users.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of recent conversations to return.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_bridge_start",
    description: "Install or update the realtime WeChat bridge as a macOS launchd background service and start it.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: {
          type: "string",
          description: "Absolute or relative workspace path that the bridge should run Codex in.",
        },
        codexBinary: {
          type: "string",
          description: "Optional Codex executable path. Defaults to the current Codex binary if discoverable.",
        },
        model: {
          type: "string",
          description: "Optional Codex model override.",
        },
        sandbox: {
          type: "string",
          enum: SANDBOX_VALUES,
          description: "Codex sandbox mode used when full-auto is disabled.",
        },
        fullAuto: {
          type: "boolean",
          description: "Whether the bridge should run Codex with --full-auto.",
        },
        dangerousBypass: {
          type: "boolean",
          description: "Whether the bridge should run Codex with dangerous bypass approvals and sandbox.",
        },
        skipGitRepoCheck: {
          type: "boolean",
          description: "Whether to pass --skip-git-repo-check to Codex.",
        },
        addDirs: {
          type: "array",
          items: { type: "string" },
          description: "Extra writable directories passed to Codex with --add-dir.",
        },
        multiTurn: {
          type: "boolean",
          description: "Whether to reuse a Codex session per WeChat user.",
        },
        stripMarkdown: {
          type: "boolean",
          description: "Whether to flatten Markdown before replying to WeChat.",
        },
        triggerPrefix: {
          type: "string",
          description: "Optional command prefix that a message must start with before the bridge forwards it to Codex.",
        },
        allowedUserIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional allow-list of WeChat user ids that may trigger the bridge.",
        },
        systemPrompt: {
          type: "string",
          description: "Additional system prompt prepended to each Codex bridge request.",
        },
        idleRetryMs: {
          type: "integer",
          minimum: 1000,
          description: "Retry delay in milliseconds after a polling failure.",
        },
        deliveryMode: {
          type: "string",
          enum: DELIVERY_MODE_VALUES,
          description: "Whether the bridge should forward messages directly to codex exec or enqueue them for a Desktop heartbeat thread.",
        },
        queueAckMode: {
          type: "string",
          enum: QUEUE_ACK_MODE_VALUES,
          description: "Queue mode acknowledgement behavior. Defaults to typing so WeChat shows an input indicator instead of an immediate text reply.",
        },
        queueAckText: {
          type: "string",
          description: "Optional acknowledgement text used when queueAckMode is text or both.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_bridge_stop",
    description: "Stop the realtime WeChat bridge background service but keep its saved configuration.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_bridge_status",
    description: "Inspect the realtime WeChat bridge launchd status, saved configuration, and recent logs.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "wechat_ilink_bridge_remove",
    description: "Uninstall the realtime WeChat bridge launchd agent, optionally removing logs and saved bridge config.",
    inputSchema: {
      type: "object",
      properties: {
        clearLogs: {
          type: "boolean",
          description: "Whether to remove the bridge stdout/stderr log files.",
        },
        clearSavedConfig: {
          type: "boolean",
          description: "Whether to remove the saved bridge configuration file.",
        },
      },
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

  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }

  return value;
}

function optionalInteger(value: unknown, name: string): number | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }

  return value;
}

function optionalPositiveInteger(value: unknown, name: string, minimum = 1, maximum?: number): number | undefined {
  const parsed = optionalInteger(value, name);
  if (parsed == null) {
    return undefined;
  }

  if (parsed < minimum) {
    throw new Error(`${name} must be at least ${minimum}`);
  }

  if (maximum != null && parsed > maximum) {
    throw new Error(`${name} must be at most ${maximum}`);
  }

  return parsed;
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }

  return value.map((item) => item.trim()).filter(Boolean);
}

function optionalSandbox(value: unknown): CodexSandbox | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "string" || !SANDBOX_VALUES.includes(value as CodexSandbox)) {
    throw new Error(`sandbox must be one of: ${SANDBOX_VALUES.join(", ")}`);
  }

  return value as CodexSandbox;
}

function optionalDeliveryMode(value: unknown): BridgeDeliveryMode | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "string" || !DELIVERY_MODE_VALUES.includes(value as BridgeDeliveryMode)) {
    throw new Error(`deliveryMode must be one of: ${DELIVERY_MODE_VALUES.join(", ")}`);
  }

  return value as BridgeDeliveryMode;
}

function optionalQueueAckMode(value: unknown): BridgeQueueAckMode | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "string" || !QUEUE_ACK_MODE_VALUES.includes(value as BridgeQueueAckMode)) {
    throw new Error(`queueAckMode must be one of: ${QUEUE_ACK_MODE_VALUES.join(", ")}`);
  }

  return value as BridgeQueueAckMode;
}

function renderTerminalQr(content: string): string {
  let rendered = "";
  qrcodeTerminal.generate(content, { small: true }, (output) => {
    rendered = output;
  });
  return rendered.trim();
}

function getLoginReadyNextAction(): string {
  return loadPendingSetup()
    ? "Login is ready. Re-run wechat_ilink_setup to finish bridge setup."
    : "Login is ready. You can now pull messages, send replies, or start the realtime bridge.";
}

function summarizePendingSetup(setup: PendingSetup | null): Record<string, unknown> | null {
  if (!setup) {
    return null;
  }

  return {
    requestedAt: setup.requestedAt,
    deliveryMode: setup.bridgeConfig.deliveryMode ?? "exec",
    workspaceRoot: setup.bridgeConfig.workspaceRoot ?? null,
    heartbeatIntervalMinutes: setup.heartbeatIntervalMinutes,
    heartbeatName: setup.heartbeatName ?? null,
  };
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

function ensureExistingDirectory(directoryPath: string, name: string): string {
  const resolved = path.resolve(directoryPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${name} does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`${name} is not a directory: ${resolved}`);
  }

  return resolved;
}

function resolveExecutable(candidate: string): string {
  const trimmed = candidate.trim();
  if (!trimmed) {
    throw new Error("codexBinary cannot be empty");
  }

  if (trimmed.includes(path.sep)) {
    const resolved = path.resolve(trimmed);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Executable not found: ${resolved}`);
    }
    return resolved;
  }

  const whichResult = spawnSync("which", [trimmed], {
    encoding: "utf8",
  });
  if (whichResult.status === 0) {
    const resolved = whichResult.stdout.trim();
    if (resolved) {
      return resolved;
    }
  }

  return trimmed;
}

function parseBridgeConfigUpdate(args: JsonRecord): StoredBridgeConfig {
  const config: StoredBridgeConfig = {};

  const workspaceRoot = optionalString(args.workspaceRoot, "workspaceRoot");
  if (workspaceRoot) {
    config.workspaceRoot = ensureExistingDirectory(workspaceRoot, "workspaceRoot");
  }

  const codexBinary = optionalString(args.codexBinary, "codexBinary");
  if (codexBinary) {
    config.codexBinary = resolveExecutable(codexBinary);
  }

  const model = optionalString(args.model, "model");
  if (model) {
    config.model = model;
  }

  const sandbox = optionalSandbox(args.sandbox);
  if (sandbox) {
    config.sandbox = sandbox;
  }

  const fullAuto = optionalBoolean(args.fullAuto, "fullAuto");
  if (fullAuto != null) {
    config.fullAuto = fullAuto;
  }

  const dangerousBypass = optionalBoolean(args.dangerousBypass, "dangerousBypass");
  if (dangerousBypass != null) {
    config.dangerousBypass = dangerousBypass;
  }

  const skipGitRepoCheck = optionalBoolean(args.skipGitRepoCheck, "skipGitRepoCheck");
  if (skipGitRepoCheck != null) {
    config.skipGitRepoCheck = skipGitRepoCheck;
  }

  const addDirs = optionalStringArray(args.addDirs, "addDirs");
  if (addDirs != null) {
    config.addDirs = addDirs.map((item) => ensureExistingDirectory(item, "addDirs entry"));
  }

  const multiTurn = optionalBoolean(args.multiTurn, "multiTurn");
  if (multiTurn != null) {
    config.multiTurn = multiTurn;
  }

  const stripMarkdown = optionalBoolean(args.stripMarkdown, "stripMarkdown");
  if (stripMarkdown != null) {
    config.stripMarkdown = stripMarkdown;
  }

  const triggerPrefix = optionalString(args.triggerPrefix, "triggerPrefix");
  if (triggerPrefix !== undefined) {
    config.triggerPrefix = triggerPrefix;
  } else if (typeof args.triggerPrefix === "string") {
    config.triggerPrefix = "";
  }

  const allowedUserIds = optionalStringArray(args.allowedUserIds, "allowedUserIds");
  if (allowedUserIds != null) {
    config.allowedUserIds = allowedUserIds;
  }

  const systemPrompt = optionalString(args.systemPrompt, "systemPrompt");
  if (systemPrompt) {
    config.systemPrompt = systemPrompt;
  }

  const idleRetryMs = optionalInteger(args.idleRetryMs, "idleRetryMs");
  if (idleRetryMs != null) {
    if (idleRetryMs < 1000) {
      throw new Error("idleRetryMs must be at least 1000");
    }
    config.idleRetryMs = idleRetryMs;
  }

  const deliveryMode = optionalDeliveryMode(args.deliveryMode);
  if (deliveryMode) {
    config.deliveryMode = deliveryMode;
  }

  const queueAckMode = optionalQueueAckMode(args.queueAckMode);
  if (queueAckMode) {
    config.queueAckMode = queueAckMode;
  }

  const queueAckText = optionalString(args.queueAckText, "queueAckText");
  if (queueAckText !== undefined) {
    config.queueAckText = queueAckText;
  } else if (typeof args.queueAckText === "string") {
    config.queueAckText = "";
  }

  return config;
}

function buildSavedBridgeConfig(args: JsonRecord): StoredBridgeConfig {
  const current = loadStoredBridgeConfig();
  const update = parseBridgeConfigUpdate(args);
  const workspaceRoot = update.workspaceRoot ?? current.workspaceRoot;
  if (!workspaceRoot) {
    throw new Error("workspaceRoot is required the first time you start the realtime bridge.");
  }

  const codexBinary =
    update.codexBinary ??
    current.codexBinary ??
    resolveExecutable(process.env.CODEX_BINARY || process.env.CODEX_BIN || "codex");

  return {
    ...current,
    ...update,
    workspaceRoot,
    codexBinary,
  };
}

function buildPendingSetupRequest(args: JsonRecord): PendingSetup {
  const savedConfig = loadStoredBridgeConfig();
  const existing = loadPendingSetup();
  const update = parseBridgeConfigUpdate(args);
  const workspaceRoot = update.workspaceRoot ?? existing?.bridgeConfig.workspaceRoot ?? savedConfig.workspaceRoot;
  if (!workspaceRoot) {
    throw new Error("workspaceRoot is required the first time you run wechat_ilink_setup.");
  }

  const codexBinary =
    update.codexBinary ??
    existing?.bridgeConfig.codexBinary ??
    savedConfig.codexBinary ??
    resolveExecutable(process.env.CODEX_BINARY || process.env.CODEX_BIN || "codex");
  const deliveryMode =
    update.deliveryMode ?? existing?.bridgeConfig.deliveryMode ?? savedConfig.deliveryMode ?? "exec";
  const queueAckMode =
    update.queueAckMode ?? existing?.bridgeConfig.queueAckMode ?? savedConfig.queueAckMode ?? "typing";
  const queueAckText =
    update.queueAckText ??
    existing?.bridgeConfig.queueAckText ??
    savedConfig.queueAckText ??
    "";
  const heartbeatIntervalMinutes =
    optionalPositiveInteger(args.heartbeatIntervalMinutes, "heartbeatIntervalMinutes", 1, 60) ??
    existing?.heartbeatIntervalMinutes ??
    DEFAULT_QUEUE_HEARTBEAT_INTERVAL_MINUTES;
  const heartbeatName =
    optionalString(args.heartbeatName, "heartbeatName") ?? existing?.heartbeatName ?? undefined;

  return {
    bridgeConfig: {
      ...savedConfig,
      ...existing?.bridgeConfig,
      ...update,
      workspaceRoot,
      codexBinary,
      deliveryMode,
      queueAckMode,
      queueAckText,
    },
    heartbeatIntervalMinutes,
    heartbeatName,
    requestedAt: new Date().toISOString(),
  };
}

function buildSetupWaitingPayload(input: {
  setup: PendingSetup;
  loginStatus: "waiting" | "scanned" | "expired";
  qrContent: string;
  baseUrl: string;
  refreshed?: boolean;
}): Record<string, unknown> {
  return {
    ok: true,
    phase: "login",
    loggedIn: false,
    status: input.loginStatus,
    deliveryMode: input.setup.bridgeConfig.deliveryMode ?? "exec",
    setup: summarizePendingSetup(input.setup),
    bridgeWillAutoStartAfterLogin: true,
    qrContent: input.qrContent,
    terminalQr: renderTerminalQr(input.qrContent),
    baseUrl: input.baseUrl,
    refreshed: input.refreshed ?? false,
    nextAction:
      input.loginStatus === "scanned"
        ? "The QR has been scanned. Ask the user to confirm inside WeChat, then call wechat_ilink_setup again with the same mode."
        : "Show the QR to the user, ask them to scan and confirm in WeChat, then call wechat_ilink_setup again with the same mode.",
  };
}

function buildQueueHeartbeatTemplate(setup: PendingSetup): Record<string, unknown> {
  const workspaceRoot = setup.bridgeConfig.workspaceRoot!;
  const stateDirectory = getStateDirectory();
  const interval = setup.heartbeatIntervalMinutes;
  const name = setup.heartbeatName || "WeChat Queue";
  const envPrefix = `WEIXIN_CODEX_BOT_HOME=${stateDirectory}`;

  return {
    required: true,
    kind: "heartbeat",
    destination: "thread",
    name,
    intervalMinutes: interval,
    rrule: `FREQ=MINUTELY;INTERVAL=${interval}`,
    workspaceRoot,
    stateDirectory,
    prompt: [
      "Process at most one pending WeChat queue item for this thread.",
      `Run \`${envPrefix} node --import tsx src/cli/queue-pop.ts --claimed-by desktop-heartbeat\` in the workspace to claim the next item.`,
      "If no queue item is returned, stop for this run.",
      "If an item is claimed, treat its `text` as the user's request, do the needed work in this thread, write the final plain-text reply to a temporary file, and send it back with",
      `\`${envPrefix} node --import tsx src/cli/queue-reply.ts --id <queue-id> --text-file <reply-file> --typing\`.`,
      "Keep the final reply concise and suitable for WeChat.",
    ].join(" "),
    note: "The host Codex assistant should create this heartbeat automation for the current thread.",
  };
}

function completeSetup(setup: PendingSetup): CallToolResult {
  const savedConfig = saveStoredBridgeConfig(setup.bridgeConfig);
  const bridge = startBridgeAgent({
    bridgeEntrypoint: resolvePackagedBridgeEntrypoint(import.meta.url),
    stateDirectory: getStateDirectory(),
    nodeBinary: process.execPath,
  });
  clearPendingSetup();

  return textResult({
    ok: true,
    phase: "complete",
    loggedIn: true,
    deliveryMode: savedConfig.deliveryMode ?? "exec",
    bridgeAutoStarted: true,
    bridge,
    savedConfig,
    stateDirectory: getStateDirectory(),
    heartbeatAutomation:
      savedConfig.deliveryMode === "queue" ? buildQueueHeartbeatTemplate(setup) : null,
    nextAction:
      savedConfig.deliveryMode === "queue"
        ? "Bridge is running in queue mode. The host Codex assistant should now create the suggested heartbeat automation for this thread."
        : "Bridge is running in exec mode. WeChat messages can now call codex exec directly.",
  });
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

async function handleSetup(args: JsonRecord): Promise<CallToolResult> {
  const setup = savePendingSetup(buildPendingSetupRequest(args));
  const credentials = loadCredentials();
  if (credentials) {
    return completeSetup(setup);
  }

  const pending = loadPendingLogin();
  if (!pending) {
    const baseUrl = typeof args.baseUrl === "string" && args.baseUrl ? args.baseUrl : DEFAULT_ILINK_BASE_URL;
    const qr = await startQrLogin(baseUrl);
    savePendingLogin({
      qrcode: qr.qrcode,
      qrContent: qr.qrcode_img_content,
      baseUrl,
      refreshCount: 0,
      createdAt: new Date().toISOString(),
    });

    return textResult(
      buildSetupWaitingPayload({
        setup,
        loginStatus: "waiting",
        qrContent: qr.qrcode_img_content,
        baseUrl,
      }),
    );
  }

  const status = await checkQrLogin(pending.baseUrl, pending.qrcode);

  if (status.status === "confirmed") {
    saveCredentials(toLoginResult(status, pending.baseUrl));
    clearPendingLogin();
    return completeSetup(setup);
  }

  if (status.status === "expired") {
    const refreshed = await startQrLogin(pending.baseUrl);
    savePendingLogin({
      qrcode: refreshed.qrcode,
      qrContent: refreshed.qrcode_img_content,
      baseUrl: pending.baseUrl,
      refreshCount: pending.refreshCount + 1,
      createdAt: new Date().toISOString(),
    });

    return textResult(
      buildSetupWaitingPayload({
        setup,
        loginStatus: "expired",
        qrContent: refreshed.qrcode_img_content,
        baseUrl: pending.baseUrl,
        refreshed: true,
      }),
    );
  }

  return textResult(
    buildSetupWaitingPayload({
      setup,
      loginStatus: status.status === "scaned" ? "scanned" : "waiting",
      qrContent: pending.qrContent,
      baseUrl: pending.baseUrl,
    }),
  );
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
      nextAction: getLoginReadyNextAction(),
      pendingSetup: summarizePendingSetup(loadPendingSetup()),
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
      nextAction: getLoginReadyNextAction(),
      pendingSetup: summarizePendingSetup(loadPendingSetup()),
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
      nextAction: getLoginReadyNextAction(),
      pendingSetup: summarizePendingSetup(loadPendingSetup()),
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
    stateDirectory: getStateDirectory(),
    knownConversationCount: listKnownConversations().length,
    bridgeAgentLabel: BRIDGE_AGENT_LABEL,
    pendingSetup: summarizePendingSetup(loadPendingSetup()),
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
    if (message.from_user_id) {
      recordInboundConversation({
        userId: message.from_user_id,
        text: normalizeInboundMessage(message).text,
        contextToken: message.context_token,
        createTimeMs: message.create_time_ms ?? null,
      });
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
  recordOutboundConversation({
    userId: toUserId,
    text,
    contextToken,
  });
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

async function handleListConversations(args: JsonRecord): Promise<CallToolResult> {
  const limit = typeof args.limit === "number" ? args.limit : 20;
  return textResult({
    conversations: listKnownConversations(limit),
    total: listKnownConversations().length,
  });
}

async function handleBridgeStart(args: JsonRecord): Promise<CallToolResult> {
  if (!loadCredentials()) {
    throw new Error("WeChat is not logged in yet. Run wechat_ilink_ensure_login before starting the realtime bridge.");
  }

  const savedConfig = saveStoredBridgeConfig(buildSavedBridgeConfig(args));
  const status = startBridgeAgent({
    bridgeEntrypoint: resolvePackagedBridgeEntrypoint(import.meta.url),
    stateDirectory: getStateDirectory(),
    nodeBinary: process.execPath,
  });

  return textResult({
    ok: true,
    note: "Realtime bridge installed and started.",
    bridge: status,
    savedConfig,
    stateDirectory: getStateDirectory(),
  });
}

async function handleBridgeStop(): Promise<CallToolResult> {
  const status = stopBridgeAgent(getStateDirectory());
  return textResult({
    ok: true,
    note: "Realtime bridge stopped. Saved config was kept.",
    bridge: status,
  });
}

async function handleBridgeStatus(): Promise<CallToolResult> {
  const savedConfig = loadStoredBridgeConfig();
  const status = getBridgeAgentStatus(getStateDirectory());
  return textResult({
    bridge: status,
    savedConfig,
    stateDirectory: getStateDirectory(),
    knownConversationCount: listKnownConversations().length,
    bridgeEntrypoint: resolvePackagedBridgeEntrypoint(import.meta.url),
  });
}

async function handleBridgeRemove(args: JsonRecord): Promise<CallToolResult> {
  const clearLogs = optionalBoolean(args.clearLogs, "clearLogs") ?? false;
  const clearSavedConfig = optionalBoolean(args.clearSavedConfig, "clearSavedConfig") ?? false;
  const status = removeBridgeAgent(getStateDirectory(), { clearLogs });
  if (clearSavedConfig) {
    clearStoredBridgeConfig();
  }

  return textResult({
    ok: true,
    note: "Realtime bridge launchd agent removed.",
    bridge: status,
    clearedSavedConfig: clearSavedConfig,
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
    note: "All saved WeChat runtime state has been cleared. Bridge config was left untouched.",
  });
}

async function dispatchTool(name: string, args: JsonRecord): Promise<CallToolResult> {
  switch (name) {
    case "wechat_ilink_setup":
      return handleSetup(args);
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
    case "wechat_ilink_list_conversations":
      return handleListConversations(args);
    case "wechat_ilink_bridge_start":
      return handleBridgeStart(args);
    case "wechat_ilink_bridge_stop":
      return handleBridgeStop();
    case "wechat_ilink_bridge_status":
      return handleBridgeStatus();
    case "wechat_ilink_bridge_remove":
      return handleBridgeRemove(args);
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
