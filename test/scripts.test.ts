import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("root verification scripts", () => {
  it("runs root and every workspace unit suite without recursive self-invocation", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(manifest.scripts.test).toBe("pnpm test:consumer && pnpm test:unit && pnpm test:workspace");
    expect(manifest.scripts["test:workspace"]).toContain("@riftversus/contracts");
    expect(manifest.scripts["test:workspace"]).toContain("@riftversus/domain");
    expect(manifest.scripts["test:workspace"]).toContain("@riftversus/data");
    expect(manifest.scripts["test:workspace"]).toContain("@riftversus/sync");
    expect(manifest.scripts["test:workspace"]).toContain("@riftversus/web");
    expect(manifest.scripts["test:workspace"]).not.toMatch(/(?:^|&&\s*)pnpm test(?:\s|$)/u);
  });

  it("runs the real Playwright suite from the root e2e command", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(manifest.scripts["test:e2e"]).toBe("pnpm --filter @riftversus/web test:e2e");
    expect(manifest.scripts["test:e2e"]).not.toContain("vitest");
  });
});
