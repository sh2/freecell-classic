import { defineConfig } from "@playwright/test";
import net from "node:net";

/**
 * ランダムな空きポートを 1 つ選ぶ。
 * 空きポートの確認から HTTP サーバーの起動までに小さな競合余地が残ることは許容する。
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * ポートはメインプロセスとワーカープロセスで同じ値を使う必要がある。
 * config は両方のプロセスで評価されるため、最初(メインプロセス)に決めた
 * ポートを環境変数へ書き戻し、ワーカーはそれを読み取る。
 * 環境変数 FREECELL_E2E_PORT で固定ポートを指定した場合はそれを優先する。
 */
const envPort = Number(process.env.FREECELL_E2E_PORT);
const port =
  Number.isInteger(envPort) && envPort > 0
    ? envPort
    : await findFreePort();
if (!(Number.isInteger(envPort) && envPort > 0)) {
  process.env.FREECELL_E2E_PORT = String(port);
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
