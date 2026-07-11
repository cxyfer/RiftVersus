import type { Kysely } from "kysely";

import type { Database } from "../types.js";
import type { DatasetStatus } from "./types.js";

export async function getDatasetStatus(db: Kysely<Database>): Promise<DatasetStatus | null> {
  const version = await db.selectFrom("dataset_versions")
    .innerJoin("sync_runs", "sync_runs.id", "dataset_versions.sync_run_id")
    .select(["dataset_versions.id", "dataset_versions.version", "dataset_versions.published_at", "sync_runs.finished_at"])
    .orderBy("dataset_versions.generation", "desc")
    .orderBy("dataset_versions.id", "desc")
    .executeTakeFirst();
  if (version === undefined) return null;
  const coverage = await db.selectFrom("coverage_status")
    .select(["provider", "competition", "season_year", "earliest_date", "latest_date", "status", "detail"])
    .where("dataset_version_id", "=", version.id)
    .orderBy("provider").orderBy("competition").orderBy("season_year")
    .execute();
  const dates = coverage.flatMap((item) => [item.earliest_date, item.latest_date].filter((date): date is string => date !== null));
  return {
    version: version.version,
    lastSuccessfulSyncAt: (version.finished_at ?? version.published_at).toISOString(),
    coverage: { from: dates.sort()[0] ?? "1970-01-01", to: dates.sort().at(-1) ?? "1970-01-01" },
    coverageStatus: coverage.map((item) => ({
      provider: item.provider, competition: item.competition, seasonYear: item.season_year,
      earliestDate: item.earliest_date, latestDate: item.latest_date,
      status: item.status as "complete" | "partial" | "missing", detail: item.detail,
    })),
  };
}
