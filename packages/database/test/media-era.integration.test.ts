import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectLeaguepediaMedia } from "../../sync/src/providers/leaguepedia/media.js";
import { createDb, destroyDb } from "../src/db.js";
import { beginSyncRun, publishDataset, createMigrator } from "../src/index.js";
import { migrateToLatest } from "../src/migrator.js";
import { createTestSchemaName } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("historical logo publication", () => {
  const schema = createTestSchemaName();
  const pool = new Pool({ connectionString: databaseUrl });
  const db = createDb({ databaseUrl: databaseUrl!, schema });
  const team = randomUUID(); const oldEra = randomUUID(); const newEra = randomUUID();
  beforeAll(async () => { await pool.query(`create schema ${schema}`); await migrateToLatest(db, { schema }); });
  afterAll(async () => { await destroyDb(db); await pool.query(`drop schema if exists ${schema} cascade`); await pool.end(); });
  it("keeps two era logos current independently through provider-to-database publication", async () => {
    const images = ["Old", "New"].map(name => ({ sourceKey: `${name}.png`, entityKey: name, sourceUrl: `https://example.test/${name}.png`, contentType: "image/png", license: "CC BY", attribution: "Fixture owner" }));
    const media = inspectLeaguepediaMedia(images, new Map([["Old", team], ["New", team]]), new Map([["Old", oldEra], ["New", newEra]])).media;
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({
      syncRunId: run.id, version: "era-logos", coverage: [],
      dimensions: {
        entities: [{ id: team, provider: "fixture", sourceKeys: ["Era Team"], kind: "team", canonicalName: "Era Team", aliases: [] }], regions: [], tournaments: [],
        teamEras: [
          { id: oldEra, provider: "fixture", sourceKey: "Old", teamEntityId: team, displayName: "Old", regionId: null, validFrom: "2010-01-01", validTo: "2019-12-31" },
          { id: newEra, provider: "fixture", sourceKey: "New", teamEntityId: team, displayName: "New", regionId: null, validFrom: "2020-01-01", validTo: null },
        ],
      },
      media: media.map((item, index) => ({ ...item, provider: "fixture", objectKey: `media/era-${index}.png`, checksum: `sha256:fixture-${index}`, contentType: "image/png", byteSize: "3" })),
    }, db);
    const owners = await db.selectFrom("media_assets").select(["entity_id", "team_era_id", "is_current"]).orderBy("team_era_id").execute();
    expect(owners).toEqual([oldEra, newEra].sort().map(id => ({ entity_id: null, team_era_id: id, is_current: true })));
  });
  it("retains null-license editorial evidence and blocks changed metadata and lossy downgrade", async () => {
    const rightsBasis = { kind: "editorial-use" as const, policy: "leaguepedia-editorial-v1" as const, sourcePageUrl: "https://lol.fandom.com/wiki/File:Old.png", revisionId: 12, fileChecksum: "a".repeat(64), statement: "Source has no explicit license.", reviewedNote: "Exact old era logo reviewed." };
    const item = { provider: "fixture", teamEraId: oldEra, sourceUrl: "https://static.wikia.nocookie.net/old.png", objectKey: `media/${rightsBasis.fileChecksum}.png`, checksum: rightsBasis.fileChecksum, contentType: "image/png", byteSize: "3", attribution: "Leaguepedia source", license: null, rightsBasis };
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "media" }, db);
    await publishDataset({ syncRunId: run.id, version: "editorial-media", coverage: [], media: [item] }, db);
    expect(await db.selectFrom("media_assets").select(["license", "rights_basis"]).where("object_key", "=", item.objectKey).executeTakeFirstOrThrow()).toEqual({ license: null, rights_basis: rightsBasis });
    const next = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "media" }, db);
    await expect(publishDataset({ syncRunId: next.id, version: "changed-rights", coverage: [], media: [{ ...item, rightsBasis: { ...rightsBasis, revisionId: 13 } }] }, db)).rejects.toThrow(/Immutable media rights/);
    const downgrade = await createMigrator(db, { schema }).migrateTo("010_public_route_ids");
    expect(downgrade.error).toBeDefined();
    expect(await db.selectFrom("media_assets").select("rights_basis").where("object_key", "=", item.objectKey).executeTakeFirstOrThrow()).toEqual({ rights_basis: rightsBasis });
  });
});
