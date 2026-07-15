import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compareHeadToHead, createDb, destroyDb, findAcceptanceDatasetEvidence, findMediaObjectMetadataByKey, findSourceObjectMetadataByKey } from "@riftversus/database";

import { verifyAcceptanceSnapshot, type AcceptanceEvaluation } from "./acceptance.js";
import { loadConfig, type Environment } from "./config.js";
import { createConfiguredObjectStore } from "./storage.js";
import { generateCanonicalAvatar } from "./avatar.js";

const DEFAULT_SNAPSHOT = fileURLToPath(new URL("../../../data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json", import.meta.url));

export async function runProductionAcceptanceCheck(path = DEFAULT_SNAPSHOT, environment: Environment = process.env): Promise<AcceptanceEvaluation> {
  let db: ReturnType<typeof createDb> | undefined;
  try {
    const config = loadConfig(environment);
    const objectStore = createConfiguredObjectStore(config);
    if (objectStore === undefined) return { status: "blocked", blockers: ["Acceptance runtime configuration requires a complete ObjectStore."] };
    const snapshot = JSON.parse(await readFile(resolve(process.cwd(), path), "utf8")) as unknown;
    db = createDb({ databaseUrl: config.databaseUrl });
    return await verifyAcceptanceSnapshot(snapshot, {
      approvedLeaguepediaEndpoint: config.leaguepedia.endpoint,
      maxRawObjectBytes: config.leaguepedia.resourceLimits.maxBytes,
      maxMediaObjectBytes: 10_000_000,
      compare: (query) => compareHeadToHead(query, db!),
      getRawObject: (key) => objectStore.get(key),
      getSourceMetadata: (key) => findSourceObjectMetadataByKey(key, db!),
      getDatasetEvidence: (version, seriesIds) => findAcceptanceDatasetEvidence(version, seriesIds, db!),
      getMediaMetadata: (key) => findMediaObjectMetadataByKey(key, db!),
      generateAvatar: generateCanonicalAvatar,
    });
  } catch (error) {
    return { status: "blocked", blockers: [`Acceptance runtime configuration or dependency failed: ${error instanceof Error ? error.message : String(error)}`] };
  } finally {
    if (db !== undefined) await destroyDb(db);
  }
}

async function main() {
  const result = await runProductionAcceptanceCheck(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ready") process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
