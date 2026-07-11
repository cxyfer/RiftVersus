import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import type { Kysely } from "kysely";

import type { Database } from "../types.js";
import type {
  BeginSyncRunInput, DatasetVersion, FailSyncRunInput, PublishDatasetInput, SourceObjectInput, SyncRun,
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
    const run = await trx.selectFrom("sync_runs").select(["id", "status"])
      .where("id", "=", input.syncRunId).executeTakeFirst();
    if (run === undefined || run.status !== "running") throw new Error("Only a running sync run may publish a dataset.");
    const finishedAt = new Date();
    await trx.updateTable("sync_runs").set({ status: "succeeded", finished_at: finishedAt }).where("id", "=", input.syncRunId).execute();
    const version = await trx.insertInto("dataset_versions").values({ id: randomUUID(), version: input.version, sync_run_id: input.syncRunId })
      .returning(["id", "version", "published_at", "sync_run_id"]).executeTakeFirstOrThrow();
    if (input.coverage.length) await trx.insertInto("coverage_status").values(input.coverage.map((coverage) => ({
      id: randomUUID(), dataset_version_id: version.id, provider: coverage.provider, competition: coverage.competition,
      season_year: coverage.seasonYear, earliest_date: coverage.earliestDate ?? null, latest_date: coverage.latestDate ?? null,
      status: coverage.status, detail: coverage.detail ?? null,
    }))).execute();
    return { id: version.id, version: version.version, publishedAt: version.published_at.toISOString(), syncRunId: version.sync_run_id };
  });
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
