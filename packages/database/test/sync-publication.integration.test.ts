import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { beginSyncRun, failSyncRun, getDatasetStatus, publishDataset, recordSourceObject, withSyncAdvisoryLock } from "../src/index.js";
import { createDb, destroyDb } from "../src/db.js";
import { migrateToLatest } from "../src/migrator.js";
import { createTestSchemaName, seedComparisonFixture, seedIds } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("sync publication repository", () => {
  const schema = createTestSchemaName();
  const adminPool = new Pool({ connectionString: databaseUrl });
  const db = createDb({ databaseUrl: databaseUrl!, schema });
  beforeAll(async () => { await adminPool.query(`create schema ${schema}`); await migrateToLatest(db, { schema }); await seedComparisonFixture(db); });
  afterAll(async () => { await destroyDb(db); await adminPool.query(`drop schema if exists ${schema} cascade`); await adminPool.end(); });

  it("is idempotent for source objects and publishes append-only dataset versions", async () => {
    expect(await getDatasetStatus(db)).toBeNull();
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const source = { provider: "fixture", sourceKey: "source-1", sourceUrl: "https://example.test/a", objectKey: "sources/a", checksum: "a", parserVersion: "test" };
    expect(await recordSourceObject(source, db)).toBe("inserted");
    expect(await recordSourceObject(source, db)).toBe("existing");
    const first = await publishDataset({ syncRunId: run.id, version: "v1", coverage: [{ provider: "fixture", competition: "all", seasonYear: 2024, earliestDate: "2024-01-01", latestDate: "2024-12-31", status: "complete" }] }, db);
    const secondRun = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const second = await publishDataset({ syncRunId: secondRun.id, version: "v2", coverage: [] }, db);
    expect(second.id).not.toBe(first.id);
  });

  it("atomically upserts canonical facts and rolls staged changes back on validation failure", async () => {
    const source = { provider: "fixture", sourceKey: "facts-source", sourceUrl: "https://example.test/facts", objectKey: "sources/facts", checksum: "facts", parserVersion: "test" };
    await recordSourceObject(source, db);
    const sourceObject = await db.selectFrom("source_objects").select("id").where("provider", "=", source.provider).where("source_key", "=", source.sourceKey).executeTakeFirstOrThrow();
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const input = { id: seedIds.t1Series, provider: "fixture", sourceKey: "t1", tournamentId: seedIds.worlds, playedAt: new Date("2024-11-02T12:00:00Z"), bestOf: 5 as const, completed: true, sideATeamId: seedIds.t1, sideAEraId: seedIds.t1Era, sideARegionId: seedIds.lck, sideBTeamId: seedIds.weibo, sideBRegionId: seedIds.lpl, sideAScore: 3, sideBScore: 1, winnerTeamId: seedIds.t1 };
    const game = { id: seedIds.t1Game, provider: "fixture", sourceKey: "t1-1", seriesId: seedIds.t1Series, gameNumber: 1, playedAt: new Date("2024-11-02T12:00:00Z"), sideATeamId: seedIds.t1, sideAEraId: seedIds.t1Era, sideARegionId: seedIds.lck, sideBTeamId: seedIds.weibo, sideBRegionId: seedIds.lpl, winnerTeamId: seedIds.t1 };
    const players = [{ gameId: seedIds.t1Game, playerEntityId: seedIds.faker, side: "a" as const, teamEntityId: seedIds.t1 }, { gameId: seedIds.t1Game, playerEntityId: seedIds.xiaohu, side: "b" as const, teamEntityId: seedIds.weibo }];
    const facts = { series: [input], games: [game], gamePlayers: players };
    const published = await publishDataset({ syncRunId: run.id, version: "facts-v1", sourceObjectId: sourceObject.id, coverage: [], facts }, db);
    expect(published.generation).toBeDefined();
    const counts = await Promise.all([db.selectFrom("series_facts").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow(), db.selectFrom("game_facts").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow(), db.selectFrom("game_players").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow()]);
    const retry = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: retry.id, version: "facts-v2", sourceObjectId: sourceObject.id, coverage: [], facts });
    const retryCounts = await Promise.all([db.selectFrom("series_facts").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow(), db.selectFrom("game_facts").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow(), db.selectFrom("game_players").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow()]);
    expect(retryCounts).toEqual(counts);
    const before = await db.selectFrom("series_facts").select("publication_generation").where("id", "=", seedIds.t1Series).executeTakeFirstOrThrow();
    const failed = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({ syncRunId: failed.id, version: "facts-never", sourceObjectId: sourceObject.id, coverage: [], facts: { series: [input], games: [{ id: "99999999-9999-4999-8999-999999999999", provider: "fixture", sourceKey: "invalid", seriesId: "99999999-9999-4999-8999-999999999998", gameNumber: 1, playedAt: new Date(), sideATeamId: seedIds.t1, sideBTeamId: seedIds.weibo }] } }, db)).rejects.toThrow();
    const after = await db.selectFrom("series_facts").select("publication_generation").where("id", "=", seedIds.t1Series).executeTakeFirstOrThrow();
    expect(after).toEqual(before);
    expect(await db.selectFrom("dataset_versions").select("version").where("version", "=", "facts-never").executeTakeFirst()).toBeUndefined();
  });

  it("does not publish a failed run and excludes concurrent provider work", async () => {
    const run = await beginSyncRun({ provider: "failure", mode: "sync", parserVersion: "test" }, db);
    await failSyncRun({ syncRunId: run.id, error: "invalid source" }, db);
    await expect(publishDataset({ syncRunId: run.id, version: "never", coverage: [] }, db)).rejects.toThrow();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = withSyncAdvisoryLock("fixture-lock", async () => { await held; }, db);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await withSyncAdvisoryLock("fixture-lock", async () => undefined, db)).toBe("locked");
    release?.();
    expect(await first).toBe("ran");
  });
});
