import type { LoginResult, QRCodeResponse, QRStatusResponse } from "./types.js";

export const DEFAULT_ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const QR_POLL_TIMEOUT_MS = 35_000;

function buildUrl(baseUrl: string, endpoint: string): string {
  return new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

export async function startQrLogin(baseUrl = DEFAULT_ILINK_BASE_URL): Promise<QRCodeResponse> {
  const response = await fetch(buildUrl(baseUrl, "ilink/bot/get_bot_qrcode?bot_type=3"));
  if (!response.ok) {
    throw new Error(`Failed to fetch QR code: ${response.status}`);
  }

  return (await response.json()) as QRCodeResponse;
}

export async function checkQrLogin(baseUrl: string, qrcode: string): Promise<QRStatusResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QR_POLL_TIMEOUT_MS);

  try {
    const response = await fetch(
      buildUrl(baseUrl, `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`),
      {
        headers: {
          "iLink-App-ClientVersion": "1",
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`QR status poll failed: ${response.status}`);
    }

    return (await response.json()) as QRStatusResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "wait" };
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function toLoginResult(status: QRStatusResponse, fallbackBaseUrl: string): LoginResult {
  if (!status.bot_token || !status.ilink_bot_id) {
    throw new Error("Login confirmed but required credentials are missing");
  }

  return {
    botToken: status.bot_token,
    accountId: status.ilink_bot_id,
    baseUrl: status.baseurl || fallbackBaseUrl,
    userId: status.ilink_user_id,
  };
}
