import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { join, resolve } from "node:path";

import type { ImmutableObject, ObjectStore, StoredObjectMetadata } from "../storage.js";

const BODY_FILE = "body";
const METADATA_FILE = "metadata.json";
const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface PersistedMetadata {
  checksum: string;
  contentType: string;
  byteSize: number;
}

interface StoredObject {
  bytes: Uint8Array;
  metadata: PersistedMetadata;
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function isExistingTargetError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "EEXIST" || code === "ENOTEMPTY" || code === "EISDIR" || code === "EPERM";
}

function validateKey(key: string): readonly string[] {
  if (typeof key !== "string" || key.length === 0 || key.includes("\\") || key.startsWith("/") || key.endsWith("/")) {
    throw new Error(`Invalid object key: ${key}`);
  }
  const segments = key.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || !KEY_SEGMENT.test(segment))) {
    throw new Error(`Invalid object key: ${key}`);
  }
  return segments;
}

function assertDirectory(path: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (stats.isSymbolicLink()) throw new Error(`Filesystem object path contains a symlink: ${path}`);
  if (!stats.isDirectory()) throw new Error(`Filesystem object path is not a directory: ${path}`);
}

function assertRegularFile(path: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (stats.isSymbolicLink()) throw new Error(`Filesystem object file is a symlink: ${path}`);
  if (!stats.isFile()) throw new Error(`Filesystem object file is not a regular file: ${path}`);
  if (stats.nlink !== 1) throw new Error(`Filesystem object file is hard-linked: ${path}`);
}

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseMetadata(raw: string, path: string): PersistedMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Filesystem object metadata is corrupt: ${path}`, { cause: error });
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { checksum?: unknown }).checksum !== "string" ||
    typeof (parsed as { contentType?: unknown }).contentType !== "string" ||
    !Number.isSafeInteger((parsed as { byteSize?: unknown }).byteSize) ||
    ((parsed as { byteSize: number }).byteSize) < 0
  ) {
    throw new Error(`Filesystem object metadata is corrupt: ${path}`);
  }
  const metadata = parsed as PersistedMetadata;
  if (metadata.checksum.length === 0 || metadata.contentType.length === 0) {
    throw new Error(`Filesystem object metadata is corrupt: ${path}`);
  }
  return metadata;
}

function verifyStoredObject(object: StoredObject, objectPath: string): StoredObjectMetadata {
  if (object.metadata.byteSize !== object.bytes.byteLength) {
    throw new Error(`Filesystem object byte size is corrupt: ${objectPath}`);
  }
  if (checksum(object.bytes) !== object.metadata.checksum) {
    throw new Error(`Filesystem object checksum is corrupt: ${objectPath}`);
  }
  return {
    checksum: object.metadata.checksum,
    contentType: object.metadata.contentType,
    byteSize: object.metadata.byteSize,
  };
}

function compareExisting(existing: StoredObjectMetadata, object: ImmutableObject): "existing" {
  if (existing.checksum !== object.checksum) throw new Error(`Immutable object checksum conflict for ${object.key}.`);
  if (existing.byteSize !== object.bytes.byteLength) throw new Error(`Immutable object byte size conflict for ${object.key}.`);
  if (existing.contentType !== object.contentType) throw new Error(`Immutable object content type conflict for ${object.key}.`);
  return "existing";
}

function validateImmutableObject(object: ImmutableObject): void {
  validateKey(object.key);
  if (!(object.bytes instanceof Uint8Array)) throw new Error(`Immutable object bytes are invalid for ${object.key}.`);
  if (typeof object.checksum !== "string" || object.checksum.length === 0) throw new Error(`Immutable object checksum is invalid for ${object.key}.`);
  if (checksum(object.bytes) !== object.checksum) throw new Error(`Immutable object checksum does not match bytes for ${object.key}.`);
  if (typeof object.contentType !== "string" || object.contentType.length === 0) throw new Error(`Immutable object content type is invalid for ${object.key}.`);
}

export function createFilesystemObjectStore(rootDirectory: string): ObjectStore {
  if (typeof rootDirectory !== "string" || rootDirectory.length === 0) throw new Error("Filesystem object store root is required.");

  const root = resolve(rootDirectory);
  const writes = new Map<string, Promise<void>>();

  async function ensureRoot(): Promise<void> {
    await mkdir(root, { recursive: true });
    const stats = await lstat(root);
    assertDirectory(root, stats);
  }

  async function ensureParent(segments: readonly string[], create: boolean): Promise<string | null> {
    await ensureRoot();
    let current = root;
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment);
      let stats;
      try {
        stats = await lstat(current);
      } catch (error) {
        if (!isMissing(error) || !create) {
          if (isMissing(error) && !create) return null;
          throw error;
        }
        try {
          await mkdir(current);
        } catch (mkdirError) {
          if (!isExistingTargetError(mkdirError)) throw mkdirError;
        }
        stats = await lstat(current);
      }
      assertDirectory(current, stats);
    }
    return current;
  }

  async function readObject(key: string): Promise<StoredObject | null> {
    const segments = validateKey(key);
    const parent = await ensureParent(segments, false);
    if (parent === null) return null;
    const objectPath = join(parent, segments.at(-1)!);
    let objectStats;
    try {
      objectStats = await lstat(objectPath);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    assertDirectory(objectPath, objectStats);

    const bodyPath = join(objectPath, BODY_FILE);
    const metadataPath = join(objectPath, METADATA_FILE);
    let bodyStats;
    let metadataStats;
    try {
      [bodyStats, metadataStats] = await Promise.all([lstat(bodyPath), lstat(metadataPath)]);
    } catch (error) {
      if (isMissing(error)) throw new Error(`Filesystem object is incomplete: ${objectPath}`, { cause: error });
      throw error;
    }
    assertRegularFile(bodyPath, bodyStats);
    assertRegularFile(metadataPath, metadataStats);

    const [bytes, metadataRaw] = await Promise.all([readFile(bodyPath), readFile(metadataPath, "utf8")]);
    const metadata = parseMetadata(metadataRaw, metadataPath);
    if (bodyStats.size !== metadata.byteSize) throw new Error(`Filesystem object byte size is corrupt: ${objectPath}`);
    return { bytes: new Uint8Array(bytes), metadata };
  }

  async function publish(object: ImmutableObject, parent: string, finalPath: string): Promise<"inserted" | "existing"> {
    const tempPath = join(parent, `.${object.key.split("/").at(-1)!}.tmp-${randomUUID()}`);
    const metadata: PersistedMetadata = {
      checksum: object.checksum,
      contentType: object.contentType,
      byteSize: object.bytes.byteLength,
    };
    try {
      await mkdir(tempPath);
      await writeFile(join(tempPath, BODY_FILE), object.bytes, { flag: "wx" });
      await writeFile(join(tempPath, METADATA_FILE), `${JSON.stringify(metadata)}\n`, { encoding: "utf8", flag: "wx" });

      const raced = await readObject(object.key);
      if (raced !== null) {
        return compareExisting(verifyStoredObject(raced, finalPath), object);
      }

      try {
        await rename(tempPath, finalPath);
        return "inserted";
      } catch (error) {
        let racedAfterRename: StoredObject | null = null;
        try {
          racedAfterRename = await readObject(object.key);
        } catch (readError) {
          if (!isExistingTargetError(error)) throw readError;
        }
        if (racedAfterRename !== null) {
          return compareExisting(verifyStoredObject(racedAfterRename, finalPath), object);
        }
        throw error;
      }
    } finally {
      await rm(tempPath, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async function withWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = writes.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveRelease) => {
      release = resolveRelease;
    });
    writes.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (writes.get(key) === current) writes.delete(key);
    }
  }

  return {
    async get(key) {
      const object = await readObject(key);
      if (object === null) return null;
      verifyStoredObject(object, join(root, ...validateKey(key)));
      return Readable.from([object.bytes]);
    },

    async head(key) {
      const object = await readObject(key);
      if (object === null) return null;
      return verifyStoredObject(object, join(root, ...validateKey(key)));
    },

    async putImmutable(object) {
      validateImmutableObject(object);
      return withWriteLock(object.key, async () => {
        const segments = validateKey(object.key);
        const parent = await ensureParent(segments, true);
        if (parent === null) throw new Error(`Unable to create filesystem object parent for ${object.key}.`);
        const finalPath = join(parent, segments.at(-1)!);
        const existing = await readObject(object.key);
        if (existing !== null) return compareExisting(verifyStoredObject(existing, finalPath), object);
        return publish(object, parent, finalPath);
      });
    },
  };
}
