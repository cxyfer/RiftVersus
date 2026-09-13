import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import JSZip from "jszip";
import { z } from "zod";

import { CheckpointManifestSchema, verifyCheckpoint, type CheckpointManifest } from "./checkpoint.js";
import { readBoundedZipEntry, type BoundedZipBudget, type BoundedZipEntry } from "./bounded-zip.js";
import type { Release, ReleaseAsset, ReleaseStore } from "./release-store.js";

const MANIFEST_FILE = "manifest.json";
const DATABASE_DUMP_FILE = "database.dump";
const ATTEMPT_ID = /^attempt-[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_FILE = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ZIP_ASSET = /^attempt-bundle-([a-f0-9]{64})\.zip$/u;
const INDEX_ASSET = /^attempt-index-([a-f0-9]{64})\.json$/u;
const MAX_ATTEMPT_FILES = 10_000;
export const MAX_ATTEMPT_INDEX_BYTES = 2 * 1024 * 1024;
export const MAX_ATTEMPT_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
export const MAX_ATTEMPT_ZIP_BYTES = 256 * 1024 * 1024;

const AttemptFileSchema = z.object({
  file: z.string().regex(SAFE_FILE),
  checksum: z.string().regex(SHA256),
  byteSize: z.number().int().nonnegative().safe(),
}).strict();

export const AttemptIndexSchema = z.object({
  attemptId: z.string().regex(ATTEMPT_ID),
  baselineCheckpointId: z.string().min(1).nullable(),
  codeSha: z.string().regex(SAFE_VALUE),
  failedStage: z.string().regex(SAFE_VALUE),
  checkpointManifestId: z.string().regex(SAFE_VALUE),
  zip: z.object({
    checksum: z.string().regex(SHA256),
    byteSize: z.number().int().positive().safe(),
  }).strict(),
  files: z.array(AttemptFileSchema).min(1).max(MAX_ATTEMPT_FILES),
}).strict().superRefine((index, context) => {
  if (index.zip.byteSize > MAX_ATTEMPT_ZIP_BYTES) {
    context.addIssue({ code: "custom", message: `Attempt archive ZIP exceeds ${MAX_ATTEMPT_ZIP_BYTES} bytes.`, path: ["zip", "byteSize"] });
  }
  let total = 0;
  for (const file of index.files) {
    total += file.byteSize;
    if (!Number.isSafeInteger(total) || total > MAX_ATTEMPT_UNCOMPRESSED_BYTES) {
      context.addIssue({ code: "custom", message: `Attempt archive exceeds ${MAX_ATTEMPT_UNCOMPRESSED_BYTES} uncompressed bytes.`, path: ["files"] });
      break;
    }
  }
});

export type AttemptFile = z.infer<typeof AttemptFileSchema>;
export type AttemptIndex = z.infer<typeof AttemptIndexSchema>;

export interface AttemptBundle {
  bytes: Uint8Array;
  index: AttemptIndex;
}

export interface BuildAttemptBundleInput {
  directory: string;
  attemptId: string;
  baselineCheckpointId: string | null;
  codeSha: string;
  failedStage: string;
}

export interface PublishAttemptInput extends BuildAttemptBundleInput {
  releaseStore: ReleaseStore;
  targetCommitish: string;
  body?: string;
}

export interface ResolvedAttempt {
  release: Release;
  index: AttemptIndex;
  assets: readonly ReleaseAsset[];
}

export interface DownloadedAttempt {
  release: Release;
  index: AttemptIndex;
  bytes: Uint8Array;
}

interface VerifiedLocalFiles {
  manifest: CheckpointManifest;
  files: Map<string, Uint8Array>;
}

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function assertAttemptId(attemptId: string): void {
  if (!ATTEMPT_ID.test(attemptId)) throw new Error("attemptId must have the form attempt-<run-id>-<run-attempt>.");
}

function assertSafeValue(value: string, label: string): void {
  if (!SAFE_VALUE.test(value)) throw new Error(`${label} must be a safe non-empty ASCII value.`);
}

function assertSafeFile(file: string): readonly string[] {
  if (!SAFE_FILE.test(file)) throw new Error(`Attempt archive path is unsafe: ${file}`);
  const segments = file.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) throw new Error(`Attempt archive path is unsafe: ${file}`);
  return segments;
}

