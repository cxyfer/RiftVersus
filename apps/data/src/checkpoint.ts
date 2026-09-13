import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, parse, relative, resolve, sep } from "node:path";

import type { ObjectStore } from "@riftversus/sync";
import { z } from "zod";

const CHECKPOINT_MANIFEST_FILE = "manifest.json";
const DATABASE_DUMP_FILE = "database.dump";
const OBJECTS_DIRECTORY = "objects";
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const SAFE_RELATIVE_FILE = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;

const CheckpointFileSchema = z.object({
  file: z.literal(DATABASE_DUMP_FILE),
  checksum: z.string().regex(SHA256),
  byteSize: z.number().int().nonnegative().safe(),
}).strict();

const CheckpointObjectSchema = z.object({
  key: z.string().regex(SAFE_KEY),
  checksum: z.string().regex(SHA256),
  contentType: z.string().min(1),
  byteSize: z.number().int().nonnegative().safe(),
  file: z.string().regex(new RegExp(`^${OBJECTS_DIRECTORY}/[a-f0-9]{64}$`)),
}).strict();

export const CheckpointManifestSchema = z.object({
  checkpointSchemaVersion: z.literal(1),
  id: z.string().min(1),
  parent: z.string().min(1).nullable(),
  sequence: z.number().int().positive().safe(),
  codeSha: z.string().min(1),
  postgresMajor: z.literal(17),
  databaseDump: CheckpointFileSchema,
  objects: z.array(CheckpointObjectSchema),
}).strict();

export type CheckpointManifest = z.infer<typeof CheckpointManifestSchema>;

export interface CheckpointObjectInput {
  key: string;
  checksum: string;
  contentType: string;
  byteSize: number;
}

export interface CreateCheckpointInput {
  directory: string;
  databaseDump: Uint8Array;
  objects: readonly CheckpointObjectInput[];
  store: ObjectStore;
  id: string;
  parentId: string | null;
  sequence: number;
  codeSha: string;
}

export interface CheckpointRestoreResult {
  manifest: CheckpointManifest;
  restored: number;
}

interface VerifiedCheckpoint {
  manifest: CheckpointManifest;
  files: Map<string, Uint8Array>;
}

const checkpointWrites = new Map<string, Promise<void>>();

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function assertDirectory(path: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (stats.isSymbolicLink()) throw new Error(`Checkpoint path contains a symlink: ${path}`);
  if (!stats.isDirectory()) throw new Error(`Checkpoint path is not a directory: ${path}`);
}

function assertRegularFile(path: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (stats.isSymbolicLink()) throw new Error(`Checkpoint file is a symlink: ${path}`);
  if (!stats.isFile()) throw new Error(`Checkpoint path is not a regular file: ${path}`);
  if (stats.nlink !== 1) throw new Error(`Checkpoint file is hard-linked: ${path}`);
}

function assertSafeRelativeFile(file: string): readonly string[] {
  if (!SAFE_RELATIVE_FILE.test(file)) throw new Error(`Checkpoint file path is unsafe: ${file}`);
  const segments = file.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) throw new Error(`Checkpoint file path is unsafe: ${file}`);
  return segments;
}

function objectFile(checksumValue: string): string {
  return `${OBJECTS_DIRECTORY}/${checksumValue}`;
}

function validateManifestConsistency(manifest: CheckpointManifest): void {
  const keys = new Set<string>();
  const files = new Map<string, { checksum: string; byteSize: number }>();
  if (manifest.databaseDump.file !== DATABASE_DUMP_FILE) throw new Error("Checkpoint database dump filename is invalid.");
  assertSafeRelativeFile(manifest.databaseDump.file);

  for (const object of manifest.objects) {
    if (keys.has(object.key)) throw new Error(`Checkpoint contains duplicate object key: ${object.key}`);
    keys.add(object.key);
    if (object.file !== objectFile(object.checksum)) throw new Error(`Checkpoint object file does not match checksum: ${object.key}`);
    assertSafeRelativeFile(object.file);
    const existing = files.get(object.file);
    if (existing !== undefined && (existing.checksum !== object.checksum || existing.byteSize !== object.byteSize)) {
      throw new Error(`Checkpoint object file metadata conflicts: ${object.file}`);
    }
    files.set(object.file, { checksum: object.checksum, byteSize: object.byteSize });
  }
}

function parseManifest(raw: string): CheckpointManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Checkpoint manifest is not valid JSON.", { cause: error });
  }
  const manifest = CheckpointManifestSchema.parse(parsed);
  validateManifestConsistency(manifest);
  return manifest;
}

