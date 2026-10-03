import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectLeaguepediaMedia } from "../../sync/src/providers/leaguepedia/media.js";
import { createDb, destroyDb } from "../src/db.js";
import { beginSyncRun, publishDataset } from "../src/index.js";
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
});
