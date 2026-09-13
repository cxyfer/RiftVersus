import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { z } from "zod";

import { CheckpointManifestSchema, verifyCheckpoint, type CheckpointManifest } from "./checkpoint.js";
import type { Release, ReleaseAsset, ReleaseStore } from "./release-store.js";

const CHECKPOINT_INDEX_SCHEMA_VERSION = 1;
const MANIFEST_FILE = "manifest.json";
const DATABASE_DUMP_FILE = "database.dump";
const OBJECTS_DIRECTORY = "objects";
const CHUNK_ASSET_PREFIX = "chunk-";
const INDEX_ASSET_PREFIX = "checkpoint-index-";
const INDEX_ASSET_SUFFIX = ".json";
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_RELATIVE_FILE = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const INDEX_ASSET = /^checkpoint-index-([a-f0-9]{64})\.json$/;
const MAX_RELEASE_ASSETS = 1_000;
export const MAX_CHECKPOINT_CHUNK_BYTES = 256 * 1024 * 1024;

const CheckpointIndexPartSchema = z.object({
  assetId: z.number().int().positive().safe(),
  checksum: z.string().regex(SHA256),
  byteSize: z.number().int().nonnegative().safe(),
}).strict();

const CheckpointIndexFileSchema = z.object({
  file: z.string().min(1),
  parts: z.array(CheckpointIndexPartSchema).min(1),
}).strict();

export const CheckpointIndexSchema = z.object({
  checkpointIndexSchemaVersion: z.literal(CHECKPOINT_INDEX_SCHEMA_VERSION),
  manifest: CheckpointManifestSchema,
  files: z.array(CheckpointIndexFileSchema),
}).strict();

export type CheckpointIndexPart = z.infer<typeof CheckpointIndexPartSchema>;
export type CheckpointIndexFile = z.infer<typeof CheckpointIndexFileSchema>;
export type CheckpointIndex = z.infer<typeof CheckpointIndexSchema>;

export interface PublishCheckpointInput {
  directory: string;
  releaseStore: ReleaseStore;
  targetCommitish: string;
  body?: string;
  validateRestore: (directory: string) => Promise<void>;
}

export interface ResolvedCheckpoint {
  release: Release;
  index: CheckpointIndex;
  assets: readonly ReleaseAsset[];
}

export interface DownloadCheckpointInput {
  resolved: ResolvedCheckpoint;
  releaseStore: ReleaseStore;
  directory: string;
}

interface VerifiedLocalFiles {
  manifest: CheckpointManifest;
  files: Map<string, Uint8Array>;
}

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSafeFile(file: string): readonly string[] {
  if (!SAFE_RELATIVE_FILE.test(file)) throw new Error(`Checkpoint release file path is unsafe: ${file}`);
  const segments = file.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) throw new Error(`Checkpoint release file path is unsafe: ${file}`);
  return segments;
}

function assertRegularFile(path: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (stats.isSymbolicLink()) throw new Error(`Checkpoint release file is a symlink: ${path}`);
  if (!stats.isFile()) throw new Error(`Checkpoint release path is not a regular file: ${path}`);
  if (stats.nlink !== 1) throw new Error(`Checkpoint release file is hard-linked: ${path}`);
}

function objectFiles(manifest: CheckpointManifest): string[] {
  return [...new Set(manifest.objects.map((object) => object.file))];
}

function expectedLocalFiles(manifest: CheckpointManifest): string[] {
  return [MANIFEST_FILE, DATABASE_DUMP_FILE, ...objectFiles(manifest)];
}

function expectedChecksumForFile(manifest: CheckpointManifest, file: string): { checksum: string; byteSize: number } {
  if (file === DATABASE_DUMP_FILE) return { checksum: manifest.databaseDump.checksum, byteSize: manifest.databaseDump.byteSize };
  const object = manifest.objects.find((candidate) => candidate.file === file);
  if (object === undefined) throw new Error(`Checkpoint release file is not listed in manifest: ${file}`);
  return { checksum: object.checksum, byteSize: object.byteSize };
}

