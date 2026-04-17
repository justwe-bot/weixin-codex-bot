import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
function buildPrompt(input) {
    return [
        input.config.systemPrompt,
        "",
        "额外约束：",
        "- 把最终回复写成适合微信阅读的纯文本。",
        "- 如果你改了文件，简要说明结果和关键路径。",
        "- 如果需要澄清，请尽量先基于现有信息完成最合理的动作。",
        "",
        `微信用户: ${input.userId}`,
        "",
        "用户消息：",
        input.prompt.trim(),
    ].join("\n");
}
function maybePush(args, flag, value) {
    if (value) {
        args.push(flag, value);
    }
}
function extractSessionId(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return undefined;
    }
    const record = candidate;
    const directValues = [
        record.session_id,
        record.sessionId,
        record.conversation_id,
        record.conversationId,
        record.thread_id,
        record.threadId,
    ];
    for (const value of directValues) {
        if (typeof value === "string" && value) {
            return value;
        }
    }
    for (const value of Object.values(record)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                const nested = extractSessionId(item);
                if (nested) {
                    return nested;
                }
            }
            continue;
        }
        const nested = extractSessionId(value);
        if (nested) {
            return nested;
        }
    }
    return undefined;
}
export async function runCodexPrompt(input) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-codex-bot-"));
    const outputPath = path.join(tempDir, "last-message.txt");
    const prompt = buildPrompt(input);
    const args = input.sessionId
        ? ["exec", "resume", input.sessionId, prompt]
        : ["exec", prompt];
    if (input.config.dangerousBypass) {
        args.push("--dangerously-bypass-approvals-and-sandbox");
    }
    else if (input.config.fullAuto) {
        args.push("--full-auto");
    }
    else {
        args.push("--sandbox", input.config.sandbox);
    }
    if (input.config.skipGitRepoCheck) {
        args.push("--skip-git-repo-check");
    }
    maybePush(args, "--model", input.config.model);
    for (const addDir of input.config.addDirs) {
        args.push("--add-dir", addDir);
    }
    args.push("--json", "--color", "never", "--output-last-message", outputPath);
    return new Promise((resolve, reject) => {
        const child = spawn(input.config.codexBinary, args, {
            cwd: input.config.workspaceRoot,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let discoveredSessionId = input.sessionId;
        child.stdout.on("data", (chunk) => {
            const text = chunk.toString();
            stdout += text;
            for (const line of text.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("{")) {
                    continue;
                }
                try {
                    const parsed = JSON.parse(trimmed);
                    discoveredSessionId = extractSessionId(parsed) || discoveredSessionId;
                }
                catch {
                    // Ignore non-JSON lines and partial JSON chunks.
                }
            }
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (error) => {
            fs.rmSync(tempDir, { recursive: true, force: true });
            reject(error);
        });
        child.on("close", (code) => {
            try {
                const text = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").trim() : "";
                fs.rmSync(tempDir, { recursive: true, force: true });
                if (code !== 0) {
                    const message = stderr.trim() || stdout.trim() || `codex exited with code ${code}`;
                    reject(new Error(message));
                    return;
                }
                resolve({
                    text,
                    sessionId: discoveredSessionId,
                    stdout,
                    stderr,
                });
            }
            catch (error) {
                fs.rmSync(tempDir, { recursive: true, force: true });
                reject(error);
            }
        });
    });
}
