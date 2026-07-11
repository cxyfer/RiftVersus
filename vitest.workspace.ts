import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@riftversus/contracts": source("./packages/contracts/src/index.ts"),
      "@riftversus/domain": source("./packages/domain/src/index.ts"),
      "@riftversus/database": source("./packages/database/src/index.ts"),
      "@riftversus/sync": source("./packages/sync/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
