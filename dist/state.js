import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBoolean, parseList } from "./util/text.js";
const DEFAULT_STATE_DIR = path.join(os.homedir(), ".weixin-codex-bot");
function stateDir() {
    return process.env.WEIXIN_CODEX_BOT_HOME
        ? path.resolve(process.env.WEIXIN_CODEX_BOT_HOME)
        : DEFAULT_STATE_DIR;
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
    }
    catch {
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
export function getStateDirectory() {
    return stateDir();
}
export function saveCredentials(credentials) {
    const payload = {
        ...credentials,
        savedAt: new Date().toISOString(),
    };
    writeJson("credentials.json", payload, 0o600);
    return payload;
}
export function loadCredentials() {
    return readJson("credentials.json", null);
}
export function clearCredentials() {
    fs.rmSync(resolvePath("credentials.json"), { force: true });
}
export function savePendingLogin(pending) {
    writeJson("pending-login.json", pending, 0o600);
}
export function loadPendingLogin() {
    return readJson("pending-login.json", null);
}
export function clearPendingLogin() {
    fs.rmSync(resolvePath("pending-login.json"), { force: true });
}
export function loadCursor() {
    try {
        return fs.readFileSync(resolvePath("sync-cursor.txt"), "utf8");
    }
    catch {
        return "";
    }
}
export function saveCursor(cursor) {
    ensureStateDir();
    fs.writeFileSync(resolvePath("sync-cursor.txt"), cursor, "utf8");
}
export function clearCursor() {
    fs.rmSync(resolvePath("sync-cursor.txt"), { force: true });
}
function loadContextMap() {
    return readJson("context-tokens.json", {});
}
function saveContextMap(tokens) {
    writeJson("context-tokens.json", tokens, 0o600);
}
export function getContextToken(userId) {
    return loadContextMap()[userId];
}
export function setContextToken(userId, token) {
    const tokens = loadContextMap();
    tokens[userId] = token;
    saveContextMap(tokens);
}
export function clearContextTokens() {
    fs.rmSync(resolvePath("context-tokens.json"), { force: true });
}
function loadSessionMap() {
    return readJson("codex-sessions.json", {});
}
function saveSessionMap(payload) {
    writeJson("codex-sessions.json", payload, 0o600);
}
export function getCodexSession(userId) {
    return loadSessionMap()[userId];
}
export function setCodexSession(userId, sessionId) {
    const sessions = loadSessionMap();
    sessions[userId] = {
        sessionId,
        updatedAt: new Date().toISOString(),
    };
    saveSessionMap(sessions);
}
export function clearCodexSession(userId) {
    const sessions = loadSessionMap();
    delete sessions[userId];
    saveSessionMap(sessions);
}
export function clearAllCodexSessions() {
    fs.rmSync(resolvePath("codex-sessions.json"), { force: true });
}
export function loadBridgeConfig() {
    const workspaceRoot = process.env.CODEX_WORKSPACE
        ? path.resolve(process.env.CODEX_WORKSPACE)
        : process.cwd();
    const dangerousBypass = parseBoolean(process.env.CODEX_DANGEROUS_BYPASS, false);
    const sandbox = (process.env.CODEX_SANDBOX ?? "workspace-write");
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
        systemPrompt: process.env.BRIDGE_SYSTEM_PROMPT ||
            "你正在通过微信与用户协作。优先直接完成任务，回复使用适合微信的纯文本，不要输出 Markdown 表格。",
        idleRetryMs: Number.parseInt(process.env.BRIDGE_IDLE_RETRY_MS || "30000", 10),
    };
}
export function clearAllState() {
    clearPendingLogin();
    clearCredentials();
    clearCursor();
    clearContextTokens();
    clearAllCodexSessions();
}
