import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { classifyActiveSourceFile, collectActiveSourceViolations } from "./source-retirement-guard.js";

const root = resolve(import.meta.dirname, "..");
const retiredToken = ["Ora", "cle"].join("");
const retiredHost = ["oe", "data", "lisk", "io"].join(".");
const retiredDownloadPath = ["match", "Data"].join("");

describe("retired MVP source classifier", () => {
  it.each([
    ["packages/sync/src/adapter.ts", `export class ${retiredToken}Adapter {}`],
    ["packages/sync/src/client.ts", `const client = new ${retiredToken.toLowerCase()}Client()`],
    ["packages/sync/src/provider.ts", `const source = "${retiredToken}'s Elixir"`],
    ["packages/sync/src/provider.ts", `const source = "${retiredToken}’s Elixir"`],
    ["Dockerfile", `ENV DATA_SOURCE=${retiredToken}`],
    ["containers/sync.dockerfile", `ENV DATA_SOURCE=${retiredToken}`],
    ["scripts/sync.sh", `SOURCE=${retiredToken.toLowerCase()}`],
    ["CHANGELOG.md", `- retire ${retiredToken} provider`],
    [`packages/sync/src/${retiredToken.toLowerCase()}-adapter.ts`, "export {}"],
    ["packages/sync/src/provider.ts", `const endpoint = "https://${retiredHost}"`],
    ["packages/sync/src/provider.ts", `const path = "${retiredDownloadPath}"`],
  ])("rejects retired source surface in %s", (logicalPath, content) => {
    expect(classifyActiveSourceFile(logicalPath, content)).not.toEqual([]);
  });

  it("allows unrelated CSV parsing", () => {
    expect(classifyActiveSourceFile("packages/export/src/csv-parser.ts", "export class CsvParser {}" )).toEqual([]);
  });

  it.each([
    `${retiredToken} is not part of the MVP.`,
    `${retiredToken} is not an MVP source.`,
    `${retiredToken} was retired.`,
    `Reintroduction of ${retiredToken} requires a new reviewed decision and publicly verifiable direct evidence.`,
  ])("allows an explicit operator policy line", (line) => {
    expect(classifyActiveSourceFile("docs/source-policy.md", line)).toEqual([]);
  });

  it("rejects a non-policy operator documentation line", () => {
    expect(classifyActiveSourceFile("README.md", `${retiredToken} can be enabled with a flag.`)).not.toEqual([]);
  });

  it("allows historical Aegis records only", () => {
    expect(classifyActiveSourceFile("docs/aegis/specs/history.md", `${retiredToken}Adapter`)).toEqual([]);
  });
});

describe("retired MVP source guard", () => {
  it("keeps the active tree Leaguepedia-only", async () => {
    expect(await collectActiveSourceViolations(root)).toEqual([]);
  });
});
