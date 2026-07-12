import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const retiredSource = ["ora", "cle"].join("");
const retiredBrand = new RegExp(`${retiredSource}(?:['’]s)?\\s+elixir`, "iu");
const retiredHost = new RegExp(["oe", "data", "lisk", "io"].join("\\."), "iu");
const retiredJoinedName = new RegExp(`${retiredSource}(?:['’]s)?[_.-]*(?:selixir|csv|manifest|parser|fixture|config|fallback|endpoint|download|provider|source|url)|(?:csv|manifest|parser|fixture|config|fallback|endpoint|download|provider|source|url)[_.-]*${retiredSource}`, "iu");
const retiredTechnicalPhrase = new RegExp(`${retiredSource}(?:['’]s)?\\s+(?:csv|manifest|parser|fixture|config|fallback|endpoint|download|provider|source|url)`, "iu");
const retiredCsvSurface = new RegExp(`${["c", "sv"].join("")}[\\s_.-]*(?:manifest|parser|fixture|download)`, "iu");
const retiredDownloadPath = new RegExp(["match", "data"].join(""), "iu");

const ignoredDirectories = new Set([".git", ".worktrees", "dist", "node_modules", "coverage", "docs/aegis"]);
const textExtensions = new Set([".cjs", ".env", ".js", ".json", ".jsonc", ".md", ".mjs", ".mts", ".ts", ".tsx", ".yaml", ".yml"]);
const rootFiles = new Set([".env.example", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);

async function activeFiles(directory = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const logical = relative(root, absolute).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(logical) && !ignoredDirectories.has(entry.name)) output.push(...await activeFiles(absolute));
      continue;
    }
    if (logical === "CHANGELOG.md") continue;
    if (textExtensions.has(extname(entry.name)) || rootFiles.has(logical)) output.push(absolute);
  }
  return output;
}

describe("retired MVP source guard", () => {
  it("keeps active source ownership Leaguepedia-only", async () => {
    const violations: string[] = [];
    for (const file of await activeFiles()) {
      const logical = relative(root, file).replaceAll("\\", "/");
      const content = await readFile(file, "utf8");
      if (
        retiredBrand.test(content)
        || retiredHost.test(content)
        || retiredJoinedName.test(content)
        || retiredTechnicalPhrase.test(content)
        || retiredCsvSurface.test(content)
        || retiredDownloadPath.test(content)
        || retiredJoinedName.test(logical)
      ) violations.push(logical);
    }

    expect(violations).toEqual([]);
  });
});
