import { sql } from "kysely";
import type { Migration } from "kysely/migration";

export const entitySearchIndexesMigration: Migration = {
  async up(db) {
    await sql.raw(`
      select pg_advisory_xact_lock(hashtext('riftversus:pg_trgm_extension'));
      create extension if not exists pg_trgm with schema public;
      create index entities_canonical_name_trgm on entities using gin (canonical_name public.gin_trgm_ops);
      create index entities_slug_trgm on entities using gin (slug public.gin_trgm_ops);
      create index entity_aliases_display_name_trgm on entity_aliases using gin (display_name public.gin_trgm_ops) where searchable;
    `).execute(db);
  },
  async down(db) {
    await sql.raw(`
      drop index if exists entity_aliases_display_name_trgm;
      drop index if exists entities_slug_trgm;
      drop index if exists entities_canonical_name_trgm;
    `).execute(db);
  },
};