async function readLocalFile(directory: string, file: string, expectedChecksum: string, expectedByteSize: number): Promise<Uint8Array> {
  const path = join(resolve(directory), ...assertSafeFile(file));
  const stats = await lstat(path);
  assertRegularFile(path, stats);
  const bytes = new Uint8Array(await readFile(path));
  if (stats.size !== expectedByteSize || bytes.byteLength !== expectedByteSize) throw new Error(`Checkpoint release byte size mismatch: ${file}`);
  if (checksum(bytes) !== expectedChecksum) throw new Error(`Checkpoint release checksum mismatch: ${file}`);
  return bytes;
}

async function collectLocalFiles(directory: string): Promise<Set<string>> {
  const files = new Set<string>();
  async function visit(current: string, relativeDirectory: string): Promise<void> {
    for (const name of await readdir(current)) {
      const relativePath = relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
      assertSafeFile(relativePath);
      const path = join(current, name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) throw new Error(`Checkpoint release path is a symlink: ${path}`);
      if (stats.isDirectory()) await visit(path, relativePath);
      else {
        assertRegularFile(path, stats);
        files.add(relativePath);
      }
    }
  }
  await visit(resolve(directory), "");
  return files;
}

async function readVerifiedLocalFiles(directory: string): Promise<VerifiedLocalFiles> {
  const manifest = await verifyCheckpoint(directory);
  const root = resolve(directory);
  const actualFiles = await collectLocalFiles(root);
  const expectedFiles = new Set(expectedLocalFiles(manifest));
  for (const file of actualFiles) if (!expectedFiles.has(file)) throw new Error(`Checkpoint release contains an unexpected file: ${file}`);
  for (const file of expectedFiles) if (!actualFiles.has(file)) throw new Error(`Checkpoint release is missing file: ${file}`);

  const files = new Map<string, Uint8Array>();
  for (const file of [DATABASE_DUMP_FILE, ...objectFiles(manifest)]) {
    const expected = expectedChecksumForFile(manifest, file);
    files.set(file, await readLocalFile(root, file, expected.checksum, expected.byteSize));
  }
  return { manifest, files };
}

function expectedIndexFiles(manifest: CheckpointManifest): Map<string, { checksum: string; byteSize: number }> {
  const expected = new Map<string, { checksum: string; byteSize: number }>();
  expected.set(DATABASE_DUMP_FILE, { checksum: manifest.databaseDump.checksum, byteSize: manifest.databaseDump.byteSize });
  for (const object of manifest.objects) {
    if (!expected.has(object.file)) expected.set(object.file, { checksum: object.checksum, byteSize: object.byteSize });
  }
  return expected;
}

function assertChunkSize(file: string, byteSize: number): void {
  if (byteSize > MAX_CHECKPOINT_CHUNK_BYTES) throw new Error(`Checkpoint chunk exceeds ${MAX_CHECKPOINT_CHUNK_BYTES} bytes: ${file}`);
}

function validateIndexConsistency(index: CheckpointIndex): void {
  const expected = expectedIndexFiles(index.manifest);
  const seenFiles = new Set<string>();
  const seenAssetRefs = new Map<number, { checksum: string; byteSize: number }>();
  for (const file of index.files) {
    assertSafeFile(file.file);
    if (seenFiles.has(file.file)) throw new Error(`Checkpoint index contains duplicate file: ${file.file}`);
    seenFiles.add(file.file);
    const expectedFile = expected.get(file.file);
    if (expectedFile === undefined) throw new Error(`Checkpoint index contains an unexpected file: ${file.file}`);
    let totalSize = 0;
    for (const part of file.parts) {
      assertChunkSize(file.file, part.byteSize);
      totalSize += part.byteSize;
      if (!Number.isSafeInteger(totalSize)) throw new Error(`Checkpoint index byte size is too large: ${file.file}`);
      const previous = seenAssetRefs.get(part.assetId);
      if (previous !== undefined && (previous.checksum !== part.checksum || previous.byteSize !== part.byteSize)) {
        throw new Error(`Checkpoint index asset metadata conflicts: ${part.assetId}`);
      }
      seenAssetRefs.set(part.assetId, { checksum: part.checksum, byteSize: part.byteSize });
    }
    if (totalSize !== expectedFile.byteSize) throw new Error(`Checkpoint index total byte size mismatch: ${file.file}`);
  }
  if (seenFiles.size !== expected.size) throw new Error("Checkpoint index does not map every local file exactly once.");
}

