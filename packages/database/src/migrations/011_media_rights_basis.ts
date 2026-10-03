import { sql } from "kysely";
import type { Migration } from "kysely/migration";

export const mediaRightsBasisMigration: Migration = {
  async up(db) {
    await sql`alter table media_assets add column rights_basis jsonb`.execute(db);
  },
  async down(db) {
    await sql`do $$ begin
      if exists (select 1 from media_assets where rights_basis is not null) then
        raise exception 'Cannot remove recorded editorial media rights evidence';
      end if;
    end $$`.execute(db);
    await sql`alter table media_assets drop column rights_basis`.execute(db);
  },
};
