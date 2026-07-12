import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { beginSyncRun, completeUnchangedSyncRun, failSyncRun, findDatasetVersion, getDatasetStatus, publishDataset, recordSourceObject, recordSourceObjectWithId, withSyncAdvisoryLock } from "../src/index.js";
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
    await expect(recordSourceObject({ ...source, checksum: "different" }, db)).rejects.toThrow("Immutable source object metadata conflicts");
    const first = await publishDataset({ syncRunId: run.id, version: "v1", coverage: [{ provider: "fixture", competition: "all", seasonYear: 2024, earliestDate: "2024-01-01", latestDate: "2024-12-31", status: "complete" }] }, db);
    const secondRun = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const second = await publishDataset({ syncRunId: secondRun.id, version: "v2", coverage: [] }, db);
    expect(second.id).not.toBe(first.id);
  });

  it("returns retained source identity and completes unchanged runs without publishing", async () => {
    const source = { provider: "fixture", sourceKey: "unchanged-source", sourceUrl: "https://example.test/unchanged", objectKey: "sources/unchanged", checksum: "unchanged", parserVersion: "test" };
    const first = await recordSourceObjectWithId(source, db);
    const second = await recordSourceObjectWithId(source, db);
    expect(second).toEqual({ id: first.id, status: "existing" });
    const publishedRun = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: publishedRun.id, version: "unchanged-v1", coverage: [] }, db);
    const version = await findDatasetVersion("unchanged-v1", db);
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await completeUnchangedSyncRun({ syncRunId: run.id, version: "unchanged-v1" }, db);
    expect(await findDatasetVersion("unchanged-v1", db)).toEqual(version);
    expect(await db.selectFrom("dataset_versions").select(({ fn }) => fn.countAll<number>().as("count")).where("version", "=", "unchanged-v1").executeTakeFirstOrThrow()).toMatchObject({ count: "1" });
    expect(await db.selectFrom("sync_runs").select(["status", "finished_at"]).where("id", "=", run.id).executeTakeFirstOrThrow()).toMatchObject({ status: "succeeded" });
  });

  it("publishes dimensions, media and coverage in the canonical transaction", async () => {
    const teamId = randomUUID(); const regionId = randomUUID(); const eraId = randomUUID(); const tournamentId = randomUUID();
    const source = await recordSourceObjectWithId({ provider: "leaguepedia", sourceKey: "dimension-source", sourceUrl: "https://lol.example/wiki", objectKey: "sources/dimension", checksum: "dimension", parserVersion: "test" }, db);
    const run = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({
      syncRunId: run.id, version: "dimension-v1", sourceObjectId: source.id, coverage: [{ provider: "leaguepedia", competition: "Worlds", seasonYear: 2024, status: "complete" }],
      dimensions: {
        entities: [{ id: teamId, provider: "leaguepedia", sourceKeys: ["T1"], kind: "team", canonicalName: "T1", aliases: ["SKT"] }],
        regions: [{ id: regionId, provider: "leaguepedia", sourceKey: "LCK", name: "LCK" }],
        teamEras: [{ id: eraId, provider: "leaguepedia", sourceKey: "T1", teamEntityId: teamId, displayName: "T1", regionId, validFrom: "2019-12-08", validTo: null }],
        tournaments: [{ id: tournamentId, provider: "leaguepedia", sourceKey: "Worlds 2024", name: "Worlds 2024", aliases: [], category: "worlds", seasonYear: 2024, validFrom: "2024-09-01", validTo: "2024-11-02" }],
      },
      media: [{ provider: "leaguepedia", sourceUrl: "https://static.example/t1.png", objectKey: "media/leaguepedia/t1", checksum: "sha256:image", contentType: "image/png", byteSize: "3", attribution: "Leaguepedia", entityId: teamId, license: "fair-use" }],
      overrideApplications: [{ overrideFile: "data/overrides/identities.yaml", checksum: "sha256:override" }],
    }, db);
    expect(await db.selectFrom("entities").select("canonical_name").where("id", "=", teamId).executeTakeFirstOrThrow()).toEqual({ canonical_name: "T1" });
    expect(await db.selectFrom("media_assets").select(["object_key", "provider", "byte_size", "is_current"]).where("entity_id", "=", teamId).executeTakeFirstOrThrow()).toMatchObject({ object_key: "media/leaguepedia/t1", provider: "leaguepedia", byte_size: "3", is_current: true });
    expect(await db.selectFrom("coverage_status").select("status").where("provider", "=", "leaguepedia").where("competition", "=", "Worlds").executeTakeFirstOrThrow()).toEqual({ status: "complete" });
    const firstApplication = await db.selectFrom("override_applications").select(["id", "checksum"]).where("override_file", "=", "data/overrides/identities.yaml").executeTakeFirstOrThrow();
    expect(firstApplication.checksum).toBe("sha256:override");
    expect(await db.selectFrom("override_application_runs").select("sync_run_id").where("override_application_id", "=", firstApplication.id).executeTakeFirstOrThrow()).toEqual({ sync_run_id: run.id });
    const secondRun = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: secondRun.id, version: "dimension-v2", coverage: [], overrideApplications: [{ overrideFile: "data/overrides/identities.yaml", checksum: "sha256:override" }] }, db);
    const application = await db.selectFrom("override_applications").select("id").where("override_file", "=", "data/overrides/identities.yaml").where("checksum", "=", "sha256:override").executeTakeFirstOrThrow();
    expect(await db.selectFrom("override_application_runs").select("sync_run_id").where("override_application_id", "=", application.id).execute()).toEqual(expect.arrayContaining([{ sync_run_id: run.id }, { sync_run_id: secondRun.id }]));
    const unchangedRun = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await completeUnchangedSyncRun({ syncRunId: unchangedRun.id, version: "dimension-v2" }, db);
    expect(await db.selectFrom("override_application_runs").select("sync_run_id").where("override_application_id", "=", application.id).execute()).toHaveLength(2);
    const reusedVersion = await db.selectFrom("dataset_versions").select("id").where("version", "=", "dimension-v2").executeTakeFirstOrThrow();
    expect(await db.selectFrom("sync_runs").select("reused_dataset_version_id").where("id", "=", unchangedRun.id).executeTakeFirstOrThrow()).toEqual({ reused_dataset_version_id: reusedVersion.id });
    await expect(db.deleteFrom("override_application_runs").where("override_application_id", "=", application.id).execute()).rejects.toThrow();
  });

  it("atomically upserts canonical facts and rolls staged changes back on validation failure", async () => {
    const source = { provider: "fixture", sourceKey: "t1", sourceUrl: "https://example.test/facts", objectKey: "sources/facts", checksum: "facts", parserVersion: "test" };
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
    const sourceLess = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const rosterBeforeRejection = await db.selectFrom("game_players").select("player_entity_id").where("game_id", "=", seedIds.t1Game).execute();
    await expect(publishDataset({ syncRunId: sourceLess.id, version: "no-source-roster", coverage: [], rosterGameIds: [seedIds.t1Game] }, db)).rejects.toThrow("requires sourceObjectId");
    expect(await db.selectFrom("game_players").select("player_entity_id").where("game_id", "=", seedIds.t1Game).execute()).toEqual(rosterBeforeRejection);
    const unlisted = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({ syncRunId: unlisted.id, version: "unlisted-roster", sourceObjectId: sourceObject.id, coverage: [], rosterGameIds: [], facts: { gamePlayers: [players[0]!] } })).rejects.toThrow("rosterGameIds");
    const correction = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: correction.id, version: "facts-v3", sourceObjectId: sourceObject.id, coverage: [], facts: { series: [input], games: [game], gamePlayers: [] }, rosterGameIds: [seedIds.t1Game] });
    expect(await db.selectFrom("game_players").select("player_entity_id").where("game_id", "=", seedIds.t1Game).execute()).toEqual([]);
    const badSource = { provider: "wrong", sourceKey: "t1", sourceUrl: "https://example.test/wrong", objectKey: "sources/wrong", checksum: "wrong", parserVersion: "test" };
    await recordSourceObject(badSource, db);
    const badObject = await db.selectFrom("source_objects").select("id").where("provider", "=", "wrong").executeTakeFirstOrThrow();
    const badRun = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({ syncRunId: badRun.id, version: "bad-source", sourceObjectId: badObject.id, coverage: [], facts: { series: [input] } })).rejects.toThrow("Source object does not match");
    const before = await db.selectFrom("series_facts").select("publication_generation").where("id", "=", seedIds.t1Series).executeTakeFirstOrThrow();
    const publishedBeforeFailure = await getDatasetStatus(db);
    const countsBeforeFailure = await db.selectFrom("game_facts").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    const currentMediaBeforeFailure = await db.selectFrom("media_assets").select(["object_key", "is_current"]).where("entity_id", "=", seedIds.t1).where("kind", "=", "logo").execute();
    const failed = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({ syncRunId: failed.id, version: "facts-never", sourceObjectId: sourceObject.id, coverage: [], media: [{ provider: "fixture", sourceUrl: "https://example.test/new-t1.png", objectKey: "media/new-t1.png", checksum: "sha256:new", contentType: "image/png", byteSize: "3", attribution: "fixture", entityId: seedIds.t1 }], facts: { series: [input], games: [{ id: "99999999-9999-4999-8999-999999999999", provider: "fixture", sourceKey: "invalid", seriesId: "99999999-9999-4999-8999-999999999998", gameNumber: 1, playedAt: new Date(), sideATeamId: seedIds.t1, sideBTeamId: seedIds.weibo }] } }, db)).rejects.toThrow();
    const after = await db.selectFrom("series_facts").select("publication_generation").where("id", "=", seedIds.t1Series).executeTakeFirstOrThrow();
    expect(after).toEqual(before);
    expect(await db.selectFrom("game_facts").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow()).toEqual(countsBeforeFailure);
    expect(await getDatasetStatus(db)).toEqual(publishedBeforeFailure);
    expect(await db.selectFrom("dataset_versions").select("version").where("version", "=", "facts-never").executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom("media_assets").select(["object_key", "is_current"]).where("entity_id", "=", seedIds.t1).where("kind", "=", "logo").execute()).toEqual(currentMediaBeforeFailure);
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

  it("records durable provenance audits for newly inserted canonical facts", async () => {
    const seriesId = randomUUID();
    const gameId = randomUUID();
    const source = { provider: "fixture", sourceKey: "fresh", sourceUrl: "https://example.test/fresh", objectKey: "sources/fresh", checksum: "fresh", parserVersion: "test" };
    await recordSourceObject(source, db);
    const sourceObject = await db.selectFrom("source_objects").select("id").where("provider", "=", source.provider).where("source_key", "=", source.sourceKey).executeTakeFirstOrThrow();
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({
      syncRunId: run.id, version: "fresh-audit", sourceObjectId: sourceObject.id, coverage: [], facts: {
        series: [{ id: seriesId, provider: "fixture", sourceKey: "fresh-series", tournamentId: seedIds.worlds, playedAt: new Date("2025-01-01T00:00:00Z"), bestOf: 1, completed: true, sideATeamId: seedIds.t1, sideBTeamId: seedIds.weibo, sideAScore: 1, sideBScore: 0, winnerTeamId: seedIds.t1 }],
        games: [{ id: gameId, provider: "fixture", sourceKey: "fresh-game", seriesId, gameNumber: 1, playedAt: new Date("2025-01-01T00:00:00Z"), sideATeamId: seedIds.t1, sideBTeamId: seedIds.weibo, winnerTeamId: seedIds.t1 }], gamePlayers: [{ gameId, playerEntityId: seedIds.faker, side: "a", teamEntityId: seedIds.t1 }],
      },
      rosterGameIds: [gameId],
    }, db);
    const audit = await db.selectFrom("fact_mutation_audits").select(["fact_table", "fact_id", "source_object_id", "old_payload", "new_payload"])
      .where("fact_table", "=", "series_facts").where("fact_id", "=", seriesId).executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ fact_table: "series_facts", fact_id: seriesId, source_object_id: sourceObject.id, old_payload: {} });
    expect(audit.new_payload).toMatchObject({ id: seriesId, source_key: "fresh-series" });
  });

  it("rejects direct mutation of append-only dataset versions", async () => {
    const version = await db.selectFrom("dataset_versions").select("id").orderBy("generation", "desc").executeTakeFirstOrThrow();
    await expect(db.updateTable("dataset_versions").set({ version: "mutated" }).where("id", "=", version.id).execute()).rejects.toThrow();
    await expect(db.deleteFrom("dataset_versions").where("id", "=", version.id).execute()).rejects.toThrow();
  });
});
