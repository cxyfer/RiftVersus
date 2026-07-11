import { describe, expect, it } from "vitest";

import { groupGamesIntoSeries } from "../src/series-grouping.js";

const game = (id: string, gameNumber: number, winnerTeamId: string | null, playedAt = "2024-05-01T12:00:00.000Z") => ({
  id,
  tournamentId: "worlds",
  teamAId: "t1",
  teamBId: "weibo",
  gameNumber,
  winnerTeamId,
  playedAt,
});

describe("series grouping", () => {
  it("uses explicit series metadata before derived grouping", () => {
    const result = groupGamesIntoSeries([game("g1", 1, "t1"), game("g2", 1, "weibo")], [{ id: "explicit", gameIds: ["g1", "g2"] }]);

    expect(result.errors).toEqual([]);
    expect(result.series).toEqual([
      expect.objectContaining({ id: "explicit", source: "explicit", gameIds: ["g1", "g2"] }),
    ]);
  });

  it("derives only bounded, same-opponent games with unique numbers and a winner", () => {
    const result = groupGamesIntoSeries([
      game("g1", 1, "t1"),
      game("g2", 2, "t1", "2024-05-01T13:00:00.000Z"),
      game("g3", 3, "weibo", "2024-05-01T14:00:00.000Z"),
    ], []);

    expect(result.errors).toEqual([]);
    expect(result.series).toEqual([
      expect.objectContaining({ source: "derived", gameIds: ["g1", "g2", "g3"], winnerTeamId: "t1" }),
    ]);
  });

  it("derives a BO1 from its single completed game", () => {
    const result = groupGamesIntoSeries([game("g-bo1", 1, "t1")], []);

    expect(result.errors).toEqual([]);
    expect(result.series).toEqual([expect.objectContaining({ gameIds: ["g-bo1"], winnerTeamId: "t1" })]);
  });

  it("splits games outside the derived time window into separate series", () => {
    const result = groupGamesIntoSeries([
      game("g-first", 1, "t1"),
      game("g-later", 1, "weibo", "2024-05-02T00:00:01.000Z"),
    ], []);

    expect(result.errors).toEqual([]);
    expect(result.series).toEqual([
      expect.objectContaining({ source: "derived", gameIds: ["g-first"], winnerTeamId: "t1" }),
      expect.objectContaining({ source: "derived", gameIds: ["g-later"], winnerTeamId: "weibo" }),
    ]);
  });

  it.each([
    ["has no game winner", [game("g-missing", 1, null)]],
    ["has a tied game result", [game("g-tied-a", 1, "t1"), game("g-tied-b", 2, "weibo")]],
  ])("returns AMBIGUOUS_RESULT when a derived group %s", (_description, games) => {
    const result = groupGamesIntoSeries(games, []);

    expect(result.series).toEqual([]);
    expect(result.errors).toEqual([expect.objectContaining({ code: "AMBIGUOUS_RESULT" })]);
  });

  it("returns validation errors for ambiguous derived groups instead of guessing", () => {
    const result = groupGamesIntoSeries([game("g1", 1, "t1"), game("g2", 1, "weibo")], []);

    expect(result.series).toEqual([]);
    expect(result.errors).toEqual([expect.objectContaining({ code: "DUPLICATE_GAME_NUMBER" })]);
  });
});
