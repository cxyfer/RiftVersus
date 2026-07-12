import { describe, expect, it } from "vitest";

import { parseCliCommand } from "../src/commands.js";

describe("parseCliCommand", () => {
  it.each([
    [["serve"], { kind: "serve" }],
    [["migrate"], { kind: "migrate" }],
    [["sync"], { kind: "sync-scheduled" }],
    [["sync", "--once"], { kind: "sync-once", fixture: null }],
    [["sync", "--once", "--fixture", "leaguepedia-small"], { kind: "sync-once", fixture: "leaguepedia-small" }],
    [["backfill", "--year", "2024", "--competition", "Worlds"], { kind: "backfill", years: [2024], competitions: ["Worlds"], fixture: null }],
  ])("parses %j", (argv, expected) => expect(parseCliCommand(argv)).toEqual(expected));

  it("requires bounded backfill arguments and the reviewed fixture name", () => {
    expect(() => parseCliCommand(["backfill"])).toThrow(/year/i);
    expect(() => parseCliCommand(["backfill", "--year", "2024", "--competition", "Worlds", "--competition", "Worlds"])).toThrow(/unique/i);
    expect(() => parseCliCommand(["sync", "--once", "--fixture", "unknown"])).toThrow(/leaguepedia-small/);
    expect(() => parseCliCommand(["serve", "--once"])).toThrow(/serve/);
  });
});
