import { sql } from "kysely";
import type { Migration } from "kysely/migration";

export const datasetVersionsAppendOnlyMigration: Migration = {
  async up(db) { await sql.raw(`create trigger dataset_versions_append_only_before_mutation before update or delete on dataset_versions for each row execute function riftversus_reject_append_only_mutation();`).execute(db); },
  async down(db) { await sql.raw(`drop trigger if exists dataset_versions_append_only_before_mutation on dataset_versions;`).execute(db); },
};
