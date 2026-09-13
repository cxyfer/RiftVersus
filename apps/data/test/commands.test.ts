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
});
