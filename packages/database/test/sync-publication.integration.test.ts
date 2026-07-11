import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { beginSyncRun, failSyncRun, publishDataset, recordSourceObject, withSyncAdvisoryLock } from "../src/index.js";
import { createDb, destroyDb } from "../src/db.js";
import { migrateToLatest } from "../src/migrator.js";
import { createTestSchemaName } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("sync publication repository", () => {
  const schema = createTestSchemaName();
  const adminPool = new Pool({ connectionString: databaseUrl });
  const db = createDb({ databaseUrl: databaseUrl!, schema });
  beforeAll(async () => { await adminPool.query(`create schema ${schema}`); await migrateToLatest(db, { schema }); });
  afterAll(async () => { await destroyDb(db); await adminPool.query(`drop schema if exists ${schema} cascade`); await adminPool.end(); });

  it("is idempotent for source objects and publishes append-only dataset versions", async () => {
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const source = { provider: "fixture", sourceKey: "source-1", sourceUrl: "https://example.test/a", objectKey: "sources/a", checksum: "a", parserVersion: "test" };
    expect(await recordSourceObject(source, db)).toBe("inserted");
    expect(await recordSourceObject(source, db)).toBe("existing");
    const first = await publishDataset({ syncRunId: run.id, version: "v1", coverage: [{ provider: "fixture", competition: "all", seasonYear: 2024, earliestDate: "2024-01-01", latestDate: "2024-12-31", status: "complete" }] }, db);
    const secondRun = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    const second = await publishDataset({ syncRunId: secondRun.id, version: "v2", coverage: [] }, db);
    expect(second.id).not.toBe(first.id);
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
});
