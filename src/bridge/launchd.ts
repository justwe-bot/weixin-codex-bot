import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const BRIDGE_AGENT_LABEL = "com.xiongdi.weixin-codex-bot.bridge";

export interface BridgeAgentPaths {
  label: string;
  plistPath: string;
  stdoutPath: string;
  stderrPath: string;
}

export interface BridgeAgentStatus extends BridgeAgentPaths {
  installed: boolean;
  enabled: boolean;
  loaded: boolean;
  running: boolean;
  pid: number | null;
  state: string | null;
  lastExitCode: number | null;
  launchctlSummary: string | null;
  stdoutTail: string | null;
  stderrTail: string | null;
}

function ensureDarwin(): void {
  if (process.platform !== "darwin") {
    throw new Error("The realtime bridge service currently supports macOS launchd only.");
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function getLaunchdDomain(): string {
  const uid = process.getuid?.();
  if (uid == null) {
    throw new Error("Unable to determine the current macOS user id.");
  }

  return `gui/${uid}`;
}

function getTargetLabel(label = BRIDGE_AGENT_LABEL): string {
  return `${getLaunchdDomain()}/${label}`;
}

export function getBridgeAgentPaths(stateDirectory: string, label = BRIDGE_AGENT_LABEL): BridgeAgentPaths {
  return {
    label,
    plistPath: path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`),
    stdoutPath: path.join(stateDirectory, "bridge.stdout.log"),
    stderrPath: path.join(stateDirectory, "bridge.stderr.log"),
  };
}

function runLaunchctl(args: string[], allowFailure = false): { ok: boolean; output: string } {
  const result = spawnSync("launchctl", args, {
    encoding: "utf8",
  });
  const output = [result.stdout || "", result.stderr || ""]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");

  if (result.status !== 0 && !allowFailure) {
    throw new Error(output || `launchctl ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }

  return {
    ok: result.status === 0,
    output,
  };
}

function readTail(filePath: string, maxLines = 20): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) {
    return null;
  }

  return content
    .split("\n")
    .slice(-maxLines)
    .join("\n");
}

function parseBooleanFlag(text: string, label: string): boolean | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`"${escapedLabel}"\\s*=>\\s*(true|false)`));
  if (!match) {
    return null;
  }

  return match[1] === "true";
}

