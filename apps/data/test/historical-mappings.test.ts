import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadSyncConfig } from "@riftversus/sync";
import { checkLeaguepediaMappings } from "../src/mapping-check.js";
import { historyRequests } from "../src/sync-plan.js";

const mapText = await readFile(new URL("../../../data/leaguepedia/competition-map.json", import.meta.url), "utf8");
const map = JSON.parse(mapText) as Record<string, Record<string, string[]>>;
const audit = JSON.parse(await readFile(new URL("../../../data/leaguepedia/domestic-ewc-audit.json", import.meta.url), "utf8")) as {
  tournaments: { competition: string; Tournament: string; FirstGame: string; LastGame: string }[];
};

describe("reviewed domestic and EWC mappings", () => {
  it("covers every reviewed exact key in each calendar year containing its games", () => {
    for (const competition of ["LCK", "LPL", "EWC"]) {
      const rows = audit.tournaments.filter(row => row.competition === competition);
      const expected: Record<string, string[]> = {};
      for (const row of rows) {
        for (let year = Number(row.FirstGame.slice(0, 4)); year <= Number(row.LastGame.slice(0, 4)); year++) (expected[year] ??= []).push(row.Tournament);
      }
      expect(Object.keys(map[competition]!)).toEqual(Object.keys(expected));
      for (const [year, keys] of Object.entries(expected)) expect([...map[competition]![year]!].sort()).toEqual(keys.sort());
    }
  });

  it("retains winter seasons, LCK Cups and first EWC without academy or qualifier pollution", () => {
    expect(map.LCK!["2012"]).toContain("Champions 2013 Winter");
    expect(map.LCK!["2013"]).toContain("Champions 2013 Winter");
    expect(map.LCK!["2025"]).toContain("LCK Cup 2025");
    expect(map.LCK!["2026"]).toContain("LCK Cup 2026");
    expect(map.EWC!["2024"]).toEqual(["Esports World Cup 2024"]);
    expect(audit.tournaments.some(row => /academy|challengers|all.star|online qualifier|promotion/i.test(row.Tournament))).toBe(false);
    const config = loadSyncConfig({ DATABASE_URL: "postgresql://example.test/db", LEAGUEPEDIA_ENDPOINT: "https://leaguepedia.acme.org/api.php", LEAGUEPEDIA_USER_AGENT: "RiftVersus/1.0 ops@acme.org", LEAGUEPEDIA_MEDIA_HOSTS: "static.acme.org", LEAGUEPEDIA_COMPETITION_MAP: mapText, LEAGUEPEDIA_SYNC_YEARS: "2026", LEAGUEPEDIA_MAPPING_COMPETITIONS: "LCK,LPL,EWC", LEAGUEPEDIA_MAPPING_YEARS: "2026" });
    expect(checkLeaguepediaMappings(config).missing).toEqual([]);
    const domestic = historyRequests(config).filter(request => ["LCK", "LPL", "EWC"].includes(request.competitions[0]!));
    expect(domestic).toHaveLength(15);
    expect(domestic.every(request => request.years.length >= 1 && request.years.length <= 2)).toBe(true);
  });
});
