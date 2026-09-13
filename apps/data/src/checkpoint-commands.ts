import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDb } from "@riftversus/database";
import { createFilesystemObjectStore } from "@riftversus/sync";
import { sql } from "kysely";
import { createCheckpoint, restoreCheckpointObjects, verifyCheckpoint, type CheckpointObjectInput } from "./checkpoint.js";
import { dumpDatabase, restoreDatabase } from "./postgres-checkpoint.js";

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]; if (!value?.trim()) throw new Error(`${key} is required.`); return value;
}

export async function runCheckpointCommand(mode: "pack" | "verify" | "restore", directory: string, env: Record<string, string | undefined>): Promise<void> {
  const destination = resolve(directory);
  if (mode === "verify") { console.log(JSON.stringify(await verifyCheckpoint(destination))); return; }
  const databaseUrl = required(env, "DATABASE_URL");
  const store = createFilesystemObjectStore(resolve(required(env, "OBJECT_STORE_DIR")));
  if (mode === "restore") {
    // Validate all bytes before either target receives state. The database must be empty.
    await verifyCheckpoint(destination);
    await restoreDatabase(databaseUrl, destination);
    await restoreCheckpointObjects(destination, store);
    console.log(JSON.stringify({ status: "restored", directory: destination }));
    return;
  }
  const id = required(env, "CHECKPOINT_ID");
  const codeSha = required(env, "CODE_SHA");
  const sequence = Number(required(env, "CHECKPOINT_SEQUENCE"));
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("CHECKPOINT_SEQUENCE must be a positive integer.");
  const temporary = await mkdtemp(join(tmpdir(), "riftversus-checkpoint-"));
  const db = createDb({ databaseUrl });
  try {
    const { dump, objects } = await db.transaction().setIsolationLevel("repeatable read").execute(async transaction => {
      const result = await sql<{ snapshot: string }>`select pg_export_snapshot() as snapshot`.execute(transaction);
      const dump = await dumpDatabase(databaseUrl, join(temporary, "database.dump"), result.rows[0]!.snapshot);
      const objects = (await sql<CheckpointObjectInput>`select distinct object_key as key, checksum, content_type as "contentType", byte_size::float8 as "byteSize" from source_objects union select object_key,checksum,content_type,byte_size::float8 from media_objects order by key`.execute(transaction)).rows;
      return { dump, objects };
    });
    const manifest = await createCheckpoint({ directory: destination, databaseDump: dump, objects, store, id,
      parentId: env.CHECKPOINT_PARENT_ID ?? null, sequence, codeSha });
    console.log(JSON.stringify({ status: "packed", id: manifest.id, objectCount: manifest.objects.length }));
  } finally { await db.destroy(); await rm(temporary, { recursive: true, force: true }); }
}
