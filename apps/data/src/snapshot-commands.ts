import { resolve } from "node:path";
import { createFilesystemObjectStore } from "@riftversus/sync";
import { exportPublicSnapshot, verifyPublicSnapshot } from "./export-snapshot.js";

export async function runSnapshotCommand(mode: "export" | "verify", directory: string, env: Record<string, string | undefined>): Promise<void> {
  if (mode === "verify") {
    const snapshot = await verifyPublicSnapshot(resolve(directory));
    console.log(JSON.stringify({ status: "verified", snapshotId: snapshot.snapshotId }));
    return;
  }
  if (!env.DATABASE_URL?.trim() || !env.OBJECT_STORE_DIR?.trim()) throw new Error("Snapshot export requires DATABASE_URL and OBJECT_STORE_DIR.");
  const snapshot = await exportPublicSnapshot({ databaseUrl: env.DATABASE_URL, directory: resolve(directory),
    store: createFilesystemObjectStore(resolve(env.OBJECT_STORE_DIR)), ...(env.PUBLIC_BASE_PATH ? { basePath: env.PUBLIC_BASE_PATH } : {}) });
  console.log(JSON.stringify({ status: "exported", snapshotId: snapshot.snapshotId, series: snapshot.series.length }));
}
