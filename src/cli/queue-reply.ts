import fs from "node:fs";
import path from "node:path";
import { enqueueWechatOutboxReply } from "../outbox.js";
import { getWechatQueueItem, markWechatQueueItemReplied } from "../queue.js";

interface QueueReplyArgs {
  id: string;
  text: string;
  typing: boolean;
}

function parseArgs(argv: string[]): QueueReplyArgs {
  let id = "";
  let text = "";
  let typing = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--id") {
      id = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (token === "--text") {
      text = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (token === "--text-file") {
      const filePath = argv[index + 1];
      if (!filePath) {
        throw new Error("--text-file requires a value");
      }
      text = fs.readFileSync(path.resolve(filePath), "utf8");
      index += 1;
      continue;
    }

    if (token === "--typing") {
      typing = true;
    }
  }

  if (!id) {
    throw new Error("--id is required");
  }

  if (!text.trim()) {
    throw new Error("Reply text is required. Use --text or --text-file.");
  }

  return {
    id,
    text: text.trim(),
    typing,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const item = getWechatQueueItem(args.id);
  if (!item) {
    throw new Error(`Queue item not found: ${args.id}`);
  }
  const outbox = enqueueWechatOutboxReply({
    queueItemId: item.id,
    userId: item.userId,
    contextToken: item.contextToken,
    text: args.text,
    typing: args.typing,
  });
  markWechatQueueItemReplied(item.id, args.text);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        id: item.id,
        userId: item.userId,
        outboxId: outbox.item.id,
        duplicate: outbox.duplicate,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
