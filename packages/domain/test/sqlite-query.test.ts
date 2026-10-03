import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import type { ComparisonQuery } from "@riftversus/contracts";

import { compareSqlite, searchSqlite, type SqliteExecutor } from "../src/sqlite-query.js";
import { createSqliteSchema } from "../src/sqlite-schema.js";

const ids = {
  t1: "11111111-1111-4111-8111-111111111111",
  sktEra: "11111111-1111-4111-8111-111111111112",
  t1Era: "11111111-1111-4111-8111-111111111113",
  blg: "22222222-2222-4222-8222-222222222221",
  genG: "22222222-2222-4222-8222-222222222222",
  lck: "33333333-3333-4333-8333-333333333331",
  lpl: "33333333-3333-4333-8333-333333333332",
  faker: "44444444-4444-4444-8444-444444444441",
  oner: "44444444-4444-4444-8444-444444444442",
  xiaohu: "44444444-4444-4444-8444-444444444443",
  worlds: "55555555-5555-4555-8555-555555555551",
  lckCup: "55555555-5555-4555-8555-555555555552",
  oldSeries: "66666666-6666-4666-8666-666666666661",
  swappedSeries: "66666666-6666-4666-8666-666666666662",
  newSeries: "66666666-6666-4666-8666-666666666663",
  leagueSeries: "66666666-6666-4666-8666-666666666664",
  regionRosterSeries: "66666666-6666-4666-8666-666666666666",
  oldGame: "77777777-7777-4777-8777-777777777771",
  swappedGameOne: "77777777-7777-4777-8777-777777777772",
  swappedGameTwo: "77777777-7777-4777-8777-777777777773",
  newGame: "77777777-7777-4777-8777-777777777774",
  leagueGame: "77777777-7777-4777-8777-777777777775",
  regionRosterGame: "77777777-7777-4777-8777-777777777776",
};

const snapshotId = `sha256:${"a".repeat(64)}`;

const query = (left: ComparisonQuery["left"], right: ComparisonQuery["right"]): ComparisonQuery => ({
  left,
  right,
  eventCategories: [],
  leagues: [],
  bestOf: [],
  tournamentIds: [],
  limit: 50,
});

interface Fixture {
  database: DatabaseSync;
  executor: SqliteExecutor;
}

const fixtures: Fixture[] = [];

