import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBoolean, parseList } from "./util/text.js";

export type CodexSandbox = "read-only" | "workspace-write" | "danger-full-access";

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
}

interface SessionState {
  sessionId: string;
  updatedAt: string;
}

const DEFAULT_STATE_DIR = path.join(os.homedir(), ".weixin-codex-bot");

function stateDir(): string {
  return process.env.WEIXIN_CODEX_BOT_HOME
    ? path.resolve(process.env.WEIXIN_CODEX_BOT_HOME)
    : DEFAULT_STATE_DIR;
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

export function loadBridgeConfig(): BridgeConfig {
  const workspaceRoot = process.env.CODEX_WORKSPACE
    ? path.resolve(process.env.CODEX_WORKSPACE)
    : process.cwd();

  const dangerousBypass = parseBoolean(process.env.CODEX_DANGEROUS_BYPASS, false);
  const sandbox = (process.env.CODEX_SANDBOX ?? "workspace-write") as CodexSandbox;

  return {
    codexBinary: process.env.CODEX_BINARY || "codex",
    workspaceRoot,
    model: process.env.CODEX_MODEL || undefined,
    sandbox,
    fullAuto: parseBoolean(process.env.CODEX_FULL_AUTO, true) && !dangerousBypass,
    dangerousBypass,
    skipGitRepoCheck: parseBoolean(process.env.CODEX_SKIP_GIT_REPO_CHECK, true),
    addDirs: parseList(process.env.CODEX_ADD_DIRS),
    multiTurn: parseBoolean(process.env.BRIDGE_MULTI_TURN, true),
    stripMarkdown: parseBoolean(process.env.BRIDGE_STRIP_MARKDOWN, true),
    systemPrompt:
      process.env.BRIDGE_SYSTEM_PROMPT ||
      "你正在通过微信与用户协作。优先直接完成任务，回复使用适合微信的纯文本，不要输出 Markdown 表格。",
    idleRetryMs: Number.parseInt(process.env.BRIDGE_IDLE_RETRY_MS || "30000", 10),
  };
}

export function clearAllState(): void {
  clearPendingLogin();
  clearCredentials();
  clearCursor();
  clearContextTokens();
  clearAllCodexSessions();
}
