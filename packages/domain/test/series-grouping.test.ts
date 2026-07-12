import { describe, expect, it } from "vitest";

import type { ComparisonQuery, DomainSeries } from "../src/comparison.js";
import { summarizeComparison } from "../src/comparison.js";
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

  it("rejects a duplicate game ID within one explicit series", () => {
    const result = groupGamesIntoSeries(
      [game("g1", 1, "t1"), game("g2", 2, "t1")],
      [{ id: "explicit", gameIds: ["g1", "g2", "g2"] }],
    );

    expect(result.series).toEqual([]);
    expect(result.errors).toEqual([expect.objectContaining({ code: "GAME_ASSIGNED_TWICE", gameIds: ["g2"] })]);
  });

  it("keeps distinct tournament and team tuples out of the same derived bucket", () => {
    const result = groupGamesIntoSeries([
      {
        id: "g-colon-first",
        tournamentId: "event:alpha",
        teamAId: "blue",
        teamBId: "red",
        gameNumber: 1,
        winnerTeamId: "blue",
        playedAt: "2024-05-01T12:00:00.000Z",
      },
      {
        id: "g-colon-second",
        tournamentId: "event",
        teamAId: "alpha:blue",
        teamBId: "red",
        gameNumber: 1,
        winnerTeamId: "alpha:blue",
        playedAt: "2024-05-01T12:00:00.000Z",
      },
    ], []);

    expect(result.errors).toEqual([]);
    expect(result.series).toEqual([
      expect.objectContaining({ tournamentId: "event:alpha", gameIds: ["g-colon-first"] }),
      expect.objectContaining({ tournamentId: "event", gameIds: ["g-colon-second"] }),
    ]);
  });

  it("gives colon-colliding derived tuples distinct series IDs", () => {
    const result = groupGamesIntoSeries([
      {
        id: "d:e",
        tournamentId: "a",
        teamAId: "b",
        teamBId: "c",
        gameNumber: 1,
        winnerTeamId: "b",
        playedAt: "2024-05-01T12:00:00.000Z",
      },
      {
        id: "e",
        tournamentId: "a:b",
        teamAId: "c",
        teamBId: "d",
        gameNumber: 1,
        winnerTeamId: "c",
        playedAt: "2024-05-01T12:00:00.000Z",
      },
    ], []);

    expect(result.errors).toEqual([]);
    expect(result.series).toHaveLength(2);
    expect(new Set(result.series.map((series) => series.id)).size).toBe(2);
    const domainSeries: DomainSeries[] = result.series.map((grouped) => {
      const winnerSide = grouped.winnerTeamId === grouped.teamIds[0] ? "a" : "b";
      return {
        id: grouped.id,
        date: "2024-05-01",
        tournament: { id: grouped.tournamentId, name: "Test tournament", category: "worlds" },
        bestOf: 1,
        sides: [
          { teamId: grouped.teamIds[0], eraId: null, regionId: "left-region", playerIds: [] },
          { teamId: grouped.teamIds[1], eraId: null, regionId: "right-region", playerIds: [] },
        ],
        games: [],
        completed: true,
        winnerSide,
        score: winnerSide === "a" ? { a: 1, b: 0 } : { a: 0, b: 1 },
      };
    });
    const qualifyingQuery: ComparisonQuery = {
      left: { kind: "region", id: "left-region" },
      right: { kind: "region", id: "right-region" },
      eventCategories: [],
      leagues: [],
      bestOf: [],
      tournamentIds: [],
      limit: 50,
    };

    expect(summarizeComparison(qualifyingQuery, domainSeries).series.total).toBe(2);
  });

  it("uses the same derived output for tied match times in any input order", () => {
    const games = [game("g-tied-second", 2, "t1"), game("g-tied-first", 1, "t1")];

    expect(groupGamesIntoSeries(games, [])).toEqual(groupGamesIntoSeries([...games].reverse(), []));
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
