import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReleaseStore } from "./release-store.js";
import { downloadCheckpoint, publishCheckpoint, resolveLatestCheckpoint } from "./checkpoint-release.js";
import { runCheckpointCommand } from "./checkpoint-commands.js";

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value?.trim()) throw new Error(`${key} is required.`);
  return value;
}

export async function runArchiveCommand(mode: "resolve" | "publish", directory: string, env: Record<string, string | undefined>): Promise<void> {
  const releaseStore = createReleaseStore({ repository: required(env, "DATA_REPOSITORY"), token: required(env, "RIFTVERSUS_DATA_TOKEN") });
  if (mode === "resolve") {
    const checkpoint = await resolveLatestCheckpoint(releaseStore);
    if (checkpoint === null) throw new Error("No published checkpoint exists; explicit bootstrap is required.");
    const manifest = await downloadCheckpoint({ resolved: checkpoint, releaseStore, directory });
    console.log(JSON.stringify({ status: "downloaded", id: manifest.id, sequence: manifest.sequence, directory }));
    return;
  }
  const databaseUrl = required(env, "CHECKPOINT_RESTORE_DATABASE_URL");
  const targetCommitish = required(env, "ARCHIVE_TARGET_COMMITISH");
  const temporary = await mkdtemp(join(tmpdir(), "riftversus-archive-restore-"));
  try {
    const release = await publishCheckpoint({ directory, releaseStore, targetCommitish,
      validateRestore: candidate => runCheckpointCommand("restore", candidate, {
        DATABASE_URL: databaseUrl, OBJECT_STORE_DIR: join(temporary, "objects"),
      }),
    });
    console.log(JSON.stringify({ status: "published", id: release.tag_name }));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
