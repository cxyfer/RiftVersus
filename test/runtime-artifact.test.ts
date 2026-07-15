import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "riftversus-artifact-"));
  await mkdir(join(root, "dist"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "test"), { recursive: true });
  await mkdir(join(root, "node_modules", "@riftversus", "database", "dist", "migrations"), { recursive: true });
  await writeFile(join(root, "dist", "cli.js"), "export {};");
  await writeFile(join(root, "dist", "acceptance-cli.js"), "export {};");
  await writeFile(join(root, "dist", "cli.d.ts"), "export {};");
  await writeFile(join(root, "dist", "cli.d.mts"), "export {};");
  await writeFile(join(root, "dist", "cli.js.map"), "{}");
  await writeFile(join(root, "src", "cli.ts"), "export {};");
  await writeFile(join(root, "test", "cli.test.ts"), "export {};");
  await writeFile(join(root, "tsconfig.json"), "{}");
  await writeFile(join(root, "node_modules", "@riftversus", "database", "dist", "migrations", "001_initial.js"), "export {};");
  return root;
}

describe("runtime artifact static preflight", () => {
  it("rejects source, tests, declarations, maps, and tsconfig before pruning", async () => {
    const module = await import("../scripts/runtime-artifact.mjs");
    const result = await module.inspectRuntimeArtifact(await fixture());
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.stringMatching(/source directory/i), expect.stringMatching(/test directory/i),
      expect.stringMatching(/declaration/i), expect.stringMatching(/source map/i), expect.stringMatching(/tsconfig/i),
    ]));
  });

  it("prunes non-runtime files while retaining compiled migrations and CLI files", async () => {
    const module = await import("../scripts/runtime-artifact.mjs");
    const root = await fixture();
    await module.pruneRuntimeArtifact(root);
    await expect(module.inspectRuntimeArtifact(root)).resolves.toEqual({ blockers: [] });
    await expect(readFile(join(root, "dist", "cli.js"), "utf8")).resolves.toContain("export");
    await expect(readFile(join(root, "node_modules", "@riftversus", "database", "dist", "migrations", "001_initial.js"), "utf8")).resolves.toContain("export");
  });
});
