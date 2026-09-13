import { resolve } from "node:path";

import { createReleaseStore } from "./release-store.js";
import { buildSiteBundle, downloadSiteBundle, getSiteImmutableFiles, publishSiteBundle, retainPreviousSite } from "./site-bundle.js";
import { verifyPublicSnapshot } from "./export-snapshot.js";

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value?.trim()) throw new Error(`${key} is required.`);
  return value;
}

export async function runSiteCommand(mode: "publish" | "download", directory: string, env: Record<string, string | undefined>): Promise<void> {
  const destination = resolve(directory);
  const repository = required(env, "DATA_REPOSITORY");
  const token = required(env, "RIFTVERSUS_DATA_TOKEN");
  const siteId = required(env, "SITE_ID");
  const publishConfig = mode === "publish"
    ? { codeSha: required(env, "CODE_SHA"), checkpointId: required(env, "CHECKPOINT_ID"), targetCommitish: required(env, "ARCHIVE_TARGET_COMMITISH") }
    : null;
  const releaseStore = createReleaseStore({ repository, token });

  if (mode === "download") {
    const manifest = await downloadSiteBundle({ tag: siteId, releaseStore, directory: destination });
    console.log(JSON.stringify({ status: "downloaded", id: manifest.siteId, snapshotId: manifest.snapshotId, directory: destination }));
    return;
  }

  const { codeSha, checkpointId, targetCommitish } = publishConfig!;
  const snapshot = await verifyPublicSnapshot(destination);
  const immutableFiles = await getSiteImmutableFiles(destination);
  if (env.PREVIOUS_SITE_DIR?.trim()) await retainPreviousSite(destination, resolve(env.PREVIOUS_SITE_DIR));
  const bundle = await buildSiteBundle({ directory: destination, siteId, codeSha, checkpointId, snapshotId: snapshot.snapshotId, immutableFiles });
  const release = await publishSiteBundle({ bundle, releaseStore, targetCommitish });
  console.log(JSON.stringify({ status: "published", id: release.tag_name, snapshotId: bundle.manifest.snapshotId, directory: destination }));
}
