import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:5188", screenshot: "only-on-failure" },
  webServer: { command: "pnpm dev --host 127.0.0.1 --port 5188 --strictPort", url: "http://127.0.0.1:5188", reuseExistingServer: false },
});
