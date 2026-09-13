import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const packageDirectory = fileURLToPath(new URL(".", import.meta.url));
const externalServer = process.env.RIFTVERSUS_E2E_EXTERNAL === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.RIFTVERSUS_E2E_BASE_URL ?? "http://127.0.0.1:4187/RiftVersus/",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  ...(externalServer ? {} : {
    webServer: {
      command: "VITE_BASE_PATH=/RiftVersus/ pnpm vite build && node ../../scripts/build-static-fixture.mjs && VITE_BASE_PATH=/RiftVersus/ pnpm vite preview --host 127.0.0.1 --port 4187 --strictPort",
      cwd: packageDirectory,
      url: "http://127.0.0.1:4187/RiftVersus/",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  }),
});
