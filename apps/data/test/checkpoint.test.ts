import { createHash } from "node:crypto";
import { link, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createFilesystemObjectStore } from "@riftversus/sync";
import {
  createCheckpoint,
  restoreCheckpointObjects,
  verifyCheckpoint,
  type CheckpointObjectInput,
  type CreateCheckpointInput,
} from "../src/checkpoint.js";

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "riftversus-checkpoint-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function objectInput(key: string, body: string, contentType = "application/json"): { input: CheckpointObjectInput; body: Uint8Array } {
  const objectBytes = bytes(body);
  return {
    body: objectBytes,
    input: {
      key,
      checksum: createHash("sha256").update(objectBytes).digest("hex"),
      contentType,
      byteSize: objectBytes.byteLength,
    },
  };
}

async function seedStore(root: string, object: ReturnType<typeof objectInput>): Promise<void> {
  const store = createFilesystemObjectStore(root);
  await store.putImmutable({ ...object.input, bytes: object.body });
}

function checkpointInput(directory: string, storeRoot: string, object: ReturnType<typeof objectInput>, databaseDump = bytes("pg_dump fixture")): CreateCheckpointInput {
  return {
    directory,
    databaseDump,
    objects: [object.input],
    store: createFilesystemObjectStore(storeRoot),
    id: "checkpoint-1-run",
    parentId: null,
    sequence: 1,
    codeSha: "0123456789abcdef0123456789abcdef01234567",
  };
}

describe("checkpoint bundles", () => {
  it("creates, verifies, and restores a complete bundle", async () => {
    await withRoot(async (root) => {
      const sourceRoot = join(root, "source");
      const target = join(root, "checkpoint-1");
      const object = objectInput("sources/leaguepedia/raw", "raw source");
      await seedStore(sourceRoot, object);

      const manifest = await createCheckpoint(checkpointInput(target, sourceRoot, object));
      expect(manifest).toMatchObject({
        checkpointSchemaVersion: 1,
        id: "checkpoint-1-run",
        parent: null,
        sequence: 1,
        codeSha: "0123456789abcdef0123456789abcdef01234567",
        postgresMajor: 17,
        databaseDump: { file: "database.dump", byteSize: "pg_dump fixture".length },
      });
      expect(await verifyCheckpoint(target)).toEqual(manifest);
      await expect(readFile(join(target, "database.dump"))).resolves.toEqual(Buffer.from("pg_dump fixture"));
      await expect(readdir(join(target, "objects"))).resolves.toEqual([object.input.checksum]);

      const restoredRoot = join(root, "restored");
      const restored = await restoreCheckpointObjects(target, createFilesystemObjectStore(restoredRoot));
      expect(restored).toEqual({ manifest, restored: 1 });
      await expect(createFilesystemObjectStore(restoredRoot).head(object.input.key)).resolves.toEqual({
        checksum: object.input.checksum,
        contentType: object.input.contentType,
        byteSize: object.input.byteSize,
      });
    });
  });

  it("rejects missing and corrupted dump or object files", async () => {
    await withRoot(async (root) => {
      const sourceRoot = join(root, "source");
      const object = objectInput("media/hash.png", "image", "image/png");
      await seedStore(sourceRoot, object);
      const target = join(root, "checkpoint-1");
      await createCheckpoint(checkpointInput(target, sourceRoot, object));

      await unlink(join(target, "database.dump"));
      await expect(verifyCheckpoint(target)).rejects.toThrow("missing file");

      await writeFile(join(target, "database.dump"), bytes("pg_dump fixture"));
      await writeFile(join(target, "objects", object.input.checksum), bytes("corrupt"));
      await expect(verifyCheckpoint(target)).rejects.toThrow(/checksum|byte size/);
    });
  });

  it("rejects invalid keys, duplicate keys, unknown versions, and credentials", async () => {
    await withRoot(async (root) => {
      const sourceRoot = join(root, "source");
      const object = objectInput("sources/provider/raw", "raw");
      await seedStore(sourceRoot, object);
      await expect(createCheckpoint({ ...checkpointInput(join(root, "invalid-key"), sourceRoot, object), objects: [{ ...object.input, key: "../escape" }] })).rejects.toThrow("Invalid checkpoint object key");
      await expect(createCheckpoint({ ...checkpointInput(join(root, "duplicate-key"), sourceRoot, object), objects: [object.input, object.input] })).rejects.toThrow("duplicate object key");

      const target = join(root, "checkpoint-1");
      await createCheckpoint(checkpointInput(target, sourceRoot, object));
      const manifestPath = join(target, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
      await writeFile(manifestPath, JSON.stringify({ ...manifest, checkpointSchemaVersion: 2 }));
      await expect(verifyCheckpoint(target)).rejects.toThrow();

      await writeFile(manifestPath, JSON.stringify({ ...manifest, credentials: { token: "secret" } }));
      await expect(verifyCheckpoint(target)).rejects.toThrow();
    });
  });

  it("refuses an existing target and leaves failed creation without partial output", async () => {
    await withRoot(async (root) => {
      const sourceRoot = join(root, "source");
      const object = objectInput("sources/provider/raw", "raw");
      await seedStore(sourceRoot, object);
      const target = join(root, "checkpoint-1");
      const input = checkpointInput(target, sourceRoot, object);
      const manifest = await createCheckpoint(input);
      await expect(createCheckpoint(input)).rejects.toThrow("already exists");
      await expect(verifyCheckpoint(target)).resolves.toEqual(manifest);

      const corruptRoot = join(root, "corrupt-source");
      await seedStore(corruptRoot, object);
      await writeFile(join(corruptRoot, "sources/provider/raw/body"), bytes("tampered"));
      const failedTarget = join(root, "failed-checkpoint");
      await expect(createCheckpoint(checkpointInput(failedTarget, corruptRoot, object))).rejects.toThrow();
      await expect(readFile(join(failedTarget, "manifest.json"))).rejects.toThrow();
      await expect(readdir(root)).resolves.toEqual(expect.not.arrayContaining(["failed-checkpoint", "failed-checkpoint.tmp"]));
    });
  });

  it("rejects symlinks, hardlinks, and unexpected files", async () => {
    await withRoot(async (root) => {
      const sourceRoot = join(root, "source");
      const object = objectInput("sources/provider/raw", "raw");
      await seedStore(sourceRoot, object);
      const target = join(root, "checkpoint-1");
      await createCheckpoint(checkpointInput(target, sourceRoot, object));

      await writeFile(join(target, "extra.txt"), bytes("extra"));
      await expect(verifyCheckpoint(target)).rejects.toThrow("unexpected file");
      await unlink(join(target, "extra.txt"));

      const linked = join(root, "linked-dump");
      await link(join(target, "database.dump"), linked);
      await expect(verifyCheckpoint(target)).rejects.toThrow("hard-linked");
      await unlink(linked);

      await unlink(join(target, "database.dump"));
      await symlink(join(root, "outside-dump"), join(target, "database.dump"));
      await expect(verifyCheckpoint(target)).rejects.toThrow("symlink");
    });
  });
});
