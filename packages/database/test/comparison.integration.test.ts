import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { summarizeComparison } from "@riftversus/domain";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";

import { beginSyncRun, compareHeadToHead, getDatasetStatus, getMediaByKey, listAvailableFilters, publishDataset, searchEntities } from "../src/index.js";
import { createDb, destroyDb } from "../src/db.js";
import { migrateToLatest } from "../src/migrator.js";
import { comparisonOracleFixture, createTestSchemaName, seedComparisonFixture, seedIds } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("comparison repositories", () => {
  const schema = createTestSchemaName();
  const adminPool = new Pool({ connectionString: databaseUrl });
  const db = createDb({ databaseUrl: databaseUrl!, schema });

  beforeAll(async () => {
    await adminPool.query(`create schema ${schema}`);
    await migrateToLatest(db, { schema });
    await seedComparisonFixture(db);
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: run.id, version: "fixture-publication", coverage: [] }, db);
  });
  afterAll(async () => {
    await destroyDb(db);
    await adminPool.query(`drop schema if exists ${schema} cascade`);
    await adminPool.end();
  });

  const query = (left: { kind: "team" | "player" | "region"; id: string; teamEraId?: string }, right: { kind: "team" | "player" | "region"; id: string; teamEraId?: string }) => ({ left, right, eventCategories: [], bestOf: [], tournamentIds: [], limit: 50 });

  it("matches the domain oracle for all nine subject-kind combinations", async () => {
    const subjects = [
      { kind: "team" as const, id: seedIds.t1 },
      { kind: "player" as const, id: seedIds.faker },
      { kind: "region" as const, id: seedIds.lck },
    ];
    const opponents = [
      { kind: "team" as const, id: seedIds.weibo },
      { kind: "player" as const, id: seedIds.xiaohu },
      { kind: "region" as const, id: seedIds.lpl },
    ];
    for (const left of subjects) for (const right of opponents) {
      const response = await compareHeadToHead(query(left, right), db);
      const expected = summarizeComparison(query(left, right), comparisonOracleFixture());
      expect(response.seriesSummary).toEqual(expected.series);
      expect(response.gameSummary).toEqual(expected.games);
    }
  });

  it("keeps independent team lineage/era and applies filters plus keyset pagination", async () => {
    const lineage = await compareHeadToHead(query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), db);
    const exact = await compareHeadToHead(query({ kind: "team", id: seedIds.t1, teamEraId: seedIds.t1Era }, { kind: "team", id: seedIds.weibo }), db);
    expect(lineage.seriesSummary.total).toBe(2);
    expect(exact.seriesSummary.total).toBe(1);
    const filtered = await compareHeadToHead({ ...query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), from: "2024-01-01", eventCategories: ["worlds"], bestOf: [5], limit: 1 }, db);
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.nextCursor).toBeDefined();
    const pageTwo = await compareHeadToHead({ ...query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), limit: 1, cursor: filtered.nextCursor }, db);
    expect(pageTwo.rows[0]?.id).not.toBe(filtered.rows[0]?.id);
    const rightEra = await compareHeadToHead(query({ kind: "team", id: seedIds.weibo }, { kind: "team", id: seedIds.t1, teamEraId: seedIds.t1Era }), db);
    expect(rightEra.seriesSummary.total).toBe(1);
    expect((await compareHeadToHead({ ...query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), to: "2023-12-31" }, db)).seriesSummary.total).toBe(1);
    expect((await compareHeadToHead({ ...query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), tournamentIds: [seedIds.worlds] }, db)).seriesSummary.total).toBe(2);
  });

  it("uses alias search, derived filters, current media, and coverage warnings", async () => {
    expect((await searchEntities({ query: "skt" }, db)).entities).toEqual(expect.arrayContaining([expect.objectContaining({ id: seedIds.t1 })]));
    expect((await listAvailableFilters(db)).eventCategories).toEqual(expect.arrayContaining(["league", "worlds"]));
    expect(await getMediaByKey("media/t1.png", db)).toMatchObject({ objectKey: "media/t1.png" });
    expect(await getDatasetStatus(db)).toBeNull();
    const comparison = await compareHeadToHead(query({ kind: "team", id: seedIds.t1 }, { kind: "region", id: seedIds.lpl }), db);
    expect(comparison.coverageWarnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "NO_PUBLISHED_DATASET" })]));
  });

  it("uses participant and player indexes above the planner threshold", async () => {
    const otherA = randomUUID();
    const otherB = randomUUID();
    const otherPlayer = randomUUID();
    await db.insertInto("entities").values([
      { id: otherA, kind: "team", canonical_name: "Load A", slug: `load-a-${otherA}` },
      { id: otherB, kind: "team", canonical_name: "Load B", slug: `load-b-${otherB}` },
      { id: otherPlayer, kind: "player", canonical_name: "Load Player", slug: `load-p-${otherPlayer}` },
    ]).execute();
    const rows = Array.from({ length: 600 }, (_, index) => {
      const seriesId = randomUUID();
      return { seriesId, gameId: randomUUID(), index };
    });
    await db.insertInto("series_facts").values(rows.map(({ seriesId, index }) => ({
      id: seriesId, provider: "explain", source_key: `series-${index}`, tournament_id: seedIds.worlds, played_at: new Date("2024-01-01T00:00:00Z"), best_of: 1, completed: true,
      side_a_team_id: otherA, side_b_team_id: otherB, side_a_score: 1, side_b_score: 0, winner_team_id: otherA, publication_generation: "0",
    }))).execute();
    await db.insertInto("game_facts").values(rows.map(({ seriesId, gameId, index }) => ({
      id: gameId, provider: "explain", source_key: `game-${index}`, series_id: seriesId, game_number: 1, played_at: new Date("2024-01-01T00:00:00Z"),
      side_a_team_id: otherA, side_b_team_id: otherB, winner_team_id: otherA, publication_generation: "0",
    }))).execute();
    await db.insertInto("game_players").values(rows.map(({ gameId }) => ({ game_id: gameId, player_entity_id: otherPlayer, side: "a", team_entity_id: otherA }))).execute();
    const plan = await db.transaction().execute(async (trx) => {
      await sql`set local enable_seqscan = off`.execute(trx);
      return sql<{ "QUERY PLAN": unknown }>`
        explain (format json) select series.id
        from series_facts series join game_facts game on game.series_id = series.id
        join game_players left_player on left_player.game_id = game.id
        join game_players right_player on right_player.game_id = game.id
        where series.publication_generation <= (select max(generation) from dataset_versions)
          and series.side_a_team_id = ${seedIds.t1} and series.side_b_team_id = ${seedIds.weibo}
          and left_player.player_entity_id = ${seedIds.faker} and right_player.player_entity_id = ${seedIds.xiaohu}
      `.execute(trx);
    });
    const nodes: Array<{ relation?: string; node?: string; index?: string }> = [];
    const visit = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      const record = value as Record<string, unknown>;
      if (typeof record["Node Type"] === "string") nodes.push({ relation: typeof record["Relation Name"] === "string" ? record["Relation Name"] : undefined, node: record["Node Type"], index: typeof record["Index Name"] === "string" ? record["Index Name"] : undefined });
      for (const child of Object.values(record)) visit(child);
    };
    visit(plan.rows[0]?.["QUERY PLAN"]);
    expect(nodes.filter((node) => node.relation === "series_facts" || node.relation === "game_players").every((node) => node.node !== "Seq Scan")).toBe(true);
    expect(nodes.map((node) => node.index)).toEqual(expect.arrayContaining(["game_players_player_game_lookup", "series_facts_comparison_lookup"]));
  });
});