function assertRegularFile(path: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (stats.isSymbolicLink()) throw new Error(`Attempt archive file is a symlink: ${path}`);
  if (!stats.isFile()) throw new Error(`Attempt archive path is not a regular file: ${path}`);
  if (stats.nlink !== 1) throw new Error(`Attempt archive file is hard-linked: ${path}`);
}

function objectFiles(manifest: CheckpointManifest): string[] {
  return [...new Set(manifest.objects.map((object) => object.file))];
}

function expectedFiles(manifest: CheckpointManifest): string[] {
  return [MANIFEST_FILE, DATABASE_DUMP_FILE, ...objectFiles(manifest)];
}

function expectedFileMetadata(manifest: CheckpointManifest, file: string): { checksum: string; byteSize: number } | null {
  if (file === DATABASE_DUMP_FILE) return { checksum: manifest.databaseDump.checksum, byteSize: manifest.databaseDump.byteSize };
  const object = manifest.objects.find((candidate) => candidate.file === file);
  return object === undefined ? null : { checksum: object.checksum, byteSize: object.byteSize };
}

async function collectLocalFiles(directory: string): Promise<Set<string>> {
  const files = new Set<string>();
  async function visit(current: string, relativeDirectory: string): Promise<void> {
    for (const name of await readdir(current)) {
      const relativePath = relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
      assertSafeFile(relativePath);
      const path = join(current, name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) throw new Error(`Attempt archive path is a symlink: ${path}`);
      if (stats.isDirectory()) {
        await visit(path, relativePath);
      } else {
        assertRegularFile(path, stats);
        files.add(relativePath);
      }
    }
  }
  await visit(resolve(directory), "");
  return files;
}

async function preflightLocalCheckpoint(directory: string): Promise<void> {
  const root = resolve(directory);
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink()) throw new Error(`Attempt archive source is a symlink: ${root}`);
  if (!rootStats.isDirectory()) throw new Error(`Attempt archive source is not a directory: ${root}`);
  let entries = 0;
  let files = 0;
  let totalBytes = 0;
  async function visit(current: string, relativeDirectory: string): Promise<void> {
    for (const name of await readdir(current)) {
      entries += 1;
      if (entries > MAX_ATTEMPT_FILES * 2) throw new Error(`Attempt archive exceeds ${MAX_ATTEMPT_FILES * 2} filesystem entries.`);
      const relativePath = relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
      assertSafeFile(relativePath);
      const path = join(current, name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) throw new Error(`Attempt archive source is a symlink: ${path}`);
      if (stats.isDirectory()) {
        await visit(path, relativePath);
        continue;
      }
      assertRegularFile(path, stats);
      files += 1;
      if (files > MAX_ATTEMPT_FILES) throw new Error(`Attempt archive exceeds ${MAX_ATTEMPT_FILES} files.`);
      if (!Number.isSafeInteger(stats.size) || stats.size < 0) throw new Error(`Attempt archive file size is invalid: ${relativePath}`);
      totalBytes += stats.size;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_ATTEMPT_UNCOMPRESSED_BYTES) {
        throw new Error(`Attempt archive exceeds ${MAX_ATTEMPT_UNCOMPRESSED_BYTES} uncompressed bytes.`);
      }
    }
  }
  await visit(root, "");
}

async function readLocalFile(directory: string, file: string, expectedChecksum: string | null, expectedByteSize?: number): Promise<Uint8Array> {
  const path = join(resolve(directory), ...assertSafeFile(file));
  const stats = await lstat(path);
  assertRegularFile(path, stats);
  const bytes = new Uint8Array(await readFile(path));
  if (expectedByteSize !== undefined && (stats.size !== expectedByteSize || bytes.byteLength !== expectedByteSize)) {
    throw new Error(`Attempt archive byte size mismatch: ${file}`);
  }
  if (expectedChecksum !== null && checksum(bytes) !== expectedChecksum) throw new Error(`Attempt archive checksum mismatch: ${file}`);
  return bytes;
}

