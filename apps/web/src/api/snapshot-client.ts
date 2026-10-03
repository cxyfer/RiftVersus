import { createDbWorker as createSqliteWorker } from "sql.js-httpvfs";
import workerAssetUrl from "sql.js-httpvfs/dist/sqlite.worker.js?url";
import wasmAssetUrl from "sql.js-httpvfs/dist/sql-wasm.wasm?url";
import { SqliteManifestSchema, type SqliteManifest } from "@riftversus/contracts";
import type { SqliteExecutor } from "@riftversus/domain";

export type SqliteParameter = string | number | null;

export type SplitFileConfig = {
  from: "inline";
  config: {
    serverMode: "chunked";
    requestChunkSize: number;
    urlPrefix: string;
    serverChunkSize: number;
    databaseLengthBytes: number;
    suffixLength: number;
  };
};

export interface SqliteExecResult {
  columns: string[];
  values: unknown[][];
}

export interface SqliteDatabaseHandle {
  exec(sql: string, params?: readonly SqliteParameter[]): Promise<SqliteExecResult[]>;
  close?: () => void | Promise<void>;
}

export interface SqliteWorkerHandle {
  db: SqliteDatabaseHandle;
}

export type CreateSqliteWorker = (
  configs: SplitFileConfig[],
  workerUrl: string,
  wasmUrl: string,
  maxBytesToRead: number,
) => Promise<SqliteWorkerHandle>;

export interface SqliteSnapshotClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  createDbWorker?: CreateSqliteWorker;
  workerUrl?: string;
  wasmUrl?: string;
}

export interface OpenSqliteSnapshot {
  manifest: SqliteManifest;
  executor: SqliteExecutor;
}

export interface SqliteSnapshotClient {
  open(): Promise<OpenSqliteSnapshot>;
}

const DEFAULT_BASE_URL = import.meta.env.BASE_URL;
const SQLITE_HEADER = "SQLite format 3\u0000";
const RANGE_END = 99;
const MAX_BYTES_TO_READ = 128 * 1024 * 1024;

function requestPath(url: URL): string {
  return url.pathname;
}

function requestError(url: URL, status: number): Error {
  return new Error(`Static SQLite request failed: ${status} ${requestPath(url)}`);
}

function invalidManifestError(path: string): Error {
  return new Error(`Invalid SQLite snapshot manifest at ${path}.`);
}

function baseUrl(value: string | undefined): URL {
  const raw = value ?? DEFAULT_BASE_URL ?? "/";
  const current = typeof window === "undefined" ? "http://localhost/" : window.location.href;
  const url = new URL(raw, current);
  if (url.origin !== new URL(current).origin || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/")) {
    throw new Error("Static SQLite base URL must be same-origin and end with a slash.");
  }
  return url;
}

function resolveDatabaseUrl(manifestUrl: URL, base: URL, manifest: SqliteManifest): URL {
  const url = new URL(manifest.database.file, manifestUrl);
  const dataRoot = new URL("data/", base);
  if (url.origin !== base.origin || !url.pathname.startsWith(dataRoot.pathname) || url.search || url.hash) {
    throw invalidManifestError(requestPath(manifestUrl));
  }
  return url;
}

function singleChunkUrls(databaseUrl: URL): { urlPrefix: string; firstUrl: URL } {
  const prefixUrl = new URL(databaseUrl);
  prefixUrl.search = "?chunk=";
  const urlPrefix = prefixUrl.toString();
  return { urlPrefix, firstUrl: new URL(`${urlPrefix}0`) };
}

function parseContentRange(value: string | null, expectedSize: number): void {
  const match = /^bytes 0-99\/(\d+)$/u.exec(value ?? "");
  if (match === null || Number(match[1]) !== expectedSize) throw new Error("SQLite range preflight returned an invalid content range.");
}

function verifySqliteHeader(bytes: Uint8Array, pageSize: number): void {
  if (bytes.byteLength !== RANGE_END + 1) throw new Error("SQLite range preflight returned an invalid byte count.");
  const header = new TextDecoder("ascii").decode(bytes.slice(0, SQLITE_HEADER.length));
  if (header !== SQLITE_HEADER) throw new Error("SQLite range preflight returned an invalid header.");
  const encodedPageSize = (bytes[16]! << 8) | bytes[17]!;
  const actualPageSize = encodedPageSize === 1 ? 65_536 : encodedPageSize;
  if (actualPageSize !== pageSize) throw new Error("SQLite range preflight returned an invalid page size.");
}

async function preflightDatabase(fetcher: typeof globalThis.fetch, url: URL, manifest: SqliteManifest): Promise<void> {
  const response = await fetcher(url, {
    credentials: "same-origin",
    headers: { Accept: "application/octet-stream", Range: `bytes=0-${RANGE_END}` },
  });
  if (response.status !== 206) {
    cancelResponse(response);
    throw requestError(url, response.status);
  }
  const contentEncoding = response.headers.get("content-encoding")?.toLowerCase() ?? null;
  if (contentEncoding !== null && contentEncoding !== "identity") {
    cancelResponse(response);
    throw new Error("SQLite range preflight requires identity content encoding.");
  }
  try {
    parseContentRange(response.headers.get("content-range"), manifest.database.byteSize);
    verifySqliteHeader(new Uint8Array(await response.arrayBuffer()), manifest.database.pageSize);
  } catch (error) {
    cancelResponse(response);
    throw error;
  }
}

