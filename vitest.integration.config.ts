import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Kysely's PostgreSQL adapter uses a database-global advisory migration lock
    // independent of migrationTableSchema. Serialize files so queued migrations
    // cannot cross Vitest timeouts into schema teardown.
    fileParallelism: false,
    include: ["test/**/*.integration.test.ts", "apps/*/test/**/*.integration.test.ts", "packages/*/test/**/*.integration.test.ts"],
  },
});