async function readVerifiedLocalFiles(directory: string): Promise<VerifiedLocalFiles> {
  await preflightLocalCheckpoint(directory);
  const manifest = await verifyCheckpoint(directory);
  const root = resolve(directory);
  const actualFiles = await collectLocalFiles(root);
  const expected = new Set(expectedFiles(manifest));
  for (const file of actualFiles) if (!expected.has(file)) throw new Error(`Attempt archive contains an unexpected file: ${file}`);
  for (const file of expected) if (!actualFiles.has(file)) throw new Error(`Attempt archive is missing file: ${file}`);

  const manifestBytes = await readLocalFile(root, MANIFEST_FILE, null);
  const parsed = CheckpointManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
  if (parsed.id !== manifest.id) throw new Error("Attempt archive checkpoint manifest changed while reading.");
  const files = new Map<string, Uint8Array>([[MANIFEST_FILE, manifestBytes]]);
  for (const file of [DATABASE_DUMP_FILE, ...objectFiles(manifest)]) {
    const metadata = expectedFileMetadata(manifest, file);
    if (metadata === null) throw new Error(`Attempt archive file is not listed in checkpoint manifest: ${file}`);
    files.set(file, await readLocalFile(root, file, metadata.checksum, metadata.byteSize));
  }
  return { manifest, files };
}

function validateIndexConsistency(index: AttemptIndex): void {
  assertAttemptId(index.attemptId);
  if (index.baselineCheckpointId !== null) assertSafeValue(index.baselineCheckpointId, "baselineCheckpointId");
  assertSafeValue(index.codeSha, "codeSha");
  assertSafeValue(index.failedStage, "failedStage");
  assertSafeValue(index.checkpointManifestId, "checkpointManifestId");
  if (index.zip.byteSize > MAX_ATTEMPT_ZIP_BYTES) throw new Error(`Attempt archive ZIP exceeds ${MAX_ATTEMPT_ZIP_BYTES} bytes.`);
  const seen = new Set<string>();
  let total = 0;
  for (const entry of index.files) {
    assertSafeFile(entry.file);
    if (seen.has(entry.file)) throw new Error(`Attempt index contains duplicate file: ${entry.file}`);
    seen.add(entry.file);
    total += entry.byteSize;
    if (!Number.isSafeInteger(total) || total > MAX_ATTEMPT_UNCOMPRESSED_BYTES) throw new Error("Attempt archive exceeds the uncompressed size limit.");
  }
  if (seen.size !== index.files.length) throw new Error("Attempt index contains duplicate files.");
}

function parseIndex(bytes: Uint8Array): AttemptIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error("Attempt index is not valid JSON.", { cause: error });
  }
  const index = AttemptIndexSchema.parse(parsed);
  if (!bytesEqual(bytes, jsonBytes(index))) throw new Error("Attempt index is not canonical JSON.");
  validateIndexConsistency(index);
  return index;
}

function indexBytes(index: AttemptIndex): Uint8Array {
  return jsonBytes(index);
}

function zipAssetName(index: AttemptIndex): string {
  return `attempt-bundle-${index.zip.checksum}.zip`;
}

function indexAssetName(index: AttemptIndex): string {
  return `attempt-index-${checksum(indexBytes(index))}.json`;
}

interface RemoteAttemptIndex {
  index: AttemptIndex;
  zipAsset: ReleaseAsset;
}

