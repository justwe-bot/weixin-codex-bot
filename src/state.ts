import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBoolean, parseList } from "./util/text.js";

export type CodexSandbox = "read-only" | "workspace-write" | "danger-full-access";
export type BridgeDeliveryMode = "exec" | "queue";
export type BridgeQueueAckMode = "none" | "typing" | "text" | "both";

export interface Credentials {
  botToken: string;
  accountId: string;
  baseUrl: string;
  userId?: string;
  savedAt: string;
}

export interface PendingLogin {
  qrcode: string;
  qrContent: string;
  baseUrl: string;
  refreshCount: number;
  createdAt: string;
}

export interface PendingSetup {
  bridgeConfig: StoredBridgeConfig;
  heartbeatIntervalMinutes: number;
  heartbeatName?: string;
  requestedAt: string;
}

export interface StoredBridgeConfig {
  codexBinary?: string;
  workspaceRoot?: string;
  model?: string;
  sandbox?: CodexSandbox;
  fullAuto?: boolean;
  dangerousBypass?: boolean;
  skipGitRepoCheck?: boolean;
  addDirs?: string[];
  multiTurn?: boolean;
  stripMarkdown?: boolean;
  systemPrompt?: string;
  idleRetryMs?: number;
  allowedUserIds?: string[];
  triggerPrefix?: string;
  deliveryMode?: BridgeDeliveryMode;
  queueAckMode?: BridgeQueueAckMode;
  queueAckText?: string;
}

export interface BridgeConfig {
  codexBinary: string;
  workspaceRoot: string;
  model?: string;
  sandbox: CodexSandbox;
  fullAuto: boolean;
  dangerousBypass: boolean;
  skipGitRepoCheck: boolean;
  addDirs: string[];
  multiTurn: boolean;
  stripMarkdown: boolean;
  systemPrompt: string;
  idleRetryMs: number;
  allowedUserIds: string[];
  triggerPrefix: string;
  deliveryMode: BridgeDeliveryMode;
  queueAckMode: BridgeQueueAckMode;
  queueAckText: string;
}

interface SessionState {
  sessionId: string;
  updatedAt: string;
}

export interface KnownConversation {
  userId: string;
  contextToken?: string;
  lastInboundText?: string;
  lastInboundAt?: string;
  lastOutboundText?: string;
  lastOutboundAt?: string;
  updatedAt: string;
}

const DEFAULT_STATE_DIR = path.join(os.homedir(), ".weixin-codex-bot");
const LOCAL_STATE_DIRNAME = ".codex-wechat-state";
const SHARED_STATE_DIR = path.join("/tmp", "weixin-codex-bot-state");

function findNearestLocalStateDir(startDir: string): string | null {
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

export function getLocalStateDirectory(baseDir = process.cwd()): string {
  return path.join(path.resolve(baseDir), LOCAL_STATE_DIRNAME);
}

export function getSharedStateDirectory(): string {
  return SHARED_STATE_DIR;
}

function stateDir(): string {
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

function ensureStateDir(): void {
  fs.mkdirSync(stateDir(), { recursive: true });
}

function resolvePath(filename: string): string {
  return path.join(stateDir(), filename);
}

function readJson<T>(filename: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(resolvePath(filename), "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filename: string, payload: unknown, mode?: number): void {
  ensureStateDir();
  const target = resolvePath(filename);
  fs.writeFileSync(target, JSON.stringify(payload, null, 2));
  if (mode != null) {
    fs.chmodSync(target, mode);
  }
}

export function getStateDirectory(): string {
  return stateDir();
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value == null || value === "") {
    return undefined;
  }

  return parseBoolean(value, false);
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveMaybePath(value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }

  return value.includes(path.sep) ? path.resolve(value) : value;
}

function normalizeStoredBridgeConfig(config: StoredBridgeConfig): StoredBridgeConfig {
  const normalized: StoredBridgeConfig = {};

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
        config.addDirs
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => path.resolve(item)),
      ),
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
        config.allowedUserIds
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }

  if (typeof config.triggerPrefix === "string") {
    normalized.triggerPrefix = config.triggerPrefix.trim();
  }

  if (config.deliveryMode === "exec" || config.deliveryMode === "queue") {
    normalized.deliveryMode = config.deliveryMode;
  }

  if (
    config.queueAckMode === "none" ||
    config.queueAckMode === "typing" ||
    config.queueAckMode === "text" ||
    config.queueAckMode === "both"
  ) {
    normalized.queueAckMode = config.queueAckMode;
  }

  if (typeof config.queueAckText === "string") {
    normalized.queueAckText = config.queueAckText.trim();
  }

  return normalized;
}

