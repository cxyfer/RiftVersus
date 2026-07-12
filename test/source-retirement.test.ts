import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { classifyActiveSourceFile, classifyTrackedEntry, collectActiveSourceViolations } from "./source-retirement-guard.js";

const root = resolve(import.meta.dirname, "..");
const retiredToken = ["Ora", "cle"].join("");
const retiredHost = ["oe", "data", "lisk", "io"].join(".");
const retiredDownloadPath = ["match", "Data"].join("");

describe("retired MVP source classifier", () => {
  it.each([
    ["packages/sync/src/adapter.ts", `export class ${retiredToken}Adapter {}`],
    ["packages/sync/src/client.ts", `const client = new ${retiredToken.toLowerCase()}Client()`],
    ["packages/sync/src/client.ts", `const ${retiredToken.toUpperCase()}_CLIENT = createClient()`],
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
    `${retiredToken} is excluded from the MVP deployment.`,
  ])("allows an explicit operator policy line", (line) => {
    expect(classifyActiveSourceFile("docs/source-policy.md", line)).toEqual([]);
  });

  it("rejects active content appended to an allowed policy phrase", () => {
    expect(classifyActiveSourceFile("README.md", `${retiredToken} is not part of the MVP. Enable ${retiredToken}Adapter with SOURCE=1.`)).not.toEqual([]);
  });

  it("rejects non-policy residue appended to an allowed phrase", () => {
    expect(classifyActiveSourceFile("README.md", `${retiredToken} is not part of the MVP. Enable legacy provider with SOURCE=1.`)).not.toEqual([]);
  });

  it("allows a standalone policy sentence with markdown punctuation", () => {
    expect(classifyActiveSourceFile("README.md", `- **${retiredToken} is not part of the MVP.**`)).toEqual([]);
  });

  it("rejects a non-policy operator documentation line", () => {
    expect(classifyActiveSourceFile("README.md", `${retiredToken} can be enabled with a flag.`)).not.toEqual([]);
  });

  it("allows historical Aegis records only", () => {
    expect(classifyActiveSourceFile("docs/aegis/specs/history.md", `${retiredToken}Adapter`)).toEqual([]);
  });

  it.each([
    ["scripts/provider.py", `class ${retiredToken}Client: pass`],
    ["notes/source.txt", `${retiredToken} provider`],
    ["dist/provider.py", `class ${retiredToken}Provider: pass`],
  ])("scans every tracked text file regardless of path or extension (%s)", (logicalPath, content) => {
    expect(classifyTrackedEntry(logicalPath, Buffer.from(content), "file")).not.toEqual([]);
  });

  it.each([["test", retiredToken].join(""), ["c", retiredToken.toLowerCase()].join("")])('does not treat "%s" as the retired identifier', (content) => {
    expect(classifyActiveSourceFile("packages/example.ts", content)).toEqual([]);
  });

  it.each([["match", "Database"].join(""), ["match", "Dataset"].join("")])('does not treat "%s" as the retired download path', (content) => {
    expect(classifyActiveSourceFile("packages/example.ts", content)).toEqual([]);
  });

  it("rejects the retired download path with a URL path boundary", () => {
    expect(classifyActiveSourceFile("packages/example.ts", `https://source.acme.org/${retiredDownloadPath}`)).not.toEqual([]);
  });

  it("skips binary content after checking its tracked path", () => {
    expect(classifyTrackedEntry("assets/source.bin", Buffer.from([0, ...Buffer.from(retiredToken)]), "file")).toEqual([]);
    expect(classifyTrackedEntry(`assets/${retiredToken.toLowerCase()}.bin`, Buffer.from([0, 1, 2]), "file")).not.toEqual([]);
  });

  it("rejects every tracked symbolic link without reading its target", () => {
    expect(classifyTrackedEntry("scripts/provider.py", Buffer.alloc(0), "symlink")).toEqual([
      { path: "scripts/provider.py", reason: "tracked-symlink" },
    ]);
  });
});

describe("retired MVP source guard", () => {
  it("keeps the active tree Leaguepedia-only", async () => {
    expect(await collectActiveSourceViolations(root)).toEqual([]);
  });
});