async function readRemoteAttemptIndex(releaseStore: ReleaseStore, release: Release, assets: readonly ReleaseAsset[]): Promise<RemoteAttemptIndex> {
  if (assets.length !== 2) throw new Error(`Attempt release must contain exactly two assets: ${release.tag_name}`);
  const zipAssets = assets.filter((asset) => ZIP_ASSET.test(asset.name));
  const indexAssets = assets.filter((asset) => INDEX_ASSET.test(asset.name));
  if (zipAssets.length !== 1 || indexAssets.length !== 1) throw new Error(`Attempt release assets are invalid: ${release.tag_name}`);
  const indexAsset = indexAssets[0]!;
  if (indexAsset.size > MAX_ATTEMPT_INDEX_BYTES) throw new Error(`Attempt index exceeds ${MAX_ATTEMPT_INDEX_BYTES} bytes.`);
  const indexChecksum = INDEX_ASSET.exec(indexAsset.name)![1]!;
  const indexRaw = await releaseStore.downloadAsset(indexAsset.id, { byteSize: indexAsset.size, checksum: indexChecksum });
  if (indexRaw.byteLength > MAX_ATTEMPT_INDEX_BYTES) throw new Error(`Attempt index exceeds ${MAX_ATTEMPT_INDEX_BYTES} bytes.`);
  const index = parseIndex(indexRaw);
  if (index.attemptId !== release.tag_name) throw new Error(`Attempt index ID does not match release tag: ${release.tag_name}`);
  if (indexAsset.size !== indexRaw.byteLength || checksum(indexRaw) !== indexChecksum) throw new Error("Attempt index checksum mismatch.");
  const zipAsset = zipAssets[0]!;
  if (zipAsset.size > MAX_ATTEMPT_ZIP_BYTES) throw new Error(`Attempt archive ZIP exceeds ${MAX_ATTEMPT_ZIP_BYTES} bytes.`);
  const zipChecksum = ZIP_ASSET.exec(zipAsset.name)![1]!;
  if (zipChecksum !== index.zip.checksum || zipAsset.size !== index.zip.byteSize) throw new Error("Attempt release ZIP metadata mismatch.");
  return { index, zipAsset };
}

function expectedIndexFiles(manifest: CheckpointManifest): Map<string, { checksum: string; byteSize: number }> {
  const expected = new Map<string, { checksum: string; byteSize: number }>();
  for (const file of expectedFiles(manifest)) {
    const metadata = file === MANIFEST_FILE ? null : expectedFileMetadata(manifest, file);
    if (file !== MANIFEST_FILE && metadata === null) throw new Error(`Attempt checkpoint file is not indexed: ${file}`);
    expected.set(file, metadata ?? { checksum: "", byteSize: 0 });
  }
  return expected;
}

