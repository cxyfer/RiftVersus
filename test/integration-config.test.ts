import { describe, expect, it } from "vitest";

import integrationConfig from "../vitest.integration.config.js";

describe("integration test harness", () => {
  it("serializes schema-isolated files around Kysely's database-global migration lock", () => {
    expect(integrationConfig.test?.fileParallelism).toBe(false);
  });
});
