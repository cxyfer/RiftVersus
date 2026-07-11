import type { Kysely } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";

import { initialMigration } from "./migrations/001_initial.js";
import type { Database } from "./types.js";

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return { "001_initial": initialMigration };
  }
}

export function createMigrator(db: Kysely<Database>) {
  return new Migrator({ db, provider: new StaticMigrationProvider() });
}

export async function migrateToLatest(db: Kysely<Database>) {
  const result = await createMigrator(db).migrateToLatest();

  if (result.error !== undefined) {
    throw result.error;
  }

  return result;
}