async function inspectZip(bytes: Uint8Array, index: AttemptIndex): Promise<Map<string, Uint8Array>> {
  if (bytes.byteLength !== index.zip.byteSize || checksum(bytes) !== index.zip.checksum) throw new Error("Attempt archive ZIP checksum or size mismatch.");
  if (bytes.byteLength > MAX_ATTEMPT_ZIP_BYTES) throw new Error(`Attempt archive ZIP exceeds ${MAX_ATTEMPT_ZIP_BYTES} bytes.`);
  validateIndexConsistency(index);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    throw new Error("Attempt archive ZIP is invalid.", { cause: error });
  }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ATTEMPT_FILES) throw new Error(`Attempt archive exceeds ${MAX_ATTEMPT_FILES} files.`);
  const indexed = new Map(index.files.map((entry) => [entry.file, entry]));
  const files = new Map<string, Uint8Array>();
  const budget: BoundedZipBudget = { used: 0, limit: MAX_ATTEMPT_UNCOMPRESSED_BYTES };
  for (const entry of entries) {
    if (entry.dir) throw new Error(`Attempt archive contains a directory entry: ${entry.name}`);
    const unsafeOriginalName = (entry as unknown as { unsafeOriginalName?: unknown }).unsafeOriginalName;
    if (typeof unsafeOriginalName === "string" && unsafeOriginalName !== entry.name) throw new Error(`Attempt archive ZIP path is unsafe: ${unsafeOriginalName}`);
    assertSafeFile(entry.name);
    const unixPermissions = (entry as unknown as { unixPermissions?: unknown }).unixPermissions;
    if (typeof unixPermissions === "number" && (unixPermissions & 0o170000) === 0o120000) throw new Error(`Attempt archive ZIP entry is a symlink: ${entry.name}`);
    if (files.has(entry.name)) throw new Error(`Attempt archive contains a duplicate file: ${entry.name}`);
    const expected = indexed.get(entry.name);
    if (expected === undefined) throw new Error(`Attempt archive ZIP contains an unindexed file: ${entry.name}`);
    const fileBytes = await readBoundedZipEntry(entry as unknown as BoundedZipEntry, expected, budget, entry.name);
    files.set(entry.name, fileBytes);
  }
  if (files.size !== indexed.size) throw new Error("Attempt archive ZIP does not contain exactly the indexed files.");
  const manifestBytes = files.get(MANIFEST_FILE);
  if (manifestBytes === undefined) throw new Error("Attempt archive ZIP is missing manifest.json.");
  let checkpointManifest: CheckpointManifest;
  try {
    checkpointManifest = CheckpointManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
  } catch (error) {
    throw new Error("Attempt archive checkpoint manifest is invalid.", { cause: error });
  }
  if (checkpointManifest.id !== index.checkpointManifestId) throw new Error("Attempt archive checkpoint manifest ID does not match the index.");
  const expectedFilesForManifest = expectedIndexFiles(checkpointManifest);
  if (expectedFilesForManifest.size !== indexed.size || [...expectedFilesForManifest.keys()].some((file) => !indexed.has(file))) {
    throw new Error("Attempt archive ZIP does not contain exactly the checkpoint files.");
  }
  const manifestMetadata = indexed.get(MANIFEST_FILE)!;
  if (manifestMetadata.checksum !== checksum(manifestBytes) || manifestMetadata.byteSize !== manifestBytes.byteLength) throw new Error("Attempt archive manifest checksum mismatch.");
  for (const [file, expected] of expectedFilesForManifest) {
    if (file === MANIFEST_FILE) continue;
    const indexedMetadata = indexed.get(file)!;
    if (indexedMetadata.checksum !== expected.checksum || indexedMetadata.byteSize !== expected.byteSize) {
      throw new Error(`Attempt archive checkpoint metadata mismatch: ${file}`);
    }
  }
  return files;
}

