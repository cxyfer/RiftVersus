import { sql } from "kysely";
import type { Migration } from "kysely/migration";

export const playerPublicIdMigration: Migration = {
  async up(db) {
    await sql.raw(`
      alter table entities add column player_id text;
      alter table entities add constraint entities_player_id_owner
        check (player_id is null or (kind = 'player' and btrim(player_id) = player_id and player_id <> ''));
      create index entities_player_id_trgm on entities
        using gin (player_id public.gin_trgm_ops)
        where kind = 'player' and player_id is not null;
    `).execute(db);
  },
  async down(db) {
    await sql.raw(`
      lock table entities in access exclusive mode;
      do $$ begin
        if exists (select 1 from entities where player_id is not null) then
          raise exception 'Cannot losslessly downgrade player public ID: at least one entity has a player ID.';
        end if;
      end $$;
      drop index if exists entities_player_id_trgm;
      alter table entities drop constraint if exists entities_player_id_owner;
      alter table entities drop column if exists player_id;
    `).execute(db);
  },
};
