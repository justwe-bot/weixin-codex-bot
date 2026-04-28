import {
  listPendingWechatOutboxItems,
  markWechatOutboxItemSent,
  recordWechatOutboxFailure,
} from "../outbox.js";
import { runCodexPrompt } from "../codex/runner.js";
import { ILinkClient } from "../ilink/client.js";
import { MessageType } from "../ilink/types.js";
import { enqueueWechatMessage } from "../queue.js";
import {
  clearCodexSession,
  getCodexSession,
  getContextToken,
  loadBridgeConfig,
  loadCredentials,
  loadCursor,
  recordInboundConversation,
  recordOutboundConversation,
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

function extractPromptText(text: string, triggerPrefix: string): string | null {
  const trimmed = text.trim();
  if (!triggerPrefix) {
    return trimmed;
  }

  if (!trimmed.startsWith(triggerPrefix)) {
    return null;
  }

  return trimmed.slice(triggerPrefix.length).trim();
}

async function flushWechatOutbox(client: ILinkClient): Promise<void> {
  const items = listPendingWechatOutboxItems();
  for (const item of items) {
    try {
      if (item.typing) {
        await client.sendTyping(item.userId, item.contextToken).catch(() => {});
      }

      const chunks = await client.sendTextChunked(item.userId, item.text, item.contextToken);
      markWechatOutboxItemSent(item.id);
      recordOutboundConversation({
        userId: item.userId,
        text: item.text,
        contextToken: item.contextToken,
      });
      console.log(`📤 已发送队列回复 ${item.queueItemId}，共 ${chunks} 条消息`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      recordWechatOutboxFailure(item.id, reason);
      console.error(`发送队列回复失败 ${item.queueItemId}:`, reason);
    }
  }
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
  recordInboundConversation({
    userId: fromUserId,
    text,
    contextToken,
    createTimeMs: rawMessage.create_time_ms ?? null,
  });
  console.log(`\n📩 ${fromUserId}: ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`);

  if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(fromUserId)) {
    console.log(`[skip] ${fromUserId} 不在 bridge 白名单内`);
    return;
  }

  if (config.multiTurn && RESET_COMMANDS.has(text.trim())) {
    clearCodexSession(fromUserId);
    await client.sendText(fromUserId, "已为你重置 Codex 会话。", contextToken);
    recordOutboundConversation({
      userId: fromUserId,
      text: "已为你重置 Codex 会话。",
      contextToken,
    });
    return;
  }

  const promptText = extractPromptText(text, config.triggerPrefix);
  if (promptText == null) {
    console.log(`[skip] ${fromUserId} 的消息未命中触发前缀 ${config.triggerPrefix}`);
    return;
  }

  if (!promptText) {
    const tip = config.triggerPrefix
      ? `请在 ${config.triggerPrefix} 后面补充要交给 Codex 的内容。`
      : "请发送要交给 Codex 的内容。";
    await client.sendText(fromUserId, tip, contextToken);
    recordOutboundConversation({
      userId: fromUserId,
      text: tip,
      contextToken,
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
      createTimeMs: rawMessage.create_time_ms ?? null,
    });
    if (queued.duplicate) {
      console.log(`[skip] 重复消息已在队列中: ${queued.item.id}`);
      return;
    }

    console.log(`🧾 已入队 ${queued.item.id}`);
    if (config.queueAckMode === "typing" || config.queueAckMode === "both") {
      await client.sendTyping(fromUserId, contextToken).catch(() => {});
    }
    if ((config.queueAckMode === "text" || config.queueAckMode === "both") && config.queueAckText) {
      await client.sendText(fromUserId, config.queueAckText, contextToken);
      recordOutboundConversation({
        userId: fromUserId,
        text: config.queueAckText,
        contextToken,
      });
    }
    return;
  }

  client.sendTyping(fromUserId, contextToken).catch(() => {});

  const existingSession = config.multiTurn ? getCodexSession(fromUserId)?.sessionId : undefined;
  const result = await runCodexPrompt({
    prompt: promptText,
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
  recordOutboundConversation({
    userId: fromUserId,
    text: reply,
    contextToken,
  });
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
  console.log(`触发前缀: ${config.triggerPrefix || "(无，所有文本消息都会触发)"}`);
  console.log(`白名单用户: ${config.allowedUserIds.length > 0 ? config.allowedUserIds.join(", ") : "(未限制)"}`);
  console.log(`投递模式: ${config.deliveryMode}`);
  if (config.deliveryMode === "queue") {
    console.log(`入队确认模式: ${config.queueAckMode}`);
    if (config.queueAckMode === "text" || config.queueAckMode === "both") {
      console.log(`入队确认文本: ${config.queueAckText || "(关闭)"}`);
    }
  }
  console.log("等待微信消息中...\n");

  process.on("SIGINT", () => {
    console.log("\n收到退出信号，bridge 正在关闭。");
    process.exit(0);
  });

  while (true) {
    try {
      await flushWechatOutbox(client);
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
      await flushWechatOutbox(client);
    } catch (error) {
      console.error("bridge 轮询失败:", error instanceof Error ? error.message : String(error));
      await sleep(loadBridgeConfig().idleRetryMs);
    }
  }
}

main().catch((error) => {
  console.error("bridge 启动失败:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
