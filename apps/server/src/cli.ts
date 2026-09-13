import { compareHeadToHead, createDb, destroyDb, getAvatarIdentity, getDatasetStatus, getSyncStatus, getMediaByKey, listAvailableFilters, migrateToLatest, searchEntities } from "@riftversus/database";
import { bootstrapS3Bucket, scheduleSync } from "@riftversus/sync";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildApp } from "./app.js";
import { cliUsage, parseCliCommand, type CliCommand } from "./commands.js";
import { loadConfig, type Config } from "./config.js";
import { startListeningServer } from "./server.js";
import { createConfiguredObjectStore } from "./storage.js";
import { executeLeaguepediaSync } from "./sync-service.js";
import { evaluateSyncHealth, readSyncHealth } from "./sync-health.js";
import { runHistory, runSchedules } from "./sync-schedules.js";
import { checkLeaguepediaMappings } from "./mapping-check.js";

declare const process: {
  argv: string[]; cwd(): string; env: Record<string, string | undefined>; exitCode?: number;
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
};

export async function startServer(config: Config) {
  const objectStore = createConfiguredObjectStore(config);
  return startListeningServer(config, {
    createDb: () => createDb({ databaseUrl: config.databaseUrl }),
    buildApp: (db) => buildApp({
      searchEntities: (query) => searchEntities(query, db), listFilters: () => listAvailableFilters(db), compare: (query) => compareHeadToHead(query, db),
      getDataset: async () => { const status = await getDatasetStatus(db); return status === null ? null : { version: status.version, lastSuccessfulSyncAt: status.lastSuccessfulSyncAt, coverage: status.coverage }; },
      getSyncHealth: async () => evaluateSyncHealth(config, await getSyncStatus(db)),
      getMedia: (key) => getMediaByKey(key, db), ...(objectStore === undefined ? {} : { objectStore }), mediaDelivery: config.mediaDelivery, staticDir: resolve(process.cwd(), "apps/web/dist"),
      getAvatarIdentity: (kind, id) => getAvatarIdentity(kind, id, db),
    }),
    destroyDb,
  });
}

async function migrate(config: Config) {
  const db = createDb({ databaseUrl: config.databaseUrl });
  try { const result = await migrateToLatest(db); for (const migration of result.results ?? []) console.log(`${migration.migrationName}: ${migration.status}`); }
  finally { await destroyDb(db); }
}

async function requiredObjectStore(config: Config) {
  const store = createConfiguredObjectStore(config);
  if (store === undefined) throw new Error("sync and backfill require complete S3 configuration.");
  await bootstrapS3Bucket(config.s3!, config.s3AutoCreateBucket);
  return store;
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolveShutdown) => {
    const finish = () => { process.off("SIGINT", finish); process.off("SIGTERM", finish); resolveShutdown(); };
    process.once("SIGINT", finish); process.once("SIGTERM", finish);
  });
}

export async function runCli(argv: readonly string[], environment: Record<string, string | undefined>): Promise<void> {
  const command = parseCliCommand(argv);
  const config = loadConfig(environment);
  await executeCommand(command, config);
}

export interface CommandDependencies {
  startServer(config: Config): Promise<{ close(): Promise<unknown> }>;
  migrate(config: Config): Promise<void>;
  objectStore(config: Config): ReturnType<typeof requiredObjectStore>;
  execute(input: Parameters<typeof executeLeaguepediaSync>[0]): ReturnType<typeof executeLeaguepediaSync>;
  schedule: typeof scheduleSync;
  waitForShutdown(): Promise<void>;
  log(value: string): void;
  error(value: unknown): void;
  syncHealth: typeof readSyncHealth;
}

const defaultCommandDependencies: CommandDependencies = {
  startServer, migrate, objectStore: requiredObjectStore, execute: executeLeaguepediaSync,
  schedule: scheduleSync, waitForShutdown, log: (value) => console.log(value), error: (value) => console.error(value), syncHealth: readSyncHealth,
};

export async function executeCommand(command: CliCommand, config: Config, dependencies: CommandDependencies = defaultCommandDependencies): Promise<void> {
  if (command.kind === "serve") {
    const server = await dependencies.startServer(config);
    try { await dependencies.waitForShutdown(); }
    finally { await server.close(); }
    return;
  }
  if (command.kind === "migrate") { await dependencies.migrate(config); return; }
  if (command.kind === "sync-health") {
    const health = await dependencies.syncHealth(config);
    dependencies.log(JSON.stringify(health));
    if (health.status !== "healthy") throw new Error("Sync health check failed.");
    return;
  }
  if (command.kind === "sync-map-check") {
    const check = checkLeaguepediaMappings(config);
    dependencies.log(JSON.stringify({ event: "sync_mapping_check", ...check, status: check.missing.length === 0 ? "complete" : "incomplete" }));
    if (check.missing.length > 0) throw new Error(`${check.missing.length} required Leaguepedia mapping(s) are missing.`);
    return;
  }
  const objectStore = await dependencies.objectStore(config);
  if (command.kind === "sync-history-once") { await runHistory(config, objectStore, dependencies); return; }
  if (command.kind === "sync-once") {
    dependencies.log(JSON.stringify(await dependencies.execute({ config, objectStore, request: { mode: "sync-once" }, fixture: command.fixture })));
    return;
  }
  if (command.kind === "backfill") {
    dependencies.log(JSON.stringify(await dependencies.execute({ config, objectStore, request: { mode: "backfill", years: command.years, competitions: command.competitions }, fixture: command.fixture })));
    return;
  }
  await runSchedules(config, objectStore, dependencies);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--help" || argv[0] === "-h") { console.log(cliUsage); return; }
  if (argv.length === 0) { console.error(cliUsage); process.exitCode = 1; return; }
  await runCli(argv, process.env);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
