import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { evaluateSyncHealth } from "../../data/src/sync-health.js";
import { historyRequests } from "../../data/src/sync-plan.js";

const config = loadConfig({
  DATABASE_URL: "postgresql://example.test/db", LEAGUEPEDIA_ENDPOINT: "https://leaguepedia.acme.org/api.php",
  LEAGUEPEDIA_USER_AGENT: "RiftVersus/0.1 ops@acme.org", LEAGUEPEDIA_MEDIA_HOSTS: "static.acme.org",
  LEAGUEPEDIA_SYNC_YEARS: "2026", LEAGUEPEDIA_SYNC_COMPETITIONS: "MSI",
  LEAGUEPEDIA_COMPETITION_MAP: '{"Worlds":{"2025":"Worlds 2025"},"MSI":{"2019":"MSI 2019","2021":"MSI 2021","2026":"MSI 2026","2027":"MSI 2027"}}',
});
const now = Date.parse("2026-09-13T12:00:00Z");
const scope = { competition: "MSI", seasonYear: 2026, status: "complete", checkedAt: "2026-09-13T10:00:00Z" };

describe("sync health and scope planning", () => {
  it("uses only explicitly mapped historical years without inventing missing or future events", () => {
    expect(historyRequests(config)).toEqual([
      { mode: "backfill", competitions: ["Worlds"], years: [2025] },
      { mode: "backfill", competitions: ["MSI"], years: [2019, 2021] },
    ]);
  });
  it("requires fresh complete coverage for every configured active scope", () => {
    expect(evaluateSyncHealth(config, { runs: [], scopes: [scope] }, now).status).toBe("healthy");
    for (const scopes of [[], [{ ...scope, status: "partial" }], [{ ...scope, checkedAt: "2026-09-01T00:00:00Z" }]]) {
      expect(evaluateSyncHealth(config, { runs: [], scopes }, now).status).toBe("unhealthy");
    }
  });
  it("does not let a recent historical run hide stale current coverage", () => {
    const runs = [{ mode: "backfill", lastSuccessfulSyncAt: new Date(now).toISOString(), consecutiveFailures: 0 }];
    expect(evaluateSyncHealth(config, { runs, scopes: [{ ...scope, checkedAt: "2026-07-18T00:00:00Z" }] }, now).status).toBe("unhealthy");
  });
  it("flags consecutive failures even while the retained dataset is fresh", () => {
    const runs = [{ mode: "sync", lastSuccessfulSyncAt: scope.checkedAt, consecutiveFailures: 3 }];
    expect(evaluateSyncHealth(config, { runs, scopes: [scope] }, now).status).toBe("unhealthy");
  });
  it("applies the historical age threshold only when history scheduling is enabled", () => {
    expect(evaluateSyncHealth({ ...config, historyEnabled: true }, { runs: [], scopes: [scope] }, now).status).toBe("unhealthy");
    const history = historyRequests(config).flatMap((request) => request.years.map((seasonYear) => ({ competition: request.competitions[0]!, seasonYear, status: "complete", checkedAt: "2026-09-07T00:00:00Z" })));
    expect(evaluateSyncHealth({ ...config, historyEnabled: true }, { runs: [], scopes: [scope, ...history] }, now).status).toBe("healthy");
  });
});
