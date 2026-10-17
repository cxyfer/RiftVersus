import { sql } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Bound the published entity label at the storage layer. `publishDimensions` already refuses
 * these values, but a player real name became mutable, so the bound belongs where every
 * writer has to honour it rather than only in the repository that happens to write today.
 * Every published name is far below the limit; the longest is 44 characters.
 */
export const entityNameBoundsMigration: Migration = {
  async up(db) {
    await sql`alter table entities add constraint entities_canonical_name_bounded check (char_length(canonical_name) between 1 and 120 and canonical_name !~ '[[:cntrl:]]')`.execute(db);
  },
  async down(db) {
    await sql`alter table entities drop constraint if exists entities_canonical_name_bounded`.execute(db);
  },
};
