import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createFilesystemObjectStore } from "@riftversus/sync";
import { createCheckpoint, type CheckpointManifest } from "../src/checkpoint.js";
import {
  CheckpointIndexSchema,
  publishCheckpoint,
  resolveLatestCheckpoint,
  type CheckpointIndex,
} from "../src/checkpoint-release.js";
import type {
  CreateDraftInput,
  DownloadExpected,
  Release,
  ReleaseAsset,
  ReleaseStore,
  UploadAssetInput,
} from "../src/release-store.js";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

class FakeReleaseStore implements ReleaseStore {
  readonly releases: Release[] = [];
  readonly assets = new Map<number, ReleaseAsset>();
  readonly assetBytes = new Map<number, Uint8Array>();
  readonly uploads: Array<{ releaseId: number; input: UploadAssetInput }> = [];
  readonly downloads: number[] = [];
  private readonly releaseAssetIds = new Map<number, number[]>();
  corruptDownloads = false;
  corruptUploadedIndex = false;
  private nextReleaseId = 1;
  private nextAssetId = 1;

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
    return this.assetsFor(releaseId);
  }

  async uploadAsset(releaseId: number, input: UploadAssetInput): Promise<ReleaseAsset> {
    const asset: ReleaseAsset = { id: this.nextAssetId++, name: input.name, size: input.bytes.byteLength, content_type: input.contentType };
    this.assets.set(asset.id, asset);
    const storedBytes = new Uint8Array(input.bytes);
    if (this.corruptUploadedIndex && input.name.startsWith("checkpoint-index-") && storedBytes.byteLength > 0) storedBytes[0] = storedBytes[0]! ^ 1;
    this.assetBytes.set(asset.id, storedBytes);
    this.uploads.push({ releaseId, input: { ...input, bytes: new Uint8Array(input.bytes) } });
    this.releaseAssetIds.set(releaseId, [...(this.releaseAssetIds.get(releaseId) ?? []), asset.id]);
    return asset;
  }

  async downloadAsset(assetId: number, expected: DownloadExpected): Promise<Uint8Array> {
    const asset = this.assets.get(assetId);
    const bytes = this.assetBytes.get(assetId);
    if (asset === undefined || bytes === undefined) throw new Error(`missing asset ${assetId}`);
    this.downloads.push(assetId);
    if (this.corruptDownloads) return makeBytes("corrupted remote bytes");
    if (bytes.byteLength !== expected.byteSize || digest(bytes) !== expected.checksum) throw new Error(`asset verification failed: ${asset.name}`);
    return new Uint8Array(bytes);
  }

  async publishDraft(releaseId: number): Promise<Release> {
    const release = this.releases.find((candidate) => candidate.id === releaseId);
    if (release === undefined) throw new Error(`missing release ${releaseId}`);
    release.draft = false;
    return { ...release };
  }

  private assetsFor(releaseId: number): ReleaseAsset[] {
    return (this.releaseAssetIds.get(releaseId) ?? []).map((id) => this.assets.get(id)!).sort((left, right) => left.id - right.id);
  }

  assetsForTest(name: string): number {
    const asset = [...this.assets.values()].find((candidate) => candidate.name === name);
    if (asset === undefined) throw new Error(`missing asset ${name}`);
    return asset.id;
  }

  async clonePublishedCheckpoint(source: Release, newId: string, overrides: Partial<Pick<CheckpointManifest, "parent" | "sequence">> = {}): Promise<void> {
    const sourceAssets = await this.listAssets(source.id);
    const indexAsset = sourceAssets.find((asset) => asset.name.startsWith("checkpoint-index-"));
    if (indexAsset === undefined) throw new Error("source index missing");
    const sourceIndex = CheckpointIndexSchema.parse(JSON.parse(new TextDecoder().decode(this.assetBytes.get(indexAsset.id)!))) as CheckpointIndex;
    const manifest: CheckpointManifest = { ...sourceIndex.manifest, id: newId, ...overrides };
    const cloned: CheckpointIndex = { ...sourceIndex, manifest, files: [] };
    const release: Release = { id: this.nextReleaseId++, tag_name: newId, draft: false };
    this.releases.push(release);
    for (const file of sourceIndex.files) {
      const parts = [];
      for (const part of file.parts) {
        const sourceAsset = this.assets.get(part.assetId)!;
        const sourceBytes = this.assetBytes.get(sourceAsset.id)!;
        const asset: ReleaseAsset = { id: this.nextAssetId++, name: sourceAsset.name, size: sourceBytes.byteLength, content_type: sourceAsset.content_type };
        this.assets.set(asset.id, asset);
        this.assetBytes.set(asset.id, new Uint8Array(sourceBytes));
        this.releaseAssetIds.set(release.id, [...(this.releaseAssetIds.get(release.id) ?? []), asset.id]);
        parts.push({ ...part, assetId: asset.id });
      }
      cloned.files.push({ ...file, parts });
    }
    const indexBytes = new TextEncoder().encode(`${JSON.stringify(cloned)}\n`);
    const asset: ReleaseAsset = { id: this.nextAssetId++, name: `checkpoint-index-${digest(indexBytes)}.json`, size: indexBytes.byteLength, content_type: "application/json" };
    this.assets.set(asset.id, asset);
    this.assetBytes.set(asset.id, indexBytes);
    this.releaseAssetIds.set(release.id, [...(this.releaseAssetIds.get(release.id) ?? []), asset.id]);
    this.uploads.push({ releaseId: release.id, input: { name: asset.name, bytes: indexBytes, contentType: "application/json" } });
  }

  async rewriteIndex(releaseId: number, mutate: (index: CheckpointIndex) => CheckpointIndex): Promise<void> {
    const indexAsset = (await this.listAssets(releaseId)).find((asset) => asset.name.startsWith("checkpoint-index-"));
    if (indexAsset === undefined) throw new Error("index missing");
    const index = CheckpointIndexSchema.parse(JSON.parse(new TextDecoder().decode(this.assetBytes.get(indexAsset.id)!)));
    const bytes = new TextEncoder().encode(`${JSON.stringify(mutate(index))}\n`);
    indexAsset.name = `checkpoint-index-${digest(bytes)}.json`;
    indexAsset.size = bytes.byteLength;
    this.assetBytes.set(indexAsset.id, bytes);
  }
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "riftversus-checkpoint-release-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createLocalCheckpoint(root: string, sequence: number): Promise<{ directory: string; manifest: CheckpointManifest }> {
  const sourceRoot = join(root, `source-${sequence}`);
  const sourceStore = createFilesystemObjectStore(sourceRoot);
  const objectBytes = makeBytes("raw object bytes");
  const object = {
    key: "sources/provider/raw",
    bytes: objectBytes,
    checksum: digest(objectBytes),
    contentType: "application/json",
  };
  await sourceStore.putImmutable(object);
  const directory = join(root, `local-${sequence}`);
  const manifest = await createCheckpoint({
    directory,
    databaseDump: makeBytes(`dump-${sequence}`),
    objects: [{ key: object.key, checksum: object.checksum, contentType: object.contentType, byteSize: object.bytes.byteLength }],
    store: createFilesystemObjectStore(sourceRoot),
    id: `checkpoint-${sequence}-run`,
    parentId: sequence === 1 ? null : "checkpoint-1-run",
    sequence,
    codeSha: "0123456789abcdef0123456789abcdef01234567",
  });
  return { directory, manifest };
}

