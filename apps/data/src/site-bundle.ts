import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { SnapshotIdSchema, SqliteManifestSchema, type PublicSnapshot } from "@riftversus/contracts";
import JSZip from "jszip";
import { z } from "zod";

import { verifyPublicSnapshot } from "./export-snapshot.js";
import { readBoundedZipEntry, type BoundedZipBudget, type BoundedZipEntry } from "./bounded-zip.js";
import type { Release, ReleaseAsset, ReleaseStore } from "./release-store.js";

const SITE_BUNDLE_SCHEMA_VERSION = 1;
const SITE_MANIFEST_SCHEMA_VERSION = 1;
const SITE_MANIFEST_FILE = "site-manifest.json";
const MAX_SITE_FILES = 10_000;
export const MAX_SITE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
export const MAX_SITE_ZIP_BYTES = 256 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const SITE_ID = /^site-[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const DATA_FILE = /^data\/([a-f0-9]{64})\/database\.sqlite$/u;
const PRESENTATION_FILE = /^presentation\/([a-f0-9]{64})\.(svg|png|jpg|webp|gif)$/u;
const ASSET_FILE = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|mjs|css|wasm|woff|woff2|ttf|otf|eot)$/u;
const ZIP_ASSET = /^site-bundle-([a-f0-9]{64})\.zip$/u;
const MANIFEST_ASSET = /^site-manifest-([a-f0-9]{64})\.json$/u;
const SITE_FILE = z.object({
  file: z.string().min(1),
  checksum: z.string().regex(SHA256),
  byteSize: z.number().int().nonnegative().safe(),
}).strict();

export const SiteManifestSchema = z.object({
  siteManifestSchemaVersion: z.literal(SITE_MANIFEST_SCHEMA_VERSION),
  siteId: z.string().regex(SITE_ID),
  codeSha: z.string().min(1),
  checkpointId: z.string().min(1),
  snapshotId: SnapshotIdSchema,
  // Only this deployment's immutable files. Retained files are intentionally omitted.
  immutableFiles: z.array(z.string().min(1)).min(1).max(MAX_SITE_FILES),
  immutableFileChecksums: z.array(SITE_FILE).min(1).max(MAX_SITE_FILES),
}).strict();

export const SiteBundleManifestSchema = z.object({
  siteBundleSchemaVersion: z.literal(SITE_BUNDLE_SCHEMA_VERSION),
  siteId: z.string().regex(SITE_ID),
  codeSha: z.string().min(1),
  checkpointId: z.string().min(1),
  snapshotId: SnapshotIdSchema,
  zip: z.object({
    checksum: z.string().regex(SHA256),
    byteSize: z.number().int().positive().safe(),
  }).strict(),
  files: z.array(SITE_FILE).min(1).max(MAX_SITE_FILES),
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.files.map((file) => file.file)).size !== manifest.files.length) {
    context.addIssue({ code: "custom", message: "Site bundle files must be unique.", path: ["files"] });
  }
});

export type SiteManifest = z.infer<typeof SiteManifestSchema>;
export type SiteBundleFile = z.infer<typeof SITE_FILE>;
export type SiteBundleManifest = z.infer<typeof SiteBundleManifestSchema>;

export interface SiteBundle {
  bytes: Uint8Array;
  manifest: SiteBundleManifest;
}

export interface BuildSiteBundleInput {
  directory: string;
  siteId: string;
  codeSha: string;
  checkpointId: string;
  snapshotId: string;
  immutableFiles?: readonly string[];
}

export interface PublishSiteBundleInput {
  bundle: SiteBundle;
  releaseStore: ReleaseStore;
  targetCommitish: string;
  body?: string;
}

export interface DownloadSiteBundleInput {
  tag: string;
  releaseStore: ReleaseStore;
  directory: string;
}

interface SiteFileMap {
  files: Map<string, Uint8Array>;
}