function parseIndex(bytes: Uint8Array): CheckpointIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error("Checkpoint index is not valid JSON.", { cause: error });
  }
  const index = CheckpointIndexSchema.parse(parsed);
  validateIndexConsistency(index);
  return index;
}

function indexBytes(index: CheckpointIndex): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(index)}\n`);
}

function indexAssetName(index: CheckpointIndex): string {
  return `${INDEX_ASSET_PREFIX}${checksum(indexBytes(index))}${INDEX_ASSET_SUFFIX}`;
}

function chunkAssetName(checksumValue: string): string {
  return `${CHUNK_ASSET_PREFIX}${checksumValue}`;
}

function indexChecksumFromAsset(name: string): string | null {
  return name.match(INDEX_ASSET)?.[1] ?? null;
}

function splitBytes(bytes: Uint8Array): Array<{ bytes: Uint8Array; checksum: string; byteSize: number }> {
  if (bytes.byteLength === 0) return [{ bytes: new Uint8Array(), checksum: checksum(bytes), byteSize: 0 }];
  const parts: Array<{ bytes: Uint8Array; checksum: string; byteSize: number }> = [];
  for (let offset = 0; offset < bytes.byteLength; offset += MAX_CHECKPOINT_CHUNK_BYTES) {
    const part = bytes.slice(offset, Math.min(bytes.byteLength, offset + MAX_CHECKPOINT_CHUNK_BYTES));
    parts.push({ bytes: part, checksum: checksum(part), byteSize: part.byteLength });
  }
  return parts;
}

async function readIndexFromRelease(releaseStore: ReleaseStore, release: Release, assets: readonly ReleaseAsset[]): Promise<CheckpointIndex> {
  const indexAssets = assets.filter((asset) => indexChecksumFromAsset(asset.name) !== null);
  if (indexAssets.length !== 1) throw new Error(`Checkpoint release must contain exactly one checkpoint index: ${release.tag_name}`);
  const asset = indexAssets[0]!;
  const indexChecksum = indexChecksumFromAsset(asset.name)!;
  const bytes = await releaseStore.downloadAsset(asset.id, { byteSize: asset.size, checksum: indexChecksum });
  const index = parseIndex(bytes);
  if (index.manifest.id !== release.tag_name) throw new Error(`Checkpoint index id does not match release tag: ${release.tag_name}`);
  return index;
}

export async function resolveLatestCheckpoint(releaseStore: ReleaseStore): Promise<ResolvedCheckpoint | null> {
  const releases = await releaseStore.listReleases();
  const candidates: ResolvedCheckpoint[] = [];
  for (const release of releases) {
    if (release.draft || !release.tag_name.startsWith("checkpoint-")) continue;
    const assets = await releaseStore.listAssets(release.id);
    const index = await readIndexFromRelease(releaseStore, release, assets);
    candidates.push({ release, index, assets });
  }
  const bySequence = new Map<number, ResolvedCheckpoint>();
  for (const candidate of candidates) {
    if (bySequence.has(candidate.index.manifest.sequence)) throw new Error(`Duplicate published checkpoint sequence: ${candidate.index.manifest.sequence}`);
    bySequence.set(candidate.index.manifest.sequence, candidate);
  }
  const ordered = [...bySequence.keys()].sort((left, right) => left - right);
  for (const sequence of ordered) {
    const candidate = bySequence.get(sequence)!;
    if (sequence === 1) {
      if (candidate.index.manifest.parent !== null) throw new Error("Checkpoint lineage must start with a null parent.");
      continue;
    }
    const parent = bySequence.get(sequence - 1);
    if (parent === undefined || candidate.index.manifest.parent !== parent.index.manifest.id) {
      throw new Error(`Checkpoint lineage is broken before sequence ${sequence}.`);
    }
  }
  let latest: ResolvedCheckpoint | null = null;
  for (const candidate of candidates) {
    if (latest === null || candidate.index.manifest.sequence > latest.index.manifest.sequence) latest = candidate;
  }
  return latest;
}

async function ensureParentDirectory(directory: string): Promise<void> {
  const parent = dirname(resolve(directory));
  await mkdir(parent, { recursive: true });
  const stats = await lstat(parent);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Checkpoint release parent is not a directory: ${parent}`);
}

