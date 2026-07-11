import type { Kysely } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";

import { assertSchemaName } from "./db.js";
import { initialMigration } from "./migrations/001_initial.js";
import { publicationGenerationMigration } from "./migrations/002_publication_generation.js";
import type { Database } from "./types.js";

export interface MigrationOptions {
  /** Schema that owns both canonical objects and Kysely migration metadata. */
  schema?: string;
}

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return { "001_initial": initialMigration, "002_publication_generation": publicationGenerationMigration };
  }
}

export function createMigrator(db: Kysely<Database>, { schema }: MigrationOptions = {}) {
  if (schema !== undefined) {
    assertSchemaName(schema);
  }

  return new Migrator({
    db,
    provider: new StaticMigrationProvider(),
    ...(schema === undefined ? {} : { migrationTableSchema: schema }),
  });
}

export async function migrateToLatest(db: Kysely<Database>, options?: MigrationOptions) {
  const result = await createMigrator(db, options).migrateToLatest();

  if (result.error !== undefined) {
    throw result.error;
  }

  return result;
}
