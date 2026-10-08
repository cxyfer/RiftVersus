import { describe, expect, it } from "vitest";
import { alternativeReviewEvidence, parseSourceCorrections, projectSourceRows, sourceScheduleIds } from "../src/providers/leaguepedia/source-corrections.js";

const proof = { sourceUrl: "https://lol.fandom.com/wiki/Reviewed_Tournament?oldid=123", reviewedNote: "Verified exact match and tournament format." };
const alias = { ...proof, table: "MatchSchedule", key: "MatchId", value: "schedule-1", field: "MatchId", expected: "schedule-1", replacement: "games-1" };

describe("reviewed source corrections", () => {
  it("corrects exact game and player team references with immutable evidence and conflict checks", () => {
    const game = { ...proof, table: "ScoreboardGames", key: "GameId", value: "g1", field: "Team2", expected: "Legacy", replacement: "Current" };
    const player = { ...proof, table: "ScoreboardPlayers", key: "GameId", value: "g1", field: "Team", playerName: "Pun", expected: "Legacy", replacement: "Current" };
    const rules = parseSourceCorrections([game, player]);
    const raw = [{ GameId: "g1", Team1: "Opponent", Team2: "Legacy" }, { GameId: "g2", Team1: "Opponent", Team2: "Legacy" }];
    expect(projectSourceRows("ScoreboardGames", raw, rules)).toEqual([{ ...raw[0], Team2: "Current" }, raw[1]]);
    expect(raw[0]?.Team2).toBe("Legacy");
    const roster = [{ GameId: "g1", PlayerName: "Pun", Team: "Legacy" }, { GameId: "g1", PlayerName: "Other", Team: "Opponent" }];
    const corrected = projectSourceRows("ScoreboardPlayers", roster, rules);
    expect(corrected).toEqual([{ ...roster[0], Team: "Current" }, roster[1]]);
    expect(projectSourceRows("ScoreboardPlayers", corrected, rules)).toEqual(corrected);
    expect(() => projectSourceRows("ScoreboardPlayers", [{ ...roster[0], Team: "Unexpected" }], rules)).toThrow(/conflicts/);
    expect(() => parseSourceCorrections([{ ...player, playerName: undefined }])).toThrow(/field is invalid/);
    expect(() => parseSourceCorrections([{ ...game, field: "Winner" }])).toThrow(/field is invalid/);
    expect(() => parseSourceCorrections([player, player])).toThrow(/Duplicate/);
  });

  it("allows explicitly reviewed alternative video evidence only for missing game and roster rows", () => {
    const row = { GameId: "manual-vod:abcdefghijk:1", MatchId: "m1", Tournament: "LCK", DateTime_UTC: "2026-08-01T11:11:00Z", N_GameInMatch: 1, Team1: "A", Team2: "B", Winner: 2 };
    const alternative = { ...proof, sourceKind: "reviewed-alternative", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk", corroboratingUrls: ["https://www.inven.co.kr/webzine/news/?news=123"], table: "ScoreboardGames", key: "GameId", value: row.GameId, row };
    const rules = parseSourceCorrections([alternative]);
    const retained = alternativeReviewEvidence(rules, new Set([row.GameId]));
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({ action: "review", sourceUrl: alternative.sourceUrl, response: { kind: "reviewed-alternative", corrections: rules } });
    expect(alternativeReviewEvidence(rules, new Set(["other-game"]))).toEqual([]);
    expect(alternativeReviewEvidence(rules, new Set([row.GameId]))).toEqual(retained);
    expect(() => parseSourceCorrections([{ ...alternative, sourceKind: undefined }])).toThrow(/reviewed Leaguepedia/);
    expect(() => parseSourceCorrections([{ ...alternative, table: "Players", key: "OverviewPage" }])).toThrow(/Alternative game corrections/);
    expect(() => parseSourceCorrections([{ ...alternative, corroboratingUrls: [] }])).toThrow(/corroborating/);
    expect(() => parseSourceCorrections([{ ...alternative, sourceUrl: "https://www.youtube.com.evil.example/watch?v=abcdefghijk" }])).toThrow(/Alternative/);
  });

  it("maps live request IDs and retained rows consistently without mutating raw evidence", () => {
    const rules = parseSourceCorrections([alias, { ...proof, table: "MatchSchedule", key: "MatchId", value: "schedule-1", field: "BestOf", expected: null, replacement: 5 }]);
    const raw = [{ MatchId: "schedule-1", BestOf: null, Team1Score: 3, Team2Score: 2 }];
    expect(sourceScheduleIds(["games-1", "unaffected"], rules)).toEqual(["schedule-1", "unaffected"]);
    expect(projectSourceRows("MatchSchedule", raw, rules)).toEqual([{ ...raw[0], MatchId: "games-1", BestOf: 5 }]);
    expect(raw[0]).toEqual({ MatchId: "schedule-1", BestOf: null, Team1Score: 3, Team2Score: 2 });
  });

  it("fills absent profiles while preserving existing upstream rows", () => {
    const rules = parseSourceCorrections([{ ...proof, table: "Players", key: "OverviewPage", value: "Levi", row: { OverviewPage: "Levi", Name: "Reviewed name" } }]);
    expect(projectSourceRows("Players", [], rules)).toEqual([{ OverviewPage: "Levi", Name: "Reviewed name" }]);
    expect(projectSourceRows("Players", [{ OverviewPage: "Levi", Name: "Updated upstream name" }], rules)).toEqual([{ OverviewPage: "Levi", Name: "Updated upstream name" }]);
  });

  it("projects reindexed schedules once against original IDs, including ID swaps", () => {
    const rules = parseSourceCorrections([
      { ...alias, value: "first", expected: "first", replacement: "second" },
      { ...alias, value: "second", expected: "second", replacement: "first" },
    ]);
    const raw = [{ MatchId: "first", Team1: "A" }, { MatchId: "second", Team1: "B" }];
    expect(projectSourceRows("MatchSchedule", raw, rules)).toEqual([{ MatchId: "second", Team1: "A" }, { MatchId: "first", Team1: "B" }]);
  });

  it("rejects changed upstream format and accepts an upstream fix", () => {
    const rules = parseSourceCorrections([{ ...proof, table: "MatchSchedule", key: "OverviewPage", value: "BO3 split", field: "BestOf", expected: null, replacement: 3 }]);
    expect(() => projectSourceRows("MatchSchedule", [{ OverviewPage: "BO3 split", BestOf: 1 }], rules)).toThrow(/conflicts with upstream/);
    expect(projectSourceRows("MatchSchedule", [{ OverviewPage: "BO3 split", BestOf: 3 }], rules)[0]!.BestOf).toBe(3);
  });

  it("restricts historical team label corrections to an exact match and original value", () => {
    const rules = parseSourceCorrections([{ ...proof, table: "MatchSchedule", key: "MatchId", value: "early-match", field: "Team2", expected: "Team OP", replacement: "Xenics Storm" }]);
    expect(projectSourceRows("MatchSchedule", [{ MatchId: "early-match", Team2: "Team OP" }, { MatchId: "later-match", Team2: "Team OP" }], rules).map((row) => row.Team2)).toEqual(["Xenics Storm", "Team OP"]);
    expect(() => projectSourceRows("MatchSchedule", [{ MatchId: "early-match", Team2: "Other team" }], rules)).toThrow(/conflicts/);
  });

  it("rejects duplicate or ambiguous aliases and unsupported modifications", () => {
    expect(() => parseSourceCorrections([alias, alias])).toThrow(/Duplicate/);
    expect(() => parseSourceCorrections([alias, { ...alias, value: "another-schedule", expected: "another-schedule" }])).toThrow(/Ambiguous/);
    expect(() => parseSourceCorrections([{ ...alias, sourceUrl: "https://unreviewed.example/wiki/Test" }])).toThrow(/reviewed Leaguepedia/);
    expect(() => parseSourceCorrections([{ ...alias, field: "Team1Score", replacement: 3 }])).toThrow(/field is invalid/);
    expect(() => parseSourceCorrections([{ ...alias, key: "Team1" }])).toThrow(/primary key/);
  });

  it("allows distinct reviewed players per game, preserves upstream rows, and rejects duplicate roster rules", () => {
    const correction = { ...proof, table: "ScoreboardPlayers", key: "GameId", value: "g1", row: { GameId: "g1", PlayerName: "p1", Team: "A", PlayerWin: "Yes" } };
    const rules = parseSourceCorrections([correction, { ...correction, row: { ...correction.row, PlayerName: "p2" } }]);
    const raw = [{ ...correction.row, PlayerWin: "No" }];
    expect(projectSourceRows("ScoreboardPlayers", raw, rules)).toEqual([raw[0], { ...correction.row, PlayerName: "p2" }]);
    expect(() => parseSourceCorrections([correction, correction])).toThrow(/Duplicate/);
    expect(() => parseSourceCorrections([{ ...correction, row: { ...correction.row, PlayerWin: "unknown" } }])).toThrow(/roster row/);
  });

  it("supplements a game only when the same series and tournament were observed", () => {
    const row = { GameId: "rpgid:123", MatchId: "m1", Tournament: "LCK 2023 Spring", DateTime_UTC: "2023-02-15T08:57:00Z", N_GameInMatch: 2, Team1: "A", Team2: "B", Winner: 1 };
    const rules = parseSourceCorrections([{ ...proof, table: "ScoreboardGames", key: "GameId", value: row.GameId, row }]);
    const anchor = { ...row, GameId: "g1", N_GameInMatch: 1 };
    expect(projectSourceRows("ScoreboardGames", [anchor], rules)).toEqual([anchor, row]);
    expect(projectSourceRows("ScoreboardGames", [{ ...anchor, Tournament: "Other tournament" }], rules)).toHaveLength(1);
    expect(projectSourceRows("ScoreboardGames", [], rules)).toEqual([]);
    expect(projectSourceRows("ScoreboardGames", [anchor, row], rules)).toHaveLength(2);
    expect(projectSourceRows("ScoreboardGames", [anchor, { ...row, GameId: "upstream-fixed-game" }], rules).map((game) => game.GameId)).toEqual(["g1", "upstream-fixed-game"]);
    expect(() => parseSourceCorrections([{ ...proof, table: "ScoreboardGames", key: "GameId", value: row.GameId, row: { ...row, Winner: 0 } }])).toThrow(/game row/);
  });
});
