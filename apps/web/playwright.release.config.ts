import { defineConfig } from "@playwright/test";

import { parseReleaseBaseUrl } from "./playwright.release-url.js";

const baseURL = parseReleaseBaseUrl(process.env.RIFTVERSUS_E2E_BASE_URL);

export default defineConfig({
  testDir: "./e2e-release",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