interface RemoteSiteBundle {
  release: Release;
  manifest: SiteBundleManifest;
  zipBytes: Uint8Array;
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

function assertSiteId(siteId: string): void {
  if (!SITE_ID.test(siteId)) throw new Error("siteId must start with site- and contain only safe ASCII characters.");
}

function assertSafePath(file: string): void {
  if (typeof file !== "string" || file.length === 0 || file.includes("\\") || file.startsWith("/")) {
    throw new Error(`Site bundle path is unsafe: ${file}`);
  }
  const segments = file.split("/");
  if (segments.some((segment) => !SAFE_SEGMENT.test(segment) || segment === "." || segment === "..")) {
    throw new Error(`Site bundle path is unsafe: ${file}`);
  }
}

function assertAllowedPath(file: string, generatedManifest = true): void {
  assertSafePath(file);
  if (file === SITE_MANIFEST_FILE) {
    if (!generatedManifest) throw new Error("Source site-manifest.json is reserved for generated metadata.");
    return;
  }
  if (file === "index.html" || file === "404.html" || file === "media-placeholder.svg" || file === "data/manifest.json") return;
  if (ASSET_FILE.test(file) || DATA_FILE.test(file) || PRESENTATION_FILE.test(file)) return;
  throw new Error(`Site bundle contains an unexpected file: ${file}`);
}

function assertAllowedDirectory(directory: string): void {
  assertSafePath(directory);
  if (directory === "assets" || directory === "data" || directory === "presentation" || /^data\/[a-f0-9]{64}$/u.test(directory)) return;
  throw new Error(`Site bundle contains an unexpected directory: ${directory}`);
}

function assertRegularFile(path: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (stats.isSymbolicLink()) throw new Error(`Site bundle file is a symlink: ${path}`);
  if (!stats.isFile()) throw new Error(`Site bundle path is not a regular file: ${path}`);
  if (stats.nlink !== 1) throw new Error(`Site bundle file is hard-linked: ${path}`);
}

async function collectSourceFiles(directory: string, allowSiteManifest = false): Promise<SiteFileMap> {
  const root = resolve(directory);
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error(`Site bundle source is not a directory: ${root}`);
  const files = new Map<string, Uint8Array>();
  let totalBytes = 0;

  async function visit(current: string, relativeDirectory: string): Promise<void> {
    for (const name of await readdir(current)) {
      const relativePath = relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
      const path = join(current, name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) throw new Error(`Site bundle path is a symlink: ${path}`);
      if (stats.isDirectory()) {
        assertAllowedDirectory(relativePath);
        await visit(path, relativePath);
        continue;
      }
      assertAllowedPath(relativePath, allowSiteManifest);
      assertRegularFile(path, stats);
      const bytes = new Uint8Array(await readFile(path));
      if (bytes.byteLength !== stats.size) throw new Error(`Site bundle file changed while reading: ${relativePath}`);
      if (files.size >= MAX_SITE_FILES) throw new Error(`Site bundle exceeds ${MAX_SITE_FILES} files.`);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_SITE_UNCOMPRESSED_BYTES) throw new Error(`Site bundle exceeds ${MAX_SITE_UNCOMPRESSED_BYTES} uncompressed bytes.`);
      files.set(relativePath, bytes);
    }
  }

  await visit(root, "");
  if (!files.has("index.html")) throw new Error("Site bundle is missing index.html.");
  if (!files.has("data/manifest.json")) throw new Error("Site bundle is missing data/manifest.json.");
  if (![...files.keys()].some((file) => DATA_FILE.test(file))) throw new Error("Site bundle is missing a SQLite database.");
  return { files };
}

function presentationPath(mediaUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(mediaUrl, "https://riftversus.invalid");
  } catch (error) {
    throw new Error(`Snapshot media URL is invalid: ${mediaUrl}`, { cause: error });
  }
  if (parsed.origin !== "https://riftversus.invalid" || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`Snapshot media URL must be same-origin: ${mediaUrl}`);
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const presentationIndex = segments.lastIndexOf("presentation");
  if (presentationIndex < 0 || presentationIndex !== segments.length - 2) throw new Error(`Snapshot media URL is not a presentation asset: ${mediaUrl}`);
  const file = `presentation/${segments[presentationIndex + 1]!}`;
  if (!PRESENTATION_FILE.test(file)) throw new Error(`Snapshot media path is invalid: ${file}`);
  return file;
}