function verifyBytes(bytes: Uint8Array, expectedChecksum: string, expectedByteSize: number, label: string): void {
  if (bytes.byteLength !== expectedByteSize) throw new Error(`Checkpoint byte size mismatch for ${label}.`);
  if (checksum(bytes) !== expectedChecksum) throw new Error(`Checkpoint checksum mismatch for ${label}.`);
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
  }
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function ensureDirectoryChain(directory: string): Promise<void> {
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  let current = root;
  const pathSegments = relative(root, absolute).split(sep).filter(Boolean);
  for (const segment of pathSegments) {
    current = join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (!isMissing(error)) throw error;
      await mkdir(current);
      stats = await lstat(current);
    }
    assertDirectory(current, stats);
  }
}

async function assertMissing(path: string, message: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new Error(message);
}

async function collectEntries(directory: string): Promise<{ files: Set<string>; directories: Set<string> }> {
  const files = new Set<string>();
  const directories = new Set<string>([""]);
  async function visit(current: string, relativeDirectory: string): Promise<void> {
    const names = await readdir(current);
    for (const name of names) {
      const relativePath = relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
      assertSafeRelativeFile(relativePath);
      const path = join(current, name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) throw new Error(`Checkpoint path contains a symlink: ${path}`);
      if (stats.isDirectory()) {
        directories.add(relativePath);
        await visit(path, relativePath);
      } else {
        assertRegularFile(path, stats);
        files.add(relativePath);
      }
    }
  }
  await visit(directory, "");
  return { files, directories };
}

async function readVerifiedFile(directory: string, file: string, expectedChecksum: string, expectedByteSize: number): Promise<Uint8Array> {
  const segments = assertSafeRelativeFile(file);
  const path = join(directory, ...segments);
  const stats = await lstat(path);
  assertRegularFile(path, stats);
  const bytes = new Uint8Array(await readFile(path));
  if (stats.size !== expectedByteSize) throw new Error(`Checkpoint byte size mismatch for ${file}.`);
  verifyBytes(bytes, expectedChecksum, expectedByteSize, file);
  return bytes;
}

async function loadVerifiedCheckpoint(directory: string): Promise<VerifiedCheckpoint> {
  const root = resolve(directory);
  const rootStats = await lstat(root);
  assertDirectory(root, rootStats);
  const manifestPath = join(root, CHECKPOINT_MANIFEST_FILE);
  const manifestStats = await lstat(manifestPath);
  assertRegularFile(manifestPath, manifestStats);
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
  const expectedFiles = new Set<string>([CHECKPOINT_MANIFEST_FILE, manifest.databaseDump.file]);
  const expectedDirectories = new Set<string>(["", OBJECTS_DIRECTORY]);
  const objectFiles = new Map<string, { checksum: string; byteSize: number }>();
  for (const object of manifest.objects) {
    expectedFiles.add(object.file);
    objectFiles.set(object.file, { checksum: object.checksum, byteSize: object.byteSize });
  }

  const entries = await collectEntries(root);
  for (const file of entries.files) {
    if (!expectedFiles.has(file)) throw new Error(`Checkpoint contains an unexpected file: ${file}`);
  }
  for (const file of expectedFiles) {
    if (!entries.files.has(file)) throw new Error(`Checkpoint is missing file: ${file}`);
  }
  for (const directoryEntry of entries.directories) {
    if (!expectedDirectories.has(directoryEntry)) throw new Error(`Checkpoint contains an unexpected directory: ${directoryEntry}`);
  }

  const files = new Map<string, Uint8Array>();
  files.set(
    manifest.databaseDump.file,
    await readVerifiedFile(root, manifest.databaseDump.file, manifest.databaseDump.checksum, manifest.databaseDump.byteSize),
  );
  for (const [file, expected] of objectFiles) {
    files.set(file, await readVerifiedFile(root, file, expected.checksum, expected.byteSize));
  }
  return { manifest, files };
}

async function withCheckpointWrite<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const key = resolve(directory);
  const previous = checkpointWrites.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveRelease) => { release = resolveRelease; });
  checkpointWrites.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (checkpointWrites.get(key) === current) checkpointWrites.delete(key);
  }
}

