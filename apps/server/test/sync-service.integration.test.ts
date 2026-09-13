import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, destroyDb, migrateToLatest, type Database } from "@riftversus/database";
import type { Kysely } from "kysely";
import type { ObjectStore, StagedSyncBatch, StoredObjectMetadata } from "@riftversus/sync";
import { loadConfig } from "../src/config.js";
import { createDatabaseSyncRepository, executeLeaguepediaSync } from "../../data/src/sync-service.js";

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
    const retainedBytes = new Map<string, Uint8Array>();
    const objectStore: ObjectStore = {
      get: async () => Readable.from([]), signedGetUrl: async () => "https://fixture.invalid/object", head: async (key) => objects.get(key) ?? null,
      putImmutable: async (object) => { const existing = objects.get(object.key); if (existing) return "existing"; objects.set(object.key, { checksum: object.checksum, contentType: object.contentType, byteSize: object.bytes.byteLength }); retainedBytes.set(object.key, object.bytes); return "inserted"; },
    };
    const config = loadConfig({
      DATABASE_URL: databaseUrl!,
      LEAGUEPEDIA_ENDPOINT: "https://leaguepedia.acme.org/api.php",
      LEAGUEPEDIA_USER_AGENT: "RiftVersus/0.1 (+https://riftversus.acme.org; ops@acme.org)",
      LEAGUEPEDIA_MEDIA_HOSTS: "static.acme.org",
    });
    const input = { config, objectStore, request: { mode: "sync-once" as const }, fixture: "leaguepedia-small" as const };
    const batches: StagedSyncBatch[] = [];
    const dependencies = { rootDir, openRepository: async () => ({ repository: createDatabaseSyncRepository(db), close: async () => undefined }), observeBatch: (batch: StagedSyncBatch) => batches.push(batch) };
    const first = await executeLeaguepediaSync(input, dependencies); const second = await executeLeaguepediaSync(input, dependencies);
    expect(first.status).toBe("published"); expect(second).toEqual({ status: "unchanged", version: first.version });
    const count = async (table: keyof Database) => db.selectFrom(table).select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    expect(await count("entities")).toMatchObject({ count: "14" });
    expect(await count("series_facts")).toMatchObject({ count: "1" }); expect(await count("game_facts")).toMatchObject({ count: "5" }); expect(await count("game_players")).toMatchObject({ count: "50" });
    expect(await count("source_objects")).toMatchObject({ count: "1" }); expect(await count("media_objects")).toMatchObject({ count: "1" }); expect(await count("media_assets")).toMatchObject({ count: "1" });
    expect(await count("coverage_status")).toMatchObject({ count: "1" }); expect(await count("dataset_versions")).toMatchObject({ count: "1" });
    const publishingRun = await db.selectFrom("sync_runs").select("id").where("reused_dataset_version_id", "is", null).executeTakeFirstOrThrow();
    const overrideFiles = ["data/overrides/identities.yaml", "data/overrides/regions.yaml", "data/overrides/tournaments.yaml"];
    const expectedOverrides = await Promise.all(overrideFiles.map(async (overrideFile) => ({
      override_file: overrideFile,
      checksum: `sha256:${createHash("sha256").update(await readFile(`${rootDir}/${overrideFile}`)).digest("hex")}`,
      sync_run_id: publishingRun.id,
    })));
    const recordedOverrides = await db.selectFrom("override_application_runs as link")
      .innerJoin("override_applications as application", "application.id", "link.override_application_id")
      .select(["application.override_file", "application.checksum", "link.sync_run_id"])
      .orderBy("application.override_file")
      .execute();
    expect(recordedOverrides).toEqual(expectedOverrides);
    expect(await db.selectFrom("coverage_status").select(["status", "detail"]).executeTakeFirstOrThrow()).toMatchObject({ status: "partial", detail: expect.stringContaining("synthetic fixture is not source coverage") });
    const retained = await db.selectFrom("source_objects").select(["source_url", "object_key"]).executeTakeFirstOrThrow();
    expect(retained.source_url).toBe("https://fixture.riftversus.invalid/dataset/leaguepedia-small");
    expect(JSON.parse(new TextDecoder().decode(retainedBytes.get(retained.object_key)!))).toHaveProperty("input.provenance", { kind: "synthetic-fixture", name: "leaguepedia-small" });
    expect(batches).toHaveLength(2); expect(batches.every((batch) => batch.publicationScopes.every((scope) => scope.status !== "complete"))).toBe(true);
    const runs = await db.selectFrom("sync_runs").select(["status", "reused_dataset_version_id"]).orderBy("started_at").execute();
    expect(runs).toEqual([{ status: "succeeded", reused_dataset_version_id: null }, { status: "succeeded", reused_dataset_version_id: expect.any(String) }]);
  });
});
