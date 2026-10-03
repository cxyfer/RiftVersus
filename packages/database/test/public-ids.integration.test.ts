import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, destroyDb } from "../src/db.js";
import { createMigrator, migrateToLatest } from "../src/migrator.js";
import { ensurePublicIds } from "../src/repositories/public-ids.js";
import { createTestSchemaName } from "./fixtures/seed.js";

const url = process.env.TEST_DATABASE_URL;
const run = url ? describe : describe.skip;
run("durable public IDs", () => {
  const schema = createTestSchemaName();
  const pool = new Pool({ connectionString: url });
  const db = createDb({ databaseUrl: url!, schema });
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  const late = "33333333-3333-4333-8333-333333333333";
  beforeAll(async () => {
    await pool.query(`create schema ${schema}`);
    const result = await createMigrator(db, { schema }).migrateTo("009_player_public_id");
    if (result.error) throw result.error;
    await db.insertInto("entities").values([
      { id: first, kind: "player", canonical_name: "Benny Hung", player_id: "Benny", slug: "benny-hung" },
      { id: second, kind: "player", canonical_name: "Lien Hsiu-Chi", player_id: "Benny", slug: "lien-hsiu-chi" },
    ]).execute();
    await migrateToLatest(db, { schema });
  });
  afterAll(async () => { await destroyDb(db); await pool.query(`drop schema if exists ${schema} cascade`); await pool.end(); });
  it("backfills collisions and preserves their ownership after later arrivals", async () => {
    const original = await db.selectFrom("entity_public_ids").selectAll().orderBy("entity_id").execute();
    expect(original.map(row => row.public_id)).toEqual(["benny--benny-hung", "benny--lien-hsiu-chi"]);
    await db.insertInto("entities").values({ id: late, kind: "player", canonical_name: "Other Benny", player_id: "Benny", slug: "other-benny" }).execute();
    await ensurePublicIds(db);
    await ensurePublicIds(db);
    expect(await db.selectFrom("entity_public_ids").selectAll().where("entity_id", "!=", late).orderBy("entity_id").execute()).toEqual(original);
    await expect(db.updateTable("entity_public_ids").set({ public_id: "hijacked" }).where("entity_id", "=", first).execute()).rejects.toThrow("immutable");
    await expect(db.deleteFrom("entity_public_ids").where("entity_id", "=", first).execute()).rejects.toThrow("immutable");
    const downgrade = await createMigrator(db, { schema }).migrateTo("009_player_public_id");
    expect(String(downgrade.error)).toContain("Cannot losslessly downgrade");
    expect(await db.selectFrom("entity_public_ids").selectAll().where("entity_id", "=", first).execute()).toEqual([original[0]]);
  });
});
