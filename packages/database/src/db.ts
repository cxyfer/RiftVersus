import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { Database } from "./types.js";

export interface CreateDbOptions {
  databaseUrl: string;
  /** An isolated PostgreSQL schema name. It is validated before being passed to pg. */
  schema?: string;
}

const schemaName = /^[a-z_][a-z0-9_]*$/;

export function assertSchemaName(schema: string) {
  if (!schemaName.test(schema)) {
    throw new Error("Database schema must be a lowercase PostgreSQL identifier.");
  }
}

export function createDb({ databaseUrl, schema }: CreateDbOptions): Kysely<Database> {
  if (schema !== undefined) {
    assertSchemaName(schema);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ...(schema === undefined ? {} : { options: `-c search_path=${schema}` }),
  });

  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  return schema === undefined ? db : db.withSchema(schema);
}

export async function destroyDb(db: Kysely<Database>) {
  await db.destroy();
}