async function assertMissing(path: string, message: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return;
    throw error;
  }
  throw new Error(message);
}

function mergeParts(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((size, part) => size + part.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

async function downloadCheckpointInternal(input: DownloadCheckpointInput): Promise<CheckpointManifest> {
  const { resolved, releaseStore } = input;
  validateIndexConsistency(resolved.index);
  if (resolved.index.manifest.id !== resolved.release.tag_name) throw new Error("Checkpoint index id does not match release tag.");
  const target = resolve(input.directory);
  await ensureParentDirectory(target);
  await assertMissing(target, `Checkpoint restore directory already exists: ${target}`);
  const stage = `${target}.tmp-${randomUUID()}`;
  try {
    await mkdir(stage);
    await mkdir(join(stage, OBJECTS_DIRECTORY));
    for (const file of resolved.index.files) {
      const parts: Uint8Array[] = [];
      for (const part of file.parts) {
        const bytes = await releaseStore.downloadAsset(part.assetId, { byteSize: part.byteSize, checksum: part.checksum });
        if (bytes.byteLength !== part.byteSize || checksum(bytes) !== part.checksum) throw new Error(`Checkpoint release chunk verification failed: ${file.file}`);
        parts.push(bytes);
      }
      const bytes = mergeParts(parts);
      const expected = expectedChecksumForFile(resolved.index.manifest, file.file);
      if (bytes.byteLength !== expected.byteSize || checksum(bytes) !== expected.checksum) throw new Error(`Checkpoint release file verification failed: ${file.file}`);
      await writeFile(join(stage, ...assertSafeFile(file.file)), bytes, { flag: "wx" });
    }
    await writeFile(join(stage, MANIFEST_FILE), `${JSON.stringify(resolved.index.manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await verifyCheckpoint(stage);
    await assertMissing(target, `Checkpoint restore directory already exists: ${target}`);
    await rename(stage, target);
    return resolved.index.manifest;
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function downloadCheckpoint(input: DownloadCheckpointInput): Promise<CheckpointManifest> {
  return downloadCheckpointInternal(input);
}

function previousObjectParts(previous: ResolvedCheckpoint | null): Map<string, CheckpointIndexPart> {
  const result = new Map<string, CheckpointIndexPart>();
  if (previous === null) return result;
  for (const file of previous.index.files) {
    if (file.file === DATABASE_DUMP_FILE) continue;
    for (const part of file.parts) if (!result.has(part.checksum)) result.set(part.checksum, part);
  }
  return result;
}

export async function publishCheckpoint(input: PublishCheckpointInput): Promise<Release> {
  if (typeof input.validateRestore !== "function") throw new Error("validateRestore callback is required.");
  const local = await readVerifiedLocalFiles(input.directory);
  const previous = await resolveLatestCheckpoint(input.releaseStore);
  if (previous === null) {
    if (local.manifest.sequence !== 1 || local.manifest.parent !== null) throw new Error("Initial checkpoint must have sequence 1 and no parent.");
  } else {
    if (local.manifest.sequence !== previous.index.manifest.sequence + 1) throw new Error("Checkpoint sequence must immediately follow the latest published checkpoint.");
    if (local.manifest.parent !== previous.index.manifest.id) throw new Error("Checkpoint parent must match the latest published checkpoint.");
  }
  const existing = await input.releaseStore.getRelease(local.manifest.id);
  if (existing !== null) throw new Error(`Checkpoint release already exists: ${local.manifest.id}`);

  const files = new Map<string, Array<{ bytes: Uint8Array; checksum: string; byteSize: number }>>();
  for (const file of [DATABASE_DUMP_FILE, ...objectFiles(local.manifest)]) {
    const bytes = local.files.get(file)!;
    const parts = splitBytes(bytes);
    for (const part of parts) assertChunkSize(file, part.byteSize);
    files.set(file, parts);
  }
  const previousParts = previousObjectParts(previous);
  const reused = new Map<string, CheckpointIndexPart>();
  for (const file of objectFiles(local.manifest)) {
    for (const part of files.get(file)!) {
      const source = previousParts.get(part.checksum);
      if (source === undefined || reused.has(part.checksum)) continue;
      const verified = await input.releaseStore.downloadAsset(source.assetId, { byteSize: source.byteSize, checksum: source.checksum });
      if (verified.byteLength !== part.byteSize || checksum(verified) !== part.checksum) throw new Error(`Reused checkpoint chunk verification failed: ${file}`);
      reused.set(part.checksum, source);
    }
  }

  const currentAssetChecksums = new Set<string>();
  for (const part of files.get(DATABASE_DUMP_FILE)!) currentAssetChecksums.add(part.checksum);
  for (const file of objectFiles(local.manifest)) {
    for (const part of files.get(file)!) {
      if (!reused.has(part.checksum)) currentAssetChecksums.add(part.checksum);
    }
  }
  if (currentAssetChecksums.size + 1 > MAX_RELEASE_ASSETS) throw new Error(`Checkpoint release exceeds ${MAX_RELEASE_ASSETS} assets.`);

  const draft = await input.releaseStore.createDraft({ tag: local.manifest.id, targetCommitish: input.targetCommitish, body: input.body ?? `Checkpoint ${local.manifest.id}` });
  const currentAssets = new Map<string, CheckpointIndexPart>();
    for (const part of files.get(DATABASE_DUMP_FILE)!) {
      let uploaded = currentAssets.get(part.checksum);
      if (uploaded === undefined) {
        const asset = await input.releaseStore.uploadAsset(draft.id, { name: chunkAssetName(part.checksum), bytes: part.bytes, contentType: "application/octet-stream" });
        uploaded = { assetId: asset.id, checksum: part.checksum, byteSize: part.byteSize };
        currentAssets.set(part.checksum, uploaded);
      }
    }
    const indexFiles: CheckpointIndexFile[] = [{ file: DATABASE_DUMP_FILE, parts: files.get(DATABASE_DUMP_FILE)!.map((part) => currentAssets.get(part.checksum)!) }];
    for (const file of objectFiles(local.manifest)) {
      const parts: CheckpointIndexPart[] = [];
      for (const part of files.get(file)!) {
        const source = reused.get(part.checksum);
        if (source !== undefined) {
          parts.push(source);
          continue;
        }
        let uploaded = currentAssets.get(part.checksum);
        if (uploaded === undefined) {
          const asset = await input.releaseStore.uploadAsset(draft.id, { name: chunkAssetName(part.checksum), bytes: part.bytes, contentType: "application/octet-stream" });
          uploaded = { assetId: asset.id, checksum: part.checksum, byteSize: part.byteSize };
          currentAssets.set(part.checksum, uploaded);
        }
        parts.push(uploaded);
      }
      indexFiles.push({ file, parts });
    }

    const index = CheckpointIndexSchema.parse({ checkpointIndexSchemaVersion: CHECKPOINT_INDEX_SCHEMA_VERSION, manifest: local.manifest, files: indexFiles });
    validateIndexConsistency(index);
    await input.releaseStore.uploadAsset(draft.id, { name: indexAssetName(index), bytes: indexBytes(index), contentType: "application/json" });
    const verifiedIndex = await readIndexFromRelease(input.releaseStore, draft, await input.releaseStore.listAssets(draft.id));

    const temporaryRoot = await mkdtemp(join(tmpdir(), "riftversus-checkpoint-release-"));
    try {
      await downloadCheckpoint({ resolved: { release: draft, index: verifiedIndex, assets: [] }, releaseStore: input.releaseStore, directory: join(temporaryRoot, "candidate") });
      await input.validateRestore(join(temporaryRoot, "candidate"));
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  return await input.releaseStore.publishDraft(draft.id);
}