async function validateSnapshotMedia(snapshot: PublicSnapshot, files: Map<string, Uint8Array>): Promise<void> {
  for (const [file, bytes] of files) {
    const match = file.match(PRESENTATION_FILE);
    if (match !== null && checksum(bytes) !== match[1]) throw new Error(`Presentation asset checksum mismatch: ${file}`);
    const databaseMatch = file.match(DATA_FILE);
    if (databaseMatch !== null && checksum(bytes) !== databaseMatch[1]) throw new Error(`SQLite database checksum mismatch: ${file}`);
  }
  for (const entity of snapshot.entities) {
    const file = presentationPath(entity.mediaUrl);
    const bytes = files.get(file);
    if (bytes === undefined) throw new Error(`Snapshot references missing presentation asset: ${file}`);
    const expectedChecksum = file.match(PRESENTATION_FILE)?.[1];
    if (expectedChecksum === undefined || checksum(bytes) !== expectedChecksum) throw new Error(`Presentation asset checksum mismatch: ${file}`);
  }
}

async function verifyPublicDirectory(directory: string, snapshotId: string, files?: Map<string, Uint8Array>): Promise<PublicSnapshot> {
  const snapshot = await verifyPublicSnapshot(directory);
  if (snapshot.snapshotId !== snapshotId) throw new Error(`Public snapshot ID mismatch: expected ${snapshotId}, got ${snapshot.snapshotId}.`);
  const actualFiles = files ?? (await collectSourceFiles(directory)).files;
  await validateSnapshotMedia(snapshot, actualFiles);
  return snapshot;
}

function databaseFileFromManifest(files: Map<string, Uint8Array>): string {
  const raw = files.get("data/manifest.json");
  if (raw === undefined) throw new Error("Site bundle is missing data/manifest.json.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch (error) {
    throw new Error("SQLite snapshot manifest is not valid JSON.", { cause: error });
  }
  const manifest = SqliteManifestSchema.parse(parsed);
  return `data/${manifest.database.file}`;
}

function snapshotPresentationFiles(snapshot: PublicSnapshot): string[] {
  return [...new Set(snapshot.entities.map((entity) => presentationPath(entity.mediaUrl)))].sort();
}

function assertImmutableFile(file: string): void {
  if (!isImmutableSiteFile(file)) throw new Error(`Site manifest contains a non-immutable file: ${file}`);
}

function validateImmutableInventory(manifest: SiteManifest, snapshot: PublicSnapshot, files: Map<string, Uint8Array>): void {
  const inventory = [...manifest.immutableFiles];
  if (new Set(inventory).size !== inventory.length) throw new Error("Site manifest immutable files must be unique.");
  if (inventory.some((file, index) => index > 0 && inventory[index - 1]! >= file)) throw new Error("Site manifest immutable files must be sorted.");
  const checksums = [...manifest.immutableFileChecksums];
  if (checksums.length !== inventory.length || checksums.some((entry, index) => entry.file !== inventory[index])) {
    throw new Error("Site manifest immutable file checksums must match its inventory.");
  }
  for (const file of inventory) {
    assertAllowedPath(file);
    assertImmutableFile(file);
    const bytes = files.get(file);
    if (bytes === undefined) throw new Error(`Site manifest references missing immutable file: ${file}`);
    const entry = checksums.find((candidate) => candidate.file === file);
    if (entry === undefined || entry.byteSize !== bytes.byteLength || entry.checksum !== checksum(bytes)) {
      throw new Error(`Site manifest immutable file checksum mismatch: ${file}`);
    }
  }
  const expected = [databaseFileFromManifest(files), ...snapshotPresentationFiles(snapshot)];
  for (const file of expected) if (!inventory.includes(file)) throw new Error(`Site manifest omits current immutable file: ${file}`);
}

