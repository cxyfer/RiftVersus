import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, destroyDb } from "../src/db.js";
import { createMigrator, migrateToLatest } from "../src/migrator.js";
import { createTestSchemaName, seedIds } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("initial schema migration", () => {
  const schema = createTestSchemaName();
  const decoySchema = `${schema}_decoy`;
  const adminPool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await adminPool.query(`create schema ${schema}`);
  });

  afterAll(async () => {
    await adminPool.query(`drop schema if exists ${schema} cascade`);
    await adminPool.end();
  });

  it("creates the canonical schema idempotently and enforces fact integrity", async () => {
    const db = createDb({ databaseUrl: databaseUrl!, schema });

    try {
      const firstRun = await migrateToLatest(db, { schema });
      expect(firstRun.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ migrationName: "001_initial", status: "Success" }),
        expect.objectContaining({ migrationName: "002_publication_generation", status: "Success" }),
        expect.objectContaining({ migrationName: "003_dataset_versions_append_only", status: "Success" }),
        expect.objectContaining({ migrationName: "004_media_provenance", status: "Success" }),
        expect.objectContaining({ migrationName: "005_override_run_provenance", status: "Success" }),
        expect.objectContaining({ migrationName: "006_fact_retirement", status: "Success" }),
        expect.objectContaining({ migrationName: "007_shared_media_objects", status: "Success" }),
      ]));

      const secondRun = await migrateToLatest(db, { schema });
      expect(secondRun.error).toBeUndefined();
      expect(secondRun.results).toEqual([]);

      const tables = await sql<{ table_name: string }>`
        select table_name from information_schema.tables where table_schema = ${schema}
      `.execute(db);
      expect(tables.rows.map((table) => table.table_name)).toEqual(
        expect.arrayContaining([
          "entities",
          "entity_aliases",
          "team_eras",
          "media_assets",
          "media_objects",
          "override_applications",
          "override_application_runs",
          "tournaments",
          "series_facts",
          "game_facts",
          "game_players",
          "team_region_history",
          "sync_runs",
          "source_objects",
          "source_cursors",
          "dataset_versions",
          "coverage_status",
          "fact_mutation_audits",
          "kysely_migration",
          "kysely_migration_lock",
        ]),
      );

      const migrationMetadata = await sql<{ table_name: string; table_schema: string }>`
        select table_name, table_schema
        from information_schema.tables
        where table_schema = ${schema}
          and table_name in ('kysely_migration', 'kysely_migration_lock')
      `.execute(db);
      expect(migrationMetadata.rows).toEqual([
        { table_name: "kysely_migration", table_schema: schema },
        { table_name: "kysely_migration_lock", table_schema: schema },
      ]);

      const indexes = await sql<{ indexname: string; indexdef: string }>`
        select indexname, indexdef from pg_indexes where schemaname = ${schema}
      `.execute(db);
      expect(indexes.rows.map((index) => index.indexname)).toEqual(
        expect.arrayContaining([
          "media_assets_current_entity_kind_unique",
          "entities_canonical_name_search",
          "entity_aliases_display_name_search",
          "tournaments_category_lookup",
          "series_facts_comparison_lookup",
          "game_facts_comparison_lookup",
          "game_players_player_game_lookup",
          "game_players_game_player_lookup",
          "team_region_history_lookup",
          "fact_mutation_audits_fact_lookup",
          "series_facts_retirement_visibility",
          "game_facts_retirement_visibility",
          "media_assets_object_owners",
        ]),
      );
      expect(indexes.rows.find((index) => index.indexname === "media_assets_current_entity_kind_unique")?.indexdef).toContain(
        "WHERE is_current",
      );

      await expect(
        db.insertInto("entities").values({
          id: randomUUID(),
          kind: "invalid" as never,
          canonical_name: "Invalid",
          slug: "invalid",
        }).execute(),
      ).rejects.toThrow();

      await db.insertInto("entities").values([
        { id: seedIds.teamA, kind: "team", canonical_name: "Alpha", slug: "alpha" },
        { id: seedIds.teamB, kind: "team", canonical_name: "Bravo", slug: "bravo" },
        { id: seedIds.teamC, kind: "team", canonical_name: "Charlie", slug: "charlie" },
        { id: seedIds.player, kind: "player", canonical_name: "Player", slug: "player" },
        { id: seedIds.region, kind: "region", canonical_name: "Region", slug: "region" },
      ]).execute();
      await expect(
        db.insertInto("team_eras").values({
          id: randomUUID(),
          team_entity_id: seedIds.player,
          display_name: "Invalid era",
          slug: "invalid-era",
        }).execute(),
      ).rejects.toThrow();

      await db.insertInto("tournaments").values({
        id: seedIds.tournament,
        provider: "fixture",
        source_key: "tournament-1",
        name: "Fixture Tournament",
        category: "league",
      }).execute();
      await expect(
        db.insertInto("tournaments").values({
          id: randomUUID(),
          provider: "fixture",
          source_key: "invalid-category",
          name: "Invalid Tournament",
          category: "invalid" as never,
        }).execute(),
      ).rejects.toThrow();

      await expect(
        db.insertInto("series_facts").values({
          id: seedIds.series,
          provider: "fixture",
          source_key: "invalid-best-of",
          tournament_id: seedIds.tournament,
          played_at: new Date("2026-01-01T00:00:00Z"),
          best_of: 2 as never,
          completed: true,
          side_a_team_id: seedIds.teamA,
          side_b_team_id: seedIds.teamB,
          side_a_score: 1,
          side_b_score: 0,
          winner_team_id: seedIds.teamA,
        }).execute(),
      ).rejects.toThrow();
      for (const [bestOf, sideAScore, sideBScore] of [
        [1, 4, 0],
        [3, 3, 2],
        [5, 7, 6],
      ] as const) {
        await expect(
          db.insertInto("series_facts").values({
            id: randomUUID(),
            provider: "fixture",
            source_key: `impossible-score-${bestOf}`,
            tournament_id: seedIds.tournament,
            played_at: new Date("2026-01-01T00:00:00Z"),
            best_of: bestOf,
            completed: true,
            side_a_team_id: seedIds.teamA,
            side_b_team_id: seedIds.teamB,
            side_a_score: sideAScore,
            side_b_score: sideBScore,
            winner_team_id: seedIds.teamA,
          }).execute(),
        ).rejects.toThrow();
      }
      await expect(
        db.insertInto("series_facts").values({
          id: randomUUID(),
          provider: "fixture",
          source_key: "wrong-side-kind",
          tournament_id: seedIds.tournament,
          played_at: new Date("2026-01-01T00:00:00Z"),
          best_of: 1,
          completed: true,
          side_a_team_id: seedIds.player,
          side_b_team_id: seedIds.teamB,
          side_a_score: 1,
          side_b_score: 0,
          winner_team_id: seedIds.teamB,
        }).execute(),
      ).rejects.toThrow();
      await expect(
        db.insertInto("team_region_history").values({
          team_entity_id: seedIds.teamA,
          region_entity_id: seedIds.teamB,
          valid_from: "2026-01-01",
          provider: "fixture",
          source_key: "wrong-region-kind",
        }).execute(),
      ).rejects.toThrow();
      await expect(
        db.insertInto("series_facts").values({
          id: randomUUID(),
          provider: "fixture",
          source_key: "wrong-region-kind",
          tournament_id: seedIds.tournament,
          played_at: new Date("2026-01-01T00:00:00Z"),
          best_of: 1,
          completed: true,
          side_a_team_id: seedIds.teamA,
          side_a_region_id: seedIds.teamA,
          side_b_team_id: seedIds.teamB,
          side_a_score: 1,
          side_b_score: 0,
          winner_team_id: seedIds.teamA,
        }).execute(),
      ).rejects.toThrow();

      await db.insertInto("entity_aliases").values({
        id: randomUUID(),
        entity_id: seedIds.teamA,
        provider: "fixture",
        source_key: "team-a",
        display_name: "Alpha",
      }).execute();
      await expect(
        db.insertInto("entity_aliases").values({
          id: randomUUID(),
          entity_id: seedIds.teamB,
          provider: "fixture",
          source_key: "team-a",
          display_name: "Another Alpha",
        }).execute(),
      ).rejects.toThrow();

      await db.insertInto("series_facts").values({
        id: seedIds.series,
        provider: "fixture",
        source_key: "series-1",
        tournament_id: seedIds.tournament,
        played_at: new Date("2026-01-01T00:00:00Z"),
        best_of: 3,
        completed: true,
        side_a_team_id: seedIds.teamA,
        side_b_team_id: seedIds.teamB,
        side_a_score: 2,
        side_b_score: 0,
        winner_team_id: seedIds.teamA,
      }).execute();
      await expect(
        db.updateTable("series_facts")
          .set({ played_at: new Date("2026-01-02T00:00:00Z") })
          .where("id", "=", seedIds.series)
          .execute(),
      ).rejects.toThrow();

      await db.insertInto("source_objects").values({
        id: seedIds.sourceObject,
        provider: "fixture",
        source_key: "series-1-correction",
        source_url: "https://example.test/series-1-correction.json",
        object_key: "fixtures/series-1-correction.json",
        checksum: "fixture-checksum",
        parser_version: "test",
      }).execute();
      await db.insertInto("source_objects").values({
        id: seedIds.sourceObjectTwo,
        provider: "fixture",
        source_key: "immutable-source",
        source_url: "https://example.test/immutable-source.json",
        object_key: "fixtures/immutable-source.json",
        checksum: "immutable-checksum",
        parser_version: "test",
      }).execute();
      await db.insertInto("override_applications").values({
        id: seedIds.overrideApplication,
        override_file: "data/overrides/fixture.yaml",
        checksum: "override-checksum",
      }).execute();
      await expect(
        db.updateTable("source_objects")
          .set({ parser_version: "changed" })
          .where("id", "=", seedIds.sourceObjectTwo)
          .execute(),
      ).rejects.toThrow();
      await expect(
        db.deleteFrom("source_objects").where("id", "=", seedIds.sourceObjectTwo).execute(),
      ).rejects.toThrow();
      await expect(
        db.updateTable("override_applications")
          .set({ checksum: "changed" })
          .where("id", "=", seedIds.overrideApplication)
          .execute(),
      ).rejects.toThrow();
      await expect(
        db.deleteFrom("override_applications").where("id", "=", seedIds.overrideApplication).execute(),
      ).rejects.toThrow();
      await sql.raw(`create schema ${decoySchema}`).execute(db);
      try {
        await sql.raw(`create table ${decoySchema}.series_facts (id uuid primary key)`).execute(db);
        await expect(
          sql.raw(`
            select riftversus_authorize_fact_update(
              '${decoySchema}.series_facts'::regclass,
              '${seedIds.series}'::uuid,
              'source_object',
              '${seedIds.sourceObject}'::uuid
            )
          `).execute(db),
        ).rejects.toThrow();
      } finally {
        await sql.raw(`drop schema ${decoySchema} cascade`).execute(db);
      }
      await db.connection().execute(async (connection) => {
        await sql`
          select set_config('riftversus.fact_update_provenance_kind', 'source_object', false)
        `.execute(connection);
        await sql`
          select set_config('riftversus.fact_update_provenance_id', ${seedIds.sourceObject}, false)
        `.execute(connection);
        await expect(
          connection.updateTable("series_facts")
            .set({ played_at: new Date("2026-01-02T00:00:00Z") })
            .where("id", "=", seedIds.series)
            .execute(),
        ).rejects.toThrow();
      });
      await db.transaction().execute(async (trx) => {
        await sql`
          select riftversus_authorize_fact_update(
            'series_facts'::regclass,
            ${seedIds.series}::uuid,
            'source_object',
            ${seedIds.sourceObject}::uuid
          )
        `.execute(trx);
        await trx.updateTable("series_facts")
          .set({ played_at: new Date("2026-01-02T00:00:00Z") })
          .where("id", "=", seedIds.series)
          .execute();
      });
      const updatedSeries = await db.selectFrom("series_facts")
        .select("played_at")
        .where("id", "=", seedIds.series)
        .executeTakeFirstOrThrow();
      expect(updatedSeries.played_at.toISOString()).toBe("2026-01-02T00:00:00.000Z");
      await db.transaction().execute(async (trx) => {
        await sql`
          select riftversus_authorize_fact_update(
            'series_facts'::regclass,
            ${seedIds.series}::uuid,
            'override_application',
            ${seedIds.overrideApplication}::uuid
          )
        `.execute(trx);
        await trx.updateTable("series_facts")
          .set({ played_at: new Date("2026-01-03T00:00:00Z") })
          .where("id", "=", seedIds.series)
          .execute();
      });
      const mutationAudits = await sql<{
        fact_id: string;
        fact_table: string;
        source_object_id: string | null;
        override_application_id: string | null;
        old_played_at: string;
        new_played_at: string;
      }>`
        select fact_id, fact_table, source_object_id, override_application_id,
          old_payload ->> 'played_at' as old_played_at,
          new_payload ->> 'played_at' as new_played_at
        from fact_mutation_audits
        where fact_id = ${seedIds.series}::uuid
        order by audit_id
      `.execute(db);
      expect(mutationAudits.rows).toEqual([
        {
          fact_id: seedIds.series,
          fact_table: "series_facts",
          source_object_id: seedIds.sourceObject,
          override_application_id: null,
          old_played_at: expect.stringContaining("2026-01-01"),
          new_played_at: expect.stringContaining("2026-01-02"),
        },
        {
          fact_id: seedIds.series,
          fact_table: "series_facts",
          source_object_id: null,
          override_application_id: seedIds.overrideApplication,
          old_played_at: expect.stringContaining("2026-01-02"),
          new_played_at: expect.stringContaining("2026-01-03"),
        },
      ]);
      await expect(
        sql`
          update fact_mutation_audits
          set changed_at = now()
          where fact_id = ${seedIds.series}::uuid
        `.execute(db),
      ).rejects.toThrow();
      await expect(
        db.deleteFrom("fact_mutation_audits")
          .where("fact_id", "=", seedIds.series)
          .execute(),
      ).rejects.toThrow();
      await expect(
        db.insertInto("series_facts").values({
          id: randomUUID(),
          provider: "fixture",
          source_key: "invalid-score-winner",
          tournament_id: seedIds.tournament,
          played_at: new Date("2026-01-01T00:00:00Z"),
          best_of: 3,
          completed: true,
          side_a_team_id: seedIds.teamA,
          side_b_team_id: seedIds.teamB,
          side_a_score: 0,
          side_b_score: 2,
          winner_team_id: seedIds.teamA,
        }).execute(),
      ).rejects.toThrow();

      await expect(
        db.insertInto("game_facts").values({
          id: seedIds.game,
          provider: "fixture",
          source_key: "invalid-winner",
          series_id: seedIds.series,
          game_number: 1,
          played_at: new Date("2026-01-01T00:00:00Z"),
          side_a_team_id: seedIds.teamA,
          side_b_team_id: seedIds.teamB,
          winner_team_id: seedIds.teamC,
        }).execute(),
      ).rejects.toThrow();

      await db.insertInto("game_facts").values({
        id: seedIds.game,
        provider: "fixture",
        source_key: "game-1",
        series_id: seedIds.series,
        game_number: 1,
        played_at: new Date("2026-01-01T00:00:00Z"),
        side_a_team_id: seedIds.teamA,
        side_b_team_id: seedIds.teamB,
        winner_team_id: seedIds.teamA,
      }).execute();
      await expect(
        db.insertInto("game_players").values({
          game_id: seedIds.game,
          player_entity_id: seedIds.teamA,
          team_entity_id: seedIds.teamA,
          side: "invalid" as never,
        }).execute(),
      ).rejects.toThrow();
      await expect(
        db.insertInto("game_players").values({
          game_id: seedIds.game,
          player_entity_id: seedIds.teamA,
          team_entity_id: seedIds.teamA,
          side: "a",
        }).execute(),
      ).rejects.toThrow();
    } finally {
      await destroyDb(db);
    }
  });
});

