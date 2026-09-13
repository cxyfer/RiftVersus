import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareHeadToHead, createDb, findAcceptanceDatasetEvidence, findMediaObjectMetadataByKey, findSourceObjectMetadataByKey, getAvatarIdentity } from "@riftversus/database";
import { createFilesystemObjectStore, loadSyncConfig } from "@riftversus/sync";
import { verifyAcceptanceSnapshot, type AcceptanceEvaluation } from "./acceptance.js";
import { generateCanonicalAvatar } from "./avatar.js";

const defaultSnapshot = fileURLToPath(new URL("../../../data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json", import.meta.url));

export async function runDataAcceptanceCheck(path = defaultSnapshot, environment: Record<string, string | undefined> = process.env): Promise<AcceptanceEvaluation> {
  const config = loadSyncConfig(environment);
  if (!environment.OBJECT_STORE_DIR?.trim()) throw new Error("OBJECT_STORE_DIR is required for acceptance.");
  const store = createFilesystemObjectStore(resolve(environment.OBJECT_STORE_DIR));
  const snapshot: unknown = JSON.parse(await readFile(path, "utf8"));
  const db = createDb({ databaseUrl: config.databaseUrl });
  try {
    return await verifyAcceptanceSnapshot(snapshot, {
      approvedLeaguepediaEndpoint: config.leaguepedia.endpoint,
      maxRawObjectBytes: config.leaguepedia.resourceLimits.maxBytes,
      maxMediaObjectBytes: 10_000_000,
      compare: query => compareHeadToHead(query, db),
      getRawObject: key => store.get(key),
      getSourceMetadata: key => findSourceObjectMetadataByKey(key, db),
      getDatasetEvidence: (version, ids) => findAcceptanceDatasetEvidence(version, ids, db),
      getMediaMetadata: key => findMediaObjectMetadataByKey(key, db),
      getAvatarIdentity: (kind, id) => getAvatarIdentity(kind, id, db),
      generateAvatar: generateCanonicalAvatar,
    });
  } finally { await db.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runDataAcceptanceCheck(process.argv[2]).then(result => {
    console.log(JSON.stringify(result));
    if (result.status !== "ready") process.exitCode = 1;
  }).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
