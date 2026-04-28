import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function hasPluginManifest(candidate: string): boolean {
  return fs.existsSync(path.join(candidate, ".codex-plugin", "plugin.json"));
}

export function resolvePluginRoot(importMetaUrl: string): string {
  const currentDir = path.dirname(fileURLToPath(importMetaUrl));
  const candidates = [
    path.resolve(currentDir, "../.."),
    path.resolve(currentDir, "../../plugins/weixin-codex-bot"),
    path.resolve(currentDir, "../../../plugins/weixin-codex-bot"),
  ];

  for (const candidate of candidates) {
    if (hasPluginManifest(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to locate the weixin-codex-bot plugin root.");
}

export function resolvePackagedBridgeEntrypoint(importMetaUrl: string): string {
  const pluginRoot = resolvePluginRoot(importMetaUrl);
  const bridgeEntrypoint = path.join(pluginRoot, "dist", "cli", "bridge.js");
  if (!fs.existsSync(bridgeEntrypoint)) {
    throw new Error(`Bridge runtime not found at ${bridgeEntrypoint}. Run npm run build first.`);
  }

  return bridgeEntrypoint;
}
