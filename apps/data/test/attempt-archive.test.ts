import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { link, mkdtemp, readFile, rm, symlink, truncate, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createFilesystemObjectStore } from "@riftversus/sync";
import { describe, expect, it } from "vitest";

import { createCheckpoint, type CheckpointManifest } from "../src/checkpoint.js";
import { resolveLatestCheckpoint } from "../src/checkpoint-release.js";
import {
  AttemptIndexSchema,
  MAX_ATTEMPT_INDEX_BYTES,
  MAX_ATTEMPT_UNCOMPRESSED_BYTES,
  MAX_ATTEMPT_ZIP_BYTES,
  buildAttemptBundle,
  downloadAttempt,
  listAttemptSummaries,
  listVerifiedAttempts,
  publishAttempt,
  resolveAttempt,
  type AttemptIndex,
} from "../src/attempt-archive.js";
import type { CreateDraftInput, Release, ReleaseAsset, ReleaseStore, UploadAssetInput } from "../src/release-store.js";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

class FakeReleaseStore implements ReleaseStore {
  readonly releases: Release[] = [];
  readonly assets = new Map<number, ReleaseAsset>();
  readonly assetBytes = new Map<number, Uint8Array>();
  readonly downloads: number[] = [];
  private readonly releaseAssets = new Map<number, number[]>();
  private nextReleaseId = 1;
  private nextAssetId = 1;
  corruptDownloads = false;
  corruptUploadedIndex = false;

  async listReleases(): Promise<Release[]> {
    return this.releases.map((release) => ({ ...release }));
  }

  async getRelease(tag: string): Promise<Release | null> {
    return this.releases.find((release) => release.tag_name === tag) ?? null;
  }

  async createDraft(input: CreateDraftInput): Promise<Release> {
    const release: Release = { id: this.nextReleaseId++, tag_name: input.tag, draft: true };
    this.releases.push(release);
    return release;
  }

  async listAssets(releaseId: number): Promise<ReleaseAsset[]> {
    return (this.releaseAssets.get(releaseId) ?? []).map((id) => this.assets.get(id)!).sort((left, right) => left.id - right.id);
  }

  async uploadAsset(releaseId: number, input: UploadAssetInput): Promise<ReleaseAsset> {
    const asset: ReleaseAsset = { id: this.nextAssetId++, name: input.name, size: input.bytes.byteLength, content_type: input.contentType };
    const stored = new Uint8Array(input.bytes);
    if (this.corruptUploadedIndex && input.name.startsWith("attempt-index-") && stored.byteLength > 0) stored[0] = stored[0]! ^ 1;
    this.assets.set(asset.id, asset);
    this.assetBytes.set(asset.id, stored);
    this.releaseAssets.set(releaseId, [...(this.releaseAssets.get(releaseId) ?? []), asset.id]);
    return asset;
  }

  async downloadAsset(assetId: number): Promise<Uint8Array> {
    const stored = this.assetBytes.get(assetId);
    if (stored === undefined) throw new Error(`missing asset ${assetId}`);
    this.downloads.push(assetId);
    return this.corruptDownloads ? bytes("corrupt remote asset") : new Uint8Array(stored);
  }

  async publishDraft(releaseId: number): Promise<Release> {
    const release = this.releases.find((candidate) => candidate.id === releaseId);
    if (release === undefined) throw new Error(`missing release ${releaseId}`);
    release.draft = false;
    return { ...release };
  }
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "riftversus-attempt-archive-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createLocalCheckpoint(root: string): Promise<{ directory: string; manifest: CheckpointManifest }> {
  const sourceRoot = join(root, "object-store");
  const sourceStore = createFilesystemObjectStore(sourceRoot);
  const objectBytes = bytes("forensic source object");
  const object = { key: "sources/provider/raw", bytes: objectBytes, checksum: digest(objectBytes), contentType: "application/json" };
  await sourceStore.putImmutable(object);
  const directory = join(root, "staging-checkpoint");
  const manifest = await createCheckpoint({
    directory,
    databaseDump: bytes("staging database dump"),
    objects: [{ key: object.key, checksum: object.checksum, contentType: object.contentType, byteSize: object.bytes.byteLength }],
    store: sourceStore,
    id: "checkpoint-staging-1",
    parentId: null,
    sequence: 1,
    codeSha: "0123456789abcdef0123456789abcdef01234567",
  });
  return { directory, manifest };
}

