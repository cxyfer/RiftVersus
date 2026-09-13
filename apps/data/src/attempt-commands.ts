import { resolve } from "node:path";

import { createReleaseStore } from "./release-store.js";
import { publishAttempt } from "./attempt-archive.js";

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value?.trim()) throw new Error(`${key} is required.`);
  return value;
}

export async function runAttemptCommand(directory: string, env: Record<string, string | undefined>): Promise<void> {
  const attemptId = required(env, "ATTEMPT_ID");
  const baselineCheckpointId = env.ATTEMPT_BASELINE_ID?.trim() || null;
  const codeSha = required(env, "CODE_SHA");
  const failedStage = required(env, "FAILED_STAGE");
  const repository = required(env, "DATA_REPOSITORY");
  const token = required(env, "RIFTVERSUS_DATA_TOKEN");
  const targetCommitish = required(env, "ARCHIVE_TARGET_COMMITISH");
  const release = await publishAttempt({
    directory: resolve(directory),
    attemptId,
    baselineCheckpointId,
    codeSha,
    failedStage,
    releaseStore: createReleaseStore({ repository, token }),
    targetCommitish,
  });
  console.log(JSON.stringify({ status: "published", id: release.tag_name, attemptId, failedStage }));
}
