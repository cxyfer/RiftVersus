import { createDb, destroyDb, migrateToLatest } from "@riftversus/database";

import { loadConfig } from "./config.js";

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
};

function printUsage() {
  console.log("Usage: riftversus migrate");
}

async function main() {
  const [command] = process.argv.slice(2);

  if (command === "--help" || command === "-h" || command === undefined) {
    printUsage();
    process.exitCode = command === undefined ? 1 : 0;
    return;
  }

  if (command !== "migrate" || process.argv.length !== 3) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  const config = loadConfig(process.env);
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