describeWithDatabase("override provenance migration downgrade", () => {
  const adminPool = new Pool({ connectionString: databaseUrl });
  afterAll(async () => { await adminPool.end(); });

  async function setup() {
    const schema = createTestSchemaName();
    await adminPool.query(`create schema ${schema}`);
    const db = createDb({ databaseUrl: databaseUrl!, schema });
    await migrateToLatest(db, { schema });
    expect((await createMigrator(db, { schema }).migrateDown()).error).toBeUndefined();
    expect((await createMigrator(db, { schema }).migrateDown()).error).toBeUndefined();
    const applicationId = randomUUID(); const firstRunId = randomUUID(); const secondRunId = randomUUID();
    await db.insertInto("sync_runs").values([
      { id: firstRunId, provider: "leaguepedia", mode: "sync", status: "running", parser_version: "test" },
      { id: secondRunId, provider: "leaguepedia", mode: "sync", status: "running", parser_version: "test" },
    ]).execute();
    await db.insertInto("override_applications").values({ id: applicationId, override_file: "data/overrides/identities.yaml", checksum: "sha256:fixture" }).execute();
    return { schema, db, applicationId, firstRunId, secondRunId };
  }

  async function cleanup(schema: string, db: ReturnType<typeof createDb>) {
    await destroyDb(db); await adminPool.query(`drop schema if exists ${schema} cascade`);
  }

  it("refuses a lossy downgrade and leaves migration 005 state intact", async () => {
    const context = await setup();
    try {
      await context.db.insertInto("override_application_runs").values([
        { override_application_id: context.applicationId, sync_run_id: context.firstRunId },
        { override_application_id: context.applicationId, sync_run_id: context.secondRunId },
      ]).execute();
      const result = await createMigrator(context.db, { schema: context.schema }).migrateDown();
      expect(result.error).toBeInstanceOf(Error);
      expect(String((result.error as Error).message)).toMatch(/cannot losslessly downgrade/i);
      expect(await context.db.selectFrom("override_application_runs").select("sync_run_id").where("override_application_id", "=", context.applicationId).execute()).toHaveLength(2);
      const migration = await sql<{ name: string }>`select name from ${sql.table(`${context.schema}.kysely_migration`)} where name = '005_override_run_provenance'`.execute(context.db);
      expect(migration.rows).toEqual([{ name: "005_override_run_provenance" }]);
    } finally { await cleanup(context.schema, context.db); }
  });

  it("downgrades one association without changing its legacy run identity", async () => {
    const context = await setup();
    try {
      await context.db.insertInto("override_application_runs").values({ override_application_id: context.applicationId, sync_run_id: context.firstRunId }).execute();
      const result = await createMigrator(context.db, { schema: context.schema }).migrateDown();
      expect(result.error).toBeUndefined();
      const legacy = await sql<{ sync_run_id: string }>`select sync_run_id from override_applications where id = ${context.applicationId}`.execute(context.db);
      expect(legacy.rows).toEqual([{ sync_run_id: context.firstRunId }]);
      const table = await sql<{ exists: boolean }>`select to_regclass(${`${context.schema}.override_application_runs`}) is not null as exists`.execute(context.db);
      expect(table.rows).toEqual([{ exists: false }]);
    } finally { await cleanup(context.schema, context.db); }
  });
});

