import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts", "apps/*/test/**/*.integration.test.ts", "packages/*/test/**/*.integration.test.ts"],
  },
});
