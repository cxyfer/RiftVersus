import { describe, expect, it } from "vitest";

import type { ComparisonQuery, DomainSeries } from "../src/comparison.js";
import { qualifiesSeries, resolveDirectGame, summarizeComparison } from "../src/comparison.js";

const ids = {
  t1: "11111111-1111-4111-8111-111111111111",
  sktEra: "11111111-1111-4111-8111-111111111112",
  t1Era: "11111111-1111-4111-8111-111111111113",
  lpl: "22222222-2222-4222-8222-222222222221",
  lck: "22222222-2222-4222-8222-222222222222",
  weibo: "33333333-3333-4333-8333-333333333331",
  genG: "33333333-3333-4333-8333-333333333332",
  faker: "44444444-4444-4444-8444-444444444441",
  xiaohu: "44444444-4444-4444-8444-444444444442",
  substitute: "44444444-4444-4444-8444-444444444443",
  worlds: "55555555-5555-4555-855555555551",
  lck: "55555555-5555-4555-855555555552",
  ssk: "66666666-6666-4666-8666-666666666661",
  st1: "66666666-6666-4666-8666-666666666662",
  sincomplete: "66666666-6666-4666-8666-666666666663",
  schange: "66666666-6666-4666-8666-666666666664",
};

const query = (left: ComparisonQuery["left"], right: ComparisonQuery["right"]): ComparisonQuery => ({
  left,
  right,
  eventCategories: [],
  leagues: [],
  bestOf: [],
  tournamentIds: [],
  limit: 50,
});

const t1 = (eraId: string, regionId = ids.lck, playerIds = [ids.faker]) => ({
  teamId: ids.t1,
  eraId,
  regionId,
  playerIds,
});

const weibo = (playerIds = [ids.xiaohu]) => ({
  teamId: ids.weibo,
  eraId: "77777777-7777-4777-8777-777777777771",
  regionId: ids.lpl,
  playerIds,
});

const genG = () => ({
  teamId: ids.genG,
  eraId: "77777777-7777-4777-8777-777777777772",
  regionId: ids.lck,
  playerIds: [],
});

const series = (input: Partial<DomainSeries> & Pick<DomainSeries, "id" | "sides" | "games">): DomainSeries => ({
  id: input.id,
  date: input.date ?? "2024-11-02",
  tournament: input.tournament ?? { id: ids.worlds, name: "World Championship", category: "worlds" },
  bestOf: input.bestOf ?? 5,
  sides: input.sides,
  games: input.games,
  completed: input.completed ?? true,
  winnerSide: input.winnerSide ?? "a",
  score: input.score ?? { a: 3, b: 1 },
});

const game = (id: string, seriesId: string, sides: DomainSeries["sides"], winnerSide: "a" | "b" = "a") => ({
  id,
  seriesId,
  playedAt: "2024-11-02T12:00:00.000Z",
  gameNumber: 1,
  sides,
  winnerSide,
});