describeWithDatabase("shared media objects migration downgrade", () => {
  const adminPool = new Pool({ connectionString: databaseUrl });
  afterAll(async () => { await adminPool.end(); });

  async function setup(ownerCount: 1 | 2) {
    const schema = createTestSchemaName();
    await adminPool.query(`create schema ${schema}`);
    const db = createDb({ databaseUrl: databaseUrl!, schema });
    await migrateToLatest(db, { schema });
    const entityIds = [randomUUID(), randomUUID()];
    await db.insertInto("entities").values(entityIds.slice(0, ownerCount).map((id, index) => ({ id, kind: "team" as const, canonical_name: `Media Owner ${index}`, slug: `media-owner-${index}` }))).execute();
    await db.insertInto("media_objects").values({ object_key: "media/shared.png", checksum: "sha256:shared", content_type: "image/png", byte_size: "42" }).execute();
    await db.insertInto("media_assets").values(entityIds.slice(0, ownerCount).map((entityId) => ({ id: randomUUID(), entity_id: entityId, team_era_id: null, kind: "logo" as const, provider: "leaguepedia", source_url: "https://example.test/shared.png", object_key: "media/shared.png", attribution: "fixture", license: null, is_current: true }))).execute();
    return { schema, db };
  }

  async function cleanup(schema: string, db: ReturnType<typeof createDb>) {
    await destroyDb(db);
    await adminPool.query(`drop schema if exists ${schema} cascade`);
  }

  it("refuses a lossy downgrade when one immutable object has multiple owners", async () => {
    const context = await setup(2);
    try {
      const result = await createMigrator(context.db, { schema: context.schema }).migrateDown();
      expect(result.error).toBeInstanceOf(Error);
      expect(String((result.error as Error).message)).toMatch(/cannot losslessly downgrade/i);
      expect(await context.db.selectFrom("media_assets").select("object_key").execute()).toHaveLength(2);
      expect(await context.db.selectFrom("media_objects").select("object_key").execute()).toEqual([{ object_key: "media/shared.png" }]);
    } finally { await cleanup(context.schema, context.db); }
  });

  it("restores immutable metadata to a sole legacy owner", async () => {
    const context = await setup(1);
    try {
      const result = await createMigrator(context.db, { schema: context.schema }).migrateDown();
      expect(result.error).toBeUndefined();
      const legacy = await sql<{ object_key: string; checksum: string; content_type: string; byte_size: string }>`
        select object_key, checksum, content_type, byte_size from ${sql.table(`${context.schema}.media_assets`)}
      `.execute(context.db);
      expect(legacy.rows).toEqual([{ object_key: "media/shared.png", checksum: "sha256:shared", content_type: "image/png", byte_size: "42" }]);
      const objectTable = await sql<{ exists: boolean }>`select to_regclass(${`${context.schema}.media_objects`}) is not null as exists`.execute(context.db);
      expect(objectTable.rows).toEqual([{ exists: false }]);
    } finally { await cleanup(context.schema, context.db); }
  });

  it("rejects direct immutable metadata updates and deletion", async () => {
    const context = await setup(1);
    try {
      await expect(context.db.updateTable("media_objects").set({ checksum: "sha256:changed" }).where("object_key", "=", "media/shared.png").execute()).rejects.toThrow(/append-only/i);
      await expect(context.db.updateTable("media_objects").set({ content_type: "image/webp" }).where("object_key", "=", "media/shared.png").execute()).rejects.toThrow(/append-only/i);
      await expect(context.db.updateTable("media_objects").set({ byte_size: "43" }).where("object_key", "=", "media/shared.png").execute()).rejects.toThrow(/append-only/i);
      await expect(context.db.deleteFrom("media_objects").where("object_key", "=", "media/shared.png").execute()).rejects.toThrow(/append-only/i);
      expect(await context.db.selectFrom("media_objects").selectAll().where("object_key", "=", "media/shared.png").executeTakeFirstOrThrow()).toEqual({ object_key: "media/shared.png", checksum: "sha256:shared", content_type: "image/png", byte_size: "42" });
    } finally { await cleanup(context.schema, context.db); }
  });
});

