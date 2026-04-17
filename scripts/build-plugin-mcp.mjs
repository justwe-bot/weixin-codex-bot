import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const entry = path.join(repoRoot, "src/mcp/server.ts");
const outputs = [
  path.join(repoRoot, "dist/mcp/server.js"),
  path.join(repoRoot, "plugins/weixin-codex-bot/dist/mcp/server.js"),
];

for (const outfile of outputs) {
  await mkdir(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: false,
    legalComments: "none",
  });
}
