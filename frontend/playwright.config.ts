import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", fullyParallel: false, workers: 1,
  timeout: 30000, reporter: "list",
  use: { baseURL: process.env.FRONTEND_URL ?? "http://127.0.0.1:3000", viewport: { width: 1440, height: 900 },
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined),
    screenshot: "only-on-failure" },
});
