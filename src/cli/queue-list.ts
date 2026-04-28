import { getWechatQueueSummary, listWechatQueueItems } from "../queue.js";

async function main(): Promise<void> {
  process.stdout.write(
    `${JSON.stringify(
      {
        summary: getWechatQueueSummary(),
        items: listWechatQueueItems(),
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
