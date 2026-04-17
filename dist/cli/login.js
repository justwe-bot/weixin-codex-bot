import qrcodeTerminal from "qrcode-terminal";
import { checkQrLogin, DEFAULT_ILINK_BASE_URL, startQrLogin, toLoginResult } from "../ilink/auth.js";
import { clearPendingLogin, loadPendingLogin, saveCredentials, savePendingLogin } from "../state.js";
const MAX_QR_REFRESH = 3;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function main() {
    const baseUrl = process.env.ILINK_BASE_URL || DEFAULT_ILINK_BASE_URL;
    console.log("=== 微信 iLink 登录 ===\n");
    let pending = loadPendingLogin();
    if (!pending) {
        const qr = await startQrLogin(baseUrl);
        pending = {
            qrcode: qr.qrcode,
            qrContent: qr.qrcode_img_content,
            baseUrl,
            refreshCount: 0,
            createdAt: new Date().toISOString(),
        };
        savePendingLogin(pending);
    }
    while (true) {
        console.log("\n请使用微信扫描以下二维码：\n");
        qrcodeTerminal.generate(pending.qrContent, { small: true });
        console.log(`\n如终端二维码显示异常，可直接打开：${pending.qrContent}\n`);
        while (true) {
            const status = await checkQrLogin(pending.baseUrl, pending.qrcode);
            if (status.status === "wait") {
                process.stdout.write(".");
                await sleep(1000);
                continue;
            }
            if (status.status === "scaned") {
                console.log("\n\n已扫码，请在微信里确认登录...");
                await sleep(1000);
                continue;
            }
            if (status.status === "expired") {
                pending.refreshCount += 1;
                if (pending.refreshCount > MAX_QR_REFRESH) {
                    throw new Error("二维码多次过期，请重新执行登录");
                }
                console.log("\n二维码已过期，正在刷新...\n");
                const refreshed = await startQrLogin(pending.baseUrl);
                pending = {
                    qrcode: refreshed.qrcode,
                    qrContent: refreshed.qrcode_img_content,
                    baseUrl: pending.baseUrl,
                    refreshCount: pending.refreshCount,
                    createdAt: new Date().toISOString(),
                };
                savePendingLogin(pending);
                break;
            }
            const result = toLoginResult(status, pending.baseUrl);
            saveCredentials(result);
            clearPendingLogin();
            console.log("\n✅ 微信登录成功！");
            console.log(`账号 ID: ${result.accountId}`);
            console.log(`Base URL: ${result.baseUrl}`);
            if (result.userId) {
                console.log(`用户 ID: ${result.userId}`);
            }
            return;
        }
    }
}
main().catch((error) => {
    clearPendingLogin();
    console.error("\n登录失败:", error instanceof Error ? error.message : String(error));
    process.exit(1);
});
