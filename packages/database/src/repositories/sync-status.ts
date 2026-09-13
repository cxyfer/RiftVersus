import { sql, type Kysely } from "kysely";
import type { Database } from "../types.js";

export interface SyncStatusSnapshot {
  runs: Array<{ mode: string; lastSuccessfulSyncAt: string | null; consecutiveFailures: number }>;
  scopes: Array<{ competition: string; seasonYear: number; status: string; checkedAt: string | null }>;
}

export async function getSyncStatus(db: Kysely<Database>): Promise<SyncStatusSnapshot> {
  const runs = await sql<{ mode: string; last_success: Date | null; failures: number }>`
    WITH successes AS (
      SELECT mode, max(finished_at) AS last_success FROM sync_runs
      WHERE provider = 'leaguepedia' AND status = 'succeeded' GROUP BY mode
    )
    SELECT modes.mode, successes.last_success,
      (SELECT count(*)::int FROM sync_runs r WHERE r.provider = 'leaguepedia'
        AND r.mode = modes.mode AND r.status = 'failed'
        AND r.finished_at > coalesce(successes.last_success, '-infinity'::timestamptz)) AS failures
    FROM (VALUES ('sync'), ('backfill')) AS modes(mode)
    LEFT JOIN successes ON successes.mode = modes.mode
  `.execute(db);
  const scopes = await sql<{ competition: string; season_year: number; status: string; checked_at: Date | null }>`
    SELECT DISTINCT ON (c.competition, c.season_year)
      c.competition, c.season_year, c.status,
      (SELECT max(r.finished_at) FROM sync_runs r WHERE r.provider = 'leaguepedia'
        AND r.status = 'succeeded'
        AND (r.id = d.sync_run_id OR r.reused_dataset_version_id = d.id)) AS checked_at
    FROM coverage_status c JOIN dataset_versions d ON d.id = c.dataset_version_id
    WHERE c.provider = 'leaguepedia'
    ORDER BY c.competition, c.season_year, d.generation DESC
  `.execute(db);
  return {
    runs: runs.rows.map((row) => ({ mode: row.mode, lastSuccessfulSyncAt: row.last_success?.toISOString() ?? null, consecutiveFailures: row.failures })),
    scopes: scopes.rows.map((row) => ({ competition: row.competition, seasonYear: row.season_year, status: row.status, checkedAt: row.checked_at?.toISOString() ?? null })),
  };
}