async function buildAttemptBundleInternal(input: BuildAttemptBundleInput): Promise<AttemptBundle> {
  assertAttemptId(input.attemptId);
  if (input.baselineCheckpointId !== null) assertSafeValue(input.baselineCheckpointId, "baselineCheckpointId");
  assertSafeValue(input.codeSha, "codeSha");
  assertSafeValue(input.failedStage, "failedStage");
  const local = await readVerifiedLocalFiles(input.directory);
  const files = [...local.files.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (files.length > MAX_ATTEMPT_FILES) throw new Error(`Attempt archive exceeds ${MAX_ATTEMPT_FILES} files.`);
  const totalBytes = files.reduce((total, [, value]) => total + value.byteLength, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_ATTEMPT_UNCOMPRESSED_BYTES) throw new Error(`Attempt archive exceeds ${MAX_ATTEMPT_UNCOMPRESSED_BYTES} uncompressed bytes.`);
  const zip = new JSZip();
  for (const [file, value] of files) zip.file(file, value, { createFolders: false, date: new Date(0) });
  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (zipBytes.byteLength > MAX_ATTEMPT_ZIP_BYTES) throw new Error(`Attempt archive ZIP exceeds ${MAX_ATTEMPT_ZIP_BYTES} bytes.`);
  const index = AttemptIndexSchema.parse({
    attemptId: input.attemptId,
    baselineCheckpointId: input.baselineCheckpointId,
    codeSha: input.codeSha,
    failedStage: input.failedStage,
    checkpointManifestId: local.manifest.id,
    zip: { checksum: checksum(zipBytes), byteSize: zipBytes.byteLength },
    files: files.map(([file, value]) => ({ file, checksum: checksum(value), byteSize: value.byteLength })),
  });
  validateIndexConsistency(index);
  await inspectZip(zipBytes, index);
  return { bytes: zipBytes, index };
}

export function buildAttemptBundle(input: BuildAttemptBundleInput): Promise<AttemptBundle> {
  return buildAttemptBundleInternal(input);
}

async function readRemoteAttempt(releaseStore: ReleaseStore, release: Release, assets: readonly ReleaseAsset[]): Promise<DownloadedAttempt> {
  const remote = await readRemoteAttemptIndex(releaseStore, release, assets);
  const zipBytes = await releaseStore.downloadAsset(remote.zipAsset.id, { byteSize: remote.index.zip.byteSize, checksum: remote.index.zip.checksum });
  await inspectZip(zipBytes, remote.index);
  return { release, index: remote.index, bytes: zipBytes };
}

export async function publishAttempt(input: PublishAttemptInput): Promise<Release> {
  const bundle = await buildAttemptBundle(input);
  const existing = await input.releaseStore.getRelease(bundle.index.attemptId);
  if (existing !== null) throw new Error(`Attempt release already exists: ${bundle.index.attemptId}`);
  const draft = await input.releaseStore.createDraft({
    tag: bundle.index.attemptId,
    targetCommitish: input.targetCommitish,
    body: input.body ?? `Failed staging attempt ${bundle.index.attemptId}`,
  });
  await input.releaseStore.uploadAsset(draft.id, { name: zipAssetName(bundle.index), bytes: bundle.bytes, contentType: "application/zip" });
  const metadata = indexBytes(bundle.index);
  await input.releaseStore.uploadAsset(draft.id, { name: indexAssetName(bundle.index), bytes: metadata, contentType: "application/json" });
  await readRemoteAttempt(input.releaseStore, draft, await input.releaseStore.listAssets(draft.id));
  return input.releaseStore.publishDraft(draft.id);
}

export async function resolveAttempt(releaseStore: ReleaseStore, tag: string): Promise<ResolvedAttempt | null> {
  assertAttemptId(tag);
  const release = await releaseStore.getRelease(tag);
  if (release === null) return null;
  if (release.draft) return null;
  const assets = await releaseStore.listAssets(release.id);
  const remote = await readRemoteAttempt(releaseStore, release, assets);
  return { release, index: remote.index, assets };
}

export async function listVerifiedAttempts(releaseStore: ReleaseStore): Promise<ResolvedAttempt[]> {
  const attempts: ResolvedAttempt[] = [];
  for (const release of await releaseStore.listReleases()) {
    if (release.draft || !release.tag_name.startsWith("attempt-")) continue;
    const assets = await releaseStore.listAssets(release.id);
    const remote = await readRemoteAttempt(releaseStore, release, assets);
    attempts.push({ release, index: remote.index, assets });
  }
  return attempts;
}

/** Read only verified index metadata for one baseline; forensic ZIP bytes are not downloaded. */
export async function listAttemptSummaries(releaseStore: ReleaseStore, baselineCheckpointId: string | null): Promise<AttemptIndex[]> {
  if (baselineCheckpointId !== null) assertSafeValue(baselineCheckpointId, "baselineCheckpointId");
  const summaries: AttemptIndex[] = [];
  for (const release of await releaseStore.listReleases()) {
    if (release.draft || !release.tag_name.startsWith("attempt-")) continue;
    const assets = await releaseStore.listAssets(release.id);
    const remote = await readRemoteAttemptIndex(releaseStore, release, assets);
    if (remote.index.baselineCheckpointId !== baselineCheckpointId) continue;
    summaries.push(remote.index);
  }
  return summaries;
}

export async function downloadAttempt(releaseStore: ReleaseStore, tag: string): Promise<DownloadedAttempt | null> {
  const resolved = await resolveAttempt(releaseStore, tag);
  if (resolved === null) return null;
  return readRemoteAttempt(releaseStore, resolved.release, resolved.assets);
}
