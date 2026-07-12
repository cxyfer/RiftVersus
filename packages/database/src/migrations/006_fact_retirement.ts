import { sql } from "kysely";
import type { Migration } from "kysely/migration";

export const factRetirementMigration: Migration = {
  async up(db) {
    await sql.raw(`
      alter table series_facts add column retired_generation bigint check (retired_generation is null or retired_generation >= 0);
      alter table game_facts add column retired_generation bigint check (retired_generation is null or retired_generation >= 0);
      create index series_facts_retirement_visibility on series_facts (publication_generation, retired_generation, played_at);
      create index game_facts_retirement_visibility on game_facts (publication_generation, retired_generation, played_at);
    `).execute(db);
  },
  async down(db) {
    await sql.raw(`
      drop index if exists game_facts_retirement_visibility;
      drop index if exists series_facts_retirement_visibility;
      alter table game_facts drop column if exists retired_generation;
      alter table series_facts drop column if exists retired_generation;
    `).execute(db);
  },
};
