import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createDb, migrateToLatest } from "@riftversus/database";
import { createFilesystemObjectStore, loadSyncConfig, validateSyncRequest, type SyncRequest } from "@riftversus/sync";
import { executeLeaguepediaSync } from "./sync-service.js";
import { checkLeaguepediaMappings } from "./mapping-check.js";
import { historyRequests } from "./sync-plan.js";
import { readSyncHealth } from "./sync-health.js";
import { runCheckpointCommand } from "./checkpoint-commands.js";
import { runArchiveCommand } from "./archive-commands.js";
import { runSnapshotCommand } from "./snapshot-commands.js";
import { verifyCurrentSnapshot } from "./current-snapshot-acceptance.js";
import { runSiteCommand } from "./site-commands.js";
import { runPublication, recordDeploymentFailure } from "./publish-run.js";
import { guardPublication, readDeployedSite } from "./publish-github.js";
import { requiredPublishValue } from "./publish-plan.js";
import { runAttemptCommand } from "./attempt-commands.js";

export type DataCommand =
  | { kind: "publish"; mode: "prepare" | "guard" | "verify-deployed" | "record-deploy-failure" }
  | { kind: "attempt"; directory: string }
  | { kind: "site"; mode: "publish" | "download"; directory: string }
  | { kind: "snapshot"; mode: "export" | "verify"; directory: string }
  | { kind: "archive"; mode: "resolve" | "publish"; directory: string }
  | { kind: "checkpoint"; mode: "pack" | "verify" | "restore"; directory: string }
  | { kind: "migrate" | "sync-map-check" | "freshness" | "history" | "acceptance" }
  | { kind: "sync"; request: SyncRequest; fixture: "leaguepedia-small" | null };

export const dataUsage = `Usage:
  riftversus-data migrate
  riftversus-data sync --once [--fixture leaguepedia-small]
  riftversus-data sync --history-once
  riftversus-data backfill --year YYYY --competition NAME [--fixture leaguepedia-small]
  riftversus-data sync-map-check
  riftversus-data freshness
  riftversus-data checkpoint pack|verify|restore DIRECTORY
  riftversus-data archive resolve|publish DIRECTORY
  riftversus-data snapshot export|verify DIRECTORY
  riftversus-data site publish|download DIRECTORY
  riftversus-data attempt publish DIRECTORY
  riftversus-data publish prepare|guard|verify-deployed|record-deploy-failure
  riftversus-data acceptance

Data writes require OBJECT_STORE_DIR. No server or scheduler is started.`;

