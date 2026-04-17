import { runCodexPrompt } from "../codex/runner.js";
import { ILinkClient } from "../ilink/client.js";
import { MessageType } from "../ilink/types.js";
import {
  clearCodexSession,
  getCodexSession,
  getContextToken,
  loadBridgeConfig,
  loadCredentials,
  loadCursor,
  saveCursor,
  setCodexSession,
  setContextToken,
} from "../state.js";
import { extractInboundText } from "../util/messages.js";
import { stripMarkdown } from "../util/text.js";

const RESET_COMMANDS = new Set(["/reset", "/clear", "新对话"]);
const SESSION_EXPIRED_ERRCODE = -14;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleInboundMessage(client: ILinkClient, rawMessage: Parameters<typeof extractInboundText>[0]) {
  if (rawMessage.message_type !== MessageType.USER) {
    return;
  }

  const fromUserId = rawMessage.from_user_id;
  if (!fromUserId) {
    return;
  }

  const text = extractInboundText(rawMessage);
  if (!text) {
    console.log(`[skip] 非文本消息 from ${fromUserId}`);
    return;
  }

  if (rawMessage.context_token) {
    setContextToken(fromUserId, rawMessage.context_token);
  }

  const contextToken = rawMessage.context_token || getContextToken(fromUserId);
  if (!contextToken) {
    console.log(`[skip] 缺少 context_token for ${fromUserId}`);
    return;
  }

  const config = loadBridgeConfig();
  console.log(`\n📩 ${fromUserId}: ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`);

  if (config.multiTurn && RESET_COMMANDS.has(text.trim())) {
    clearCodexSession(fromUserId);
    await client.sendText(fromUserId, "已为你重置 Codex 会话。", contextToken);
    return;
  }

  client.sendTyping(fromUserId, contextToken).catch(() => {});

  const existingSession = config.multiTurn ? getCodexSession(fromUserId)?.sessionId : undefined;
  const result = await runCodexPrompt({
    prompt: text,
    userId: fromUserId,
    sessionId: existingSession,
    config,
  });

  if (config.multiTurn && result.sessionId) {
    setCodexSession(fromUserId, result.sessionId);
  }

  const finalText = config.stripMarkdown ? stripMarkdown(result.text) : result.text;
  const reply = finalText || "Codex 本次没有返回可发送的文本。";
  const sent = await client.sendTextChunked(fromUserId, reply, contextToken);
  console.log(`📤 已回复 ${fromUserId}，共 ${sent} 条消息`);
}

async function main(): Promise<void> {
  const credentials = loadCredentials();
  if (!credentials) {
    throw new Error("未找到微信登录凭证，请先执行 npm run login");
  }

  const config = loadBridgeConfig();
  const client = new ILinkClient({
    baseUrl: credentials.baseUrl,
    token: credentials.botToken,
  });
  client.cursor = loadCursor();

  console.log("=== weixin-codex-bot bridge ===");
  console.log(`微信账号: ${credentials.accountId}`);
  console.log(`工作目录: ${config.workspaceRoot}`);
  console.log(`Codex 命令: ${config.codexBinary}`);
  console.log(`模型: ${config.model || "(使用 codex 默认配置)"}`);
  console.log(`多轮会话: ${config.multiTurn ? "开启" : "关闭"}`);
  console.log("等待微信消息中...\n");

  process.on("SIGINT", () => {
    console.log("\n收到退出信号，bridge 正在关闭。");
    process.exit(0);
  });

  while (true) {
    try {
      const response = await client.poll();
      saveCursor(client.cursor);

      if ((response.ret && response.ret !== 0) || (response.errcode && response.errcode !== 0)) {
        const errCode = response.errcode || response.ret;
        if (errCode === SESSION_EXPIRED_ERRCODE) {
          throw new Error("iLink 会话可能已过期，请重新运行 npm run login");
        }

        throw new Error(
          `getupdates returned ret=${response.ret ?? 0}, errcode=${response.errcode ?? 0}, errmsg=${response.errmsg ?? ""}`,
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

          const contextToken = message.context_token || (fromUserId ? getContextToken(fromUserId) : undefined);
          if (fromUserId && contextToken) {
            const reason = error instanceof Error ? error.message : String(error);
            await client.sendText(
              fromUserId,
              `处理你的消息时出错：${reason}`,
              contextToken,
            ).catch(() => {});
          }

          console.error("处理消息失败:", error);
        }
      }
    } catch (error) {
      console.error("bridge 轮询失败:", error instanceof Error ? error.message : String(error));
      await sleep(config.idleRetryMs);
    }
  }
}

main().catch((error) => {
  console.error("bridge 启动失败:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
