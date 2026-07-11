export const packageName = "@riftversus/database";
export { createDb, destroyDb } from "./db.js";
export { createMigrator, migrateToLatest } from "./migrator.js";
export type { CreateDbOptions } from "./db.js";
export type {
  CompetitiveSide,
  Database,
  EntityKind,
  TournamentCategory,
} from "./types.js";
