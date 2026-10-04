import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadOverrides } from "../src/overrides.js";
import { normalizeLeaguepediaSnapshot } from "../src/providers/leaguepedia/normalize.js";
import { parseLeaguepediaRawInput } from "../src/providers/leaguepedia/fetch.js";
import type { LeaguepediaRawInput } from "../src/providers/leaguepedia/types.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

async function input(): Promise<LeaguepediaRawInput> {
  const raw = JSON.parse(await readFile(`${root}data/fixtures/leaguepedia-small.json`, "utf8")) as LeaguepediaRawInput;
  return { ...raw, rawEvidence: raw.rawEvidence.map(evidence => {
    const rows = evidence.response as Record<string, unknown>[];
    if (evidence.table === "ScoreboardGames") return { ...evidence, response: rows.slice(0, 2) };
    if (evidence.table === "ScoreboardPlayers") return { ...evidence, response: rows.filter(row => ["WORLD24-FINAL-G1", "WORLD24-FINAL-G2"].includes(String(row.GameId))) };
    if (evidence.table === "MatchSchedule") return { ...evidence, response: rows.map(row => ({ ...row, BestOf: 2, Team1Score: 1, Team2Score: 1, Winner: 0 })) };
    return evidence;
  }) };
}

const overrides = () => loadOverrides({ identities: `${root}data/overrides/identities.yaml`, tournaments: `${root}data/overrides/tournaments.yaml`, regions: `${root}data/overrides/regions.yaml` });

describe("historical domestic series", () => {
  it("retains a source-confirmed completed BO2 draw and both game winners", async () => {
    const snapshot = parseLeaguepediaRawInput(await input());
    const result = normalizeLeaguepediaSnapshot(snapshot, await overrides());
    expect(result.facts.series[0]).toMatchObject({ bestOf: 2, completed: true, sideAScore: 1, sideBScore: 1, winnerTeamId: null });
    expect(result.facts.games).toHaveLength(2);
    expect(result.facts.games.every(game => game.winnerTeamId !== null)).toBe(true);
  });

  it("rejects a schedule that calls a 1:1 draw a side victory", async () => {
    const raw = await input();
    const schedule = raw.rawEvidence.find(evidence => evidence.table === "MatchSchedule")!;
    (schedule.response as Record<string, unknown>[])[0]!.Winner = 1;
    expect(() => parseLeaguepediaRawInput(raw)).toThrow(/winner conflicts/);
  });

  it("keeps the scheduled series result when individual game detail is missing", async () => {
    const raw = await input();
    const partial = {
      ...raw,
      rawEvidence: raw.rawEvidence.map(evidence => {
        if (evidence.table === "ScoreboardGames") return { ...evidence, response: (evidence.response as Record<string, unknown>[]).filter(row => row.GameId !== "WORLD24-FINAL-G1") };
        if (evidence.table === "ScoreboardPlayers") return { ...evidence, response: (evidence.response as Record<string, unknown>[]).filter(row => row.GameId !== "WORLD24-FINAL-G1") };
        return evidence;
      }),
    };
    const snapshot = parseLeaguepediaRawInput(partial);
    expect(snapshot.series[0]).toMatchObject({ sourceKey: "WORLD24-FINAL", sideAScore: 1, sideBScore: 1 });
    expect(snapshot.games).toHaveLength(1);
    expect(snapshot.gamePlayers.every(player => player.gameKey !== "WORLD24-FINAL-G1")).toBe(true);
  });

  it("rejects observed game results that exceed the scheduled series score", async () => {
    const raw = await input();
    const conflicting = {
      ...raw,
      rawEvidence: raw.rawEvidence.map(evidence => evidence.table === "ScoreboardGames"
        ? { ...evidence, response: (evidence.response as Record<string, unknown>[]).map(row => ({ ...row, Winner: 1 })) }
        : evidence),
    };
    expect(() => parseLeaguepediaRawInput(conflicting)).toThrow(/game rows conflict with final score/);
  });

  it("retains distinct player IDs when source-confirmed players share a real name", async () => {
    const snapshot = parseLeaguepediaRawInput(await input());
    const sameName = { ...snapshot, entities: snapshot.entities.map(entity => entity.kind === "player" ? { ...entity, displayName: "Jeong Ji-hoon" } : entity) };
    const result = normalizeLeaguepediaSnapshot(sameName, await overrides());
    expect(result.quarantine).toEqual([]);
    expect(result.facts.gamePlayers).toHaveLength(snapshot.gamePlayers.length);
    expect(new Set(result.dimensions.entities.filter(entity => entity.kind === "player").map(entity => entity.id)).size).toBe(10);
  });

  it.each([
    ["LCK/2024 Season/Spring Season", "LCK 2024 Spring", "league", "lck"],
    ["Champions/2013 Season/Spring", "Champions 2013 Spring", "league", "lck"],
    ["LPL/2024 Season/Spring Season", "LPL 2024 Spring", "league", "lpl"],
    ["Korea Regional Finals 2014", "Korea Regional Finals 2014", "league", "lck"],
    ["China Regional Finals 2014", "China Regional Finals 2014", "league", "lpl"],
    ["Esports World Cup 2024", "Esports World Cup 2024", "ewc", null],
  ])("publishes %s with its event and league ownership", async (key, name, category, leagueSlug) => {
    const snapshot = parseLeaguepediaRawInput(await input());
    const renamed = { ...snapshot, slices: snapshot.slices.map(slice => ({ ...slice, competition: leagueSlug?.toUpperCase() ?? "EWC" })), tournaments: snapshot.tournaments.map(row => ({ ...row, sourceKey: key!, displayName: name! })), series: snapshot.series.map(row => ({ ...row, tournamentKey: key! })) };
    expect(normalizeLeaguepediaSnapshot(renamed, await overrides()).dimensions.tournaments[0]).toMatchObject({ category, leagueSlug });
  });
});
