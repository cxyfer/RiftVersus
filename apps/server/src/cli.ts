import { createDb, destroyDb, migrateToLatest } from "@riftversus/database";

import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
};

function printUsage() {
  console.log("Usage: riftversus <serve|migrate>");
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
