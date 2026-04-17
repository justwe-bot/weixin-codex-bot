import crypto from "node:crypto";
import type {
  ClientOptions,
  GetConfigResp,
  GetUpdatesReq,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  SendMessageReq,
  SendTypingReq,
} from "./types.js";

const DEFAULT_CHANNEL_VERSION = "weixin-codex-bot/0.1.0";
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;

function buildUrl(baseUrl: string, endpoint: string): string {
  return new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function randomWechatUin(): string {
  const randomUInt32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(randomUInt32), "utf8").toString("base64");
}

function buildHeaders(token: string, body: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(body, "utf8")),
    "X-WECHAT-UIN": randomWechatUin(),
  };
}

async function post<T>(
  options: ClientOptions,
  endpoint: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const body = JSON.stringify({
    ...payload,
    base_info: {
      channel_version: options.channelVersion ?? DEFAULT_CHANNEL_VERSION,
    },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildUrl(options.baseUrl, endpoint), {
      method: "POST",
      headers: buildHeaders(options.token, body),
      body,
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${endpoint} ${response.status}: ${text}`);
    }

    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getUpdates(
  options: ClientOptions,
  request: GetUpdatesReq,
): Promise<GetUpdatesResp> {
  try {
    return await post<GetUpdatesResp>(
      options,
      "ilink/bot/getupdates",
      { get_updates_buf: request.get_updates_buf ?? "" },
      options.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ret: 0,
        msgs: [],
        get_updates_buf: request.get_updates_buf ?? "",
      };
    }

    throw error;
  }
}

export async function sendMessage(options: ClientOptions, request: SendMessageReq): Promise<void> {
  await post(
    options,
    "ilink/bot/sendmessage",
    request as unknown as Record<string, unknown>,
    options.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  );
}

export async function getConfig(
  options: ClientOptions,
  userId: string,
  contextToken?: string,
): Promise<GetConfigResp> {
  return post<GetConfigResp>(
    options,
    "ilink/bot/getconfig",
    {
      ilink_user_id: userId,
      context_token: contextToken,
    },
    options.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  );
}

export async function sendTyping(options: ClientOptions, request: SendTypingReq): Promise<void> {
  await post(
    options,
    "ilink/bot/sendtyping",
    request as unknown as Record<string, unknown>,
    options.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  );
}

export async function getUploadUrl(
  options: ClientOptions,
  request: GetUploadUrlReq,
): Promise<GetUploadUrlResp> {
  return post<GetUploadUrlResp>(
    options,
    "ilink/bot/getuploadurl",
    request as unknown as Record<string, unknown>,
    options.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  );
}