function normalizePendingSetup(setup: PendingSetup): PendingSetup {
  const heartbeatIntervalMinutes =
    Number.isInteger(setup.heartbeatIntervalMinutes) && setup.heartbeatIntervalMinutes > 0
      ? setup.heartbeatIntervalMinutes
      : 1;
  const heartbeatName = setup.heartbeatName?.trim() || undefined;

  return {
    bridgeConfig: normalizeStoredBridgeConfig(setup.bridgeConfig),
    heartbeatIntervalMinutes,
    heartbeatName,
    requestedAt: setup.requestedAt,
  };
}

export function saveCredentials(credentials: Omit<Credentials, "savedAt">): Credentials {
  const payload: Credentials = {
    ...credentials,
    savedAt: new Date().toISOString(),
  };

  writeJson("credentials.json", payload, 0o600);
  return payload;
}

export function loadCredentials(): Credentials | null {
  return readJson<Credentials | null>("credentials.json", null);
}

export function clearCredentials(): void {
  fs.rmSync(resolvePath("credentials.json"), { force: true });
}

export function savePendingLogin(pending: PendingLogin): void {
  writeJson("pending-login.json", pending, 0o600);
}

export function loadPendingLogin(): PendingLogin | null {
  return readJson<PendingLogin | null>("pending-login.json", null);
}

export function clearPendingLogin(): void {
  fs.rmSync(resolvePath("pending-login.json"), { force: true });
}

export function savePendingSetup(setup: PendingSetup): PendingSetup {
  const payload = normalizePendingSetup(setup);
  writeJson("pending-setup.json", payload, 0o600);
  return payload;
}

export function loadPendingSetup(): PendingSetup | null {
  const setup = readJson<PendingSetup | null>("pending-setup.json", null);
  return setup ? normalizePendingSetup(setup) : null;
}

export function clearPendingSetup(): void {
  fs.rmSync(resolvePath("pending-setup.json"), { force: true });
}

export function loadCursor(): string {
  try {
    return fs.readFileSync(resolvePath("sync-cursor.txt"), "utf8");
  } catch {
    return "";
  }
}

export function saveCursor(cursor: string): void {
  ensureStateDir();
  fs.writeFileSync(resolvePath("sync-cursor.txt"), cursor, "utf8");
}

export function clearCursor(): void {
  fs.rmSync(resolvePath("sync-cursor.txt"), { force: true });
}

function loadContextMap(): Record<string, string> {
  return readJson<Record<string, string>>("context-tokens.json", {});
}

function saveContextMap(tokens: Record<string, string>): void {
  writeJson("context-tokens.json", tokens, 0o600);
}

export function getContextToken(userId: string): string | undefined {
  return loadContextMap()[userId];
}

export function setContextToken(userId: string, token: string): void {
  const tokens = loadContextMap();
  tokens[userId] = token;
  saveContextMap(tokens);
}

export function clearContextTokens(): void {
  fs.rmSync(resolvePath("context-tokens.json"), { force: true });
}

function loadSessionMap(): Record<string, SessionState> {
  return readJson<Record<string, SessionState>>("codex-sessions.json", {});
}

function saveSessionMap(payload: Record<string, SessionState>): void {
  writeJson("codex-sessions.json", payload, 0o600);
}

export function getCodexSession(userId: string): SessionState | undefined {
  return loadSessionMap()[userId];
}

export function setCodexSession(userId: string, sessionId: string): void {
  const sessions = loadSessionMap();
  sessions[userId] = {
    sessionId,
    updatedAt: new Date().toISOString(),
  };
  saveSessionMap(sessions);
}

export function clearCodexSession(userId: string): void {
  const sessions = loadSessionMap();
  delete sessions[userId];
  saveSessionMap(sessions);
}

export function clearAllCodexSessions(): void {
  fs.rmSync(resolvePath("codex-sessions.json"), { force: true });
}

export function loadStoredBridgeConfig(): StoredBridgeConfig {
  return normalizeStoredBridgeConfig(readJson<StoredBridgeConfig>("bridge-config.json", {}));
}

export function saveStoredBridgeConfig(config: StoredBridgeConfig): StoredBridgeConfig {
  const payload = normalizeStoredBridgeConfig(config);
  writeJson("bridge-config.json", payload, 0o600);
  return payload;
}

export function clearStoredBridgeConfig(): void {
  fs.rmSync(resolvePath("bridge-config.json"), { force: true });
}

