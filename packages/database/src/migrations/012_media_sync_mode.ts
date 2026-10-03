import { sql } from "kysely";
import type { Migration } from "kysely/migration";

export const mediaSyncModeMigration: Migration = {
  async up(db) {
    await sql`alter table sync_runs drop constraint sync_runs_mode_check`.execute(db);
    await sql`alter table sync_runs add constraint sync_runs_mode_check check (mode in ('sync', 'backfill', 'media'))`.execute(db);
  },
  async down(db) {
    await sql`do $$ begin
      if exists (select 1 from sync_runs where mode = 'media') then
        raise exception 'Cannot remove recorded media publication runs';
      end if;
    end $$`.execute(db);
    await sql`alter table sync_runs drop constraint sync_runs_mode_check`.execute(db);
    await sql`alter table sync_runs add constraint sync_runs_mode_check check (mode in ('sync', 'backfill'))`.execute(db);
  },
};