function deriveImmutableInventory(snapshot: PublicSnapshot, files: Map<string, Uint8Array>, requested?: readonly string[]): string[] {
  const inventory = requested === undefined
    ? [databaseFileFromManifest(files), ...snapshotPresentationFiles(snapshot), ...[...files.keys()].filter((file) => ASSET_FILE.test(file))]
    : [...requested];
  const normalized = [...new Set(inventory)].sort();
  const manifest: SiteManifest = {
    siteManifestSchemaVersion: SITE_MANIFEST_SCHEMA_VERSION,
    siteId: "site-inventory-placeholder",
    codeSha: "inventory",
    checkpointId: "inventory",
    snapshotId: snapshot.snapshotId,
    immutableFiles: normalized,
    immutableFileChecksums: normalized.map((file) => {
      const bytes = files.get(file);
      if (bytes === undefined) throw new Error(`Site manifest references missing immutable file: ${file}`);
      return { file, checksum: checksum(bytes), byteSize: bytes.byteLength };
    }),
  };
  validateImmutableInventory(manifest, snapshot, files);
  return normalized;
}

export async function getSiteImmutableFiles(directory: string): Promise<string[]> {
  const root = resolve(directory);
  const snapshot = await verifyPublicSnapshot(root);
  const files = (await collectSourceFiles(root)).files;
  return deriveImmutableInventory(snapshot, files);
}

async function readVerifiedSiteManifest(directory: string, files: Map<string, Uint8Array>): Promise<SiteManifest> {
  const raw = files.get(SITE_MANIFEST_FILE);
  if (raw === undefined) throw new Error("Previous site is missing site-manifest.json.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch (error) {
    throw new Error("site-manifest.json is not valid JSON.", { cause: error });
  }
  const manifest = SiteManifestSchema.parse(parsed);
  if (!bytesEqual(raw, jsonBytes(manifest))) throw new Error("site-manifest.json is not canonical JSON.");
  return manifest;
}

function isImmutableSiteFile(file: string): boolean {
  return DATA_FILE.test(file) || PRESENTATION_FILE.test(file) || ASSET_FILE.test(file);
}

async function verifyPreviousSite(directory: string): Promise<{ files: Map<string, Uint8Array>; manifest: SiteManifest }> {
  const files = (await collectSourceFiles(directory, true)).files;
  const manifest = await readVerifiedSiteManifest(directory, files);
  const snapshot = await verifyPublicDirectory(directory, manifest.snapshotId, files);
  validateImmutableInventory(manifest, snapshot, files);
  return { files, manifest };
}

