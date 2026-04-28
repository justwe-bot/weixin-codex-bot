import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getStateDirectory } from "./state.js";

export type WechatOutboxStatus = "pending" | "sent";

export interface WechatOutboxItem {
  id: string;
  queueItemId: string;
  userId: string;
  contextToken: string;
  text: string;
  typing: boolean;
  queuedAt: string;
  status: WechatOutboxStatus;
  attempts: number;
  sentAt?: string;
  lastError?: string;
}

const OUTBOX_FILENAME = "message-outbox.json";

function getOutboxPath(): string {
  return path.join(getStateDirectory(), OUTBOX_FILENAME);
}

function loadOutbox(): WechatOutboxItem[] {
  try {
    return JSON.parse(fs.readFileSync(getOutboxPath(), "utf8")) as WechatOutboxItem[];
  } catch {
    return [];
  }
}

function saveOutbox(items: WechatOutboxItem[]): void {
  fs.mkdirSync(getStateDirectory(), { recursive: true });
  fs.writeFileSync(getOutboxPath(), JSON.stringify(items, null, 2), "utf8");
}

export function enqueueWechatOutboxReply(input: {
  queueItemId: string;
  userId: string;
  contextToken: string;
  text: string;
  typing: boolean;
}): { item: WechatOutboxItem; duplicate: boolean } {
  const items = loadOutbox();
  const duplicate = items.find((item) => item.queueItemId === input.queueItemId);
  if (duplicate) {
    return {
      item: duplicate,
      duplicate: true,
    };
  }

  const item: WechatOutboxItem = {
    id: crypto.randomUUID(),
    queueItemId: input.queueItemId,
    userId: input.userId,
    contextToken: input.contextToken,
    text: input.text,
    typing: input.typing,
    queuedAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
  };
  items.push(item);
  saveOutbox(items);

  return {
    item,
    duplicate: false,
  };
}

export function listPendingWechatOutboxItems(): WechatOutboxItem[] {
  return loadOutbox()
    .filter((item) => item.status === "pending")
    .sort((left, right) => Date.parse(left.queuedAt) - Date.parse(right.queuedAt));
}

export function markWechatOutboxItemSent(id: string): WechatOutboxItem {
  const items = loadOutbox();
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Outbox item not found: ${id}`);
  }

  item.status = "sent";
  item.sentAt = new Date().toISOString();
  item.lastError = undefined;
  saveOutbox(items);
  return item;
}

export function recordWechatOutboxFailure(id: string, error: string): WechatOutboxItem {
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
