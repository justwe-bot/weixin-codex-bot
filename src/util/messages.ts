import type { MessageItem, WeixinMessage } from "../ilink/types.js";
import { MessageItemType, MessageType } from "../ilink/types.js";

export interface NormalizedInboundMessage {
  messageId: number | null;
  fromUserId: string | null;
  toUserId: string | null;
  contextToken: string | null;
  text: string;
  createTimeMs: number | null;
  messageType: number | null;
  messageState: number | null;
  itemTypes: number[];
}

function extractItemText(item: MessageItem): string {
  if (item.type === MessageItemType.TEXT && item.text_item?.text) {
    const quoted = item.ref_msg?.title ? `[引用: ${item.ref_msg.title}]\n` : "";
    return `${quoted}${item.text_item.text}`.trim();
  }

  if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
    return item.voice_item.text.trim();
  }

  return "";
}

export function extractInboundText(message: WeixinMessage): string {
  for (const item of message.item_list ?? []) {
    const text = extractItemText(item);
    if (text) {
      return text;
    }
  }

  return "";
}

export function isInboundUserMessage(message: WeixinMessage): boolean {
  return message.message_type === MessageType.USER;
}

export function normalizeInboundMessage(message: WeixinMessage): NormalizedInboundMessage {
  return {
    messageId: message.message_id ?? null,
    fromUserId: message.from_user_id ?? null,
    toUserId: message.to_user_id ?? null,
    contextToken: message.context_token ?? null,
    text: extractInboundText(message),
    createTimeMs: message.create_time_ms ?? null,
    messageType: message.message_type ?? null,
    messageState: message.message_state ?? null,
    itemTypes: (message.item_list ?? []).map((item) => item.type ?? 0),
  };
}
