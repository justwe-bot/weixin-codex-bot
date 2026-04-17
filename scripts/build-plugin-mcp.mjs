import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/weixin-codex-bot");

const entry = path.join(repoRoot, "src/mcp/server.ts");
const requiredPaths = [
  path.join(pluginRoot, ".codex-plugin/plugin.json"),
  path.join(pluginRoot, ".mcp.json"),
  path.join(pluginRoot, "skills"),
];

for (const requiredPath of requiredPaths) {
  await access(requiredPath);
}

await rm(path.join(repoRoot, "dist"), { recursive: true, force: true });
await rm(path.join(pluginRoot, "dist"), { recursive: true, force: true });

const outfile = path.join(pluginRoot, "dist/mcp/server.js");
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
