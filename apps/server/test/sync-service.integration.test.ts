import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, destroyDb, migrateToLatest, type Database } from "@riftversus/database";
import type { Kysely } from "kysely";
import type { ObjectStore, StoredObjectMetadata } from "@riftversus/sync";
import { loadConfig } from "../src/config.js";
import { createDatabaseSyncRepository, executeLeaguepediaSync } from "../src/sync-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const rootDir = fileURLToPath(new URL("../../..", import.meta.url));

describeWithDatabase("Leaguepedia PostgreSQL fixture composition", () => {
  const schema = `rv_sync_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  let db: Kysely<Database>;
  beforeAll(async () => { await admin.query(`create schema ${schema}`); db = createDb({ databaseUrl: databaseUrl!, schema }); await migrateToLatest(db, { schema }); });
  afterAll(async () => { await destroyDb(db); await admin.query(`drop schema if exists ${schema} cascade`); await admin.end(); });

  it("publishes the deployable fixture once and records the unchanged replay", async () => {
    const objects = new Map<string, StoredObjectMetadata>();
    const objectStore: ObjectStore = {
      get: async () => Readable.from([]), signedGetUrl: async () => "https://fixture.invalid/object", head: async (key) => objects.get(key) ?? null,
      putImmutable: async (object) => { const existing = objects.get(object.key); if (existing) return "existing"; objects.set(object.key, { checksum: object.checksum, contentType: object.contentType, byteSize: object.bytes.byteLength }); return "inserted"; },
    };
    const config = loadConfig({ DATABASE_URL: databaseUrl! });
    const input = { config, objectStore, request: { mode: "sync-once" as const }, fixture: "leaguepedia-small" as const };
    const dependencies = { rootDir, openRepository: async () => ({ repository: createDatabaseSyncRepository(db), close: async () => undefined }) };
    const first = await executeLeaguepediaSync(input, dependencies); const second = await executeLeaguepediaSync(input, dependencies);
    expect(first.status).toBe("published"); expect(second).toEqual({ status: "unchanged", version: first.version });
    const count = async (table: keyof Database) => db.selectFrom(table).select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    expect(await count("entities")).toMatchObject({ count: "14" });
    expect(await count("series_facts")).toMatchObject({ count: "1" }); expect(await count("game_facts")).toMatchObject({ count: "3" }); expect(await count("game_players")).toMatchObject({ count: "30" });
    expect(await count("source_objects")).toMatchObject({ count: "1" }); expect(await count("media_objects")).toMatchObject({ count: "1" }); expect(await count("media_assets")).toMatchObject({ count: "1" });
    expect(await count("coverage_status")).toMatchObject({ count: "1" }); expect(await count("dataset_versions")).toMatchObject({ count: "1" }); expect(await count("override_application_runs")).toMatchObject({ count: "2" });
    const runs = await db.selectFrom("sync_runs").select(["status", "reused_dataset_version_id"]).orderBy("started_at").execute();
    expect(runs).toEqual([{ status: "succeeded", reused_dataset_version_id: null }, { status: "succeeded", reused_dataset_version_id: expect.any(String) }]);
  });
});
