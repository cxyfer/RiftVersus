import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, destroyDb } from "../src/db.js";
import { migrateToLatest } from "../src/migrator.js";
import { createTestSchemaName, seedIds } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("initial schema migration", () => {
  const schema = createTestSchemaName();
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
      expect(firstRun.results).toEqual([
        expect.objectContaining({ migrationName: "001_initial", status: "Success" }),
      ]);

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
          "override_applications",
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
      expect(migrationMetadata.rows).toEqual(
        expect.arrayContaining([
          { table_name: "kysely_migration", table_schema: schema },
          { table_name: "kysely_migration_lock", table_schema: schema },
        ]),
      );

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
      ]).execute();

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
          select riftversus_authorize_fact_update('source_object', ${seedIds.sourceObject}::uuid)
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
    } finally {
      await destroyDb(db);
    }
  });
});
