import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, destroyDb } from "../src/db.js";
import { createMigrator, migrateToLatest } from "../src/migrator.js";
import { beginSyncRun, compareHeadToHead, exportSnapshotFacts, publishDataset, recordSourceObjectWithId } from "../src/index.js";
import { createTestSchemaName, seedComparisonFixture, seedIds } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("historical domestic publication", () => {
  const schema = createTestSchemaName();
  const pool = new Pool({ connectionString: databaseUrl });
  const db = createDb({ databaseUrl: databaseUrl!, schema });
  const tournamentId = randomUUID();
  const seriesId = randomUUID();

  beforeAll(async () => {
    await pool.query(`create schema ${schema}`);
    await migrateToLatest(db, { schema });
    await seedComparisonFixture(db);
    await db.updateTable("media_assets").set({ is_current: false }).execute();
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const source = await recordSourceObjectWithId({ provider: "fixture", sourceKey: "historical-draw", sourceUrl: "https://example.test/draw", objectKey: "sources/draw", checksum: "draw", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: run.id, version: "domestic-draw", sourceObjectId: source.id, coverage: [],
      dimensions: { entities: [], regions: [], teamEras: [], tournaments: [{ id: tournamentId, provider: "fixture", sourceKey: "LCK/2013/Spring", name: "Champions 2013 Spring", category: "league", leagueSlug: "lck" }] },
      facts: { series: [{ id: seriesId, provider: "fixture", sourceKey: "draw", tournamentId, playedAt: "2013-04-03T09:30:00Z", bestOf: 2, completed: true, sideATeamId: seedIds.t1, sideBTeamId: seedIds.weibo, sideAScore: 1, sideBScore: 1, winnerTeamId: null }] },
    }, db);
  });
  afterAll(async () => { await destroyDb(db); await pool.query(`drop schema if exists ${schema} cascade`); await pool.end(); });

  it("keeps a completed draw visible in league queries and exported facts", async () => {
    const result = await compareHeadToHead({ left: { kind: "team", id: seedIds.t1 }, right: { kind: "team", id: seedIds.weibo }, eventCategories: ["league"], leagues: ["lck"], bestOf: [2], tournamentIds: [tournamentId], limit: 50 }, db);
    expect(result.seriesSummary).toEqual({ wins: 0, losses: 0, draws: 1, total: 1, winRate: 0 });
    expect(result.rows[0]).toMatchObject({ winner: "draw", leftScore: 1, rightScore: 1 });
    expect((await exportSnapshotFacts(db)).series.find(series => series.id === seriesId)).toMatchObject({ completed: true, winnerSide: null, bestOf: 2, tournament: { league: "lck" } });
  });

  it("rejects impossible completed BO2 scores at the persistence boundary", async () => {
    const fact = await db.selectFrom("series_facts").selectAll().where("id", "=", seriesId).executeTakeFirstOrThrow();
    await expect(db.insertInto("series_facts").values({ ...fact, id: randomUUID(), source_key: "invalid-draw", side_a_score: 2, side_b_score: 1, winner_team_id: seedIds.t1 }).execute()).rejects.toThrow(/completed_result/);
  });

  it("refuses a lossy downgrade while BO2 facts exist", async () => {
    const result = await createMigrator(db, { schema }).migrateTo("012_media_sync_mode");
    expect(result.error).toMatchObject({ message: "Cannot losslessly downgrade historical series formats" });
    expect(await db.selectFrom("series_facts").select("id").where("id", "=", seriesId).executeTakeFirst()).toBeDefined();
  });
});
