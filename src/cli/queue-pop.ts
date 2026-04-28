import { claimNextWechatQueueItem } from "../queue.js";

function parseClaimedBy(argv: string[]): string {
  const index = argv.indexOf("--claimed-by");
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value) {
      throw new Error("--claimed-by requires a value");
    }
    return value;
  }

  return "desktop-heartbeat";
}

async function main(): Promise<void> {
  const claimedBy = parseClaimedBy(process.argv.slice(2));
  const item = claimNextWechatQueueItem(claimedBy);
  process.stdout.write(`${JSON.stringify({ item }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