describe("comparison domain semantics", () => {
  it("excludes a team from its own match-time region side", () => {
    const sides = [t1(ids.t1Era), weibo()] as const;
    const item = game("g-own-region", ids.st1, sides);

    expect(resolveDirectGame(query({ kind: "team", id: ids.t1 }, { kind: "region", id: ids.lck }), item)).toBeNull();
  });

  it("requires player opponents to play in the same game", () => {
    const sides = [t1(ids.t1Era, ids.lck, [ids.faker]), weibo([])] as const;
    const item = game("g-player", ids.st1, sides);

    expect(resolveDirectGame(query({ kind: "player", id: ids.faker }, { kind: "player", id: ids.xiaohu }), item)).toBeNull();
  });

  it("counts a qualifying player series once while retaining only direct games", () => {
    const sides = [t1(ids.t1Era), weibo()] as const;
    const first = game("g-first", ids.st1, sides, "a");
    const benched = game("g-benched", ids.st1, [t1(ids.t1Era, ids.lck, [ids.substitute]), weibo()] as const, "b");
    const item = series({ id: ids.st1, sides, games: [first, benched] });
    const playerQuery = query({ kind: "player", id: ids.faker }, { kind: "team", id: ids.weibo });

    expect(qualifiesSeries(playerQuery, item)).toBe(true);
    expect(resolveDirectGame(playerQuery, benched)).toBeNull();
    expect(summarizeComparison(playerQuery, [item, item])).toEqual({
      series: { wins: 1, losses: 0, total: 1, winRate: 1 },
      games: { wins: 1, losses: 0, total: 1, winRate: 1 },
    });
  });

  it("keeps a player series win when game sides are reversed from series sides", () => {
    const seriesSides = [t1(ids.t1Era, ids.lck, []), weibo()] as const;
    const reversedGameSides = [weibo(), t1(ids.t1Era, ids.lck, [ids.faker])] as const;
    const directGame = game("g-reversed", ids.st1, reversedGameSides, "b");
    const item = series({ id: ids.st1, sides: seriesSides, games: [directGame], winnerSide: "a" });
    const playerQuery = query({ kind: "player", id: ids.faker }, { kind: "team", id: ids.weibo });

    expect(resolveDirectGame(playerQuery, directGame)).toMatchObject({ winner: "left" });
    expect(summarizeComparison(playerQuery, [item])).toEqual({
      series: { wins: 1, losses: 0, total: 1, winRate: 1 },
      games: { wins: 1, losses: 0, total: 1, winRate: 1 },
    });
  });

  it("matches a lineage across SKT and T1 but restricts an exact era", () => {
    const sktSides = [t1(ids.sktEra), weibo()] as const;
    const t1Sides = [t1(ids.t1Era), weibo()] as const;
    const sktSeries = series({ id: ids.ssk, sides: sktSides, games: [game("g-skt", ids.ssk, sktSides)] });
    const t1Series = series({ id: ids.st1, sides: t1Sides, games: [game("g-t1", ids.st1, t1Sides)] });

    expect(summarizeComparison(query({ kind: "team", id: ids.t1 }, { kind: "team", id: ids.weibo }), [sktSeries, t1Series]).series.total).toBe(2);
    expect(
      summarizeComparison(
        query({ kind: "team", id: ids.t1, teamEraId: ids.t1Era }, { kind: "team", id: ids.weibo }),
        [sktSeries, t1Series],
      ).series.total,
    ).toBe(1);
  });

  it("uses stored match-time region and omits incomplete series results", () => {
    const changedSides = [t1(ids.t1Era, ids.lpl), genG()] as const;
    const incompleteSides = [t1(ids.t1Era, ids.lpl), genG()] as const;
    const changed = series({ id: ids.schange, sides: changedSides, games: [game("g-change", ids.schange, changedSides)] });
    const incomplete = series({
      id: ids.sincomplete,
      sides: incompleteSides,
      games: [game("g-incomplete", ids.sincomplete, incompleteSides)],
      completed: false,
      winnerSide: null,
      score: { a: 1, b: 0 },
    });
    const regionQuery = query({ kind: "team", id: ids.t1 }, { kind: "region", id: ids.lck });

    expect(qualifiesSeries(regionQuery, changed)).toBe(true);
    expect(summarizeComparison(regionQuery, [changed, incomplete])).toEqual({
      series: { wins: 1, losses: 0, total: 1, winRate: 1 },
      games: { wins: 1, losses: 0, total: 1, winRate: 1 },
    });
  });

  it("respects category and best-of filters", () => {
    const worldsSides = [t1(ids.t1Era), weibo()] as const;
    const lckSides = [t1(ids.t1Era), genG()] as const;
    const worlds = series({ id: ids.st1, sides: worldsSides, games: [game("g-worlds", ids.st1, worldsSides)], bestOf: 5 });
    const league = series({
      id: ids.ssk,
      sides: lckSides,
      games: [game("g-lck", ids.ssk, lckSides)],
      bestOf: 3,
      tournament: { id: ids.lck, name: "LCK", category: "league" },
    });
    const filtered = {
      ...query({ kind: "team", id: ids.t1 }, { kind: "region", id: ids.lpl }),
      eventCategories: ["worlds"] as const,
      bestOf: [5] as const,
    };

    expect(qualifiesSeries(filtered, worlds)).toBe(true);
    expect(qualifiesSeries(filtered, league)).toBe(false);
  });
});