async function assertDirectory(path: string, message: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${message}: ${path}`);
}

async function ensureDirectoryTree(root: string, relativeDirectory: string): Promise<void> {
  let current = resolve(root);
  for (const segment of relativeDirectory.split("/").filter(Boolean)) {
    current = join(current, segment);
    try {
      await assertDirectory(current, "Site bundle destination path is not a directory");
    } catch (error) {
      if ((error as { code?: unknown }).code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
}

async function copyImmutableFile(directory: string, file: string, bytes: Uint8Array): Promise<void> {
  assertAllowedPath(file);
  const target = join(resolve(directory), ...file.split("/"));
  try {
    const stats = await lstat(target);
    assertRegularFile(target, stats);
    const existing = new Uint8Array(await readFile(target));
    if (!bytesEqual(existing, bytes)) throw new Error(`Previous site file conflicts with current site: ${file}`);
    return;
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") throw error;
  }
  await ensureDirectoryTree(directory, dirname(file));
  await writeFile(target, bytes, { flag: "wx" });
}

/** Carry content-addressed files forward so cached pages can finish loading after a deploy. */
export async function retainPreviousSite(currentDirectory: string, previousDirectory: string): Promise<void> {
  const current = resolve(currentDirectory);
  const previous = resolve(previousDirectory);
  if (current === previous) throw new Error("Current and previous site directories must be different.");
  await assertDirectory(current, "Current site is not a directory");
  const previousSite = await verifyPreviousSite(previous);
  for (const file of previousSite.manifest.immutableFiles) {
    const bytes = previousSite.files.get(file);
    if (bytes === undefined) throw new Error(`Previous site is missing immutable file: ${file}`);
    await copyImmutableFile(current, file, bytes);
  }
}

function siteManifestFor(input: BuildSiteBundleInput, immutableFiles: readonly string[], immutableFileChecksums: readonly SiteBundleFile[]): SiteManifest {
  return SiteManifestSchema.parse({
    siteManifestSchemaVersion: SITE_MANIFEST_SCHEMA_VERSION,
    siteId: input.siteId,
    codeSha: input.codeSha,
    checkpointId: input.checkpointId,
    snapshotId: input.snapshotId,
    immutableFiles,
    immutableFileChecksums,
  });
}

function validateManifestMetadata(manifest: SiteBundleManifest, siteManifest: SiteManifest): void {
  if (manifest.siteId !== siteManifest.siteId || manifest.codeSha !== siteManifest.codeSha || manifest.checkpointId !== siteManifest.checkpointId || manifest.snapshotId !== siteManifest.snapshotId) {
    throw new Error("Site bundle metadata does not match site-manifest.json.");
  }
}

function validateFileIndex(manifest: SiteBundleManifest): void {
  let total = 0;
  for (const entry of manifest.files) {
    assertAllowedPath(entry.file);
    total += entry.byteSize;
    if (!Number.isSafeInteger(total) || total > MAX_SITE_UNCOMPRESSED_BYTES) throw new Error("Site bundle file index exceeds the uncompressed size limit.");
  }
}

async function inspectZip(bytes: Uint8Array, manifest: SiteBundleManifest): Promise<Map<string, Uint8Array>> {
  if (bytes.byteLength !== manifest.zip.byteSize || checksum(bytes) !== manifest.zip.checksum) throw new Error("Site bundle ZIP checksum or size mismatch.");
  if (bytes.byteLength > MAX_SITE_ZIP_BYTES) throw new Error(`Site bundle ZIP exceeds ${MAX_SITE_ZIP_BYTES} bytes.`);
  validateFileIndex(manifest);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    throw new Error("Site bundle ZIP is invalid.", { cause: error });
  }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_SITE_FILES) throw new Error(`Site bundle exceeds ${MAX_SITE_FILES} files.`);
  const expected = new Map(manifest.files.map((entry) => [entry.file, entry]));
  const files = new Map<string, Uint8Array>();
  const budget: BoundedZipBudget = { used: 0, limit: MAX_SITE_UNCOMPRESSED_BYTES };
  for (const entry of entries) {
    if (entry.dir) throw new Error(`Site bundle contains a directory entry: ${entry.name}`);
    const unsafeOriginalName = (entry as unknown as { unsafeOriginalName?: unknown }).unsafeOriginalName;
    if (typeof unsafeOriginalName === "string" && unsafeOriginalName !== entry.name) throw new Error(`Site bundle ZIP path is unsafe: ${unsafeOriginalName}`);
    assertAllowedPath(entry.name);
    if (files.has(entry.name)) throw new Error(`Site bundle contains a duplicate file: ${entry.name}`);
    const expectedEntry = expected.get(entry.name);
    if (expectedEntry === undefined) throw new Error(`Site bundle ZIP contains an unindexed file: ${entry.name}`);
    const fileBytes = await readBoundedZipEntry(entry as unknown as BoundedZipEntry, expectedEntry, budget, entry.name);
    files.set(entry.name, fileBytes);
  }
  if (files.size !== expected.size) throw new Error("Site bundle ZIP does not contain exactly the indexed files.");
  const rawSiteManifest = files.get(SITE_MANIFEST_FILE);
  if (rawSiteManifest === undefined) throw new Error("Site bundle ZIP is missing site-manifest.json.");
  let parsedSiteManifest: unknown;
  try {
    parsedSiteManifest = JSON.parse(new TextDecoder().decode(rawSiteManifest));
  } catch (error) {
    throw new Error("site-manifest.json is not valid JSON.", { cause: error });
  }
  const siteManifest = SiteManifestSchema.parse(parsedSiteManifest);
  validateManifestMetadata(manifest, siteManifest);
  return files;
}

async function writeFiles(directory: string, files: Map<string, Uint8Array>): Promise<void> {
  for (const [file, bytes] of files) {
    assertAllowedPath(file);
    const path = join(resolve(directory), ...file.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" });
  }
}

async function ensureParentDirectory(directory: string): Promise<void> {
  const parent = dirname(resolve(directory));
  await mkdir(parent, { recursive: true });
  const stats = await lstat(parent);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Site bundle parent is not a directory: ${parent}`);
}

