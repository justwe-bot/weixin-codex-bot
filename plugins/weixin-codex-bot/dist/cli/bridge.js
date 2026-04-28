// src/outbox.ts
import fs2 from "node:fs";
import path2 from "node:path";

// src/state.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// src/util/text.ts
function stripMarkdown(input) {
  return input.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => code.trim()).replace(/`([^`]+)`/g, "$1").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*]\s+/gm, "- ").replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)").replace(/\n{3,}/g, "\n\n").trim();
}
function chunkText(text, maxLength = 3500) {
  if (text.length <= maxLength) {
    return [text];
  }
  const chunks = [];
  let rest = text;
  while (rest.length > maxLength) {
    const candidate = rest.slice(0, maxLength);
    const splitAt = Math.max(
      candidate.lastIndexOf("\n\n"),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf("\u3002"),
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf(" ")
    );
    const boundary = splitAt > maxLength * 0.5 ? splitAt : maxLength;
    chunks.push(rest.slice(0, boundary).trim());
    rest = rest.slice(boundary).trim();
  }
  if (rest) {
    chunks.push(rest);
  }
  return chunks;
}
function parseBoolean(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
function parseList(value) {
  if (!value) {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

// src/state.ts
var DEFAULT_STATE_DIR = path.join(os.homedir(), ".weixin-codex-bot");
var LOCAL_STATE_DIRNAME = ".codex-wechat-state";
var SHARED_STATE_DIR = path.join("/tmp", "weixin-codex-bot-state");
function findNearestLocalStateDir(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, LOCAL_STATE_DIRNAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
function stateDir() {
  if (process.env.WEIXIN_CODEX_BOT_HOME) {
    return path.resolve(process.env.WEIXIN_CODEX_BOT_HOME);
  }
  if (fs.existsSync(SHARED_STATE_DIR)) {
    return SHARED_STATE_DIR;
  }
  if (process.env.CODEX_WORKSPACE) {
    const workspaceStateDir = path.join(path.resolve(process.env.CODEX_WORKSPACE), LOCAL_STATE_DIRNAME);
    if (fs.existsSync(workspaceStateDir)) {
      return workspaceStateDir;
    }
  }
  const discovered = findNearestLocalStateDir(process.cwd());
  if (discovered) {
    return discovered;
  }
  return DEFAULT_STATE_DIR;
}
function ensureStateDir() {
  fs.mkdirSync(stateDir(), { recursive: true });
}
function resolvePath(filename) {
  return path.join(stateDir(), filename);
}
function readJson(filename, fallback) {
  try {
    return JSON.parse(fs.readFileSync(resolvePath(filename), "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(filename, payload, mode) {
  ensureStateDir();
  const target = resolvePath(filename);
  fs.writeFileSync(target, JSON.stringify(payload, null, 2));
  if (mode != null) {
    fs.chmodSync(target, mode);
  }
}
function getStateDirectory() {
  return stateDir();
}
function parseOptionalBoolean(value) {
  if (value == null || value === "") {
    return void 0;
  }
  return parseBoolean(value, false);
}
function parseOptionalInteger(value) {
  if (value == null || value === "") {
    return void 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function resolveMaybePath(value) {
  if (path.isAbsolute(value)) {
    return value;
  }
  return value.includes(path.sep) ? path.resolve(value) : value;
}
function normalizeStoredBridgeConfig(config) {
  const normalized = {};
  if (config.codexBinary) {
    normalized.codexBinary = resolveMaybePath(config.codexBinary.trim());
  }
  if (config.workspaceRoot) {
    normalized.workspaceRoot = path.resolve(config.workspaceRoot);
  }
  if (config.model) {
    normalized.model = config.model.trim();
  }
  if (config.sandbox) {
    normalized.sandbox = config.sandbox;
  }
  if (typeof config.fullAuto === "boolean") {
    normalized.fullAuto = config.fullAuto;
  }
  if (typeof config.dangerousBypass === "boolean") {
    normalized.dangerousBypass = config.dangerousBypass;
  }
  if (typeof config.skipGitRepoCheck === "boolean") {
    normalized.skipGitRepoCheck = config.skipGitRepoCheck;
  }
  if (Array.isArray(config.addDirs)) {
    normalized.addDirs = Array.from(
      new Set(
        config.addDirs.map((item) => item.trim()).filter(Boolean).map((item) => path.resolve(item))
      )
    );
  }
  if (typeof config.multiTurn === "boolean") {
    normalized.multiTurn = config.multiTurn;
  }
  if (typeof config.stripMarkdown === "boolean") {
    normalized.stripMarkdown = config.stripMarkdown;
  }
  if (typeof config.systemPrompt === "string" && config.systemPrompt.trim()) {
    normalized.systemPrompt = config.systemPrompt.trim();
  }
  if (typeof config.idleRetryMs === "number" && Number.isFinite(config.idleRetryMs) && config.idleRetryMs > 0) {
    normalized.idleRetryMs = Math.trunc(config.idleRetryMs);
  }
  if (Array.isArray(config.allowedUserIds)) {
    normalized.allowedUserIds = Array.from(
      new Set(
        config.allowedUserIds.map((item) => item.trim()).filter(Boolean)
      )
    );
  }
  if (typeof config.triggerPrefix === "string") {
    normalized.triggerPrefix = config.triggerPrefix.trim();
  }
  if (config.deliveryMode === "exec" || config.deliveryMode === "queue") {
    normalized.deliveryMode = config.deliveryMode;
  }
  if (config.queueAckMode === "none" || config.queueAckMode === "typing" || config.queueAckMode === "text" || config.queueAckMode === "both") {
    normalized.queueAckMode = config.queueAckMode;
  }
  if (typeof config.queueAckText === "string") {
    normalized.queueAckText = config.queueAckText.trim();
  }
  return normalized;
}
function loadCredentials() {
  return readJson("credentials.json", null);
}
function loadCursor() {
  try {
    return fs.readFileSync(resolvePath("sync-cursor.txt"), "utf8");
  } catch {
    return "";
  }
}
function saveCursor(cursor) {
  ensureStateDir();
  fs.writeFileSync(resolvePath("sync-cursor.txt"), cursor, "utf8");
}
function loadContextMap() {
  return readJson("context-tokens.json", {});
}
function saveContextMap(tokens) {
  writeJson("context-tokens.json", tokens, 384);
}
function getContextToken(userId) {
  return loadContextMap()[userId];
}
function setContextToken(userId, token) {
  const tokens = loadContextMap();
  tokens[userId] = token;
  saveContextMap(tokens);
}
function loadSessionMap() {
  return readJson("codex-sessions.json", {});
}
function saveSessionMap(payload) {
  writeJson("codex-sessions.json", payload, 384);
}
function getCodexSession(userId) {
  return loadSessionMap()[userId];
}
function setCodexSession(userId, sessionId) {
  const sessions = loadSessionMap();
  sessions[userId] = {
    sessionId,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  saveSessionMap(sessions);
}
function clearCodexSession(userId) {
  const sessions = loadSessionMap();
  delete sessions[userId];
  saveSessionMap(sessions);
}
function loadStoredBridgeConfig() {
  return normalizeStoredBridgeConfig(readJson("bridge-config.json", {}));
}
function loadBridgeConfig() {
  const stored = loadStoredBridgeConfig();
  const workspaceRoot = process.env.CODEX_WORKSPACE ? path.resolve(process.env.CODEX_WORKSPACE) : stored.workspaceRoot || process.cwd();
  const dangerousBypass = parseOptionalBoolean(process.env.CODEX_DANGEROUS_BYPASS) ?? stored.dangerousBypass ?? false;
  const sandbox = process.env.CODEX_SANDBOX ?? stored.sandbox ?? "workspace-write";
  const fullAuto = (parseOptionalBoolean(process.env.CODEX_FULL_AUTO) ?? stored.fullAuto ?? true) && !dangerousBypass;
  const idleRetryMs = parseOptionalInteger(process.env.BRIDGE_IDLE_RETRY_MS) ?? stored.idleRetryMs ?? 3e4;
  const addDirs = process.env.CODEX_ADD_DIRS ? parseList(process.env.CODEX_ADD_DIRS).map((item) => path.resolve(item)) : stored.addDirs ?? [];
  const allowedUserIds = process.env.BRIDGE_ALLOWED_USER_IDS ? parseList(process.env.BRIDGE_ALLOWED_USER_IDS) : stored.allowedUserIds ?? [];
  return {
    codexBinary: process.env.CODEX_BINARY || stored.codexBinary || "codex",
    workspaceRoot,
    model: process.env.CODEX_MODEL || stored.model || void 0,
    sandbox,
    fullAuto,
    dangerousBypass,
    skipGitRepoCheck: parseOptionalBoolean(process.env.CODEX_SKIP_GIT_REPO_CHECK) ?? stored.skipGitRepoCheck ?? true,
    addDirs,
    multiTurn: parseOptionalBoolean(process.env.BRIDGE_MULTI_TURN) ?? stored.multiTurn ?? true,
    stripMarkdown: parseOptionalBoolean(process.env.BRIDGE_STRIP_MARKDOWN) ?? stored.stripMarkdown ?? true,
    systemPrompt: process.env.BRIDGE_SYSTEM_PROMPT || stored.systemPrompt || "\u4F60\u6B63\u5728\u901A\u8FC7\u5FAE\u4FE1\u4E0E\u7528\u6237\u534F\u4F5C\u3002\u4F18\u5148\u76F4\u63A5\u5B8C\u6210\u4EFB\u52A1\uFF0C\u56DE\u590D\u4F7F\u7528\u9002\u5408\u5FAE\u4FE1\u7684\u7EAF\u6587\u672C\uFF0C\u4E0D\u8981\u8F93\u51FA Markdown \u8868\u683C\u3002",
    idleRetryMs,
    allowedUserIds,
    triggerPrefix: process.env.BRIDGE_TRIGGER_PREFIX ?? stored.triggerPrefix ?? "",
    deliveryMode: process.env.BRIDGE_DELIVERY_MODE ?? stored.deliveryMode ?? "exec",
    queueAckMode: process.env.BRIDGE_QUEUE_ACK_MODE ?? stored.queueAckMode ?? "typing",
    queueAckText: process.env.BRIDGE_QUEUE_ACK_TEXT ?? stored.queueAckText ?? ""
  };
}
function loadConversationMap() {
  return readJson("known-conversations.json", {});
}
function saveConversationMap(payload) {
  writeJson("known-conversations.json", payload, 384);
}
function upsertConversation(userId, patch) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const conversations = loadConversationMap();
  const existing = conversations[userId] ?? {
    userId,
    updatedAt: now
  };
  const next = {
    ...existing,
    ...patch,
    userId,
    updatedAt: now
  };
  conversations[userId] = next;
  saveConversationMap(conversations);
  return next;
}
function recordInboundConversation(input) {
  const patch = {};
  if (input.contextToken) {
    patch.contextToken = input.contextToken;
  }
  if (input.text) {
    patch.lastInboundText = input.text;
  }
  if (input.createTimeMs && Number.isFinite(input.createTimeMs)) {
    patch.lastInboundAt = new Date(input.createTimeMs).toISOString();
  } else {
    patch.lastInboundAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  return upsertConversation(input.userId, patch);
}
function recordOutboundConversation(input) {
  const patch = {
    lastOutboundAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (input.contextToken) {
    patch.contextToken = input.contextToken;
  }
  if (input.text) {
    patch.lastOutboundText = input.text;
  }
  return upsertConversation(input.userId, patch);
}

// src/outbox.ts
var OUTBOX_FILENAME = "message-outbox.json";
function getOutboxPath() {
  return path2.join(getStateDirectory(), OUTBOX_FILENAME);
}
function loadOutbox() {
  try {
    return JSON.parse(fs2.readFileSync(getOutboxPath(), "utf8"));
  } catch {
    return [];
  }
}
function saveOutbox(items) {
  fs2.mkdirSync(getStateDirectory(), { recursive: true });
  fs2.writeFileSync(getOutboxPath(), JSON.stringify(items, null, 2), "utf8");
}
function listPendingWechatOutboxItems() {
  return loadOutbox().filter((item) => item.status === "pending").sort((left, right) => Date.parse(left.queuedAt) - Date.parse(right.queuedAt));
}
function markWechatOutboxItemSent(id) {
  const items = loadOutbox();
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Outbox item not found: ${id}`);
  }
  item.status = "sent";
  item.sentAt = (/* @__PURE__ */ new Date()).toISOString();
  item.lastError = void 0;
  saveOutbox(items);
  return item;
}
function recordWechatOutboxFailure(id, error) {
  const items = loadOutbox();
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Outbox item not found: ${id}`);
  }
  item.attempts += 1;
  item.lastError = error;
  saveOutbox(items);
  return item;
}

// src/codex/runner.ts
import fs3 from "node:fs";
import os2 from "node:os";
import path3 from "node:path";
import { spawn } from "node:child_process";
function buildPrompt(input) {
  return [
    input.config.systemPrompt,
    "",
    "\u989D\u5916\u7EA6\u675F\uFF1A",
    "- \u628A\u6700\u7EC8\u56DE\u590D\u5199\u6210\u9002\u5408\u5FAE\u4FE1\u9605\u8BFB\u7684\u7EAF\u6587\u672C\u3002",
    "- \u5982\u679C\u4F60\u6539\u4E86\u6587\u4EF6\uFF0C\u7B80\u8981\u8BF4\u660E\u7ED3\u679C\u548C\u5173\u952E\u8DEF\u5F84\u3002",
    "- \u5982\u679C\u9700\u8981\u6F84\u6E05\uFF0C\u8BF7\u5C3D\u91CF\u5148\u57FA\u4E8E\u73B0\u6709\u4FE1\u606F\u5B8C\u6210\u6700\u5408\u7406\u7684\u52A8\u4F5C\u3002",
    "",
    `\u5FAE\u4FE1\u7528\u6237: ${input.userId}`,
    "",
    "\u7528\u6237\u6D88\u606F\uFF1A",
    input.prompt.trim()
  ].join("\n");
}
function maybePush(args, flag, value) {
  if (value) {
    args.push(flag, value);
  }
}
function extractSessionId(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return void 0;
  }
  const record = candidate;
  const directValues = [
    record.session_id,
    record.sessionId,
    record.conversation_id,
    record.conversationId,
    record.thread_id,
    record.threadId
  ];
  for (const value of directValues) {
    if (typeof value === "string" && value) {
      return value;
    }
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested2 = extractSessionId(item);
        if (nested2) {
          return nested2;
        }
      }
      continue;
    }
    const nested = extractSessionId(value);
    if (nested) {
      return nested;
    }
  }
  return void 0;
}
async function runCodexPrompt(input) {
  const tempDir = fs3.mkdtempSync(path3.join(os2.tmpdir(), "weixin-codex-bot-"));
  const outputPath = path3.join(tempDir, "last-message.txt");
  const prompt = buildPrompt(input);
  const args = input.sessionId ? ["exec", "resume", input.sessionId, prompt] : ["exec", prompt];
  if (input.config.dangerousBypass) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (input.config.fullAuto) {
    args.push("--full-auto");
  } else {
    args.push("--sandbox", input.config.sandbox);
  }
  if (input.config.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }
  maybePush(args, "--model", input.config.model);
  for (const addDir of input.config.addDirs) {
    args.push("--add-dir", addDir);
  }
  args.push("--json", "--output-last-message", outputPath);
  return new Promise((resolve, reject) => {
    const child = spawn(input.config.codexBinary, args, {
      cwd: input.config.workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let discoveredSessionId = input.sessionId;
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) {
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed);
          discoveredSessionId = extractSessionId(parsed) || discoveredSessionId;
        } catch {
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      fs3.rmSync(tempDir, { recursive: true, force: true });
      reject(error);
    });
    child.on("close", (code) => {
      try {
        const text = fs3.existsSync(outputPath) ? fs3.readFileSync(outputPath, "utf8").trim() : "";
        fs3.rmSync(tempDir, { recursive: true, force: true });
        if (code !== 0) {
          const message = stderr.trim() || stdout.trim() || `codex exited with code ${code}`;
          reject(new Error(message));
          return;
        }
        resolve({
          text,
          sessionId: discoveredSessionId,
          stdout,
          stderr
        });
      } catch (error) {
        fs3.rmSync(tempDir, { recursive: true, force: true });
        reject(error);
      }
    });
  });
}

// src/ilink/client.ts
import crypto2 from "node:crypto";

// src/ilink/api.ts
import crypto from "node:crypto";
var DEFAULT_CHANNEL_VERSION = "weixin-codex-bot/0.1.0";
var DEFAULT_LONG_POLL_TIMEOUT_MS = 35e3;
var DEFAULT_API_TIMEOUT_MS = 15e3;
function buildUrl(baseUrl, endpoint) {
  return new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}
function randomWechatUin() {
  const randomUInt32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(randomUInt32), "utf8").toString("base64");
}
function buildHeaders(token, body) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(body, "utf8")),
    "X-WECHAT-UIN": randomWechatUin()
  };
}
async function post(options, endpoint, payload, timeoutMs) {
  const body = JSON.stringify({
    ...payload,
    base_info: {
      channel_version: options.channelVersion ?? DEFAULT_CHANNEL_VERSION
    }
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildUrl(options.baseUrl, endpoint), {
      method: "POST",
      headers: buildHeaders(options.token, body),
      body,
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${endpoint} ${response.status}: ${text}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}
async function getUpdates(options, request) {
  try {
    return await post(
      options,
      "ilink/bot/getupdates",
      { get_updates_buf: request.get_updates_buf ?? "" },
      options.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ret: 0,
        msgs: [],
        get_updates_buf: request.get_updates_buf ?? ""
      };
    }
    throw error;
  }
}
async function sendMessage(options, request) {
  await post(
    options,
    "ilink/bot/sendmessage",
    request,
    options.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS
  );
}
async function getConfig(options, userId, contextToken) {
  return post(
    options,
    "ilink/bot/getconfig",
    {
      ilink_user_id: userId,
      context_token: contextToken
    },
    options.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS
  );
}
async function sendTyping(options, request) {
  await post(
    options,
    "ilink/bot/sendtyping",
    request,
    options.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS
  );
}
async function getUploadUrl(options, request) {
  return post(
    options,
    "ilink/bot/getuploadurl",
    request,
    options.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS
  );
}

// src/ilink/types.ts
var MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2
};
var MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5
};
var MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2
};
var TypingStatus = {
  TYPING: 1,
  CANCEL: 2
};

// src/ilink/client.ts
var ILinkClient = class {
  options;
  syncCursor = "";
  constructor(options) {
    this.options = options;
  }
  set cursor(value) {
    this.syncCursor = value;
  }
  get cursor() {
    return this.syncCursor;
  }
  async poll() {
    const response = await getUpdates(this.options, { get_updates_buf: this.syncCursor });
    if (response.get_updates_buf) {
      this.syncCursor = response.get_updates_buf;
    }
    return response;
  }
  async sendText(toUserId, text, contextToken) {
    const message = {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: this.generateClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text }
        }
      ]
    };
    await sendMessage(this.options, { msg: message });
  }
  async sendTextChunked(toUserId, text, contextToken, maxLength = 3500) {
    const chunks = chunkText(text, maxLength);
    for (const chunk of chunks) {
      await this.sendText(toUserId, chunk, contextToken);
    }
    return chunks.length;
  }
  async sendMedia(toUserId, item, contextToken) {
    const message = {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: this.generateClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: [item]
    };
    await sendMessage(this.options, { msg: message });
  }
  async getConfig(userId, contextToken) {
    return getConfig(this.options, userId, contextToken);
  }
  async sendTyping(userId, contextToken) {
    const config = await this.getConfig(userId, contextToken);
    if (!config.typing_ticket) {
      return;
    }
    await sendTyping(this.options, {
      ilink_user_id: userId,
      typing_ticket: config.typing_ticket,
      status: TypingStatus.TYPING
    });
  }
  async getUploadUrl(request) {
    return getUploadUrl(this.options, request);
  }
  generateClientId() {
    return `weixin-codex-${Date.now()}-${crypto2.randomBytes(6).toString("hex")}`;
  }
};

// src/queue.ts
import crypto3 from "node:crypto";
import fs4 from "node:fs";
import path4 from "node:path";
var QUEUE_FILENAME = "message-queue.json";
var CLAIM_TTL_MS = 10 * 60 * 1e3;
function getQueuePath() {
  return path4.join(getStateDirectory(), QUEUE_FILENAME);
}
function loadQueue() {
  try {
    return JSON.parse(fs4.readFileSync(getQueuePath(), "utf8"));
  } catch {
    return [];
  }
}
function saveQueue(items) {
  fs4.mkdirSync(getStateDirectory(), { recursive: true });
  fs4.writeFileSync(getQueuePath(), JSON.stringify(items, null, 2), "utf8");
}
function findDuplicate(items, userId, sourceMessageId) {
  if (sourceMessageId == null) {
    return void 0;
  }
  return items.find((item) => item.userId === userId && item.sourceMessageId === sourceMessageId);
}
function enqueueWechatMessage(input) {
  const items = loadQueue();
  const duplicate = findDuplicate(items, input.userId, input.sourceMessageId);
  if (duplicate) {
    return {
      item: duplicate,
      duplicate: true
    };
  }
  const item = {
    id: crypto3.randomUUID(),
    userId: input.userId,
    contextToken: input.contextToken,
    text: input.text,
    rawText: input.rawText,
    sourceMessageId: input.sourceMessageId,
    createTimeMs: input.createTimeMs,
    queuedAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: "pending",
    attempts: 0
  };
  items.push(item);
  saveQueue(items);
  return {
    item,
    duplicate: false
  };
}

// src/util/messages.ts
function extractItemText(item) {
  if (item.type === MessageItemType.TEXT && item.text_item?.text) {
    const quoted = item.ref_msg?.title ? `[\u5F15\u7528: ${item.ref_msg.title}]
` : "";
    return `${quoted}${item.text_item.text}`.trim();
  }
  if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
    return item.voice_item.text.trim();
  }
  return "";
}
function extractInboundText(message) {
  for (const item of message.item_list ?? []) {
    const text = extractItemText(item);
    if (text) {
      return text;
    }
  }
  return "";
}

// src/cli/bridge.ts
var RESET_COMMANDS = /* @__PURE__ */ new Set(["/reset", "/clear", "\u65B0\u5BF9\u8BDD"]);
var SESSION_EXPIRED_ERRCODE = -14;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function extractPromptText(text, triggerPrefix) {
  const trimmed = text.trim();
  if (!triggerPrefix) {
    return trimmed;
  }
  if (!trimmed.startsWith(triggerPrefix)) {
    return null;
  }
  return trimmed.slice(triggerPrefix.length).trim();
}
async function flushWechatOutbox(client) {
  const items = listPendingWechatOutboxItems();
  for (const item of items) {
    try {
      if (item.typing) {
        await client.sendTyping(item.userId, item.contextToken).catch(() => {
        });
      }
      const chunks = await client.sendTextChunked(item.userId, item.text, item.contextToken);
      markWechatOutboxItemSent(item.id);
      recordOutboundConversation({
        userId: item.userId,
        text: item.text,
        contextToken: item.contextToken
      });
      console.log(`\u{1F4E4} \u5DF2\u53D1\u9001\u961F\u5217\u56DE\u590D ${item.queueItemId}\uFF0C\u5171 ${chunks} \u6761\u6D88\u606F`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      recordWechatOutboxFailure(item.id, reason);
      console.error(`\u53D1\u9001\u961F\u5217\u56DE\u590D\u5931\u8D25 ${item.queueItemId}:`, reason);
    }
  }
}
async function handleInboundMessage(client, rawMessage) {
  if (rawMessage.message_type !== MessageType.USER) {
    return;
  }
  const fromUserId = rawMessage.from_user_id;
  if (!fromUserId) {
    return;
  }
  const text = extractInboundText(rawMessage);
  if (!text) {
    console.log(`[skip] \u975E\u6587\u672C\u6D88\u606F from ${fromUserId}`);
    return;
  }
  if (rawMessage.context_token) {
    setContextToken(fromUserId, rawMessage.context_token);
  }
  const contextToken = rawMessage.context_token || getContextToken(fromUserId);
  if (!contextToken) {
    console.log(`[skip] \u7F3A\u5C11 context_token for ${fromUserId}`);
    return;
  }
  const config = loadBridgeConfig();
  recordInboundConversation({
    userId: fromUserId,
    text,
    contextToken,
    createTimeMs: rawMessage.create_time_ms ?? null
  });
  console.log(`
\u{1F4E9} ${fromUserId}: ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`);
  if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(fromUserId)) {
    console.log(`[skip] ${fromUserId} \u4E0D\u5728 bridge \u767D\u540D\u5355\u5185`);
    return;
  }
  if (config.multiTurn && RESET_COMMANDS.has(text.trim())) {
    clearCodexSession(fromUserId);
    await client.sendText(fromUserId, "\u5DF2\u4E3A\u4F60\u91CD\u7F6E Codex \u4F1A\u8BDD\u3002", contextToken);
    recordOutboundConversation({
      userId: fromUserId,
      text: "\u5DF2\u4E3A\u4F60\u91CD\u7F6E Codex \u4F1A\u8BDD\u3002",
      contextToken
    });
    return;
  }
  const promptText = extractPromptText(text, config.triggerPrefix);
  if (promptText == null) {
    console.log(`[skip] ${fromUserId} \u7684\u6D88\u606F\u672A\u547D\u4E2D\u89E6\u53D1\u524D\u7F00 ${config.triggerPrefix}`);
    return;
  }
  if (!promptText) {
    const tip = config.triggerPrefix ? `\u8BF7\u5728 ${config.triggerPrefix} \u540E\u9762\u8865\u5145\u8981\u4EA4\u7ED9 Codex \u7684\u5185\u5BB9\u3002` : "\u8BF7\u53D1\u9001\u8981\u4EA4\u7ED9 Codex \u7684\u5185\u5BB9\u3002";
    await client.sendText(fromUserId, tip, contextToken);
    recordOutboundConversation({
      userId: fromUserId,
      text: tip,
      contextToken
    });
    return;
  }
  if (config.deliveryMode === "queue") {
    const queued = enqueueWechatMessage({
      userId: fromUserId,
      contextToken,
      text: promptText,
      rawText: text,
      sourceMessageId: rawMessage.message_id ?? null,
      createTimeMs: rawMessage.create_time_ms ?? null
    });
    if (queued.duplicate) {
      console.log(`[skip] \u91CD\u590D\u6D88\u606F\u5DF2\u5728\u961F\u5217\u4E2D: ${queued.item.id}`);
      return;
    }
    console.log(`\u{1F9FE} \u5DF2\u5165\u961F ${queued.item.id}`);
    if (config.queueAckMode === "typing" || config.queueAckMode === "both") {
      await client.sendTyping(fromUserId, contextToken).catch(() => {
      });
    }
    if ((config.queueAckMode === "text" || config.queueAckMode === "both") && config.queueAckText) {
      await client.sendText(fromUserId, config.queueAckText, contextToken);
      recordOutboundConversation({
        userId: fromUserId,
        text: config.queueAckText,
        contextToken
      });
    }
    return;
  }
  client.sendTyping(fromUserId, contextToken).catch(() => {
  });
  const existingSession = config.multiTurn ? getCodexSession(fromUserId)?.sessionId : void 0;
  const result = await runCodexPrompt({
    prompt: promptText,
    userId: fromUserId,
    sessionId: existingSession,
    config
  });
  if (config.multiTurn && result.sessionId) {
    setCodexSession(fromUserId, result.sessionId);
  }
  const finalText = config.stripMarkdown ? stripMarkdown(result.text) : result.text;
  const reply = finalText || "Codex \u672C\u6B21\u6CA1\u6709\u8FD4\u56DE\u53EF\u53D1\u9001\u7684\u6587\u672C\u3002";
  const sent = await client.sendTextChunked(fromUserId, reply, contextToken);
  recordOutboundConversation({
    userId: fromUserId,
    text: reply,
    contextToken
  });
  console.log(`\u{1F4E4} \u5DF2\u56DE\u590D ${fromUserId}\uFF0C\u5171 ${sent} \u6761\u6D88\u606F`);
}
async function main() {
  const credentials = loadCredentials();
  if (!credentials) {
    throw new Error("\u672A\u627E\u5230\u5FAE\u4FE1\u767B\u5F55\u51ED\u8BC1\uFF0C\u8BF7\u5148\u6267\u884C npm run login");
  }
  const config = loadBridgeConfig();
  const client = new ILinkClient({
    baseUrl: credentials.baseUrl,
    token: credentials.botToken
  });
  client.cursor = loadCursor();
  console.log("=== weixin-codex-bot bridge ===");
  console.log(`\u5FAE\u4FE1\u8D26\u53F7: ${credentials.accountId}`);
  console.log(`\u5DE5\u4F5C\u76EE\u5F55: ${config.workspaceRoot}`);
  console.log(`Codex \u547D\u4EE4: ${config.codexBinary}`);
  console.log(`\u6A21\u578B: ${config.model || "(\u4F7F\u7528 codex \u9ED8\u8BA4\u914D\u7F6E)"}`);
  console.log(`\u591A\u8F6E\u4F1A\u8BDD: ${config.multiTurn ? "\u5F00\u542F" : "\u5173\u95ED"}`);
  console.log(`\u89E6\u53D1\u524D\u7F00: ${config.triggerPrefix || "(\u65E0\uFF0C\u6240\u6709\u6587\u672C\u6D88\u606F\u90FD\u4F1A\u89E6\u53D1)"}`);
  console.log(`\u767D\u540D\u5355\u7528\u6237: ${config.allowedUserIds.length > 0 ? config.allowedUserIds.join(", ") : "(\u672A\u9650\u5236)"}`);
  console.log(`\u6295\u9012\u6A21\u5F0F: ${config.deliveryMode}`);
  if (config.deliveryMode === "queue") {
    console.log(`\u5165\u961F\u786E\u8BA4\u6A21\u5F0F: ${config.queueAckMode}`);
    if (config.queueAckMode === "text" || config.queueAckMode === "both") {
      console.log(`\u5165\u961F\u786E\u8BA4\u6587\u672C: ${config.queueAckText || "(\u5173\u95ED)"}`);
    }
  }
  console.log("\u7B49\u5F85\u5FAE\u4FE1\u6D88\u606F\u4E2D...\n");
  process.on("SIGINT", () => {
    console.log("\n\u6536\u5230\u9000\u51FA\u4FE1\u53F7\uFF0Cbridge \u6B63\u5728\u5173\u95ED\u3002");
    process.exit(0);
  });
  while (true) {
    try {
      await flushWechatOutbox(client);
      const response = await client.poll();
      saveCursor(client.cursor);
      if (response.ret && response.ret !== 0 || response.errcode && response.errcode !== 0) {
        const errCode = response.errcode || response.ret;
        if (errCode === SESSION_EXPIRED_ERRCODE) {
          throw new Error("iLink \u4F1A\u8BDD\u53EF\u80FD\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u8FD0\u884C npm run login");
        }
        throw new Error(
          `getupdates returned ret=${response.ret ?? 0}, errcode=${response.errcode ?? 0}, errmsg=${response.errmsg ?? ""}`
        );
      }
      for (const message of response.msgs ?? []) {
        try {
          await handleInboundMessage(client, message);
        } catch (error) {
          const fromUserId = message.from_user_id;
          if (fromUserId && config.multiTurn) {
            clearCodexSession(fromUserId);
          }
          const contextToken = message.context_token || (fromUserId ? getContextToken(fromUserId) : void 0);
          if (fromUserId && contextToken) {
            const reason = error instanceof Error ? error.message : String(error);
            await client.sendText(
              fromUserId,
              `\u5904\u7406\u4F60\u7684\u6D88\u606F\u65F6\u51FA\u9519\uFF1A${reason}`,
              contextToken
            ).catch(() => {
            });
          }
          console.error("\u5904\u7406\u6D88\u606F\u5931\u8D25:", error);
        }
      }
      await flushWechatOutbox(client);
    } catch (error) {
      console.error("bridge \u8F6E\u8BE2\u5931\u8D25:", error instanceof Error ? error.message : String(error));
      await sleep(loadBridgeConfig().idleRetryMs);
    }
  }
}
main().catch((error) => {
  console.error("bridge \u542F\u52A8\u5931\u8D25:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
