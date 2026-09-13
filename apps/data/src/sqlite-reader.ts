import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteManifestSchema } from "@riftversus/contracts";
import type { SqliteExecutor } from "@riftversus/domain";

export async function openPublicSqlite(directory: string) {
  const manifest = SqliteManifestSchema.parse(JSON.parse(await readFile(join(directory, "data/manifest.json"), "utf8")));
  const database = new DatabaseSync(join(directory, "data", manifest.database.file), { readOnly: true });
  const executor: SqliteExecutor = {
    async all<T extends Record<string, unknown>>(sql: string, params: readonly (string | number | null)[]): Promise<T[]> {
      return database.prepare(sql).all(...params) as T[];
    },
  };
  return { manifest, executor, close: () => database.close() };
}
