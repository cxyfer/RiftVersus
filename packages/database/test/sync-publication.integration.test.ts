import { Pool } from "pg";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { beginSyncRun, completeUnchangedSyncRun, failSyncRun, findAcceptanceDatasetEvidence, findDatasetVersion, getDatasetStatus, publishDataset, recordSourceObject, recordSourceObjectWithId, withSyncAdvisoryLock } from "../src/index.js";
import type { PublishDatasetInput } from "../src/repositories/types.js";
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

  it("normalizes PostgreSQL date scalars before deriving dataset coverage bounds", async () => {
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({
      syncRunId: run.id,
      version: "date-normalization-v1",
      coverage: [
        { provider: "fixture", competition: "Worlds", seasonYear: 2013, earliestDate: "2013-09-15", latestDate: "2013-10-05", status: "complete" },
        { provider: "fixture", competition: "Worlds", seasonYear: 2022, earliestDate: "2022-10-07", latestDate: "2022-11-06", status: "complete" },
        { provider: "fixture", competition: "Worlds", seasonYear: 2025, earliestDate: "2025-10-15", latestDate: "2025-11-09", status: "complete" },
      ],
    }, db);

    const rawCoverage = await db.selectFrom("coverage_status")
      .select(["earliest_date", "latest_date"])
      .where("season_year", "=", 2013)
      .executeTakeFirstOrThrow();
    expect(rawCoverage).toEqual({ earliest_date: "2013-09-15", latest_date: "2013-10-05" });

    const status = await getDatasetStatus(db);
    expect(status?.coverage).toEqual({ from: "2013-09-15", to: "2025-11-09" });
    expect(status?.coverageStatus.filter((item) => item.competition === "Worlds").map(({ earliestDate, latestDate }) => ({ earliestDate, latestDate }))).toEqual([
      { earliestDate: "2013-09-15", latestDate: "2013-10-05" },
      { earliestDate: "2022-10-07", latestDate: "2022-11-06" },
      { earliestDate: "2025-10-15", latestDate: "2025-11-09" },
    ]);
  });

  it("re-publishes identical dated dimensions without false conflicts or duplicate identities", async () => {
    const teamId = randomUUID(); const regionId = randomUUID(); const eraId = randomUUID(); const tournamentId = randomUUID();
    const dimensions = {
      entities: [{ id: teamId, provider: "leaguepedia", sourceKeys: ["Dated Team"], kind: "team" as const, canonicalName: "Dated Team", aliases: [] }],
      regions: [{ id: regionId, provider: "leaguepedia", sourceKey: "Dated Region", name: "Dated Region" }],
      teamEras: [{ id: eraId, provider: "leaguepedia", sourceKey: "Dated Team", teamEntityId: teamId, displayName: "Dated Team", regionId, validFrom: "2013-02-01", validTo: "2019-12-07" }],
      tournaments: [{ id: tournamentId, provider: "leaguepedia", sourceKey: "Dated Worlds", name: "Dated Worlds", aliases: [], category: "worlds" as const, seasonYear: 2013, validFrom: "2013-09-15", validTo: "2013-10-05" }],
    };
    const first = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: first.id, version: "dated-dimensions-v1", coverage: [], dimensions }, db);

    const selected = await Promise.all([
      db.selectFrom("team_eras").select(["valid_from", "valid_to"]).where("id", "=", eraId).executeTakeFirstOrThrow(),
      db.selectFrom("team_region_history").select(["valid_from", "valid_to"]).where("provider", "=", "leaguepedia").where("source_key", "=", "Dated Team").executeTakeFirstOrThrow(),
      db.selectFrom("tournaments").select(["start_date", "end_date"]).where("id", "=", tournamentId).executeTakeFirstOrThrow(),
    ]);
    expect(selected).toEqual([
      { valid_from: "2013-02-01", valid_to: "2019-12-07" },
      { valid_from: "2013-02-01", valid_to: "2019-12-07" },
      { start_date: "2013-09-15", end_date: "2013-10-05" },
    ]);

    const second = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({ syncRunId: second.id, version: "dated-dimensions-v2", coverage: [], dimensions }, db)).resolves.toBeDefined();
    await expect(Promise.all([
      db.selectFrom("team_eras").select(({ fn }) => fn.countAll<number>().as("count")).where("id", "=", eraId).executeTakeFirstOrThrow(),
      db.selectFrom("team_region_history").select(({ fn }) => fn.countAll<number>().as("count")).where("provider", "=", "leaguepedia").where("source_key", "=", "Dated Team").executeTakeFirstOrThrow(),
      db.selectFrom("tournaments").select(({ fn }) => fn.countAll<number>().as("count")).where("id", "=", tournamentId).executeTakeFirstOrThrow(),
    ])).resolves.toEqual([{ count: "1" }, { count: "1" }, { count: "1" }]);
  });

  it("keeps distinct same-name players queryable across publication batches", async () => {
    const ids = [randomUUID(), randomUUID()];
    const entity = (index: number) => ({ id: ids[index]!, provider: "fixture", sourceKeys: [`Same-name player ${index}`], kind: "player" as const, canonicalName: "Kim Dong-hyeon", playerId: index === 0 ? "Chasy" : "Loopy", aliases: [] });
    for (const [index, entities] of [[entity(0)], [entity(0), entity(1)], [entity(1), entity(0)]].entries()) {
      const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
      await publishDataset({ syncRunId: run.id, version: `same-name-${index}`, coverage: [], dimensions: { entities, regions: [], teamEras: [], tournaments: [] } }, db);
    }
    const rows = await db.selectFrom("entities").select(["id", "slug", "player_id"]).where("id", "in", ids).execute();
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === ids[0])?.slug).toBe("kim-dong-hyeon");
    expect(rows.find(row => row.id === ids[1])?.slug).toBe(`kim-dong-hyeon-${ids[1]}`);
    expect(new Set(rows.map(row => row.player_id))).toEqual(new Set(["Chasy", "Loopy"]));
  });

  it("keeps timestamp and timestamptz codecs delegated to the PostgreSQL defaults", async () => {
    const result = await sql<{ timestamp_value: unknown; timestamptz_value: unknown }>`
      select '2025-11-09 12:34:56'::timestamp as timestamp_value,
             '2025-11-09 12:34:56+00'::timestamptz as timestamptz_value
    `.execute(db);
    expect(result.rows[0]?.timestamp_value).toBeInstanceOf(Date);
    expect(result.rows[0]?.timestamptz_value).toBeInstanceOf(Date);
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

  it("reuses a retained content-addressed object under a retry source key", async () => {
    const retained = {
      provider: "leaguepedia",
      sourceKey: "failed:sha256:retry-object",
      sourceUrl: "https://lol.example/cargo",
      objectKey: "sources/leaguepedia/retry-object",
      checksum: "retry-object",
      contentType: "application/json",
      byteSize: "42",
      parserVersion: "test",
    };
    const first = await recordSourceObjectWithId(retained, db);
    const retry = await recordSourceObjectWithId({
      ...retained,
      sourceKey: "leaguepedia:retry-batch",
      sourceUrl: "https://lol.example/api.php",
    }, db);
    expect(first.status).toBe("inserted");
    expect(retry).toEqual({ id: first.id, status: "existing" });
  });

  it("publishes dimensions, media and coverage in the canonical transaction", async () => {
    const teamId = randomUUID(); const regionId = randomUUID(); const eraId = randomUUID(); const tournamentId = randomUUID();
    const source = await recordSourceObjectWithId({ provider: "leaguepedia", sourceKey: "dimension-source", sourceUrl: "https://lol.example/wiki", objectKey: "sources/dimension", checksum: "dimension", parserVersion: "test" }, db);
    const run = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({
      syncRunId: run.id, version: "dimension-v1", sourceObjectId: source.id, coverage: [{ provider: "leaguepedia", competition: "Worlds", seasonYear: 2024, status: "complete" }],
      dimensions: {
        entities: [{ id: teamId, provider: "leaguepedia", sourceKeys: ["T1"], kind: "team", canonicalName: "Dimension Team", aliases: ["SKT"] }],
        regions: [{ id: regionId, provider: "leaguepedia", sourceKey: "LCK", name: "Dimension Region" }],
        teamEras: [{ id: eraId, provider: "leaguepedia", sourceKey: "T1", teamEntityId: teamId, displayName: "T1", regionId, validFrom: "2019-12-08", validTo: null }],
        tournaments: [{ id: tournamentId, provider: "leaguepedia", sourceKey: "Worlds 2024", name: "Worlds 2024", aliases: [], category: "worlds", seasonYear: 2024, validFrom: "2024-09-01", validTo: "2024-11-02" }],
      },
      media: [
        { provider: "leaguepedia", sourceUrl: "https://static.example/t1.png", objectKey: "media/leaguepedia/t1", checksum: "sha256:image", contentType: "image/png", byteSize: "3", attribution: "Leaguepedia", entityId: teamId, license: "fair-use" },
        { provider: "leaguepedia", sourceUrl: "https://static.example/t1.png", objectKey: "media/leaguepedia/t1", checksum: "sha256:image", contentType: "image/png", byteSize: "3", attribution: "Leaguepedia", entityId: regionId, license: "fair-use" },
      ],
      overrideApplications: [{ overrideFile: "data/overrides/identities.yaml", checksum: "sha256:override" }],
    }, db);
    expect(await db.selectFrom("entities").select("canonical_name").where("id", "=", teamId).executeTakeFirstOrThrow()).toEqual({ canonical_name: "Dimension Team" });
    expect(await db.selectFrom("media_assets as owner").innerJoin("media_objects as object", "object.object_key", "owner.object_key").select(["owner.object_key", "owner.provider", "object.byte_size", "owner.is_current"]).where("owner.entity_id", "=", teamId).executeTakeFirstOrThrow()).toMatchObject({ object_key: "media/leaguepedia/t1", provider: "leaguepedia", byte_size: "3", is_current: true });
    expect(await db.selectFrom("media_objects").select(({ fn }) => fn.countAll<number>().as("count")).where("object_key", "=", "media/leaguepedia/t1").executeTakeFirstOrThrow()).toMatchObject({ count: "1" });
    expect(await db.selectFrom("media_assets").select(({ fn }) => fn.countAll<number>().as("count")).where("object_key", "=", "media/leaguepedia/t1").executeTakeFirstOrThrow()).toMatchObject({ count: "2" });
    const conflictingMediaRun = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({
      syncRunId: conflictingMediaRun.id,
      version: "dimension-media-conflict",
      coverage: [],
      media: [{ provider: "leaguepedia", sourceUrl: "https://static.example/t1.png", objectKey: "media/leaguepedia/t1", checksum: "sha256:different", contentType: "image/png", byteSize: "3", attribution: "Leaguepedia", entityId: teamId }],
    }, db)).rejects.toThrow(/immutable media object/i);
    expect(await db.selectFrom("media_objects").select("checksum").where("object_key", "=", "media/leaguepedia/t1").executeTakeFirstOrThrow()).toEqual({ checksum: "sha256:image" });
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

  it.each([
    ["null then value", [null, "Faker"], "Faker"],
    ["value then null", ["Faker", null], "Faker"],
    ["same then same", ["Faker", "Faker"], "Faker"],
  ] as const)("publishes duplicate canonical player rows order-independently: %s", async (label, playerIds, expectedPlayerId) => {
    const id = randomUUID();
    const canonicalName = `Order Player ${id}`;
    const sourceKeys = [`Faker Order 0 ${id}`, `Faker Order 1 ${id}`] as const;
    const run = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({
      syncRunId: run.id,
      version: `player-id-order-${label.replaceAll(" ", "-")}-${id}`,
      coverage: [],
      dimensions: {
        entities: playerIds.map((playerId, index) => ({
          id, provider: "leaguepedia", sourceKeys: [sourceKeys[index]!], kind: "player" as const,
          canonicalName, playerId, aliases: [],
        })),
        regions: [], teamEras: [], tournaments: [],
      },
    }, db);
    expect(await db.selectFrom("entities").select(["canonical_name", "player_id"]).where("id", "=", id).executeTakeFirstOrThrow())
      .toEqual({ canonical_name: canonicalName, player_id: expectedPlayerId });
    expect(await db.selectFrom("entities").select(({ fn }) => fn.countAll<number>().as("count")).where("id", "=", id).executeTakeFirstOrThrow()).toEqual({ count: "1" });
    expect(new Set((await db.selectFrom("entity_aliases").select("display_name").where("entity_id", "=", id).execute()).map((alias) => alias.display_name)))
      .toEqual(new Set([...sourceKeys, canonicalName]));
  });

  it.each([
    ["Faker", "Hide on bush"],
    ["Hide on bush", "Faker"],
  ] as const)("rejects conflicting player IDs before an initial publication in either order: %s then %s", async (firstPlayerId, secondPlayerId) => {
    const id = randomUUID();
    const firstSourceKey = `${firstPlayerId} Source`;
    const secondSourceKey = `${secondPlayerId} Source`;
    const version = `player-id-initial-conflict-${id}`;
    const run = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({
      syncRunId: run.id,
      version,
      coverage: [],
      dimensions: {
        entities: [
          { id, provider: "leaguepedia", sourceKeys: [firstSourceKey], kind: "player", canonicalName: "Lee Sang-hyeok", playerId: firstPlayerId, aliases: [] },
          { id, provider: "leaguepedia", sourceKeys: [secondSourceKey], kind: "player", canonicalName: "Lee Sang-hyeok", playerId: secondPlayerId, aliases: [] },
        ],
        regions: [], teamEras: [], tournaments: [],
      },
    }, db)).rejects.toThrow(new RegExp(`${id}.*${firstSourceKey}.*${secondSourceKey}.*${firstPlayerId}.*${secondPlayerId}`, "i"));
    expect(await db.selectFrom("entities").select("id").where("id", "=", id).executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom("entity_aliases").select("id").where("entity_id", "=", id).execute()).toEqual([]);
    expect(await db.selectFrom("dataset_versions").select("id").where("version", "=", version).executeTakeFirst()).toBeUndefined();
  });

  it("rejects conflicting canonical identity fields before initial publication in either order", async () => {
    for (const field of ["kind", "canonicalName"] as const) {
      for (const reverse of [false, true]) {
        const id = randomUUID();
        const version = `canonical-${field}-${reverse ? "reverse" : "forward"}-${id}`;
        const first = { id, provider: "leaguepedia", sourceKeys: ["Canonical Source A"], kind: "player" as const, canonicalName: "Lee Sang-hyeok", playerId: null, aliases: [] };
        const conflicting = field === "kind"
          ? { ...first, sourceKeys: ["Canonical Source B"], kind: "team" as const }
          : { ...first, sourceKeys: ["Canonical Source B"], canonicalName: "Sang-hyeok Lee" };
        const entities = reverse ? [conflicting, first] : [first, conflicting];
        const expectedValues = field === "kind" ? entities.map((entity) => entity.kind) : entities.map((entity) => entity.canonicalName);
        const run = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
        await expect(publishDataset({
          syncRunId: run.id,
          version,
          coverage: [],
          dimensions: { entities, regions: [], teamEras: [], tournaments: [] },
        }, db)).rejects.toThrow(new RegExp(`${id}.*${entities[0]!.sourceKeys[0]}.*${entities[1]!.sourceKeys[0]}.*${expectedValues[0]}.*${expectedValues[1]}`, "i"));
        expect(await db.selectFrom("entities").select("id").where("id", "=", id).executeTakeFirst()).toBeUndefined();
        expect(await db.selectFrom("entity_aliases").select("id").where("entity_id", "=", id).execute()).toEqual([]);
        expect(await db.selectFrom("dataset_versions").select("id").where("version", "=", version).executeTakeFirst()).toBeUndefined();
      }
    }
  });

  it("validates player ID publication and rejects inconsistent batches before mutation", async () => {
    const playerId = randomUUID();
    const preflightRejectedTeamId = randomUUID();
    const canonicalName = `Task Two Player ${playerId}`;
    const player = { id: playerId, provider: "leaguepedia", sourceKeys: ["Faker"], kind: "player" as const, canonicalName, aliases: ["Faker", canonicalName] };

    const initial = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: initial.id, version: "player-id-null", coverage: [], dimensions: { entities: [player], regions: [], teamEras: [], tournaments: [] } }, db);
    expect(await db.selectFrom("entities").select(["canonical_name", "player_id"]).where("id", "=", playerId).executeTakeFirstOrThrow()).toEqual({ canonical_name: canonicalName, player_id: null });

    const populate = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: populate.id, version: "player-id-populated", coverage: [], dimensions: { entities: [{ ...player, playerId: "Faker" }], regions: [], teamEras: [], tournaments: [] } }, db);
    expect(await db.selectFrom("entities").select(["canonical_name", "player_id"]).where("id", "=", playerId).executeTakeFirstOrThrow()).toEqual({ canonical_name: canonicalName, player_id: "Faker" });

    const replay = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({
      syncRunId: replay.id,
      version: "player-id-replay",
      coverage: [],
      dimensions: {
        entities: [
          { ...player, sourceKeys: ["Faker (Player)"], playerId: "Faker" },
          { ...player, sourceKeys: ["Faker Alternate Page"], playerId: "Faker" },
        ],
        regions: [], teamEras: [], tournaments: [],
      },
    }, db)).resolves.toBeDefined();
    expect(await db.selectFrom("entities").select(({ fn }) => fn.countAll<number>().as("count")).where("id", "=", playerId).executeTakeFirstOrThrow()).toEqual({ count: "1" });
    expect(await db.selectFrom("entity_aliases").select("display_name").where("entity_id", "=", playerId).execute()).toEqual(expect.arrayContaining([
      { display_name: "Faker (Player)" },
      { display_name: "Faker Alternate Page" },
    ]));

    const aliasesBeforeConflict = await db.selectFrom("entity_aliases").select(["source_key", "display_name"]).where("entity_id", "=", playerId).orderBy("source_key").execute();
    const conflict = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({
      syncRunId: conflict.id,
      version: "player-id-conflict",
      coverage: [],
      dimensions: {
        entities: [
          { id: preflightRejectedTeamId, provider: "leaguepedia", sourceKeys: ["Rollback Team"], kind: "team", canonicalName: "Rollback Team", aliases: [] },
          { ...player, sourceKeys: ["Conflicting Faker Page"], playerId: "Faker" },
          { ...player, sourceKeys: ["Conflicting Hide on bush Page"], playerId: "Hide on bush" },
        ],
        regions: [], teamEras: [], tournaments: [],
      },
    }, db)).rejects.toThrow(/player ID.*conflicts/i);
    expect(await db.selectFrom("entities").select("id").where("id", "=", preflightRejectedTeamId).executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom("entities").select(["canonical_name", "player_id"]).where("id", "=", playerId).executeTakeFirstOrThrow()).toEqual({ canonical_name: canonicalName, player_id: "Faker" });
    expect(await db.selectFrom("entity_aliases").select(["source_key", "display_name"]).where("entity_id", "=", playerId).orderBy("source_key").execute()).toEqual(aliasesBeforeConflict);
    expect(await db.selectFrom("dataset_versions").select("id").where("version", "=", "player-id-conflict").executeTakeFirst()).toBeUndefined();

    const invalidTeam = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({
      syncRunId: invalidTeam.id,
      version: "team-player-id-rejected",
      coverage: [],
      dimensions: {
        entities: [{ id: randomUUID(), provider: "leaguepedia", sourceKeys: ["Invalid Team"], kind: "team", canonicalName: "Invalid Team", playerId: "NotAPlayer", aliases: [] }],
        regions: [], teamEras: [], tournaments: [],
      },
    }, db)).rejects.toThrow();
    expect(await db.selectFrom("dataset_versions").select("id").where("version", "=", "team-player-id-rejected").executeTakeFirst()).toBeUndefined();
  });

  it("rejects a conflicting player ID against the existing database row without changing state", async () => {
    const id = seedIds.faker;
    const player = { id, provider: "leaguepedia", sourceKeys: ["Existing Faker Page"], kind: "player" as const, canonicalName: "Lee Sang-hyeok", playerId: "Faker", aliases: ["Faker"] };
    const initial = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: initial.id, version: `existing-player-id-${id}`, coverage: [], dimensions: { entities: [player], regions: [], teamEras: [], tournaments: [] } }, db);
    const rowBefore = await db.selectFrom("entities").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    const aliasesBefore = await db.selectFrom("entity_aliases").selectAll().where("entity_id", "=", id).orderBy("source_key").execute();

    const conflict = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({
      syncRunId: conflict.id,
      version: `existing-player-id-conflict-${id}`,
      coverage: [],
      dimensions: { entities: [{ ...player, sourceKeys: ["Incoming Faker Page"], playerId: "Hide on bush" }], regions: [], teamEras: [], tournaments: [] },
    }, db)).rejects.toThrow(new RegExp(`${id}.*Existing Faker Page.*Incoming Faker Page.*Faker.*Hide on bush`, "i"));
    expect(await db.selectFrom("entities").selectAll().where("id", "=", id).executeTakeFirstOrThrow()).toEqual(rowBefore);
    expect(await db.selectFrom("entity_aliases").selectAll().where("entity_id", "=", id).orderBy("source_key").execute()).toEqual(aliasesBefore);
    expect(await db.selectFrom("dataset_versions").select("id").where("version", "=", `existing-player-id-conflict-${id}`).executeTakeFirst()).toBeUndefined();
  });

  it("retires only complete exact scopes, preserves other years, and restores reappearing facts", async () => {
    const source = await recordSourceObjectWithId({ provider: "fixture", sourceKey: "retirement", sourceUrl: "https://example.test/retirement", objectKey: "sources/retirement", checksum: "retirement", parserVersion: "test" }, db);
    const scope = { provider: "fixture", tournamentSourceKey: "worlds", from: "2024-01-01", to: "2025-01-01", status: "partial" as const, unresolvedRows: 1 };
    const partial = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: partial.id, version: "retirement-partial", sourceObjectId: source.id, coverage: [], publicationScopes: [scope] }, db);
    expect((await db.selectFrom("series_facts").select("retired_generation").where("id", "=", seedIds.t1Series).executeTakeFirstOrThrow()).retired_generation).toBeNull();
    const complete = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: complete.id, version: "retirement-complete", sourceObjectId: source.id, coverage: [], publicationScopes: [{ ...scope, status: "complete", unresolvedRows: 0 }] }, db);
    expect((await db.selectFrom("series_facts").select("retired_generation").where("id", "=", seedIds.t1Series).executeTakeFirstOrThrow()).retired_generation).not.toBeNull();
    expect((await db.selectFrom("game_facts").select("retired_generation").where("id", "=", seedIds.t1Game).executeTakeFirstOrThrow()).retired_generation).not.toBeNull();
    expect((await db.selectFrom("series_facts").select("retired_generation").where("id", "=", seedIds.sktSeries).executeTakeFirstOrThrow()).retired_generation).toBeNull();
    expect((await db.selectFrom("series_facts").select("retired_generation").where("id", "=", seedIds.changedSeries).executeTakeFirstOrThrow()).retired_generation).toBeNull();
    const visibleGeneration = (await db.selectFrom("dataset_versions").select("generation").orderBy("generation", "desc").executeTakeFirstOrThrow()).generation;
    expect(await db.selectFrom("series_facts").select("id").where("id", "=", seedIds.t1Series).where("publication_generation", "<=", visibleGeneration).where((eb) => eb.or([eb("retired_generation", "is", null), eb("retired_generation", ">", visibleGeneration)])).execute()).toEqual([]);
    expect(await db.selectFrom("game_facts").select("id").where("id", "=", seedIds.t1Game).where("publication_generation", "<=", visibleGeneration).where((eb) => eb.or([eb("retired_generation", "is", null), eb("retired_generation", ">", visibleGeneration)])).execute()).toEqual([]);
    const original = await db.selectFrom("series_facts").selectAll().where("id", "=", seedIds.t1Series).executeTakeFirstOrThrow();
    const reappear = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: reappear.id, version: "retirement-reappear", sourceObjectId: source.id, coverage: [], publicationScopes: [{ ...scope, status: "complete", unresolvedRows: 0 }], facts: { series: [{ id: original.id, provider: original.provider, sourceKey: original.source_key, tournamentId: original.tournament_id, playedAt: original.played_at, bestOf: original.best_of, completed: original.completed, sideATeamId: original.side_a_team_id, sideAEraId: original.side_a_era_id, sideARegionId: original.side_a_region_id, sideBTeamId: original.side_b_team_id, sideBEraId: original.side_b_era_id, sideBRegionId: original.side_b_region_id, sideAScore: original.side_a_score, sideBScore: original.side_b_score, winnerTeamId: original.winner_team_id }] } }, db);
    expect((await db.selectFrom("series_facts").select("retired_generation").where("id", "=", seedIds.t1Series).executeTakeFirstOrThrow()).retired_generation).toBeNull();
  });

  it("rejects every cross-provider publication surface", async () => {
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const invalidInputs: PublishDatasetInput[] = [
      { syncRunId: run.id, version: "cross-provider-entity", coverage: [], dimensions: { entities: [{ id: randomUUID(), provider: "wrong", sourceKeys: ["wrong"], kind: "team", canonicalName: "Wrong", aliases: [] }], regions: [], teamEras: [], tournaments: [] } },
      { syncRunId: run.id, version: "cross-provider-region", coverage: [], dimensions: { entities: [], regions: [{ id: randomUUID(), provider: "wrong", sourceKey: "wrong", name: "Wrong" }], teamEras: [], tournaments: [] } },
      { syncRunId: run.id, version: "cross-provider-era", coverage: [], dimensions: { entities: [], regions: [], teamEras: [{ id: randomUUID(), provider: "wrong", sourceKey: "wrong", teamEntityId: seedIds.t1, displayName: "Wrong" }], tournaments: [] } },
      { syncRunId: run.id, version: "cross-provider-tournament", coverage: [], dimensions: { entities: [], regions: [], teamEras: [], tournaments: [{ id: randomUUID(), provider: "wrong", sourceKey: "wrong", name: "Wrong", aliases: [], category: "worlds", seasonYear: 2024 }] } },
      { syncRunId: run.id, version: "cross-provider-media", coverage: [], media: [{ provider: "wrong", sourceUrl: "https://example.test/wrong.png", objectKey: "media/wrong.png", checksum: "wrong", contentType: "image/png", byteSize: "1", attribution: "wrong", entityId: seedIds.t1 }] },
      { syncRunId: run.id, version: "cross-provider-coverage", coverage: [{ provider: "wrong", competition: "Worlds", seasonYear: 2024, status: "partial" }] },
      { syncRunId: run.id, version: "cross-provider-fact", coverage: [], facts: { series: [{ id: randomUUID(), provider: "wrong", sourceKey: "wrong", tournamentId: seedIds.worlds, playedAt: new Date("2024-01-01T00:00:00Z"), bestOf: 1, completed: true, sideATeamId: seedIds.t1, sideBTeamId: seedIds.weibo, sideAScore: 1, sideBScore: 0, winnerTeamId: seedIds.t1 }] } },
      { syncRunId: run.id, version: "cross-provider-scope", coverage: [], publicationScopes: [{ provider: "wrong", tournamentSourceKey: "worlds", from: "2024-01-01", to: "2025-01-01", status: "complete", unresolvedRows: 0 }] },
    ];
    for (const input of invalidInputs) await expect(publishDataset(input, db)).rejects.toThrow(/provider.*sync run/i);
  });

  it("rejects mismatched team-era facts before mutating any fact in the batch", async () => {
    const source = await recordSourceObjectWithId({ provider: "fixture", sourceKey: "team-era-invariant", sourceUrl: "https://example.test/team-era-invariant", objectKey: "sources/team-era-invariant", checksum: "team-era-invariant", parserVersion: "test" }, db);
    const validSeriesId = randomUUID();
    const mismatchedSeriesId = randomUUID();
    const seriesRun = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const series = (id: string, sideATeamId: string) => ({
      id, provider: "fixture", sourceKey: id, tournamentId: seedIds.worlds, playedAt: new Date("2025-01-01T00:00:00Z"),
      bestOf: 1 as const, completed: true, sideATeamId, sideAEraId: seedIds.t1Era, sideBTeamId: seedIds.weibo,
      sideAScore: 1, sideBScore: 0, winnerTeamId: sideATeamId,
    });
    await expect(publishDataset({
      syncRunId: seriesRun.id, version: "mismatched-series-era", sourceObjectId: source.id, coverage: [],
      facts: { series: [series(validSeriesId, seedIds.t1), series(mismatchedSeriesId, seedIds.genG)] },
    }, db)).rejects.toThrow(/team era.*does not belong to team/i);
    expect(await db.selectFrom("series_facts").select("id").where("id", "in", [validSeriesId, mismatchedSeriesId]).execute()).toEqual([]);
    expect(await findDatasetVersion("mismatched-series-era", db)).toBeNull();

    const validGameId = randomUUID();
    const mismatchedGameId = randomUUID();
    const gameRun = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const game = (id: string, sideBEraId: string | null) => ({
      id, provider: "fixture", sourceKey: id, seriesId: seedIds.t1Series, gameNumber: id === validGameId ? 10 : 11,
      playedAt: new Date("2025-01-01T00:00:00Z"), sideATeamId: seedIds.t1, sideAEraId: seedIds.t1Era,
      sideBTeamId: seedIds.weibo, sideBEraId, winnerTeamId: seedIds.t1,
    });
    await expect(publishDataset({
      syncRunId: gameRun.id, version: "mismatched-game-era", sourceObjectId: source.id, coverage: [],
      facts: { games: [game(validGameId, null), game(mismatchedGameId, seedIds.t1Era)] },
    }, db)).rejects.toThrow(/team era.*does not belong to team/i);
    expect(await db.selectFrom("game_facts").select("id").where("id", "in", [validGameId, mismatchedGameId]).execute()).toEqual([]);
    expect(await findDatasetVersion("mismatched-game-era", db)).toBeNull();
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
    await publishDataset({ syncRunId: retry.id, version: "facts-v2", sourceObjectId: sourceObject.id, coverage: [], facts }, db);
    const retryCounts = await Promise.all([db.selectFrom("series_facts").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow(), db.selectFrom("game_facts").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow(), db.selectFrom("game_players").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow()]);
    expect(retryCounts).toEqual(counts);
    const sourceLess = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const rosterBeforeRejection = await db.selectFrom("game_players").select("player_entity_id").where("game_id", "=", seedIds.t1Game).execute();
    await expect(publishDataset({ syncRunId: sourceLess.id, version: "no-source-roster", coverage: [], rosterGameIds: [seedIds.t1Game] }, db)).rejects.toThrow("requires sourceObjectId");
    expect(await db.selectFrom("game_players").select("player_entity_id").where("game_id", "=", seedIds.t1Game).execute()).toEqual(rosterBeforeRejection);
    const unlisted = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({ syncRunId: unlisted.id, version: "unlisted-roster", sourceObjectId: sourceObject.id, coverage: [], rosterGameIds: [], facts: { gamePlayers: [players[0]!] } }, db)).rejects.toThrow("rosterGameIds");
    const correction = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: correction.id, version: "facts-v3", sourceObjectId: sourceObject.id, coverage: [], facts: { series: [input], games: [game], gamePlayers: [] }, rosterGameIds: [seedIds.t1Game] }, db);
    expect(await db.selectFrom("game_players").select("player_entity_id").where("game_id", "=", seedIds.t1Game).execute()).toEqual([]);
    const badSource = { provider: "wrong", sourceKey: "t1", sourceUrl: "https://example.test/wrong", objectKey: "sources/wrong", checksum: "wrong", parserVersion: "test" };
    await recordSourceObject(badSource, db);
    const badObject = await db.selectFrom("source_objects").select("id").where("provider", "=", "wrong").executeTakeFirstOrThrow();
    const badRun = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({ syncRunId: badRun.id, version: "bad-source", sourceObjectId: badObject.id, coverage: [], facts: { series: [input] } }, db)).rejects.toThrow("Source object provider must match");
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

  it("reuses an existing game identity when an upstream source key replaces a reviewed row", async () => {
    const source = { provider: "fixture", sourceKey: "game-identity-transition", sourceUrl: "https://example.test/game-transition", objectKey: "sources/game-transition", checksum: "game-transition", parserVersion: "test" };
    await recordSourceObject(source, db);
    const sourceObject = await db.selectFrom("source_objects").select("id").where("provider", "=", source.provider).where("source_key", "=", source.sourceKey).executeTakeFirstOrThrow();
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const replacementId = randomUUID();
    await publishDataset({
      syncRunId: run.id, version: "game-identity-transition-v1", sourceObjectId: sourceObject.id, coverage: [], facts: {
        games: [{ id: replacementId, provider: "fixture", sourceKey: "native-game-1", seriesId: seedIds.t1Series, gameNumber: 1,
          playedAt: new Date("2024-11-02T12:00:00Z"), sideATeamId: seedIds.t1, sideAEraId: seedIds.t1Era, sideARegionId: seedIds.lck,
          sideBTeamId: seedIds.weibo, sideBRegionId: seedIds.lpl, winnerTeamId: seedIds.t1 }],
        gamePlayers: [{ gameId: replacementId, playerEntityId: seedIds.faker, side: "a", teamEntityId: seedIds.t1 }],
      },
    }, db);
    const retained = await db.selectFrom("game_facts").select(["id", "source_key"]).where("series_id", "=", seedIds.t1Series).where("game_number", "=", 1).executeTakeFirstOrThrow();
    expect(retained).toEqual({ id: seedIds.t1Game, source_key: "native-game-1" });
    expect(await db.selectFrom("game_facts").select("id").where("id", "=", replacementId).execute()).toEqual([]);
    expect(await db.selectFrom("game_players").select(["game_id", "player_entity_id"]).where("game_id", "=", seedIds.t1Game).execute()).toEqual([{ game_id: seedIds.t1Game, player_entity_id: seedIds.faker }]);
    const conflict = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await expect(publishDataset({
      syncRunId: conflict.id, version: "game-identity-conflict", sourceObjectId: sourceObject.id, coverage: [], facts: {
        games: [{ id: randomUUID(), provider: "fixture", sourceKey: "conflicting-native-game", seriesId: seedIds.t1Series, gameNumber: 1,
          playedAt: new Date("2024-11-02T12:00:00Z"), sideATeamId: seedIds.t1, sideBTeamId: seedIds.weibo, winnerTeamId: seedIds.weibo }],
      },
    }, db)).rejects.toThrow("conflicts with existing game");
    expect(await findDatasetVersion("game-identity-conflict", db)).toBeNull();
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
    const acceptance = await findAcceptanceDatasetEvidence("fresh-audit", [seriesId], db);
    expect(acceptance.dataset).toMatchObject({ generation: expect.any(String), publishedAt: expect.stringMatching(/Z$/u) });
    expect(acceptance.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "series", id: seriesId, sourceObjectId: sourceObject.id }),
      expect.objectContaining({ kind: "game", id: gameId, seriesId, sourceObjectId: sourceObject.id }),
    ]));
    expect(acceptance.facts.every((fact) => fact.publicationGeneration === acceptance.dataset?.generation)).toBe(true);
  });

  it("returns explicit empty acceptance evidence for an unknown dataset", async () => {
    await expect(findAcceptanceDatasetEvidence("missing-acceptance-dataset", [randomUUID()], db)).resolves.toEqual({
      dataset: null,
      facts: [],
      coverage: [],
    });
  });

  it("returns acceptance coverage only from the requested dataset version", async () => {
    const adjacentRun = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({
      syncRunId: adjacentRun.id,
      version: "acceptance-coverage-adjacent",
      coverage: [{
        provider: "leaguepedia", competition: "Worlds", seasonYear: 2024,
        earliestDate: "2024-10-03", latestDate: "2024-11-02", status: "partial",
      }],
    }, db);
    const run = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({
      syncRunId: run.id,
      version: "acceptance-coverage-v1",
      coverage: [{
        provider: "leaguepedia", competition: "Worlds", seasonYear: 2025,
        earliestDate: "2025-10-15", latestDate: "2025-11-09", status: "complete",
      }],
    }, db);

    const evidence = await findAcceptanceDatasetEvidence("acceptance-coverage-v1", [], db);
    expect(evidence.coverage).toEqual([{
        provider: "leaguepedia", competition: "Worlds", seasonYear: 2025,
        earliestDate: "2025-10-15", latestDate: "2025-11-09", status: "complete",
    }]);
  });

  it("rejects direct mutation of append-only dataset versions", async () => {
    const version = await db.selectFrom("dataset_versions").select("id").orderBy("generation", "desc").executeTakeFirstOrThrow();
    await expect(db.updateTable("dataset_versions").set({ version: "mutated" }).where("id", "=", version.id).execute()).rejects.toThrow();
    await expect(db.deleteFrom("dataset_versions").where("id", "=", version.id).execute()).rejects.toThrow();
  });
});
