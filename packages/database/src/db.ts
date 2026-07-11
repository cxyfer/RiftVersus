import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { Database } from "./types.js";

export interface CreateDbOptions {
  databaseUrl: string;
  /** An isolated PostgreSQL schema name. It is validated before being passed to pg. */
  schema?: string;
}

const schemaName = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function createDb({ databaseUrl, schema }: CreateDbOptions): Kysely<Database> {
  if (schema !== undefined && !schemaName.test(schema)) {
    throw new Error("Database schema must be a simple PostgreSQL identifier.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ...(schema === undefined ? {} : { options: `-c search_path=${schema},public` }),
  });

  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export async function destroyDb(db: Kysely<Database>) {
  await db.destroy();
}
