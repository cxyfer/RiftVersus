import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beginSyncRun, completeUnchangedSyncRun, createDb, failSyncRun, getDatasetStatus, getSyncStatus, migrateToLatest, publishDataset } from "../src/index.js";
import { createTestSchemaName } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("sync freshness repository", () => {
  const schema = createTestSchemaName();
  const admin = new Pool({ connectionString: databaseUrl });
  const db = createDb({ databaseUrl: databaseUrl!, schema });
  beforeAll(async () => { await admin.query(`create schema ${schema}`); await migrateToLatest(db, { schema }); });
  afterAll(async () => { await db.destroy(); await admin.query(`drop schema if exists ${schema} cascade`); await admin.end(); });

  it("retains historical coverage and counts unchanged checks without treating history as current", async () => {
    const publish = async (mode: "sync" | "backfill", competition: string, year: number, version: string) => {
      const run = await beginSyncRun({ provider: "leaguepedia", mode, parserVersion: "test" }, db);
      await publishDataset({ syncRunId: run.id, version, coverage: [{ provider: "leaguepedia", competition, seasonYear: year, earliestDate: `${year}-01-01`, latestDate: `${year}-12-31`, status: "complete" }] }, db);
      await db.updateTable("sync_runs").set({ finished_at: new Date("2026-07-18T00:00:00Z") }).where("id", "=", run.id).execute();
    };
    await publish("sync", "MSI", 2026, "current");
    await publish("backfill", "Worlds", 2025, "history");
    expect((await getDatasetStatus(db))?.coverage).toEqual({ from: "2025-01-01", to: "2026-12-31" });
    const history = await beginSyncRun({ provider: "leaguepedia", mode: "backfill", parserVersion: "test" }, db);
    await completeUnchangedSyncRun({ syncRunId: history.id, version: "history" }, db);
    let status = await getSyncStatus(db);
    expect(status.scopes.find((scope) => scope.competition === "MSI")?.checkedAt).toBe("2026-07-18T00:00:00.000Z");
    expect(Date.parse(status.scopes.find((scope) => scope.competition === "Worlds")!.checkedAt!)).toBeGreaterThan(Date.parse("2026-07-18T00:00:00Z"));
    const failed = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await failSyncRun({ syncRunId: failed.id, error: "test failure" }, db);
    expect((await getSyncStatus(db)).runs.find((run) => run.mode === "sync")?.consecutiveFailures).toBe(1);
    const unchanged = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await completeUnchangedSyncRun({ syncRunId: unchanged.id, version: "current" }, db);
    status = await getSyncStatus(db);
    expect(status.runs.find((run) => run.mode === "sync")?.consecutiveFailures).toBe(0);
    expect(Date.parse(status.scopes.find((scope) => scope.competition === "MSI")!.checkedAt!)).toBeGreaterThan(Date.parse("2026-07-18T00:00:00Z"));
    const partial = await beginSyncRun({ provider: "leaguepedia", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: partial.id, version: "partial-current", coverage: [{ provider: "leaguepedia", competition: "MSI", seasonYear: 2026, status: "partial" }] }, db);
    expect((await getSyncStatus(db)).scopes.find((item) => item.competition === "MSI")?.status).toBe("partial");
    expect((await getDatasetStatus(db))?.coverageStatus.find((item) => item.competition === "MSI")?.status).toBe("partial");
    expect((await getDatasetStatus(db))?.coverageStatus.find((item) => item.competition === "Worlds")?.status).toBe("complete");
  });
});