function cancelResponse(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    if (cancellation !== undefined) void cancellation.catch(() => undefined);
  } catch {
    // Preserve the original HTTP/preflight error.
  }
}

function rowsFromExec<T extends Record<string, unknown>>(result: SqliteExecResult | undefined): T[] {
  if (result === undefined) return [];
  return result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])) as T);
}

function createExecutor(database: SqliteDatabaseHandle): SqliteExecutor {
  return {
    async all<T extends Record<string, unknown>>(sql: string, params: readonly SqliteParameter[]): Promise<T[]> {
      const result = await database.exec(sql, [...params]);
      return rowsFromExec<T>(result[0]);
    },
  };
}

async function cleanup(handle: SqliteWorkerHandle): Promise<void> {
  try {
    await handle.db.close?.();
  } catch {
    // Preserve the original initialization error.
  }
}

async function loadManifest(fetcher: typeof globalThis.fetch, base: URL): Promise<{ manifest: SqliteManifest; manifestUrl: URL; databaseUrl: URL }> {
  const manifestUrl = new URL("data/manifest.json", base);
  const response = await fetcher(manifestUrl, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) throw requestError(manifestUrl, response.status);
  let manifest: SqliteManifest;
  try {
    manifest = SqliteManifestSchema.parse(await response.json());
  } catch {
    throw invalidManifestError(requestPath(manifestUrl));
  }
  return { manifest, manifestUrl, databaseUrl: resolveDatabaseUrl(manifestUrl, base, manifest) };
}

async function loadOpenSnapshot(
  base: URL,
  fetcher: typeof globalThis.fetch,
  createWorker: CreateSqliteWorker,
  workerUrl: string,
  wasmUrl: string,
  maxBytesToRead: number,
  onWorkerStart: () => void,
): Promise<OpenSqliteSnapshot> {
  const { manifest, databaseUrl } = await loadManifest(fetcher, base);
  const chunkUrls = singleChunkUrls(databaseUrl);
  await preflightDatabase(fetcher, chunkUrls.firstUrl, manifest);
  const config: SplitFileConfig = {
    from: "inline",
    config: {
      serverMode: "chunked",
      requestChunkSize: manifest.database.requestChunkSize,
      urlPrefix: chunkUrls.urlPrefix,
      serverChunkSize: manifest.database.byteSize,
      databaseLengthBytes: manifest.database.byteSize,
      suffixLength: 0,
    },
  };
  let handle: SqliteWorkerHandle | undefined;
  try {
    onWorkerStart();
    handle = await createWorker([config], workerUrl, wasmUrl, maxBytesToRead);
    const metadata = await createExecutor(handle.db).all<{ value: string }>("SELECT value FROM metadata WHERE key = ?", ["snapshotId"]);
    let snapshotId: unknown;
    try {
      snapshotId = JSON.parse(metadata[0]?.value ?? "");
    } catch {
      snapshotId = undefined;
    }
    if (snapshotId !== manifest.snapshotId) throw new Error("SQLite snapshot ID does not match its manifest.");
    return { manifest, executor: createExecutor(handle.db) };
  } catch (error) {
    if (handle !== undefined) await cleanup(handle);
    throw error;
  }
}

export function createSnapshotClient(options: SqliteSnapshotClientOptions = {}): SqliteSnapshotClient {
  const base = baseUrl(options.baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const createWorker = options.createDbWorker ?? (createSqliteWorker as unknown as CreateSqliteWorker);
  const workerUrl = options.workerUrl ?? workerAssetUrl;
  const wasmUrl = options.wasmUrl ?? wasmAssetUrl;
  let loaded: OpenSqliteSnapshot | undefined;
  let pending: Promise<OpenSqliteSnapshot> | undefined;
  // sql.js-httpvfs hides its native Worker; failed post-creation opens stay latched until page reload.
  let fatal: Promise<OpenSqliteSnapshot> | undefined;

  return {
    open() {
      if (loaded !== undefined) return Promise.resolve(loaded);
      if (fatal !== undefined) return fatal;
      if (pending !== undefined) return pending;
      let workerStarted = false;
      const request = loadOpenSnapshot(base, fetcher, createWorker, workerUrl, wasmUrl, MAX_BYTES_TO_READ, () => { workerStarted = true; }).then((snapshot) => {
        loaded = snapshot;
        return snapshot;
      }).catch((error: unknown) => {
        if (workerStarted) fatal = request;
        else pending = undefined;
        throw error;
      });
      pending = request;
      return pending;
    },
  };
}
