import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, migrateToLatest } from "@riftversus/database";
import { createFilesystemObjectStore } from "@riftversus/sync";
import { describe, expect, it } from "vitest";
import { runCheckpointCommand } from "../src/checkpoint-commands.js";
import { verifyCheckpoint } from "../src/checkpoint.js";

// Dedicated disposable databases only; never use the ordinary integration DB.
const sourceUrl = process.env.CHECKPOINT_TEST_SOURCE_DATABASE_URL;
const targetUrl = process.env.CHECKPOINT_TEST_TARGET_DATABASE_URL;
const suite = sourceUrl && targetUrl ? describe : describe.skip;

suite("PostgreSQL checkpoint cold restore", () => {
  it("packs one snapshot, restores bytes and schema, and refuses a populated target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftversus-checkpoint-test-"));
    const source = createDb({ databaseUrl: sourceUrl! });
    const target = createDb({ databaseUrl: targetUrl! });
    try {
      const migrated = await migrateToLatest(source);
      expect(migrated.error).toBeUndefined();
      const bytes = new TextEncoder().encode("retained checkpoint integration evidence");
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const store = createFilesystemObjectStore(join(directory, "source"));
      await store.putImmutable({ key: "media/checkpoint.txt", bytes, checksum, contentType: "text/plain" });
      await source.insertInto("media_objects").values({ object_key: "media/checkpoint.txt", checksum, content_type: "text/plain", byte_size: String(bytes.length) }).execute();
      const bundle = join(directory, "bundle");
      await runCheckpointCommand("pack", bundle, {
        DATABASE_URL: sourceUrl, OBJECT_STORE_DIR: join(directory, "source"),
        CHECKPOINT_ID: "checkpoint-integration", CHECKPOINT_SEQUENCE: "1", CODE_SHA: "a".repeat(40),
      });
      const manifest = await verifyCheckpoint(bundle);
      expect(manifest.objects).toHaveLength(1);
      const dump = await readFile(join(bundle, "database.dump"));
      await writeFile(join(bundle, "database.dump"), "corrupt");
      const restoreEnv = { DATABASE_URL: targetUrl, OBJECT_STORE_DIR: join(directory, "target") };
      await expect(runCheckpointCommand("restore", bundle, restoreEnv)).rejects.toThrow(/size|checksum/);
      await writeFile(join(bundle, "database.dump"), dump);
      await runCheckpointCommand("restore", bundle, restoreEnv);
      expect(await target.selectFrom("media_objects").selectAll().execute()).toEqual([
        { object_key: "media/checkpoint.txt", checksum, content_type: "text/plain", byte_size: String(bytes.length) },
      ]);
      const restored = createFilesystemObjectStore(join(directory, "target"));
      expect(await restored.head("media/checkpoint.txt")).toMatchObject({ checksum, byteSize: bytes.length });
      await expect(runCheckpointCommand("restore", bundle, restoreEnv)).rejects.toThrow(/empty staging database/);
    } finally {
      await source.destroy();
      await target.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
