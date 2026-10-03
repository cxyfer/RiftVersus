import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import { ensurePublicIds } from "../repositories/public-ids.js";
import type { Database } from "../types.js";

export const publicRouteIdsMigration: Migration = {
  async up(db) {
    await sql.raw(`
      create table entity_public_ids (
        entity_id uuid not null unique references entities(id),
        kind text not null check (kind in ('player', 'team', 'region')),
        public_id text not null check (public_id <> ''),
        primary key (kind, public_id)
      );
      create table team_era_public_ids (
        team_era_id uuid not null unique references team_eras(id),
        entity_id uuid not null references entities(id),
        public_id text not null check (public_id <> ''),
        primary key (entity_id, public_id)
      );
      create function protect_public_id_owner() returns trigger language plpgsql as $$
      begin
        raise exception 'Published public ID ownership is immutable';
      end $$;
      create trigger entity_public_ids_immutable before update or delete on entity_public_ids
        for each row execute function protect_public_id_owner();
      create trigger team_era_public_ids_immutable before update or delete on team_era_public_ids
        for each row execute function protect_public_id_owner();
    `).execute(db);
    await ensurePublicIds(db as Kysely<Database>);
  },
  async down(db) {
    await sql.raw(`
      do $$ begin
        if exists (select 1 from entity_public_ids) or exists (select 1 from team_era_public_ids) then
          raise exception 'Cannot losslessly downgrade assigned public IDs';
        end if;
      end $$;
      drop table team_era_public_ids;
      drop table entity_public_ids;
      drop function protect_public_id_owner();
    `).execute(db);
  },
};