function buildLaunchAgentPlist(input: {
  label: string;
  nodeBinary: string;
  bridgeEntrypoint: string;
  stateDirectory: string;
  stdoutPath: string;
  stderrPath: string;
}): string {
  const values = {
    label: escapeXml(input.label),
    nodeBinary: escapeXml(input.nodeBinary),
    bridgeEntrypoint: escapeXml(input.bridgeEntrypoint),
    stateDirectory: escapeXml(input.stateDirectory),
    stdoutPath: escapeXml(input.stdoutPath),
    stderrPath: escapeXml(input.stderrPath),
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${values.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${values.nodeBinary}</string>
    <string>${values.bridgeEntrypoint}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${values.stateDirectory}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${values.stdoutPath}</string>
  <key>StandardErrorPath</key>
  <string>${values.stderrPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WEIXIN_CODEX_BOT_HOME</key>
    <string>${values.stateDirectory}</string>
  </dict>
</dict>
</plist>
`;
}

export function installOrUpdateBridgeAgent(input: {
  bridgeEntrypoint: string;
  stateDirectory: string;
  nodeBinary?: string;
  label?: string;
}): BridgeAgentPaths {
  ensureDarwin();
  const label = input.label || BRIDGE_AGENT_LABEL;
  const nodeBinary = input.nodeBinary || process.execPath;
  if (!fs.existsSync(input.bridgeEntrypoint)) {
    throw new Error(`Bridge runtime not found: ${input.bridgeEntrypoint}`);
  }
  if (!fs.existsSync(nodeBinary)) {
    throw new Error(`Node runtime not found: ${nodeBinary}`);
  }

  const paths = getBridgeAgentPaths(input.stateDirectory, label);
  fs.mkdirSync(path.dirname(paths.plistPath), { recursive: true });
  fs.mkdirSync(input.stateDirectory, { recursive: true });

  fs.writeFileSync(
    paths.plistPath,
    buildLaunchAgentPlist({
      label,
      nodeBinary,
      bridgeEntrypoint: input.bridgeEntrypoint,
      stateDirectory: input.stateDirectory,
      stdoutPath: paths.stdoutPath,
      stderrPath: paths.stderrPath,
    }),
    "utf8",
  );

  return paths;
}

export function startBridgeAgent(input: {
  bridgeEntrypoint: string;
  stateDirectory: string;
  nodeBinary?: string;
  label?: string;
}): BridgeAgentStatus {
  const paths = installOrUpdateBridgeAgent(input);
  const domain = getLaunchdDomain();
  const target = getTargetLabel(paths.label);

  runLaunchctl(["enable", target], true);
  runLaunchctl(["bootout", domain, paths.plistPath], true);
  runLaunchctl(["bootstrap", domain, paths.plistPath]);
  runLaunchctl(["kickstart", "-k", target], true);

  return getBridgeAgentStatus(input.stateDirectory, paths.label);
}

export function stopBridgeAgent(stateDirectory: string, label = BRIDGE_AGENT_LABEL): BridgeAgentStatus {
  ensureDarwin();
  const paths = getBridgeAgentPaths(stateDirectory, label);
  const domain = getLaunchdDomain();
  const target = getTargetLabel(label);

  runLaunchctl(["bootout", domain, paths.plistPath], true);
  runLaunchctl(["disable", target], true);

  return getBridgeAgentStatus(stateDirectory, label);
}

export function removeBridgeAgent(
  stateDirectory: string,
  options?: {
    clearLogs?: boolean;
    label?: string;
  },
): BridgeAgentStatus {
  ensureDarwin();
  const label = options?.label || BRIDGE_AGENT_LABEL;
  const paths = getBridgeAgentPaths(stateDirectory, label);
  const statusBeforeRemoval = stopBridgeAgent(stateDirectory, label);

  fs.rmSync(paths.plistPath, { force: true });
  if (options?.clearLogs) {
    fs.rmSync(paths.stdoutPath, { force: true });
    fs.rmSync(paths.stderrPath, { force: true });
  }

  return {
    ...statusBeforeRemoval,
    installed: false,
    enabled: false,
    loaded: false,
    running: false,
  };
}

export function getBridgeAgentStatus(stateDirectory: string, label = BRIDGE_AGENT_LABEL): BridgeAgentStatus {
  ensureDarwin();
  const paths = getBridgeAgentPaths(stateDirectory, label);
  const installed = fs.existsSync(paths.plistPath);
  const target = getTargetLabel(label);
  const disabledOutput = runLaunchctl(["print-disabled", getLaunchdDomain()], true).output;
  const disabled = parseBooleanFlag(disabledOutput, label);
  const printResult = installed ? runLaunchctl(["print", target], true) : { ok: false, output: "" };
  const stateMatch = printResult.output.match(/state = ([^\n]+)/);
  const pidMatch = printResult.output.match(/pid = (\d+)/);
  const exitMatch = printResult.output.match(/last exit code = (\d+)/);
  const state = stateMatch?.[1]?.trim() || null;
  const pid = pidMatch ? Number.parseInt(pidMatch[1], 10) : null;
  const lastExitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : null;

  return {
    ...paths,
    installed,
    enabled: installed ? disabled !== true : false,
    loaded: printResult.ok,
    running: state === "running" || (pid != null && pid > 0),
    pid,
    state,
    lastExitCode,
    launchctlSummary: printResult.output || null,
    stdoutTail: readTail(paths.stdoutPath),
    stderrTail: readTail(paths.stderrPath),
  };
}
