import { sql } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Facts remain canonical current state. A monotonic generation is a durable
 * visibility boundary, not a dataset_version_id: only generations represented
 * by an append-only dataset_versions row are public.
 */
export const publicationGenerationMigration: Migration = {
  async up(db) {
    await sql.raw(`
      alter table dataset_versions add column generation bigint;
      with ordered as (
        select id, row_number() over (order by published_at, id) as generation from dataset_versions
      ) update dataset_versions version_row set generation = ordered.generation from ordered where ordered.id = version_row.id;
      alter table dataset_versions alter column generation set not null;
      alter table dataset_versions add constraint dataset_versions_generation_unique unique (generation);

      alter table series_facts add column publication_generation bigint not null default 9223372036854775807 check (publication_generation >= 0);
      alter table game_facts add column publication_generation bigint not null default 9223372036854775807 check (publication_generation >= 0);
      update series_facts set publication_generation = 0 where publication_generation = 9223372036854775807;
      update game_facts set publication_generation = 0 where publication_generation = 9223372036854775807;
      create index series_facts_publication_generation_lookup on series_facts (publication_generation, played_at, id);
      create index game_facts_publication_generation_lookup on game_facts (publication_generation, series_id, played_at, id);
      comment on column series_facts.publication_generation is
        'Canonical fact visibility generation. It is not a dataset_version_id and is advanced atomically with an append-only publication marker.';
    `).execute(db);
  },
  async down(db) {
    await sql.raw(`
      drop index if exists game_facts_publication_generation_lookup;
      drop index if exists series_facts_publication_generation_lookup;
      alter table game_facts drop column if exists publication_generation;
      alter table series_facts drop column if exists publication_generation;
      alter table dataset_versions drop constraint if exists dataset_versions_generation_unique;
      alter table dataset_versions drop column if exists generation;
    `).execute(db);
  },
};
