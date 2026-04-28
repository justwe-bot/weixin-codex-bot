import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getStateDirectory } from "./state.js";

export type WechatQueueStatus = "pending" | "claimed" | "replied";

export interface WechatQueueItem {
  id: string;
  userId: string;
  contextToken: string;
  text: string;
  rawText: string;
  sourceMessageId: number | null;
  createTimeMs: number | null;
  queuedAt: string;
  status: WechatQueueStatus;
  attempts: number;
  claimedAt?: string;
  claimedBy?: string;
  repliedAt?: string;
  replyText?: string;
}

const QUEUE_FILENAME = "message-queue.json";
const CLAIM_TTL_MS = 10 * 60 * 1000;

function getQueuePath(): string {
  return path.join(getStateDirectory(), QUEUE_FILENAME);
}

function loadQueue(): WechatQueueItem[] {
  try {
    return JSON.parse(fs.readFileSync(getQueuePath(), "utf8")) as WechatQueueItem[];
  } catch {
    return [];
  }
}

function saveQueue(items: WechatQueueItem[]): void {
  fs.mkdirSync(getStateDirectory(), { recursive: true });
  fs.writeFileSync(getQueuePath(), JSON.stringify(items, null, 2), "utf8");
}

function findDuplicate(items: WechatQueueItem[], userId: string, sourceMessageId: number | null): WechatQueueItem | undefined {
  if (sourceMessageId == null) {
    return undefined;
  }

  return items.find((item) => item.userId === userId && item.sourceMessageId === sourceMessageId);
}

function isClaimExpired(item: WechatQueueItem, now = Date.now()): boolean {
  if (item.status !== "claimed" || !item.claimedAt) {
    return false;
  }

  const claimedAtMs = Date.parse(item.claimedAt);
  return Number.isFinite(claimedAtMs) && now - claimedAtMs > CLAIM_TTL_MS;
}

export function enqueueWechatMessage(input: {
  userId: string;
  contextToken: string;
  text: string;
  rawText: string;
  sourceMessageId: number | null;
  createTimeMs: number | null;
}): { item: WechatQueueItem; duplicate: boolean } {
  const items = loadQueue();
  const duplicate = findDuplicate(items, input.userId, input.sourceMessageId);
  if (duplicate) {
    return {
      item: duplicate,
      duplicate: true,
    };
  }

  const item: WechatQueueItem = {
    id: crypto.randomUUID(),
    userId: input.userId,
    contextToken: input.contextToken,
    text: input.text,
    rawText: input.rawText,
    sourceMessageId: input.sourceMessageId,
    createTimeMs: input.createTimeMs,
    queuedAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
  };
  items.push(item);
  saveQueue(items);
  return {
    item,
    duplicate: false,
  };
}

export function listWechatQueueItems(): WechatQueueItem[] {
  return loadQueue().sort((left, right) => {
    const leftTime = left.createTimeMs ?? Date.parse(left.queuedAt);
    const rightTime = right.createTimeMs ?? Date.parse(right.queuedAt);
    return leftTime - rightTime;
  });
}

export function claimNextWechatQueueItem(claimedBy: string): WechatQueueItem | null {
  const now = new Date().toISOString();
  const items = listWechatQueueItems();
  const candidate = items.find((item) => item.status === "pending" || isClaimExpired(item));
  if (!candidate) {
    return null;
  }

  candidate.status = "claimed";
  candidate.claimedAt = now;
  candidate.claimedBy = claimedBy;
  candidate.attempts += 1;
  saveQueue(items);
  return candidate;
}

export function markWechatQueueItemReplied(id: string, replyText: string): WechatQueueItem {
  const items = loadQueue();
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Queue item not found: ${id}`);
  }

  item.status = "replied";
  item.repliedAt = new Date().toISOString();
  item.replyText = replyText;
  saveQueue(items);
  return item;
}

export function getWechatQueueItem(id: string): WechatQueueItem | undefined {
  return loadQueue().find((item) => item.id === id);
}

export function getWechatQueueSummary(): {
  path: string;
  total: number;
  pending: number;
  claimed: number;
  replied: number;
  oldestPending: WechatQueueItem | null;
} {
  const items = listWechatQueueItems();
  return {
    path: getQueuePath(),
    total: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    claimed: items.filter((item) => item.status === "claimed").length,
    replied: items.filter((item) => item.status === "replied").length,
    oldestPending: items.find((item) => item.status === "pending") ?? null,
  };
}
