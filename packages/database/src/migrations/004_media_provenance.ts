import { sql } from "kysely";
import type { Migration } from "kysely/migration";

/** Retained media keeps provider and size provenance without rewriting legacy rows. */
export const mediaProvenanceMigration: Migration = {
  async up(db) {
    await sql.raw(`
      alter table media_assets add column provider text;
      alter table media_assets add column byte_size bigint check (byte_size is null or byte_size >= 0);
    `).execute(db);
  },
  async down(db) {
    await sql.raw(`
      alter table media_assets drop column if exists byte_size;
      alter table media_assets drop column if exists provider;
    `).execute(db);
  },
};
