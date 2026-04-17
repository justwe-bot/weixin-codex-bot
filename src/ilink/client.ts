import crypto from "node:crypto";
import * as api from "./api.js";
import type {
  ClientOptions,
  GetConfigResp,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  MessageItem,
  WeixinMessage,
} from "./types.js";
import { MessageItemType, MessageState, MessageType, TypingStatus } from "./types.js";
import { chunkText } from "../util/text.js";

export class ILinkClient {
  private readonly options: ClientOptions;
  private syncCursor = "";

  constructor(options: ClientOptions) {
    this.options = options;
  }

  set cursor(value: string) {
    this.syncCursor = value;
  }

  get cursor(): string {
    return this.syncCursor;
  }

  async poll(): Promise<GetUpdatesResp> {
    const response = await api.getUpdates(this.options, { get_updates_buf: this.syncCursor });
    if (response.get_updates_buf) {
      this.syncCursor = response.get_updates_buf;
    }

    return response;
  }

  async sendText(toUserId: string, text: string, contextToken: string): Promise<void> {
    const message: WeixinMessage = {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: this.generateClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text },
        },
      ],
    };

    await api.sendMessage(this.options, { msg: message });
  }

  async sendTextChunked(
    toUserId: string,
    text: string,
    contextToken: string,
    maxLength = 3500,
  ): Promise<number> {
    const chunks = chunkText(text, maxLength);
    for (const chunk of chunks) {
      await this.sendText(toUserId, chunk, contextToken);
    }

    return chunks.length;
  }

  async sendMedia(toUserId: string, item: MessageItem, contextToken: string): Promise<void> {
    const message: WeixinMessage = {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: this.generateClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: [item],
    };

    await api.sendMessage(this.options, { msg: message });
  }

  async getConfig(userId: string, contextToken?: string): Promise<GetConfigResp> {
    return api.getConfig(this.options, userId, contextToken);
  }

  async sendTyping(userId: string, contextToken?: string): Promise<void> {
    const config = await this.getConfig(userId, contextToken);
    if (!config.typing_ticket) {
      return;
    }

    await api.sendTyping(this.options, {
      ilink_user_id: userId,
      typing_ticket: config.typing_ticket,
      status: TypingStatus.TYPING,
    });
  }

  async getUploadUrl(request: GetUploadUrlReq): Promise<GetUploadUrlResp> {
    return api.getUploadUrl(this.options, request);
  }

  private generateClientId(): string {
    return `weixin-codex-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  }
}
