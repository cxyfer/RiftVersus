import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, link, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createFilesystemObjectStore } from "../src/storage/filesystem.js";

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "riftversus-filesystem-store-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function object(key: string, content: string, contentType = "application/json") {
  const bytes = new TextEncoder().encode(content);
  return {
    key,
    bytes,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    contentType,
  };
}

async function readBytes(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

describe("filesystem object store", () => {
  it("persists immutable bytes and metadata across store instances", async () => {
    await withRoot(async (root) => {
      const first = createFilesystemObjectStore(root);
      const stored = object("sources/leaguepedia/fixture", "{\"ok\":true}");

      await expect(first.putImmutable(stored)).resolves.toBe("inserted");
      await expect(first.head(stored.key)).resolves.toEqual({
        checksum: stored.checksum,
        contentType: stored.contentType,
        byteSize: stored.bytes.byteLength,
      });

      const second = createFilesystemObjectStore(root);
      await expect(second.putImmutable(stored)).resolves.toBe("existing");
      await expect(readBytes((await second.get(stored.key))!)).resolves.toEqual(stored.bytes);
      await expect(readFile(join(root, "sources/leaguepedia/fixture/metadata.json"), "utf8")).resolves.toContain(stored.checksum);
    });
  });

  it("returns null for a missing object", async () => {
    await withRoot(async (root) => {
      const store = createFilesystemObjectStore(root);
      await expect(store.get("media/missing.png")).resolves.toBeNull();
      await expect(store.head("media/missing.png")).resolves.toBeNull();
    });
  });

  it("rejects immutable checksum and metadata conflicts without overwriting", async () => {
    await withRoot(async (root) => {
      const store = createFilesystemObjectStore(root);
      const stored = object("media/hash.png", "original", "image/png");
      await expect(store.putImmutable(stored)).resolves.toBe("inserted");

      const checksumConflict = object(stored.key, "different", "image/png");
      await expect(store.putImmutable(checksumConflict)).rejects.toThrow("checksum conflict");
      await expect(readBytes((await store.get(stored.key))!)).resolves.toEqual(stored.bytes);

      await expect(store.putImmutable({ ...stored, contentType: "image/webp" })).rejects.toThrow("content type conflict");
      await expect(readBytes((await store.get(stored.key))!)).resolves.toEqual(stored.bytes);
    });
  });

  it("fails closed when body or metadata is corrupted", async () => {
    await withRoot(async (root) => {
      const store = createFilesystemObjectStore(root);
      const stored = object("sources/provider/hash", "valid");
      await store.putImmutable(stored);
      await writeFile(join(root, "sources/provider/hash/body"), "tampered");

      await expect(store.get(stored.key)).rejects.toThrow(/checksum|byte size/);
      await expect(store.head(stored.key)).rejects.toThrow(/checksum|byte size/);

      await writeFile(join(root, "sources/provider/hash/body"), stored.bytes);
      await writeFile(join(root, "sources/provider/hash/metadata.json"), JSON.stringify({ ...stored, byteSize: 999 }));
      await expect(store.head(stored.key)).rejects.toThrow("byte size");
    });
  });

  it("rejects traversal, absolute, backslash, empty, and non-ASCII keys", async () => {
    await withRoot(async (root) => {
      const store = createFilesystemObjectStore(root);
      const invalidKeys = ["../escape", "sources/../../escape", "/absolute", "sources//empty", "sources/", "sources\\escape", "sources/é"];
      for (const key of invalidKeys) {
        await expect(store.head(key)).rejects.toThrow("Invalid object key");
        await expect(store.putImmutable(object(key, "value"))).rejects.toThrow("Invalid object key");
      }
    });
  });

  it("rejects symlinked key components and object files", async () => {
    await withRoot(async (root) => {
      const store = createFilesystemObjectStore(root);
      await symlink(join(root, "missing-target"), join(root, "sources"));
      await expect(store.head("sources/provider/hash")).rejects.toThrow("symlink");
      await expect(store.putImmutable(object("sources/provider/hash", "value"))).rejects.toThrow("symlink");

      await rm(join(root, "sources"), { recursive: true, force: true });
      await store.putImmutable(object("sources/provider/hash", "value"));
      await unlink(join(root, "sources/provider/hash/body"));
      await symlink(join(root, "outside-body"), join(root, "sources/provider/hash/body"));
      await expect(store.get("sources/provider/hash")).rejects.toThrow("symlink");
    });
  });

  it("rejects hard-linked object files", async () => {
    await withRoot(async (root) => {
      const store = createFilesystemObjectStore(root);
      const stored = object("media/hash.png", "image", "image/png");
      await store.putImmutable(stored);
      const external = join(root, "external-body");
      await writeFile(external, stored.bytes);
      await unlink(join(root, "media/hash.png/body"));
      await link(external, join(root, "media/hash.png/body"));

      await expect(store.get(stored.key)).rejects.toThrow("hard-linked");
      await expect(store.head(stored.key)).rejects.toThrow("hard-linked");
    });
  });

  it("serializes concurrent writers and leaves one complete object", async () => {
    await withRoot(async (root) => {
      const firstStore = createFilesystemObjectStore(root);
      const secondStore = createFilesystemObjectStore(root);
      const stored = object("sources/provider/concurrent", "same bytes");
      const results = await Promise.all([
        firstStore.putImmutable(stored),
        secondStore.putImmutable(stored),
      ]);

      expect(results.sort()).toEqual(["existing", "inserted"]);
      await expect(readBytes((await firstStore.get(stored.key))!)).resolves.toEqual(stored.bytes);
      await expect(readdir(join(root, "sources/provider"))).resolves.toEqual(["concurrent"]);
    });
  });
});