describe("checkpoint release protocol", () => {
  it("uploads, verifies, restores, and publishes a checkpoint", async () => {
    await withRoot(async (root) => {
      const local = await createLocalCheckpoint(root, 1);
      const releaseStore = new FakeReleaseStore();
      const validateRestore = vi.fn(async (directory: string) => {
        await expect(createFilesystemObjectStore(join(root, "restored")).head("sources/provider/raw")).resolves.toBeNull();
        expect(directory).toContain("riftversus-checkpoint-release-");
      });

      const published = await publishCheckpoint({ directory: local.directory, releaseStore, targetCommitish: "code-sha", validateRestore });
      expect(published).toMatchObject({ tag_name: local.manifest.id, draft: false });
      expect(validateRestore).toHaveBeenCalledOnce();
      await expect(resolveLatestCheckpoint(releaseStore)).resolves.toMatchObject({ index: { manifest: local.manifest } });
      expect(releaseStore.uploads.map((upload) => upload.input.name)).toEqual([
        `chunk-${digest(makeBytes("dump-1"))}`,
        `chunk-${local.manifest.objects[0]!.checksum}`,
        expect.stringMatching(/^checkpoint-index-[a-f0-9]{64}\.json$/),
      ]);
    });
  });

  it("leaves the draft unpublished when candidate bytes are corrupt", async () => {
    await withRoot(async (root) => {
      const local = await createLocalCheckpoint(root, 1);
      const releaseStore = new FakeReleaseStore();
      releaseStore.corruptDownloads = true;
      await expect(publishCheckpoint({ directory: local.directory, releaseStore, targetCommitish: "code-sha", validateRestore: vi.fn(async () => undefined) })).rejects.toThrow();
      expect(releaseStore.releases).toHaveLength(1);
      expect(releaseStore.releases[0]!.draft).toBe(true);
    });
  });

  it("leaves the draft unpublished when the uploaded index is corrupted", async () => {
    await withRoot(async (root) => {
      const local = await createLocalCheckpoint(root, 1);
      const releaseStore = new FakeReleaseStore();
      releaseStore.corruptUploadedIndex = true;
      const validateRestore = vi.fn(async () => undefined);
      await expect(publishCheckpoint({ directory: local.directory, releaseStore, targetCommitish: "code-sha", validateRestore })).rejects.toThrow("asset verification failed");
      expect(validateRestore).not.toHaveBeenCalled();
      expect(releaseStore.releases).toHaveLength(1);
      expect(releaseStore.releases[0]!.draft).toBe(true);
    });
  });

  it("does not publish when restore validation fails", async () => {
    await withRoot(async (root) => {
      const local = await createLocalCheckpoint(root, 1);
      const releaseStore = new FakeReleaseStore();
      await expect(publishCheckpoint({
        directory: local.directory,
        releaseStore,
        targetCommitish: "code-sha",
        validateRestore: vi.fn(async () => { throw new Error("restore failed"); }),
      })).rejects.toThrow("restore failed");
      expect(releaseStore.releases).toHaveLength(1);
      expect(releaseStore.releases[0]!.draft).toBe(true);
    });
  });

  it("reuses previous raw chunks by full checksum while always uploading the dump", async () => {
    await withRoot(async (root) => {
      const first = await createLocalCheckpoint(root, 1);
      const second = await createLocalCheckpoint(root, 2);
      const releaseStore = new FakeReleaseStore();
      await publishCheckpoint({ directory: first.directory, releaseStore, targetCommitish: "code-sha", validateRestore: vi.fn(async () => undefined) });
      const firstChunk = releaseStore.uploads.find((upload) => upload.input.name.startsWith("chunk-"));
      expect(firstChunk).toBeDefined();
      const downloadsBefore = releaseStore.downloads.length;
      await publishCheckpoint({ directory: second.directory, releaseStore, targetCommitish: "code-sha", validateRestore: vi.fn(async () => undefined) });
      expect(releaseStore.downloads.length).toBeGreaterThan(downloadsBefore);
      expect(releaseStore.downloads).toContain(releaseStore.assetsForTest(firstChunk!.input.name));
      const secondReleaseId = releaseStore.releases.find((release) => release.tag_name === second.manifest.id)!.id;
      expect(releaseStore.uploads.filter((upload) => upload.releaseId === secondReleaseId).map((upload) => upload.input.name)).toContain(`chunk-${digest(makeBytes("dump-2"))}`);
    });
  });

  it("ignores drafts and rejects duplicate published sequences", async () => {
    await withRoot(async (root) => {
      const local = await createLocalCheckpoint(root, 1);
      const releaseStore = new FakeReleaseStore();
      const first = await publishCheckpoint({ directory: local.directory, releaseStore, targetCommitish: "code-sha", validateRestore: vi.fn(async () => undefined) });
      const draft = await releaseStore.createDraft({ tag: "checkpoint-99-draft", targetCommitish: "code-sha", body: "draft" });
      expect(draft.draft).toBe(true);
      await expect(resolveLatestCheckpoint(releaseStore)).resolves.toMatchObject({ release: { id: first.id } });

      await releaseStore.clonePublishedCheckpoint(first, "checkpoint-duplicate");
      await expect(resolveLatestCheckpoint(releaseStore)).rejects.toThrow("Duplicate published checkpoint sequence");
    });
  });

  it("rejects missing lineage, wrong parents, unsafe paths, and part metadata conflicts", async () => {
    await withRoot(async (root) => {
      const missingParentLocal = await createLocalCheckpoint(root, 1);
      const missingParentStore = new FakeReleaseStore();
      const first = await publishCheckpoint({ directory: missingParentLocal.directory, releaseStore: missingParentStore, targetCommitish: "code-sha", validateRestore: vi.fn(async () => undefined) });
      missingParentStore.releases.splice(0, 1);
      await missingParentStore.clonePublishedCheckpoint(first, "checkpoint-2-run", { sequence: 2, parent: first.tag_name });
      await expect(resolveLatestCheckpoint(missingParentStore)).rejects.toThrow("lineage");

      const wrongParentStore = new FakeReleaseStore();
      const wrongFirst = await publishCheckpoint({ directory: missingParentLocal.directory, releaseStore: wrongParentStore, targetCommitish: "code-sha", validateRestore: vi.fn(async () => undefined) });
      await wrongParentStore.clonePublishedCheckpoint(wrongFirst, "checkpoint-2-run", { sequence: 2, parent: "checkpoint-wrong-parent" });
      await expect(resolveLatestCheckpoint(wrongParentStore)).rejects.toThrow("lineage");

      const malformedPathStore = new FakeReleaseStore();
      const malformedPath = await publishCheckpoint({ directory: missingParentLocal.directory, releaseStore: malformedPathStore, targetCommitish: "code-sha", validateRestore: vi.fn(async () => undefined) });
      await malformedPathStore.rewriteIndex(malformedPath.id, (index) => ({ ...index, files: index.files.map((file, index) => index === 0 ? { ...file, file: "../database.dump" } : file) }));
      await expect(resolveLatestCheckpoint(malformedPathStore)).rejects.toThrow("unsafe");

      const malformedPartsStore = new FakeReleaseStore();
      const malformedParts = await publishCheckpoint({ directory: missingParentLocal.directory, releaseStore: malformedPartsStore, targetCommitish: "code-sha", validateRestore: vi.fn(async () => undefined) });
      await malformedPartsStore.rewriteIndex(malformedParts.id, (index) => ({ ...index, files: index.files.map((file, index) => index === 0 ? { ...file, parts: file.parts.map((part, partIndex) => partIndex === 0 ? { ...part, byteSize: part.byteSize + 1 } : part) } : file) }));
      await expect(resolveLatestCheckpoint(malformedPartsStore)).rejects.toThrow("byte size");
    });
  });
});
