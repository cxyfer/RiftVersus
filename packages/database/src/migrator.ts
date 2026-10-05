import type { Kysely } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";

import { assertSchemaName } from "./db.js";
import { initialMigration } from "./migrations/001_initial.js";
import { publicationGenerationMigration } from "./migrations/002_publication_generation.js";
import { datasetVersionsAppendOnlyMigration } from "./migrations/003_dataset_versions_append_only.js";
import { mediaProvenanceMigration } from "./migrations/004_media_provenance.js";
import { overrideRunProvenanceMigration } from "./migrations/005_override_run_provenance.js";
import { factRetirementMigration } from "./migrations/006_fact_retirement.js";
import { sharedMediaObjectsMigration } from "./migrations/007_shared_media_objects.js";
import { entitySearchIndexesMigration } from "./migrations/008_entity_search_indexes.js";
import { playerPublicIdMigration } from "./migrations/009_player_public_id.js";
import { publicRouteIdsMigration } from "./migrations/010_public_route_ids.js";
import { mediaRightsBasisMigration } from "./migrations/011_media_rights_basis.js";
import { mediaSyncModeMigration } from "./migrations/012_media_sync_mode.js";
import { historicalSeriesFormatsMigration } from "./migrations/013_historical_series_formats.js";
import type { Database } from "./types.js";

export interface MigrationOptions {
  /** Schema that owns both canonical objects and Kysely migration metadata. */
  schema?: string;
}

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return { "001_initial": initialMigration, "002_publication_generation": publicationGenerationMigration, "003_dataset_versions_append_only": datasetVersionsAppendOnlyMigration, "004_media_provenance": mediaProvenanceMigration, "005_override_run_provenance": overrideRunProvenanceMigration, "006_fact_retirement": factRetirementMigration, "007_shared_media_objects": sharedMediaObjectsMigration, "008_entity_search_indexes": entitySearchIndexesMigration, "009_player_public_id": playerPublicIdMigration, "010_public_route_ids": publicRouteIdsMigration, "011_media_rights_basis": mediaRightsBasisMigration, "012_media_sync_mode": mediaSyncModeMigration, "013_historical_series_formats": historicalSeriesFormatsMigration };
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
