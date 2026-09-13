import { describe, expect, it, vi } from "vitest";

import type { SqliteManifest } from "@riftversus/contracts";

import { createSnapshotClient, type CreateSqliteWorker, type SqliteWorkerHandle } from "./snapshot-client.js";

const databaseChecksum = "a".repeat(64);
const manifest: SqliteManifest = {
  schemaVersion: 2,
  snapshotId: `sha256:${"b".repeat(64)}`,
  dataset: { version: "fixture-v2", lastSuccessfulSyncAt: "2026-01-01T00:00:00.000Z", coverage: { from: "2024-01-01", to: "2025-12-31" } },
  coverageWarnings: [],
  database: { file: `${databaseChecksum}/database.sqlite`, checksum: databaseChecksum, byteSize: 8192, pageSize: 4096, requestChunkSize: 4096 },
  freshness: [],
  attribution: [],
};

function rangeBytes(): ArrayBuffer {
  const bytes = new Uint8Array(100);
  bytes.set(new TextEncoder().encode("SQLite format 3\u0000"), 0);
  bytes[16] = 0x10;
  bytes[17] = 0x00;
  return bytes.buffer;
}

function response(status: number, body: BodyInit, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

function workerFactory(manifestId = manifest.snapshotId): { factory: CreateSqliteWorker; handle: SqliteWorkerHandle; exec: ReturnType<typeof vi.fn> } {
  const exec = vi.fn(async () => [{ columns: ["value"], values: [[JSON.stringify(manifestId)]] }]);
  const handle: SqliteWorkerHandle = { db: { exec } };
  return { factory: vi.fn(async () => handle), handle, exec };
}

function createFetch(overrides: { range?: Response; manifest?: unknown } = {}) {
  const range = overrides.range ?? response(206, rangeBytes(), { "Content-Range": "bytes 0-99/8192", "Content-Encoding": "identity" });
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = new URL(String(input));
    if (url.pathname.endsWith("/manifest.json")) return response(200, JSON.stringify(overrides.manifest ?? manifest));
    return range.clone();
  });
}

describe("SQLite HTTPVFS snapshot client", () => {
  it("preflights a 100-byte range, opens one pinned worker, and sticks to it", async () => {
    const fetcher = createFetch();
    const worker = workerFactory();
    const client = createSnapshotClient({ baseUrl: "/RiftVersus/", fetch: fetcher, createDbWorker: worker.factory, workerUrl: "/assets/sqlite.worker.js", wasmUrl: "/assets/sql-wasm.wasm" });

    const first = client.open();
    const second = client.open();
    const opened = await first;

    expect(await second).toBe(opened);
    expect(await client.open()).toBe(opened);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ credentials: "same-origin", headers: { Range: "bytes=0-99", Accept: "application/octet-stream" } });
    expect(worker.factory).toHaveBeenCalledWith([
      { from: "inline", config: { serverMode: "full", requestChunkSize: 4096, url: `http://localhost:3000/RiftVersus/data/${databaseChecksum}/database.sqlite` } },
    ], "/assets/sqlite.worker.js", "/assets/sql-wasm.wasm", 128 * 1024 * 1024);
    expect(worker.exec).toHaveBeenCalledWith("SELECT value FROM metadata WHERE key = ?", ["snapshotId"]);
  });

  it.each([
    ["rejects a 200 response", response(200, rangeBytes(), { "Content-Range": "bytes 0-99/8192" })],
    ["rejects a wrong total", response(206, rangeBytes(), { "Content-Range": "bytes 0-99/4096" })],
    ["rejects compressed bytes", response(206, rangeBytes(), { "Content-Range": "bytes 0-99/8192", "Content-Encoding": "gzip" })],
  ])("%s before creating a worker", async (_label, range) => {
    const worker = workerFactory();
    const client = createSnapshotClient({ fetch: createFetch({ range }), createDbWorker: worker.factory });

    await expect(client.open()).rejects.toThrow();
    expect(worker.factory).not.toHaveBeenCalled();
  });

  it("accepts an unencoded range response without a Content-Encoding header", async () => {
    const worker = workerFactory();
    const client = createSnapshotClient({
      fetch: createFetch({ range: response(206, rangeBytes(), { "Content-Range": "bytes 0-99/8192" }) }),
      createDbWorker: worker.factory,
    });

    await expect(client.open()).resolves.toMatchObject({ manifest });
  });

  it("retries a failed manifest or range preflight before creating a worker", async () => {
    const worker = workerFactory();
    const range = response(200, rangeBytes(), { "Content-Range": "bytes 0-99/8192" });
    let rangeAttempt = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = new URL(String(input));
      if (url.pathname.endsWith("/manifest.json")) return response(200, JSON.stringify(manifest));
      rangeAttempt += 1;
      return rangeAttempt === 1
        ? range.clone()
        : response(206, rangeBytes(), { "Content-Range": "bytes 0-99/8192" });
    });
    const client = createSnapshotClient({ fetch: fetcher, createDbWorker: worker.factory });

    await expect(client.open()).rejects.toThrow();
    expect(worker.factory).not.toHaveBeenCalled();

    await expect(client.open()).resolves.toMatchObject({ manifest });
    expect(worker.factory).toHaveBeenCalledTimes(1);
  });

  it("latches a failed worker initialization until page reload", async () => {
    const worker = workerFactory("sha256:" + "c".repeat(64));
    const fetcher = createFetch();
    const client = createSnapshotClient({ fetch: fetcher, createDbWorker: worker.factory });

    const first = client.open();
    await expect(first).rejects.toThrow(/snapshot ID/);
    await expect(client.open()).rejects.toThrow(/snapshot ID/);
    expect(worker.factory).toHaveBeenCalledTimes(1);
  });

  it("latches a worker factory rejection after worker creation starts", async () => {
    const factory = vi.fn(async () => { throw new Error("worker unavailable"); });
    const client = createSnapshotClient({ fetch: createFetch(), createDbWorker: factory });

    await expect(client.open()).rejects.toThrow("worker unavailable");
    await expect(client.open()).rejects.toThrow("worker unavailable");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("closes an injected database when worker initialization fails", async () => {
    const worker = workerFactory("sha256:" + "c".repeat(64));
    const close = vi.fn();
    const handle: SqliteWorkerHandle = { db: { ...worker.handle.db, close } };
    const factory: CreateSqliteWorker = vi.fn(async () => handle);
    const client = createSnapshotClient({ fetch: createFetch(), createDbWorker: factory });

    await expect(client.open()).rejects.toThrow(/snapshot ID/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsafe database descriptor without fetching it", async () => {
    const worker = workerFactory();
    const unsafe = { ...manifest, database: { ...manifest.database, file: "../private.sqlite" } };
    const fetcher = createFetch({ manifest: unsafe });
    const client = createSnapshotClient({ fetch: fetcher, createDbWorker: worker.factory });

    await expect(client.open()).rejects.toThrow(/Invalid SQLite snapshot manifest/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(worker.factory).not.toHaveBeenCalled();
  });
});