describe("failed attempt archive protocol", () => {
  it("packs exactly the verified checkpoint files, publishes, and remains outside checkpoint resolution", async () => {
    await withRoot(async (root) => {
      const local = await createLocalCheckpoint(root);
      const store = new FakeReleaseStore();
      const attemptId = "attempt-run-123-1";
      const published = await publishAttempt({
        directory: local.directory,
        attemptId,
        baselineCheckpointId: "checkpoint-baseline",
        codeSha: "0123456789abcdef0123456789abcdef01234567",
        failedStage: "sqlite-acceptance",
        releaseStore: store,
        targetCommitish: "main",
      });

      expect(published).toMatchObject({ tag_name: attemptId, draft: false });
      const resolved = await resolveAttempt(store, attemptId);
      expect(resolved).toMatchObject({ index: { attemptId, baselineCheckpointId: "checkpoint-baseline", checkpointManifestId: local.manifest.id } });
      expect((await listVerifiedAttempts(store)).map((entry) => entry.index.attemptId)).toEqual([attemptId]);
      await expect(resolveLatestCheckpoint(store)).resolves.toBeNull();

      const downloaded = await downloadAttempt(store, attemptId);
      expect(downloaded?.bytes).toBeDefined();
      const indexAsset = (await store.listAssets(published.id)).find((asset) => asset.name.startsWith("attempt-index-"));
      expect(indexAsset).toBeDefined();
      const index = AttemptIndexSchema.parse(JSON.parse(new TextDecoder().decode(store.assetBytes.get(indexAsset!.id)!))) as AttemptIndex;
      expect(index.files.map((file) => file.file)).toEqual(["database.dump", "manifest.json", `objects/${local.manifest.objects[0]!.checksum}`]);
      expect(JSON.stringify(index)).not.toContain("RIFTVERSUS_DATA_TOKEN");
      expect(JSON.stringify(index)).not.toContain("raw error");
    });
  });

  it("keeps the draft unpublished when remote bytes or the uploaded index are corrupt", async () => {
    await withRoot(async (root) => {
      const local = await createLocalCheckpoint(root);
      const corruptDownloadStore = new FakeReleaseStore();
      corruptDownloadStore.corruptDownloads = true;
      await expect(publishAttempt({ directory: local.directory, attemptId: "attempt-run-123-1", baselineCheckpointId: null, codeSha: "sha", failedStage: "sync", releaseStore: corruptDownloadStore, targetCommitish: "main" })).rejects.toThrow();
      expect(corruptDownloadStore.releases).toHaveLength(1);
      expect(corruptDownloadStore.releases[0]!.draft).toBe(true);

      const corruptIndexStore = new FakeReleaseStore();
      corruptIndexStore.corruptUploadedIndex = true;
      await expect(publishAttempt({ directory: local.directory, attemptId: "attempt-run-123-2", baselineCheckpointId: null, codeSha: "sha", failedStage: "sync", releaseStore: corruptIndexStore, targetCommitish: "main" })).rejects.toThrow();
      expect(corruptIndexStore.releases).toHaveLength(1);
      expect(corruptIndexStore.releases[0]!.draft).toBe(true);
    });
  });

  it("refuses existing immutable tags and unsafe, symlink, and hard-linked checkpoint inputs", async () => {
    await withRoot(async (root) => {
      const local = await createLocalCheckpoint(root);
      const store = new FakeReleaseStore();
      const input = { directory: local.directory, attemptId: "attempt-run-123-1", baselineCheckpointId: null, codeSha: "sha", failedStage: "sync", releaseStore: store, targetCommitish: "main" } as const;
      await publishAttempt(input);
      await expect(publishAttempt(input)).rejects.toThrow("already exists");

      await (await import("node:fs/promises")).writeFile(join(local.directory, "extra.env"), "TOKEN=private");
      await expect(buildAttemptBundle({ directory: local.directory, attemptId: "attempt-run-123-2", baselineCheckpointId: null, codeSha: "sha", failedStage: "sync" })).rejects.toThrow("unexpected file");
      await unlink(join(local.directory, "extra.env"));

      await link(join(local.directory, "database.dump"), join(root, "dump-hardlink"));
      await expect(buildAttemptBundle({ directory: local.directory, attemptId: "attempt-run-123-3", baselineCheckpointId: null, codeSha: "sha", failedStage: "sync" })).rejects.toThrow("hard-linked");
      await unlink(join(root, "dump-hardlink"));

      await unlink(join(local.directory, "database.dump"));
      await symlink(join(root, "outside.dump"), join(local.directory, "database.dump"));
      await expect(buildAttemptBundle({ directory: local.directory, attemptId: "attempt-run-123-4", baselineCheckpointId: null, codeSha: "sha", failedStage: "sync" })).rejects.toThrow("symlink");
    });
  });

  it("rejects malformed attempt identifiers and stage values before publishing", async () => {
    await withRoot(async (root) => {
      const local = await createLocalCheckpoint(root);
      await expect(buildAttemptBundle({ directory: local.directory, attemptId: "attempt-only", baselineCheckpointId: null, codeSha: "sha", failedStage: "sync" })).rejects.toThrow("attemptId");
      await expect(buildAttemptBundle({ directory: local.directory, attemptId: "attempt-run-1-1", baselineCheckpointId: null, codeSha: "sha", failedStage: "sync secret" })).rejects.toThrow("failedStage");
      await expect(buildAttemptBundle({ directory: local.directory, attemptId: "attempt-run-1-1", baselineCheckpointId: "token secret", codeSha: "sha", failedStage: "sync" })).rejects.toThrow("baselineCheckpointId");
      await expect(readFile(join(local.directory, "manifest.json"), "utf8")).resolves.toContain("checkpoint-staging-1");
    });
  });

  it("lists baseline summaries from verified indexes without downloading forensic ZIPs", async () => {
    await withRoot(async (root) => {
      const local = await createLocalCheckpoint(root);
      const store = new FakeReleaseStore();
      await publishAttempt({ directory: local.directory, attemptId: "attempt-run-123-1", baselineCheckpointId: "checkpoint-a", codeSha: "sha", failedStage: "sync", releaseStore: store, targetCommitish: "main" });
      await publishAttempt({ directory: local.directory, attemptId: "attempt-run-123-2", baselineCheckpointId: "checkpoint-b", codeSha: "sha", failedStage: "sqlite-export", releaseStore: store, targetCommitish: "main" });
      store.downloads.length = 0;

      const summaries = await listAttemptSummaries(store, "checkpoint-a");
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({ attemptId: "attempt-run-123-1", baselineCheckpointId: "checkpoint-a", failedStage: "sync" });
      expect(store.downloads).toHaveLength(2);
      const downloadedAssets = store.downloads.map((id) => store.assets.get(id)!.name);
      expect(downloadedAssets.every((name) => name.startsWith("attempt-index-"))).toBe(true);
    });
  });

  it("rejects oversized metadata before index or forensic ZIP downloads", async () => {
    await withRoot(async (root) => {
      const local = await createLocalCheckpoint(root);
      const store = new FakeReleaseStore();
      const published = await publishAttempt({ directory: local.directory, attemptId: "attempt-run-123-1", baselineCheckpointId: "checkpoint-a", codeSha: "sha", failedStage: "sync", releaseStore: store, targetCommitish: "main" });
      const assets = await store.listAssets(published.id);
      const indexAsset = assets.find((asset) => asset.name.startsWith("attempt-index-"))!;
      const zipAsset = assets.find((asset) => asset.name.startsWith("attempt-bundle-"))!;

      indexAsset.size = MAX_ATTEMPT_INDEX_BYTES + 1;
      store.downloads.length = 0;
      await expect(listAttemptSummaries(store, "checkpoint-a")).rejects.toThrow("Attempt index exceeds");
      expect(store.downloads).toEqual([]);

      indexAsset.size = store.assetBytes.get(indexAsset.id)!.byteLength;
      zipAsset.size = MAX_ATTEMPT_ZIP_BYTES + 1;
      store.downloads.length = 0;
      await expect(listAttemptSummaries(store, "checkpoint-a")).rejects.toThrow("Attempt archive ZIP exceeds");
      expect(store.downloads.map((id) => store.assets.get(id)!.name)).toEqual([indexAsset.name]);

      await truncate(join(local.directory, "database.dump"), MAX_ATTEMPT_UNCOMPRESSED_BYTES + 1);
      await expect(buildAttemptBundle({ directory: local.directory, attemptId: "attempt-run-123-2", baselineCheckpointId: null, codeSha: "sha", failedStage: "sync" })).rejects.toThrow("uncompressed bytes");
    });
  });

  it("rejects a forged 64 MiB ZIP stream without an uncaught worker error", () => {
    const helperUrl = pathToFileURL(fileURLToPath(new URL("../src/bounded-zip.ts", import.meta.url))).href;
    const jszipUrl = pathToFileURL(fileURLToPath(new URL("../node_modules/jszip/lib/index.js", import.meta.url))).href;
    const script = `
      import { createHash } from "node:crypto";
      import JSZip from ${JSON.stringify(jszipUrl)};
      import { readBoundedZipEntry } from ${JSON.stringify(helperUrl)};
      const zip = new JSZip();
      zip.file("payload", new Uint8Array(64 * 1024 * 1024));
      const generated = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
      const forged = new Uint8Array(generated);
      const view = new DataView(forged.buffer, forged.byteOffset, forged.byteLength);
      let entries = 0;
      for (let offset = 0; offset + 46 <= forged.byteLength; offset += 1) {
        if (view.getUint32(offset, true) !== 0x02014b50) continue;
        view.setUint32(offset + 24, 1, true);
        entries += 1;
      }
      if (entries !== 1) throw new Error("missing central directory entry");
      const loaded = await JSZip.loadAsync(forged);
      const entry = loaded.file("payload");
      if (entry === null) throw new Error("missing payload entry");
      try {
        await readBoundedZipEntry(entry, { byteSize: 1, checksum: createHash("sha256").update("x").digest("hex") }, { used: 0, limit: 64 * 1024 * 1024 }, "payload");
        throw new Error("forged ZIP unexpectedly passed");
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("indexed byte size")) throw error;
        console.log("bounded-rejected");
      }
    `;
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(output).toContain("bounded-rejected");
  });
});
