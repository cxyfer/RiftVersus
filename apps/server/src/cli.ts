import { compareHeadToHead, createDb, destroyDb, getDatasetStatus, getMediaByKey, listAvailableFilters, migrateToLatest, searchEntities } from "@riftversus/database";
import { resolve } from "node:path";

import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { startListeningServer } from "./server.js";

declare const process: {
  argv: string[];
  cwd(): string;
  env: Record<string, string | undefined>;
  exitCode?: number;
};

function printUsage() {
  console.log("Usage: riftversus <serve|migrate>");
}

export async function startServer(config: Config) {
  return startListeningServer(config, {
    createDb: () => createDb({ databaseUrl: config.databaseUrl }),
    buildApp: (db) => buildApp({
      searchEntities: (query) => searchEntities(query, db),
      listFilters: () => listAvailableFilters(db),
      compare: (query) => compareHeadToHead(query, db),
      getDataset: async () => {
        const status = await getDatasetStatus(db);
        return status === null ? null : { version: status.version, lastSuccessfulSyncAt: status.lastSuccessfulSyncAt, coverage: status.coverage };
      },
      getMedia: (key) => getMediaByKey(key, db),
      staticDir: resolve(process.cwd(), "apps/web/dist"),
    }),
    destroyDb,
  });
}

async function main() {
  const [command] = process.argv.slice(2);

  if (command === "--help" || command === "-h" || command === undefined) {
    printUsage();
    process.exitCode = command === undefined ? 1 : 0;
    return;
  }

  if ((command !== "migrate" && command !== "serve") || process.argv.length !== 3) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  const config = loadConfig(process.env);
  if (command === "serve") {
    await startServer(config);
    return;
  }
  const db = createDb({ databaseUrl: config.databaseUrl });

  try {
    const result = await migrateToLatest(db);
    for (const migration of result.results ?? []) {
      console.log(`${migration.migrationName}: ${migration.status}`);
    }
  } finally {
    await destroyDb(db);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