function createFixture(): Fixture {
  const database = new DatabaseSync(":memory:");
  createSqliteSchema(database);

  const insert = (sql: string, params: readonly (string | number | null)[]) => database.prepare(sql).run(...params);
  const media = (name: string) => `/presentation/${name}.svg`;
  const addEntity = (input: {
    variantId: string;
    entityId: string;
    kind: "team" | "region" | "player";
    teamEraId?: string | null;
    displayName: string;
    realName?: string | null;
    eraLabel?: string | null;
    canonicalName: string;
    slug: string;
    avatarLabel: string;
  }) => insert(
    `INSERT INTO entity_variants
      (variant_id, entity_id, kind, team_era_id, display_name, real_name, era_label, canonical_name, slug, avatar_label, retained_object_key, media_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.variantId, input.entityId, input.kind, input.teamEraId ?? null, input.displayName, input.realName ?? null, input.eraLabel ?? null, input.canonicalName, input.slug, input.avatarLabel, null, media(input.slug)],
  );
  const addTerms = (entityId: string, terms: readonly string[]) => terms.forEach((term) => insert("INSERT INTO search_terms (entity_id, term) VALUES (?, ?)", [entityId, term.toLowerCase()]));

  addEntity({ variantId: "t1:base", entityId: ids.t1, kind: "team", displayName: "T1", canonicalName: "T1", slug: "t1", avatarLabel: "T1" });
  addEntity({ variantId: "t1:skt", entityId: ids.t1, kind: "team", teamEraId: ids.sktEra, displayName: "SK Telecom T1", eraLabel: "SK Telecom T1", canonicalName: "T1", slug: "t1", avatarLabel: "T1" });
  addEntity({ variantId: "t1:current", entityId: ids.t1, kind: "team", teamEraId: ids.t1Era, displayName: "T1", eraLabel: "T1", canonicalName: "T1", slug: "t1", avatarLabel: "T1" });
  addEntity({ variantId: "blg:base", entityId: ids.blg, kind: "team", displayName: "Bilibili Gaming", canonicalName: "Bilibili Gaming", slug: "bilibili-gaming", avatarLabel: "BLG" });
  addEntity({ variantId: "gen-g:base", entityId: ids.genG, kind: "team", displayName: "Gen.G", canonicalName: "Gen.G", slug: "gen-g", avatarLabel: "GEN" });
  addEntity({ variantId: "lck:base", entityId: ids.lck, kind: "region", displayName: "LCK", canonicalName: "LCK", slug: "lck", avatarLabel: "LCK" });
  addEntity({ variantId: "lpl:base", entityId: ids.lpl, kind: "region", displayName: "LPL", canonicalName: "LPL", slug: "lpl", avatarLabel: "LPL" });
  addEntity({ variantId: "faker:base", entityId: ids.faker, kind: "player", displayName: "Faker", realName: "Lee Sang-hyeok", canonicalName: "Lee Sang-hyeok", slug: "faker", avatarLabel: "FAK" });
  addEntity({ variantId: "oner:base", entityId: ids.oner, kind: "player", displayName: "Oner", realName: "Moon Hyeon-jun", canonicalName: "Moon Hyeon-jun", slug: "oner", avatarLabel: "ONE" });
  addEntity({ variantId: "xiaohu:base", entityId: ids.xiaohu, kind: "player", displayName: "Xiaohu", realName: "Li Yuan-Hao", canonicalName: "Li Yuan-Hao", slug: "xiaohu", avatarLabel: "XIA" });
  addTerms(ids.t1, ["t1", "sk telecom", "skt"]);
  addTerms(ids.blg, ["bilibili gaming", "blg"]);
  addTerms(ids.genG, ["gen.g", "gen-g"]);
  addTerms(ids.lck, ["lck"]);
  addTerms(ids.lpl, ["lpl"]);
  addTerms(ids.faker, ["faker", "lee sang-hyeok", "unkillable demon king"]);
  addTerms(ids.oner, ["oner", "moon hyeon-jun"]);
  addTerms(ids.xiaohu, ["xiaohu", "li yuan-hao"]);

  insert("INSERT INTO metadata (key, value) VALUES (?, ?)", ["dataset", JSON.stringify({ version: "sqlite-v1", lastSuccessfulSyncAt: "2026-09-13T00:00:00.000Z", coverage: { from: "2023-01-01", to: "2026-09-13" } })]);
  insert("INSERT INTO metadata (key, value) VALUES (?, ?)", ["coverageWarnings", JSON.stringify([{ code: "PARTIAL_EVENT_COVERAGE", message: "Some scopes are pending review." }])]);
  insert("INSERT INTO tournaments (id, name, category, league_slug) VALUES (?, ?, ?, ?)", [ids.worlds, "World Championship", "worlds", null]);
  insert("INSERT INTO tournaments (id, name, category, league_slug) VALUES (?, ?, ?, ?)", [ids.lckCup, "LCK Spring", "league", "lck"]);

  const addSeries = (input: {
    id: string;
    playedAt: string;
    date: string;
    tournamentId: string;
    aTeam: string;
    bTeam: string;
    aEra: string | null;
    bEra: string | null;
    aRegion: string;
    bRegion: string;
    aName: string;
    bName: string;
    aScore: number;
    bScore: number;
    winner: string;
  }) => insert(
    `INSERT INTO series_facts
      (id, played_at, date, tournament_id, best_of, side_a_team_id, side_b_team_id, side_a_era_id, side_b_era_id, side_a_region_id, side_b_region_id, side_a_name, side_b_name, side_a_score, side_b_score, winner_team_id)
      VALUES (?, ?, ?, ?, 5, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.id, input.playedAt, input.date, input.tournamentId, input.aTeam, input.bTeam, input.aEra, input.bEra, input.aRegion, input.bRegion, input.aName, input.bName, input.aScore, input.bScore, input.winner],
  );
  addSeries({ id: ids.oldSeries, playedAt: "2023-11-01T12:00:00.000Z", date: "2023-11-01", tournamentId: ids.worlds, aTeam: ids.t1, bTeam: ids.blg, aEra: ids.sktEra, bEra: null, aRegion: ids.lck, bRegion: ids.lpl, aName: "SK Telecom T1", bName: "Bilibili Gaming", aScore: 3, bScore: 1, winner: ids.t1 });
  addSeries({ id: ids.swappedSeries, playedAt: "2024-11-02T12:00:00.000Z", date: "2024-11-02", tournamentId: ids.worlds, aTeam: ids.t1, bTeam: ids.blg, aEra: ids.t1Era, bEra: null, aRegion: ids.lck, bRegion: ids.lpl, aName: "T1", bName: "Bilibili Gaming", aScore: 3, bScore: 2, winner: ids.t1 });
  addSeries({ id: ids.newSeries, playedAt: "2024-11-01T12:00:00.000Z", date: "2024-11-01", tournamentId: ids.worlds, aTeam: ids.t1, bTeam: ids.blg, aEra: ids.t1Era, bEra: null, aRegion: ids.lck, bRegion: ids.lpl, aName: "T1", bName: "Bilibili Gaming", aScore: 3, bScore: 0, winner: ids.t1 });
  addSeries({ id: ids.leagueSeries, playedAt: "2024-05-01T12:00:00.000Z", date: "2024-05-01", tournamentId: ids.lckCup, aTeam: ids.t1, bTeam: ids.genG, aEra: ids.t1Era, bEra: null, aRegion: ids.lck, bRegion: ids.lck, aName: "T1", bName: "Gen.G", aScore: 3, bScore: 1, winner: ids.t1 });
  addSeries({ id: ids.regionRosterSeries, playedAt: "2024-03-01T12:00:00.000Z", date: "2024-03-01", tournamentId: ids.worlds, aTeam: ids.t1, bTeam: ids.blg, aEra: ids.t1Era, bEra: null, aRegion: ids.lck, bRegion: ids.lpl, aName: "T1", bName: "Bilibili Gaming", aScore: 3, bScore: 0, winner: ids.t1 });

  const addGame = (input: {
    id: string;
    seriesId: string;
    playedAt: string;
    aTeam: string;
    bTeam: string;
    aEra: string | null;
    bEra: string | null;
    aRegion: string;
    bRegion: string;
    aName: string;
    bName: string;
    winner: string | null;
  }) => insert(
    `INSERT INTO game_facts
      (id, series_id, played_at, game_number, side_a_team_id, side_b_team_id, side_a_era_id, side_b_era_id, side_a_region_id, side_b_region_id, side_a_name, side_b_name, winner_team_id)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.id, input.seriesId, input.playedAt, input.aTeam, input.bTeam, input.aEra, input.bEra, input.aRegion, input.bRegion, input.aName, input.bName, input.winner],
  );
  const addPlayer = (gameId: string, side: Side, playerId: string) => insert("INSERT INTO game_players (game_id, side, player_entity_id) VALUES (?, ?, ?)", [gameId, side, playerId]);
  addGame({ id: ids.oldGame, seriesId: ids.oldSeries, playedAt: "2023-11-01T12:00:00.000Z", aTeam: ids.t1, bTeam: ids.blg, aEra: ids.sktEra, bEra: null, aRegion: ids.lck, bRegion: ids.lpl, aName: "SK Telecom T1", bName: "Bilibili Gaming", winner: ids.t1 });
  addPlayer(ids.oldGame, "a", ids.faker); addPlayer(ids.oldGame, "b", ids.xiaohu);
  addGame({ id: ids.swappedGameOne, seriesId: ids.swappedSeries, playedAt: "2024-11-02T12:00:00.000Z", aTeam: ids.t1, bTeam: ids.blg, aEra: ids.t1Era, bEra: null, aRegion: ids.lck, bRegion: ids.lpl, aName: "T1", bName: "Bilibili Gaming", winner: ids.t1 });
  addPlayer(ids.swappedGameOne, "a", ids.faker); addPlayer(ids.swappedGameOne, "b", ids.xiaohu);
  addGame({ id: ids.swappedGameTwo, seriesId: ids.swappedSeries, playedAt: "2024-11-02T13:00:00.000Z", aTeam: ids.t1, bTeam: ids.blg, aEra: ids.t1Era, bEra: null, aRegion: ids.lck, bRegion: ids.lpl, aName: "T1", bName: "Bilibili Gaming", winner: ids.blg });
  addPlayer(ids.swappedGameTwo, "a", ids.oner); addPlayer(ids.swappedGameTwo, "b", ids.xiaohu);
  addGame({ id: ids.newGame, seriesId: ids.newSeries, playedAt: "2024-11-01T12:00:00.000Z", aTeam: ids.t1, bTeam: ids.blg, aEra: ids.t1Era, bEra: null, aRegion: ids.lck, bRegion: ids.lpl, aName: "T1", bName: "Bilibili Gaming", winner: ids.t1 });
  addPlayer(ids.newGame, "a", ids.faker); addPlayer(ids.newGame, "b", ids.xiaohu);
  addGame({ id: ids.leagueGame, seriesId: ids.leagueSeries, playedAt: "2024-05-01T12:00:00.000Z", aTeam: ids.t1, bTeam: ids.genG, aEra: ids.t1Era, bEra: null, aRegion: ids.lck, bRegion: ids.lck, aName: "T1", bName: "Gen.G", winner: ids.t1 });
  addGame({ id: ids.regionRosterGame, seriesId: ids.regionRosterSeries, playedAt: "2024-03-01T12:00:00.000Z", aTeam: ids.t1, bTeam: ids.blg, aEra: ids.t1Era, bEra: null, aRegion: ids.lpl, bRegion: ids.lck, aName: "T1", bName: "Bilibili Gaming", winner: ids.t1 });
  addPlayer(ids.regionRosterGame, "a", ids.xiaohu);

  const executor: SqliteExecutor = {
    async all<T extends Record<string, unknown>>(sql: string, params: readonly (string | number | null)[]): Promise<T[]> {
      return database.prepare(sql).all(...params) as T[];
    },
  };
  const fixture = { database, executor };
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.database.close();
});

describe("SQLite query layer", () => {
  it.each([
    [{ kind: "team", id: ids.t1 }, { kind: "team", id: ids.blg }, 4, 5],
    [{ kind: "team", id: ids.t1 }, { kind: "region", id: ids.lpl }, 4, 4],
    [{ kind: "team", id: ids.t1 }, { kind: "player", id: ids.xiaohu }, 3, 4],
    [{ kind: "player", id: ids.faker }, { kind: "player", id: ids.xiaohu }, 3, 3],
    [{ kind: "player", id: ids.faker }, { kind: "region", id: ids.lpl }, 3, 3],
    [{ kind: "region", id: ids.lck }, { kind: "region", id: ids.lpl }, 4, 5],
  ] as const)("preserves complete pagination and totals for %j versus %j", async (left, right, seriesTotal, gameTotal) => {
    const { executor } = createFixture();
    for (const [a, b] of [[left, right], [right, left]]) {
      const full = await compareSqlite(executor, query(a!, b!), snapshotId);
      const rows = [];
      let cursor: string | undefined;
      do {
        const page = await compareSqlite(executor, { ...query(a!, b!), limit: 1, ...(cursor ? { cursor } : {}) }, snapshotId);
        expect(page.seriesSummary).toEqual(full.seriesSummary);
        expect(page.gameSummary).toEqual(full.gameSummary);
        rows.push(...page.rows);
        cursor = page.nextCursor;
      } while (cursor);
      expect(rows).toEqual(full.rows);
      expect(full.seriesSummary.total).toBe(seriesTotal);
      expect(full.gameSummary.total).toBe(gameTotal);
    }
  });

  it("keeps series dates authoritative when a directly matching game has a different date", async () => {
    const { executor, database } = createFixture();
    database.prepare("UPDATE game_facts SET played_at = ? WHERE id = ?").run("2025-01-01T00:00:00.000Z", ids.oldGame);
    const response = await compareSqlite(executor, { ...query({ kind: "player", id: ids.faker }, { kind: "player", id: ids.xiaohu }), from: "2023-11-01", to: "2023-11-01" }, snapshotId);
    expect(response.rows.map(row => row.id)).toEqual([ids.oldSeries]);
    expect(response.gameSummary.total).toBe(1);
  });

  it("searches literal terms and returns only team-era variants when eras exist", async () => {
    const { executor } = createFixture();

    expect(await searchSqlite(executor, "Faker", ["player"])).toEqual([
      expect.objectContaining({ kind: "player", id: ids.faker, displayName: "Faker", realName: "Lee Sang-hyeok" }),
    ]);
    expect((await searchSqlite(executor, "SKT", ["team"])).map((item) => item.teamEraId)).toEqual([ids.sktEra, ids.t1Era]);
    expect(await searchSqlite(executor, "%", ["team"])).toEqual([]);
  });

  it("matches opposite-side players through game rosters and keeps all-match summaries", async () => {
    const { executor } = createFixture();
    const response = await compareSqlite(executor, query({ kind: "player", id: ids.faker }, { kind: "player", id: ids.xiaohu }), snapshotId);

    expect(response.rows.map((row) => row.id)).toEqual([ids.swappedSeries, ids.newSeries, ids.oldSeries]);
    expect(response.rows[0]).toMatchObject({ leftName: "T1", rightName: "Bilibili Gaming" });
    expect(response.seriesSummary).toEqual({ wins: 3, losses: 0, total: 3, winRate: 1 });
    expect(response.gameSummary).toEqual({ wins: 3, losses: 0, total: 3, winRate: 1 });
    expect(response.dataset.version).toBe("sqlite-v1");
  });

  it("applies league/date filters and excludes no-match rows from the SQL result", async () => {
    const { executor } = createFixture();
    const response = await compareSqlite(executor, {
      ...query({ kind: "team", id: ids.t1 }, { kind: "region", id: ids.lck }),
      leagues: ["lck"],
      from: "2024-01-01",
      to: "2024-12-31",
    }, snapshotId);

    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]).toMatchObject({ id: ids.leagueSeries, leftName: "T1", rightName: "Gen.G", winner: "left" });
  });

  it("uses series-side team orientation when the right player changes region/team affiliation in a game", async () => {
    const { executor } = createFixture();
    const response = await compareSqlite(executor, query({ kind: "region", id: ids.lck }, { kind: "player", id: ids.xiaohu }), snapshotId);

    expect(response.rows.find((row) => row.id === ids.regionRosterSeries)).toMatchObject({ id: ids.regionRosterSeries, leftName: "T1", rightName: "Bilibili Gaming", winner: "left" });
    expect(response.seriesSummary).toEqual({ wins: 4, losses: 0, total: 4, winRate: 1 });
    expect(response.gameSummary).toEqual({ wins: 3, losses: 2, total: 5, winRate: 0.6 });
  });

  it("binds keyset cursors to the snapshot while aggregating summaries over every match", async () => {
    const { executor } = createFixture();
    const first = await compareSqlite(executor, { ...query({ kind: "team", id: ids.t1 }, { kind: "team", id: ids.blg }), limit: 1 }, snapshotId);
    expect(first.rows[0]?.id).toBe(ids.swappedSeries);
    expect(first.seriesSummary.total).toBe(4);
    expect(first.nextCursor).toBeTypeOf("string");

    const second = await compareSqlite(executor, { ...query({ kind: "team", id: ids.t1 }, { kind: "team", id: ids.blg }), limit: 1, cursor: first.nextCursor }, snapshotId);
    expect(second.rows[0]?.id).toBe(ids.newSeries);
    expect(second.seriesSummary).toEqual(first.seriesSummary);

    expect(() => compareSqlite(executor, { ...query({ kind: "team", id: ids.t1 }, { kind: "team", id: ids.blg }), cursor: first.nextCursor }, `sha256:${"b".repeat(64)}`)).rejects.toThrow("Invalid comparison cursor");
    await expect(compareSqlite(executor, { ...query({ kind: "team", id: ids.t1 }, { kind: "team", id: ids.blg }), cursor: "malformed" }, snapshotId)).rejects.toThrow("Invalid comparison cursor");
  });

  it("resolves exact team eras and rejects an era from a different team", async () => {
    const { executor } = createFixture();
    const response = await compareSqlite(executor, query({ kind: "team", id: ids.t1, teamEraId: ids.sktEra }, { kind: "team", id: ids.blg }), snapshotId);
    expect(response.subjects.left).toMatchObject({ id: ids.t1, teamEraId: ids.sktEra, displayName: "SK Telecom T1", eraLabel: "SK Telecom T1" });
    await expect(compareSqlite(executor, query({ kind: "team", id: ids.blg, teamEraId: ids.sktEra }, { kind: "team", id: ids.t1 }), snapshotId)).rejects.toThrow("Team era does not belong");
  });
});