export async function createCheckpoint(input: CreateCheckpointInput): Promise<CheckpointManifest> {
  if (typeof input.directory !== "string" || input.directory.length === 0) throw new Error("Checkpoint directory is required.");
  if (!(input.databaseDump instanceof Uint8Array)) throw new Error("Checkpoint database dump bytes are invalid.");
  if (checksum(input.databaseDump).length !== 64) throw new Error("Checkpoint database dump checksum is invalid.");
  const target = resolve(input.directory);

  return withCheckpointWrite(target, async () => {
    const parentDirectory = dirname(target);
    await ensureDirectoryChain(parentDirectory);
    await assertMissing(target, `Checkpoint directory already exists: ${target}`);

    const seenKeys = new Set<string>();
    const objectBytes = new Map<string, Uint8Array>();
    const manifestObjects: CheckpointManifest["objects"] = [];
    for (const inputObject of input.objects) {
      if (typeof inputObject.key !== "string" || !SAFE_KEY.test(inputObject.key)) throw new Error(`Invalid checkpoint object key: ${inputObject.key}`);
      if (seenKeys.has(inputObject.key)) throw new Error(`Checkpoint contains duplicate object key: ${inputObject.key}`);
      seenKeys.add(inputObject.key);
      if (!SHA256.test(inputObject.checksum)) throw new Error(`Invalid checkpoint object checksum: ${inputObject.key}`);
      if (typeof inputObject.contentType !== "string" || inputObject.contentType.length === 0) throw new Error(`Invalid checkpoint object content type: ${inputObject.key}`);
      if (!Number.isSafeInteger(inputObject.byteSize) || inputObject.byteSize < 0) throw new Error(`Invalid checkpoint object byte size: ${inputObject.key}`);

      const metadata = await input.store.head(inputObject.key);
      if (metadata === null) throw new Error(`Checkpoint object is missing from the object store: ${inputObject.key}`);
      if (metadata.checksum !== inputObject.checksum) throw new Error(`Checkpoint object checksum metadata mismatch: ${inputObject.key}`);
      if (metadata.contentType !== inputObject.contentType) throw new Error(`Checkpoint object content type metadata mismatch: ${inputObject.key}`);
      if (metadata.byteSize !== inputObject.byteSize) throw new Error(`Checkpoint object byte size metadata mismatch: ${inputObject.key}`);
      const stream = await input.store.get(inputObject.key);
      if (stream === null) throw new Error(`Checkpoint object disappeared from the object store: ${inputObject.key}`);
      const bytes = await readStream(stream);
      verifyBytes(bytes, inputObject.checksum, inputObject.byteSize, inputObject.key);
      objectBytes.set(inputObject.checksum, bytes);
      manifestObjects.push({ ...inputObject, file: objectFile(inputObject.checksum) });
    }

    const manifest = CheckpointManifestSchema.parse({
      checkpointSchemaVersion: 1,
      id: input.id,
      parent: input.parentId,
      sequence: input.sequence,
      codeSha: input.codeSha,
      postgresMajor: 17,
      databaseDump: {
        file: DATABASE_DUMP_FILE,
        checksum: checksum(input.databaseDump),
        byteSize: input.databaseDump.byteLength,
      },
      objects: manifestObjects,
    });
    validateManifestConsistency(manifest);

    const stage = `${target}.tmp-${randomUUID()}`;
    try {
      await mkdir(stage);
      await mkdir(join(stage, OBJECTS_DIRECTORY));
      await writeFile(join(stage, DATABASE_DUMP_FILE), input.databaseDump, { flag: "wx" });
      for (const [objectChecksum, bytes] of objectBytes) {
        await writeFile(join(stage, OBJECTS_DIRECTORY, objectChecksum), bytes, { flag: "wx" });
      }
      await writeFile(join(stage, CHECKPOINT_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await loadVerifiedCheckpoint(stage);
      await assertMissing(target, `Checkpoint directory already exists: ${target}`);
      await rename(stage, target);
      return manifest;
    } finally {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

export async function verifyCheckpoint(directory: string): Promise<CheckpointManifest> {
  return (await loadVerifiedCheckpoint(directory)).manifest;
}

export async function restoreCheckpointObjects(directory: string, store: ObjectStore): Promise<CheckpointRestoreResult> {
  const verified = await loadVerifiedCheckpoint(directory);
  for (const object of verified.manifest.objects) {
    const bytes = verified.files.get(object.file);
    if (bytes === undefined) throw new Error(`Checkpoint object file was not loaded: ${object.file}`);
    await store.putImmutable({
      key: object.key,
      bytes,
      checksum: object.checksum,
      contentType: object.contentType,
    });
  }
  return { manifest: verified.manifest, restored: verified.manifest.objects.length };
}