export function parseDataCommand(argv: readonly string[]): DataCommand {
  const [command, ...args] = argv;
  if (command === "publish") {
    const [mode] = args;
    if (args.length !== 1 || (mode !== "prepare" && mode !== "guard" && mode !== "verify-deployed" && mode !== "record-deploy-failure")) throw new Error("publish requires prepare|guard|verify-deployed|record-deploy-failure.");
    return { kind: "publish", mode };
  }
  if (command === "attempt") {
    const [mode, directory] = args;
    if (args.length !== 2 || mode !== "publish" || !directory?.trim()) throw new Error("attempt requires publish and a directory.");
    return { kind: "attempt", directory };
  }
  if (command === "site") {
    const [mode, directory] = args;
    if (args.length !== 2 || !directory?.trim() || (mode !== "publish" && mode !== "download")) throw new Error("site requires publish|download and a directory.");
    return { kind: "site", mode, directory };
  }
  if (command === "snapshot") {
    const [mode, directory] = args;
    if (args.length !== 2 || !directory?.trim() || (mode !== "export" && mode !== "verify")) throw new Error("snapshot requires export|verify and a directory.");
    return { kind: "snapshot", mode, directory };
  }
  if (command === "archive") {
    const [mode, directory] = args;
    if (args.length !== 2 || !directory?.trim() || (mode !== "resolve" && mode !== "publish")) throw new Error("archive requires resolve|publish and a directory.");
    return { kind: "archive", mode, directory };
  }
  if (command === "checkpoint") {
    const [mode, directory] = args;
    if (args.length !== 2 || !directory?.trim() || (mode !== "pack" && mode !== "verify" && mode !== "restore")) throw new Error("checkpoint requires pack|verify|restore and a directory.");
    return { kind: "checkpoint", mode, directory };
  }
  if (command === "migrate" || command === "sync-map-check" || command === "freshness" || command === "acceptance") {
    if (args.length) throw new Error(`${command} does not accept arguments.`);
    return { kind: command };
  }
  if (command === "sync" && args.length === 1 && args[0] === "--history-once") return { kind: "history" };
  if (command !== "sync" && command !== "backfill") throw new Error(`Unknown data command: ${command ?? "(missing)"}.`);
  if (command === "sync" && args[0] !== "--once") throw new Error("sync requires --once or --history-once; resident scheduling is not supported.");
  const years: number[] = []; const competitions: string[] = [];
  let fixture: "leaguepedia-small" | null = null;
  for (let i = command === "sync" ? 1 : 0; i < args.length; i += 2) {
    const flag = args[i]; const value = args[i + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}.`);
    if (flag === "--fixture" && value === "leaguepedia-small" && fixture === null) fixture = value;
    else if (command === "backfill" && flag === "--year" && /^\d{4}$/.test(value)) years.push(Number(value));
    else if (command === "backfill" && flag === "--competition" && value.trim()) competitions.push(value.trim());
    else throw new Error(`Invalid option ${flag}.`);
  }
  return { kind: "sync", request: validateSyncRequest(command === "sync" ? { mode: "sync-once" } : { mode: "backfill", years, competitions }), fixture };
}

export async function runDataCli(argv: readonly string[], environment: Record<string, string | undefined> = process.env) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) { console.log(dataUsage); return; }
  const command = parseDataCommand(argv);
  if (command.kind === "attempt") { await runAttemptCommand(command.directory, environment); return; }
  if (command.kind === "publish") {
    if (command.mode === "guard") await guardPublication(environment);
    else if (command.mode === "prepare") console.log(JSON.stringify(await runPublication(environment, runDataCli)));
    else if (command.mode === "record-deploy-failure") await recordDeploymentFailure(environment, runDataCli);
    else {
      const manifest = await readDeployedSite(requiredPublishValue(environment, "PAGES_BASE_URL"), false);
      if (manifest?.siteId !== requiredPublishValue(environment, "EXPECTED_SITE_ID")) throw new Error("Deployed site identity does not match the verified archive.");
    }
    return;
  }
  if (command.kind === "site") { await runSiteCommand(command.mode, command.directory, environment); return; }
  if (command.kind === "snapshot") { await runSnapshotCommand(command.mode, command.directory, environment); return; }
  if (command.kind === "archive") { await runArchiveCommand(command.mode, command.directory, environment); return; }
  if (command.kind === "checkpoint") { await runCheckpointCommand(command.mode, command.directory, environment); return; }
  if (command.kind === "migrate") {
    const databaseUrl = environment.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required.");
    const db = createDb({ databaseUrl });
    try {
      const result = await migrateToLatest(db);
      console.log(JSON.stringify(result.results ?? []));
    } finally { await db.destroy(); }
    return;
  }
  const config = loadSyncConfig(environment);
  if (command.kind === "acceptance") {
    if (!environment.OBJECT_STORE_DIR?.trim() || !environment.PUBLIC_SNAPSHOT_DIR?.trim()) throw new Error("SQLite acceptance requires OBJECT_STORE_DIR and PUBLIC_SNAPSHOT_DIR.");
    const result = await verifyCurrentSnapshot({ databaseUrl: config.databaseUrl, directory: resolve(environment.PUBLIC_SNAPSHOT_DIR),
      store: createFilesystemObjectStore(resolve(environment.OBJECT_STORE_DIR)), approvedLeaguepediaEndpoint: config.leaguepedia.endpoint,
      reviewedPath: environment.REVIEWED_ACCEPTANCE_PATH ?? fileURLToPath(new URL("../../../data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json", import.meta.url)),
    });
    console.log(JSON.stringify(result));
    if (result.status !== "ready") throw new Error("Current SQLite acceptance failed; do not publish.");
    return;
  }
  if (command.kind === "sync-map-check") {
    const result = checkLeaguepediaMappings(config); console.log(JSON.stringify(result));
    if (result.missing.length) throw new Error(`${result.missing.length} required mappings are missing.`);
    return;
  }
  if (command.kind === "freshness") {
    const result = await readSyncHealth(config); console.log(JSON.stringify(result));
    if (result.status !== "healthy") throw new Error("Data freshness check failed.");
    return;
  }
  if (!environment.OBJECT_STORE_DIR?.trim()) throw new Error("OBJECT_STORE_DIR is required for data synchronization.");
  const objectStore = createFilesystemObjectStore(resolve(environment.OBJECT_STORE_DIR));
  const requests = command.kind === "history" ? historyRequests(config) : command.kind === "sync" ? [command.request] : [];
  if (requests.length === 0) throw new Error("No reviewed historical scopes are configured.");
  const errors: unknown[] = [];
  for (const request of requests) {
    try {
      const result = await executeLeaguepediaSync({ config, objectStore, request, fixture: command.kind === "sync" ? command.fixture : null,
        requireComplete: environment.PUBLISH_REQUIRE_COMPLETE === "true" });
      console.log(JSON.stringify({ ...result, request }));
      if (result.status === "locked") throw new Error("Sync could not acquire the publication lock.");
    } catch (error) { errors.push(error); console.error(environment.PUBLISH_PRIVATE_DIAGNOSTICS === "true" ? { status: "failed", request } : error); }
  }
  if (errors.length) throw new AggregateError(errors, "Data synchronization failed; do not promote this candidate.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runDataCli(process.argv.slice(2)).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
