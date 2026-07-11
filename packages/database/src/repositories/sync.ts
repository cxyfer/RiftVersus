import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import type { Kysely } from "kysely";

import type { Database } from "../types.js";
import type {
  BeginSyncRunInput, DatasetVersion, FailSyncRunInput, GameFactInput, PublishDatasetInput, SeriesFactInput, SourceObjectInput, SyncRun,
} from "./types.js";

function toSyncRun(row: { id: string; provider: string; mode: string; status: string; parser_version: string; started_at: Date; finished_at: Date | null; error: string | null }): SyncRun {
  return {
    id: row.id, provider: row.provider, mode: row.mode as SyncRun["mode"], status: row.status as SyncRun["status"],
    parserVersion: row.parser_version, startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null, error: row.error,
  };
}

export async function beginSyncRun(input: BeginSyncRunInput, db: Kysely<Database>): Promise<SyncRun> {
  const row = await db.insertInto("sync_runs").values({
    id: randomUUID(), provider: input.provider, mode: input.mode, status: "running", parser_version: input.parserVersion,
  }).returning(["id", "provider", "mode", "status", "parser_version", "started_at", "finished_at", "error"]).executeTakeFirstOrThrow();
  return toSyncRun(row);
}

export async function recordSourceObject(input: SourceObjectInput, db: Kysely<Database>): Promise<"inserted" | "existing"> {
  const inserted = await db.insertInto("source_objects").values({
    id: randomUUID(), provider: input.provider, source_key: input.sourceKey, source_url: input.sourceUrl,
    object_key: input.objectKey, checksum: input.checksum, content_type: input.contentType ?? null,
    byte_size: input.byteSize ?? null, parser_version: input.parserVersion,
  }).onConflict((conflict) => conflict.columns(["provider", "source_key"]).doNothing()).returning("id").executeTakeFirst();
  return inserted === undefined ? "existing" : "inserted";
}

export async function publishDataset(input: PublishDatasetInput, db: Kysely<Database>): Promise<DatasetVersion> {
  return db.transaction().execute(async (trx) => {
    // Version generations are global visibility state, so providers serialize only this allocation.
    await sql`select pg_advisory_xact_lock(817242991)`.execute(trx);
    const run = await trx.selectFrom("sync_runs").select(["id", "status"])
      .where("id", "=", input.syncRunId).executeTakeFirst();
    if (run === undefined || run.status !== "running") throw new Error("Only a running sync run may publish a dataset.");
    const facts = input.facts;
    if (facts !== undefined && input.sourceObjectId === undefined) throw new Error("Canonical fact publication requires sourceObjectId provenance.");
    if (input.sourceObjectId !== undefined) {
      const source = await trx.selectFrom("source_objects").select("id").where("id", "=", input.sourceObjectId).executeTakeFirst();
      if (source === undefined) throw new Error("Canonical fact publication source object does not exist.");
    }
    const latest = await trx.selectFrom("dataset_versions").select("generation").orderBy("generation", "desc").executeTakeFirst();
    const generation = (BigInt(latest?.generation ?? "0") + 1n).toString();
    for (const item of facts?.series ?? []) await upsertSeries(item, generation, input.sourceObjectId!, trx);
    for (const item of facts?.games ?? []) await upsertGame(item, generation, input.sourceObjectId!, trx);
    if ((facts?.gamePlayers?.length ?? 0) > 0) await trx.insertInto("game_players").values(facts!.gamePlayers!.map((item) => ({
      game_id: item.gameId, player_entity_id: item.playerEntityId, side: item.side, team_entity_id: item.teamEntityId,
    }))).onConflict((conflict) => conflict.columns(["game_id", "player_entity_id"]).doUpdateSet((eb) => ({ side: eb.ref("excluded.side"), team_entity_id: eb.ref("excluded.team_entity_id") }))).execute();
    const finishedAt = new Date();
    const version = await trx.insertInto("dataset_versions").values({ id: randomUUID(), version: input.version, sync_run_id: input.syncRunId, generation })
      .returning(["id", "version", "published_at", "sync_run_id", "generation"]).executeTakeFirstOrThrow();
    if (input.coverage.length) await trx.insertInto("coverage_status").values(input.coverage.map((coverage) => ({
      id: randomUUID(), dataset_version_id: version.id, provider: coverage.provider, competition: coverage.competition,
      season_year: coverage.seasonYear, earliest_date: coverage.earliestDate ?? null, latest_date: coverage.latestDate ?? null,
      status: coverage.status, detail: coverage.detail ?? null,
    }))).execute();
    await trx.updateTable("sync_runs").set({ status: "succeeded", finished_at: finishedAt }).where("id", "=", input.syncRunId).execute();
    return { id: version.id, version: version.version, publishedAt: version.published_at.toISOString(), syncRunId: version.sync_run_id, generation: version.generation };
  });
}

