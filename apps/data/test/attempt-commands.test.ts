import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const createReleaseStore = vi.hoisted(() => vi.fn());
const publishAttempt = vi.hoisted(() => vi.fn());
vi.mock("../src/release-store.js", () => ({ createReleaseStore }));
vi.mock("../src/attempt-archive.js", () => ({ publishAttempt }));

import { runAttemptCommand } from "../src/attempt-commands.js";

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "riftversus-attempt-command-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  createReleaseStore.mockReset();
  publishAttempt.mockReset();
  vi.restoreAllMocks();
});

describe("attempt commands", () => {
  it("requires every publishing variable without logging credentials", async () => {
    await withRoot(async (root) => {
      for (const key of ["ATTEMPT_ID", "CODE_SHA", "FAILED_STAGE", "DATA_REPOSITORY", "RIFTVERSUS_DATA_TOKEN", "ARCHIVE_TARGET_COMMITISH"]) {
        const environment = {
          ATTEMPT_ID: "attempt-run-1-1",
          ATTEMPT_BASELINE_ID: "checkpoint-1",
          CODE_SHA: "sha",
          FAILED_STAGE: "sync",
          DATA_REPOSITORY: "owner/data",
          RIFTVERSUS_DATA_TOKEN: "secret-token",
          ARCHIVE_TARGET_COMMITISH: "main",
        };
        delete environment[key as keyof typeof environment];
        await expect(runAttemptCommand(root, environment)).rejects.toThrow(key);
      }
      expect(createReleaseStore).not.toHaveBeenCalled();
      expect(publishAttempt).not.toHaveBeenCalled();
    });
  });

  it("passes only structured failure metadata to the archive publisher", async () => {
    await withRoot(async (root) => {
      const store = { id: 9, tag_name: "attempt-run-1-1", draft: false };
      createReleaseStore.mockReturnValue({});
      publishAttempt.mockResolvedValue(store);
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await runAttemptCommand(root, {
        ATTEMPT_ID: "attempt-run-1-1",
        ATTEMPT_BASELINE_ID: "",
        CODE_SHA: "sha",
        FAILED_STAGE: "sync",
        DATA_REPOSITORY: "owner/data",
        RIFTVERSUS_DATA_TOKEN: "secret-token",
        ARCHIVE_TARGET_COMMITISH: "main",
      });

      expect(createReleaseStore).toHaveBeenCalledWith({ repository: "owner/data", token: "secret-token" });
      expect(publishAttempt).toHaveBeenCalledWith(expect.objectContaining({
        directory: root,
        attemptId: "attempt-run-1-1",
        baselineCheckpointId: null,
        codeSha: "sha",
        failedStage: "sync",
        targetCommitish: "main",
      }));
      expect(JSON.stringify(publishAttempt.mock.calls[0]?.[0])).not.toContain("secret-token");
      expect(log).toHaveBeenCalledWith(JSON.stringify({ status: "published", id: store.tag_name, attemptId: store.tag_name, failedStage: "sync" }));
    });
  });
});