async function assertMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Site bundle target already exists: ${path}`);
}

async function restoreBytes(bytes: Uint8Array, manifest: SiteBundleManifest, directory: string): Promise<void> {
  const files = await inspectZip(bytes, manifest);
  const target = resolve(directory);
  await ensureParentDirectory(target);
  await assertMissing(target);
  const stage = `${target}.tmp-${randomUUID()}`;
  try {
    await mkdir(stage);
    await writeFiles(stage, files);
    const snapshot = await verifyPublicDirectory(stage, manifest.snapshotId, files);
    const siteManifest = await readVerifiedSiteManifest(stage, files);
    validateImmutableInventory(siteManifest, snapshot, files);
    await assertMissing(target);
    await rename(stage, target);
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
  }
}

function bundleManifestBytes(manifest: SiteBundleManifest): Uint8Array {
  return jsonBytes(manifest);
}

async function validateBundle(bundle: SiteBundle): Promise<SiteBundleManifest> {
  const manifest = SiteBundleManifestSchema.parse(bundle.manifest);
  if (bundle.bytes.byteLength > MAX_SITE_ZIP_BYTES) throw new Error(`Site bundle ZIP exceeds ${MAX_SITE_ZIP_BYTES} bytes.`);
  const files = await inspectZip(bundle.bytes, manifest);
  const temporary = await mkdtemp(join(tmpdir(), "riftversus-site-bundle-"));
  try {
    await writeFiles(temporary, files);
    const snapshot = await verifyPublicDirectory(temporary, manifest.snapshotId, files);
    const siteManifest = await readVerifiedSiteManifest(temporary, files);
    validateImmutableInventory(siteManifest, snapshot, files);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return manifest;
}

export async function buildSiteBundle(input: BuildSiteBundleInput): Promise<SiteBundle> {
  assertSiteId(input.siteId);
  const requestedSnapshotId = SnapshotIdSchema.parse(input.snapshotId);
  const snapshot = await verifyPublicSnapshot(input.directory);
  if (snapshot.snapshotId !== requestedSnapshotId) throw new Error(`Public snapshot ID mismatch: expected ${requestedSnapshotId}, got ${snapshot.snapshotId}.`);
  const source = await collectSourceFiles(input.directory);
  await validateSnapshotMedia(snapshot, source.files);
  const immutableFiles = deriveImmutableInventory(snapshot, source.files, input.immutableFiles);
  const immutableFileChecksums = immutableFiles.map((file) => {
    const bytes = source.files.get(file);
    if (bytes === undefined) throw new Error(`Site manifest references missing immutable file: ${file}`);
    return { file, checksum: checksum(bytes), byteSize: bytes.byteLength };
  });
  const siteManifest = siteManifestFor(input, immutableFiles, immutableFileChecksums);
  const files = new Map(source.files);
  files.set(SITE_MANIFEST_FILE, jsonBytes(siteManifest));
  if (files.size > MAX_SITE_FILES) throw new Error(`Site bundle exceeds ${MAX_SITE_FILES} files.`);
  const totalBytes = [...files.values()].reduce((total, bytes) => total + bytes.byteLength, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_SITE_UNCOMPRESSED_BYTES) throw new Error(`Site bundle exceeds ${MAX_SITE_UNCOMPRESSED_BYTES} uncompressed bytes.`);
  const zip = new JSZip();
  for (const [file, bytes] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    zip.file(file, bytes, { createFolders: false, date: new Date(0) });
  }
  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (zipBytes.byteLength > MAX_SITE_ZIP_BYTES) throw new Error(`Site bundle ZIP exceeds ${MAX_SITE_ZIP_BYTES} bytes.`);
  const manifest = SiteBundleManifestSchema.parse({
    siteBundleSchemaVersion: SITE_BUNDLE_SCHEMA_VERSION,
    siteId: input.siteId,
    codeSha: input.codeSha,
    checkpointId: input.checkpointId,
    snapshotId: requestedSnapshotId,
    zip: { checksum: checksum(zipBytes), byteSize: zipBytes.byteLength },
    files: [...files.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([file, bytes]) => ({ file, checksum: checksum(bytes), byteSize: bytes.byteLength })),
  });
  await validateBundle({ bytes: zipBytes, manifest });
  return { bytes: zipBytes, manifest };
}

function zipAssetName(manifest: SiteBundleManifest): string {
  return `site-bundle-${manifest.zip.checksum}.zip`;
}

function manifestAssetName(manifest: SiteBundleManifest): string {
  return `site-manifest-${checksum(bundleManifestBytes(manifest))}.json`;
}

async function readRemoteBundle(releaseStore: ReleaseStore, release: Release, assets: readonly ReleaseAsset[]): Promise<RemoteSiteBundle> {
  if (assets.length !== 2) throw new Error(`Site release must contain exactly two assets: ${release.tag_name}`);
  const zipAssets = assets.filter((asset) => ZIP_ASSET.exec(asset.name) !== null);
  const metadataAssets = assets.filter((asset) => MANIFEST_ASSET.exec(asset.name) !== null);
  if (zipAssets.length !== 1 || metadataAssets.length !== 1) throw new Error(`Site release assets are invalid: ${release.tag_name}`);
  const zipAsset = zipAssets[0]!;
  const metadataAsset = metadataAssets[0]!;
  const zipChecksum = ZIP_ASSET.exec(zipAsset.name)![1]!;
  const metadataChecksum = MANIFEST_ASSET.exec(metadataAsset.name)![1]!;
  const metadataBytes = await releaseStore.downloadAsset(metadataAsset.id, { byteSize: metadataAsset.size, checksum: metadataChecksum });
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(metadataBytes));
  } catch (error) {
    throw new Error("Site release manifest is not valid JSON.", { cause: error });
  }
  const manifest = SiteBundleManifestSchema.parse(parsed);
  if (!bytesEqual(metadataBytes, bundleManifestBytes(manifest))) throw new Error("Site release manifest is not canonical JSON.");
  if (manifest.zip.byteSize > MAX_SITE_ZIP_BYTES) throw new Error(`Site bundle ZIP exceeds ${MAX_SITE_ZIP_BYTES} bytes.`);
  if (zipChecksum !== manifest.zip.checksum || zipAsset.size !== manifest.zip.byteSize) throw new Error("Site release ZIP metadata mismatch.");
  if (manifest.siteId !== release.tag_name) throw new Error("Site release ID does not match its tag.");
  const zipBytes = await releaseStore.downloadAsset(zipAsset.id, { byteSize: manifest.zip.byteSize, checksum: manifest.zip.checksum });
  return { release, manifest, zipBytes };
}

export async function publishSiteBundle(input: PublishSiteBundleInput): Promise<Release> {
  const manifest = await validateBundle(input.bundle);
  const existing = await input.releaseStore.getRelease(manifest.siteId);
  if (existing !== null) throw new Error(`Site release already exists: ${manifest.siteId}`);
  const draft = await input.releaseStore.createDraft({ tag: manifest.siteId, targetCommitish: input.targetCommitish, body: input.body ?? `Site bundle ${manifest.siteId}` });
  await input.releaseStore.uploadAsset(draft.id, { name: zipAssetName(manifest), bytes: input.bundle.bytes, contentType: "application/zip" });
  const metadataBytes = bundleManifestBytes(manifest);
  await input.releaseStore.uploadAsset(draft.id, { name: manifestAssetName(manifest), bytes: metadataBytes, contentType: "application/json" });
  const remote = await readRemoteBundle(input.releaseStore, draft, await input.releaseStore.listAssets(draft.id));
  await validateBundle({ bytes: remote.zipBytes, manifest: remote.manifest });
  return input.releaseStore.publishDraft(draft.id);
}

export async function downloadSiteBundle(input: DownloadSiteBundleInput): Promise<SiteBundleManifest> {
  assertSiteId(input.tag);
  const release = await input.releaseStore.getRelease(input.tag);
  if (release === null) throw new Error(`Published site release does not exist: ${input.tag}`);
  if (release.draft) throw new Error(`Site release is still a draft: ${input.tag}`);
  const remote = await readRemoteBundle(input.releaseStore, release, await input.releaseStore.listAssets(release.id));
  await validateBundle({ bytes: remote.zipBytes, manifest: remote.manifest });
  await restoreBytes(remote.zipBytes, remote.manifest, input.directory);
  return remote.manifest;
}