async function authorizeExistingFact(table: "series_facts" | "game_facts", id: string, sourceObjectId: string, trx: Kysely<Database>) {
  const existing = await trx.selectFrom(table).select("id").where("id", "=", id).executeTakeFirst();
  if (existing !== undefined) await sql`select riftversus_authorize_fact_update(${sql.lit(table)}::regclass, ${id}::uuid, 'source_object', ${sourceObjectId}::uuid)`.execute(trx);
}

async function upsertSeries(item: SeriesFactInput, generation: string, sourceObjectId: string, trx: Kysely<Database>) {
  await authorizeExistingFact("series_facts", item.id, sourceObjectId, trx);
  const values = { id: item.id, provider: item.provider, source_key: item.sourceKey, tournament_id: item.tournamentId, played_at: item.playedAt, best_of: item.bestOf, completed: item.completed, side_a_team_id: item.sideATeamId, side_a_era_id: item.sideAEraId ?? null, side_a_region_id: item.sideARegionId ?? null, side_b_team_id: item.sideBTeamId, side_b_era_id: item.sideBEraId ?? null, side_b_region_id: item.sideBRegionId ?? null, side_a_score: item.sideAScore ?? null, side_b_score: item.sideBScore ?? null, winner_team_id: item.winnerTeamId ?? null, publication_generation: generation };
  await trx.insertInto("series_facts").values(values).onConflict((conflict) => conflict.column("id").doUpdateSet(values)).execute();
}

async function upsertGame(item: GameFactInput, generation: string, sourceObjectId: string, trx: Kysely<Database>) {
  await authorizeExistingFact("game_facts", item.id, sourceObjectId, trx);
  const values = { id: item.id, provider: item.provider, source_key: item.sourceKey, series_id: item.seriesId, game_number: item.gameNumber, played_at: item.playedAt, side_a_team_id: item.sideATeamId, side_a_era_id: item.sideAEraId ?? null, side_a_region_id: item.sideARegionId ?? null, side_b_team_id: item.sideBTeamId, side_b_era_id: item.sideBEraId ?? null, side_b_region_id: item.sideBRegionId ?? null, winner_team_id: item.winnerTeamId ?? null, publication_generation: generation };
  await trx.insertInto("game_facts").values(values).onConflict((conflict) => conflict.column("id").doUpdateSet(values)).execute();
}

export async function failSyncRun(input: FailSyncRunInput, db: Kysely<Database>): Promise<void> {
  await db.updateTable("sync_runs").set({ status: "failed", finished_at: new Date(), error: input.error })
    .where("id", "=", input.syncRunId).where("status", "=", "running").execute();
}

function advisoryLockKey(provider: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const character of provider) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asIntN(64, hash * 0x100000001b3n);
  }
  return hash;
}

export async function withSyncAdvisoryLock<T>(provider: string, callback: () => Promise<T>, db: Kysely<Database>): Promise<"ran" | "locked"> {
  return db.connection().execute(async (connection) => {
    const key = advisoryLockKey(provider).toString();
    const lock = await sql<{ acquired: boolean }>`select pg_try_advisory_lock(${key}::bigint) as acquired`.execute(connection);
    if (!lock.rows[0]?.acquired) return "locked";
    try { await callback(); return "ran"; }
    finally { await sql`select pg_advisory_unlock(${key}::bigint)`.execute(connection); }
  });
}
