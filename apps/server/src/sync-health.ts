import { createDb, getSyncStatus, type SyncStatusSnapshot } from "@riftversus/database";
import type { Config } from "./config.js";
import { historyRequests } from "./sync-plan.js";

export function evaluateSyncHealth(config: Config, snapshot: SyncStatusSnapshot, now = Date.now()) {
  const expected = config.leaguepedia.syncCompetitions.flatMap((competition) => config.leaguepedia.syncYears.map((seasonYear) => ({ competition, seasonYear, maxAgeHours: config.syncMaxAgeHours })));
  if (config.syncHistoryCron !== undefined) for (const request of historyRequests(config)) {
    expected.push(...request.years.map((seasonYear) => ({ competition: request.competitions[0]!, seasonYear, maxAgeHours: config.syncHistoryMaxAgeHours })));
  }
  const scopes = expected.map((scope) => {
    const found = snapshot.scopes.find((item) => item.competition === scope.competition && item.seasonYear === scope.seasonYear);
    const ageMs = found?.checkedAt == null ? NaN : now - Date.parse(found.checkedAt);
    const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= scope.maxAgeHours * 3_600_000;
    return { ...scope, coverage: found?.status ?? "missing", checkedAt: found?.checkedAt ?? null, fresh };
  });
  const runs = snapshot.runs.filter((run) => run.mode === "sync" || config.syncHistoryCron !== undefined);
  const healthy = scopes.every((scope) => scope.fresh && scope.coverage === "complete") && runs.every((run) => run.consecutiveFailures < config.syncFailureThreshold);
  return { status: healthy ? "healthy" as const : "unhealthy" as const, failureThreshold: config.syncFailureThreshold, runs, scopes };
}

export async function readSyncHealth(config: Config) {
  const db = createDb({ databaseUrl: config.databaseUrl });
  try { return evaluateSyncHealth(config, await getSyncStatus(db)); }
  finally { await db.destroy(); }
}
