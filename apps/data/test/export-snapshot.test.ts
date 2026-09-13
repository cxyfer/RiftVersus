import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteManifestSchema, type PublicSnapshot, type SnapshotSeries } from "@riftversus/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { snapshotDigest, verifyPublicSnapshot, writeSnapshotData } from "../src/export-snapshot.js";

const directories: string[] = [];
async function directory(): Promise<string> { const path = await mkdtemp(join(tmpdir(), "riftversus-public-test-")); directories.push(path); return path; }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function series(id: number, year: number): SnapshotSeries {
  const sides = [{ teamId: uuid(101), eraId: null, regionId: null, playerIds: [], teamName: "Alpha" }, { teamId: uuid(102), eraId: null, regionId: null, playerIds: [], teamName: "Beta" }] as const;
  return { id: uuid(id), date: `${year}-01-01`, playedAt: `${year}-01-01T00:00:00.000Z`,
    tournament: { id: uuid(100), name: "Fixture", category: "worlds", league: null }, bestOf: 1,
    sides, games: [{ id: uuid(id + 1000), seriesId: uuid(id), playedAt: `${year}-01-01T00:00:00.000Z`, gameNumber: 1, sides, winnerSide: "a" }],
    completed: true, winnerSide: "a", score: { a: 1, b: 0 } };
}
const projection: Omit<PublicSnapshot, "snapshotId"> = {
  schemaVersion: 1, dataset: { version: "synthetic-test", lastSuccessfulSyncAt: "2026-01-01T00:00:00.000Z", coverage: { from: "2024-01-01", to: "2025-12-31" } },
  coverageWarnings: [], entities: [{ id: uuid(1), kind: "player", displayName: "Faker", realName: "Lee Sang-hyeok", mediaUrl: "/presentation/avatar.svg", canonicalName: "faker", slug: "faker", aliases: ["Faker"], avatarLabel: "FA", retainedObjectKey: null }],
  series: [series(1, 2024), series(2, 2025), series(3, 2024)], freshness: [], attribution: [],
};

describe("public SQLite snapshot", () => {
  it("round trips relational rows with a stable logical ID and no JSON shards", async () => {
    const first = await directory(); const second = await directory();
    const snapshot = await writeSnapshotData(first, projection);
    expect(await verifyPublicSnapshot(first)).toEqual(snapshot);
    expect((await writeSnapshotData(second, projection)).snapshotId).toBe(snapshot.snapshotId);
    expect(snapshot.snapshotId).toBe(snapshotDigest(projection));

    const manifest = SqliteManifestSchema.parse(JSON.parse(await readFile(join(first, "data", "manifest.json"), "utf8")));
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.database.file).toMatch(/^[a-f0-9]{64}\/database\.sqlite$/u);
    expect((await readdir(join(first, "data"))).sort()).toEqual(["manifest.json", manifest.database.file.split("/")[0]!].sort());
    const database = new DatabaseSync(join(first, "data", manifest.database.file), { readOnly: true });
    expect((database.prepare("PRAGMA page_size").get() as { page_size: number }).page_size).toBe(4096);
    expect((database.prepare("SELECT COUNT(*) AS count FROM series_facts").get() as { count: number }).count).toBe(3);
    expect((database.prepare("SELECT side_a_name, side_b_name FROM game_facts").get() as { side_a_name: string; side_b_name: string })).toEqual({ side_a_name: "Alpha", side_b_name: "Beta" });
    database.close();
  });

  it("fails closed on modified SQLite bytes and manifest traversal", async () => {
    const root = await directory(); await writeSnapshotData(root, projection);
    const manifestPath = join(root, "data", "manifest.json");
    const manifest = SqliteManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    const databasePath = join(root, "data", manifest.database.file);
    const original = await readFile(databasePath);
    const corrupted = Buffer.from(original); corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    await writeFile(databasePath, corrupted);
    await expect(verifyPublicSnapshot(root)).rejects.toThrow(/checksum|integrity/iu);
    await writeFile(databasePath, original);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, dataset: { ...manifest.dataset, version: "tampered" } }));
    await expect(verifyPublicSnapshot(root)).rejects.toThrow("metadata");
    await writeFile(manifestPath, JSON.stringify({ ...manifest, database: { ...manifest.database, file: "../private.sqlite" } }));
    await expect(verifyPublicSnapshot(root)).rejects.toThrow();
  });

  it("rejects incomplete series because the public SQLite schema stores eligible facts only", async () => {
    const root = await directory();
    const incomplete = { ...projection, series: [{ ...projection.series[0]!, completed: false, winnerSide: null }] };
    await expect(writeSnapshotData(root, incomplete)).rejects.toThrow("completed series");
  });

  it("keeps the database physical checksum separate from the logical snapshot ID", async () => {
    const root = await directory();
    const snapshot = await writeSnapshotData(root, projection);
    const manifest = SqliteManifestSchema.parse(JSON.parse(await readFile(join(root, "data", "manifest.json"), "utf8")));
    expect(manifest.snapshotId).toBe(snapshot.snapshotId);
    expect(manifest.database.checksum).toBe(createHash("sha256").update(await readFile(join(root, "data", manifest.database.file))).digest("hex"));
    expect(manifest.database.checksum).not.toBe(snapshot.snapshotId.slice(7));
  });
});
