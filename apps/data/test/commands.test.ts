import { describe, expect, it } from "vitest";
import { parseDataCommand } from "../src/cli.js";

describe("one-shot data commands", () => {
  it.each([[], ["serve"], ["sync"], ["sync", "--once", "--year", "2025"], ["backfill", "--year", "2025"], ["migrate", "extra"]])("rejects unsupported or incomplete command %j", (args) => {
    expect(() => parseDataCommand(args)).toThrow();
  });
  it("keeps fixture import explicit and bounded", () => {
    expect(parseDataCommand(["sync", "--once", "--fixture", "leaguepedia-small"])).toEqual({ kind: "sync", request: { mode: "sync-once" }, fixture: "leaguepedia-small" });
    expect(parseDataCommand(["backfill", "--year", "2025", "--competition", "Worlds"])).toEqual({ kind: "sync", request: { mode: "backfill", years: [2025], competitions: ["Worlds"] }, fixture: null });
    expect(() => parseDataCommand(["backfill", "--year", "2025", "--year", "2025", "--competition", "Worlds"])).toThrow();
  });
  it("requires an explicit checkpoint operation and directory", () => {
    for (const mode of ["pack", "verify", "restore"]) {
      expect(parseDataCommand(["checkpoint", mode, "/tmp/candidate"])).toEqual({ kind: "checkpoint", mode, directory: "/tmp/candidate" });
    }
    for (const args of [["checkpoint"], ["checkpoint", "delete", "x"], ["checkpoint", "restore"], ["checkpoint", "pack", "x", "extra"]]) {
      expect(() => parseDataCommand(args)).toThrow();
    }
  });
  it("does not expose archive deletion or implicit bootstrap", () => {
    expect(parseDataCommand(["archive", "resolve", "candidate"])).toEqual({ kind: "archive", mode: "resolve", directory: "candidate" });
    expect(parseDataCommand(["archive", "publish", "candidate"])).toEqual({ kind: "archive", mode: "publish", directory: "candidate" });
    for (const args of [["archive"], ["archive", "delete", "x"], ["archive", "publish"], ["archive", "resolve", "x", "y"]]) expect(() => parseDataCommand(args)).toThrow();
  });
  it("requires explicit static snapshot directories", () => {
    expect(parseDataCommand(["acceptance"])).toEqual({ kind: "acceptance" });
    expect(() => parseDataCommand(["acceptance", "ignore-errors"])).toThrow();
    expect(parseDataCommand(["snapshot", "export", "public"])).toEqual({ kind: "snapshot", mode: "export", directory: "public" });
    expect(parseDataCommand(["snapshot", "verify", "public"])).toEqual({ kind: "snapshot", mode: "verify", directory: "public" });
    expect(() => parseDataCommand(["snapshot", "export"])).toThrow();
    expect(() => parseDataCommand(["snapshot", "delete", "public"])).toThrow();
  });
});