export function loadBridgeConfig(): BridgeConfig {
  const stored = loadStoredBridgeConfig();
  const workspaceRoot = process.env.CODEX_WORKSPACE
    ? path.resolve(process.env.CODEX_WORKSPACE)
    : stored.workspaceRoot || process.cwd();
  const dangerousBypass =
    parseOptionalBoolean(process.env.CODEX_DANGEROUS_BYPASS) ?? stored.dangerousBypass ?? false;
  const sandbox = ((process.env.CODEX_SANDBOX as CodexSandbox | undefined) ?? stored.sandbox ?? "workspace-write");
  const fullAuto = (parseOptionalBoolean(process.env.CODEX_FULL_AUTO) ?? stored.fullAuto ?? true) && !dangerousBypass;
  const idleRetryMs = parseOptionalInteger(process.env.BRIDGE_IDLE_RETRY_MS) ?? stored.idleRetryMs ?? 30000;
  const addDirs = process.env.CODEX_ADD_DIRS
    ? parseList(process.env.CODEX_ADD_DIRS).map((item) => path.resolve(item))
    : stored.addDirs ?? [];
  const allowedUserIds = process.env.BRIDGE_ALLOWED_USER_IDS
    ? parseList(process.env.BRIDGE_ALLOWED_USER_IDS)
    : stored.allowedUserIds ?? [];

  return {
    codexBinary: process.env.CODEX_BINARY || stored.codexBinary || "codex",
    workspaceRoot,
    model: process.env.CODEX_MODEL || stored.model || undefined,
    sandbox,
    fullAuto,
    dangerousBypass,
    skipGitRepoCheck:
      parseOptionalBoolean(process.env.CODEX_SKIP_GIT_REPO_CHECK) ?? stored.skipGitRepoCheck ?? true,
    addDirs,
    multiTurn: parseOptionalBoolean(process.env.BRIDGE_MULTI_TURN) ?? stored.multiTurn ?? true,
    stripMarkdown: parseOptionalBoolean(process.env.BRIDGE_STRIP_MARKDOWN) ?? stored.stripMarkdown ?? true,
    systemPrompt:
      process.env.BRIDGE_SYSTEM_PROMPT ||
      stored.systemPrompt ||
      "你正在通过微信与用户协作。优先直接完成任务，回复使用适合微信的纯文本，不要输出 Markdown 表格。",
    idleRetryMs,
    allowedUserIds,
    triggerPrefix: process.env.BRIDGE_TRIGGER_PREFIX ?? stored.triggerPrefix ?? "",
    deliveryMode: (process.env.BRIDGE_DELIVERY_MODE as BridgeDeliveryMode | undefined) ?? stored.deliveryMode ?? "exec",
    queueAckMode:
      (process.env.BRIDGE_QUEUE_ACK_MODE as BridgeQueueAckMode | undefined) ?? stored.queueAckMode ?? "typing",
    queueAckText: process.env.BRIDGE_QUEUE_ACK_TEXT ?? stored.queueAckText ?? "",
  };
}

function loadConversationMap(): Record<string, KnownConversation> {
  return readJson<Record<string, KnownConversation>>("known-conversations.json", {});
}

function saveConversationMap(payload: Record<string, KnownConversation>): void {
  writeJson("known-conversations.json", payload, 0o600);
}

function upsertConversation(userId: string, patch: Partial<KnownConversation>): KnownConversation {
  const now = new Date().toISOString();
  const conversations = loadConversationMap();
  const existing = conversations[userId] ?? {
    userId,
    updatedAt: now,
  };
  const next: KnownConversation = {
    ...existing,
    ...patch,
    userId,
    updatedAt: now,
  };
  conversations[userId] = next;
  saveConversationMap(conversations);
  return next;
}

export function recordInboundConversation(input: {
  userId: string;
  text?: string;
  contextToken?: string;
  createTimeMs?: number | null;
}): KnownConversation {
  const patch: Partial<KnownConversation> = {};
  if (input.contextToken) {
    patch.contextToken = input.contextToken;
  }
  if (input.text) {
    patch.lastInboundText = input.text;
  }
  if (input.createTimeMs && Number.isFinite(input.createTimeMs)) {
    patch.lastInboundAt = new Date(input.createTimeMs).toISOString();
  } else {
    patch.lastInboundAt = new Date().toISOString();
  }
  return upsertConversation(input.userId, patch);
}

export function recordOutboundConversation(input: {
  userId: string;
  text?: string;
  contextToken?: string;
}): KnownConversation {
  const patch: Partial<KnownConversation> = {
    lastOutboundAt: new Date().toISOString(),
  };
  if (input.contextToken) {
    patch.contextToken = input.contextToken;
  }
  if (input.text) {
    patch.lastOutboundText = input.text;
  }
  return upsertConversation(input.userId, patch);
}

export function listKnownConversations(limit?: number): KnownConversation[] {
  const conversations = Object.values(loadConversationMap()).sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.lastInboundAt || left.lastOutboundAt || "");
    const rightTime = Date.parse(right.updatedAt || right.lastInboundAt || right.lastOutboundAt || "");
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });

  return typeof limit === "number" ? conversations.slice(0, limit) : conversations;
}

export function clearKnownConversations(): void {
  fs.rmSync(resolvePath("known-conversations.json"), { force: true });
}

export function clearAllState(): void {
  clearPendingLogin();
  clearPendingSetup();
  clearCredentials();
  clearCursor();
  clearContextTokens();
  clearAllCodexSessions();
  clearKnownConversations();
}