describeWithDatabase("fact retirement migration downgrade", () => {
  const adminPool = new Pool({ connectionString: databaseUrl });
  afterAll(async () => { await adminPool.end(); });

  async function setup() {
    const schema = createTestSchemaName();
    await adminPool.query(`create schema ${schema}`);
    const db = createDb({ databaseUrl: databaseUrl!, schema });
    await migrateToLatest(db, { schema });
    expect((await createMigrator(db, { schema }).migrateDown()).error).toBeUndefined();
    return { schema, db };
  }

  async function cleanup(schema: string, db: ReturnType<typeof createDb>) {
    await destroyDb(db);
    await adminPool.query(`drop schema if exists ${schema} cascade`);
  }

  it.each(["series", "game"] as const)("refuses a lossy downgrade for retired %s facts and preserves migration metadata, column, and value", async (factKind) => {
    const context = await setup();
    try {
      const teamA = randomUUID(); const teamB = randomUUID(); const tournament = randomUUID(); const series = randomUUID(); const game = randomUUID();
      await context.db.insertInto("entities").values([
        { id: teamA, kind: "team", canonical_name: "Retirement A", slug: "retirement-a" },
        { id: teamB, kind: "team", canonical_name: "Retirement B", slug: "retirement-b" },
      ]).execute();
      await context.db.insertInto("tournaments").values({ id: tournament, provider: "fixture", source_key: "retirement", name: "Retirement", category: "worlds" }).execute();
      await context.db.insertInto("series_facts").values({ id: series, provider: "fixture", source_key: "retired", tournament_id: tournament, played_at: new Date("2024-01-01T00:00:00Z"), best_of: 1, completed: true, side_a_team_id: teamA, side_b_team_id: teamB, side_a_score: 1, side_b_score: 0, winner_team_id: teamA, publication_generation: "1", retired_generation: factKind === "series" ? "2" : null }).execute();
      if (factKind === "game") await context.db.insertInto("game_facts").values({ id: game, provider: "fixture", source_key: "retired-game", series_id: series, game_number: 1, played_at: new Date("2024-01-01T00:00:00Z"), side_a_team_id: teamA, side_b_team_id: teamB, winner_team_id: teamA, publication_generation: "1", retired_generation: "2" }).execute();
      const result = await createMigrator(context.db, { schema: context.schema }).migrateDown();
      expect(result.error).toBeInstanceOf(Error);
      expect(String((result.error as Error).message)).toMatch(/cannot losslessly downgrade fact retirement/i);
      const retained = factKind === "series"
        ? await context.db.selectFrom("series_facts").select("retired_generation").where("id", "=", series).executeTakeFirstOrThrow()
        : await context.db.selectFrom("game_facts").select("retired_generation").where("id", "=", game).executeTakeFirstOrThrow();
      expect(retained.retired_generation).toBe("2");
      const column = await sql<{ exists: boolean }>`select exists (select 1 from information_schema.columns where table_schema = ${context.schema} and table_name = ${factKind === "series" ? "series_facts" : "game_facts"} and column_name = 'retired_generation') as exists`.execute(context.db);
      expect(column.rows).toEqual([{ exists: true }]);
      const migration = await sql<{ name: string }>`select name from ${sql.table(`${context.schema}.kysely_migration`)} where name = '006_fact_retirement'`.execute(context.db);
      expect(migration.rows).toEqual([{ name: "006_fact_retirement" }]);
    } finally { await cleanup(context.schema, context.db); }
  });

  it("drops retirement columns when no fact has retirement metadata", async () => {
    const context = await setup();
    try {
      const result = await createMigrator(context.db, { schema: context.schema }).migrateDown();
      expect(result.error).toBeUndefined();
      const columns = await sql<{ column_name: string }>`select column_name from information_schema.columns where table_schema = ${context.schema} and table_name in ('series_facts', 'game_facts') and column_name = 'retired_generation'`.execute(context.db);
      expect(columns.rows).toEqual([]);
    } finally { await cleanup(context.schema, context.db); }
  });
});
