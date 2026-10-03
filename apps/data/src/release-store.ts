import { createHash } from "node:crypto";

import { z } from "zod";

const API_ORIGIN = "https://api.github.com";
const UPLOADS_ORIGIN = "https://uploads.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const PAGE_SIZE = 100;
const MAX_REDIRECTS = 5;
export const MAX_UPLOAD_BYTES = (2 * 1024 ** 3) - 1;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TRANSFER_TIMEOUT_MS = 10 * 60_000;
const SHA256 = /^[a-f0-9]{64}$/;
const RELEASE_TAG_PREFIXES = ["checkpoint-", "attempt-", "site-"] as const;
const SAFE_REPOSITORY_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/u;
const SAFE_ASSET_BASENAME = /^[\x20-\x7e]+$/u;
const ASSET_REDIRECT_HOSTS = new Set([
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

const ReleaseAssetSchema = z.object({
  id: z.number().int().positive().safe(),
  name: z.string().min(1),
  size: z.number().int().nonnegative().safe(),
  content_type: z.string().min(1).nullable().optional(),
}).passthrough();

const ReleaseSchema = z.object({
  id: z.number().int().positive().safe(),
  tag_name: z.string().min(1),
  draft: z.boolean(),
  assets: z.array(ReleaseAssetSchema).optional(),
}).passthrough();

const ReleaseListSchema = z.array(ReleaseSchema);
const ReleaseAssetListSchema = z.array(ReleaseAssetSchema);

export type ReleaseAsset = z.infer<typeof ReleaseAssetSchema>;
export type Release = z.infer<typeof ReleaseSchema>;

export interface CreateDraftInput {
  tag: string;
  targetCommitish: string;
  body: string;
}

export interface UploadAssetInput {
  name: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface DownloadExpected {
  byteSize: number;
  checksum: string;
}

export interface ReleaseStoreOptions {
  repository: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  transferTimeoutMs?: number;
}

export interface ReleaseStore {
  listReleases(): Promise<Release[]>;
  getRelease(tag: string): Promise<Release | null>;
  createDraft(input: CreateDraftInput): Promise<Release>;
  listAssets(releaseId: number): Promise<ReleaseAsset[]>;
  uploadAsset(releaseId: number, input: UploadAssetInput): Promise<ReleaseAsset>;
  downloadAsset(assetId: number, expected: DownloadExpected): Promise<Uint8Array>;
  publishDraft(releaseId: number): Promise<Release>;
}

interface RequestOptions {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
}

function assertRepository(repository: string): void {
  const segments = typeof repository === "string" ? repository.split("/") : [];
  if (segments.length !== 2 || segments.some((segment) => !SAFE_REPOSITORY_SEGMENT.test(segment))) {
    throw new Error("GitHub repository must have the form owner/repository.");
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required.`);
}

function assertId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`);
}

function assertTimeout(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite safe integer.`);
  }
}

function assertReleaseTag(tag: string): void {
  assertNonEmpty(tag, "Release tag");
  if (!RELEASE_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix))) {
    throw new Error("Release tag must start with checkpoint-, attempt-, or site-.");
  }
}

function assertAssetName(name: string): void {
  if (typeof name !== "string" || !SAFE_ASSET_BASENAME.test(name) || name === "." || name === ".." || /[\\/]/u.test(name)) {
    throw new Error("Release asset name must be a valid basename.");
  }
}

function assertExpected(expected: DownloadExpected): void {
  if (!Number.isSafeInteger(expected.byteSize) || expected.byteSize < 0) {
    throw new Error("Expected asset byteSize must be a non-negative safe integer.");
  }
  if (!SHA256.test(expected.checksum)) throw new Error("Expected asset checksum must be a lowercase SHA-256 digest.");
  if (expected.byteSize >= Number.MAX_SAFE_INTEGER) throw new Error("Expected asset byteSize is too large.");
}

function pathFor(url: URL): string {
  return url.pathname;
}

function apiHeaders(token: string, additional: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    ...additional,
  };
}

function assetDownloadHeaders(token: string | null): Record<string, string> {
  return token === null
    ? { Accept: "application/octet-stream" }
    : apiHeaders(token, { Accept: "application/octet-stream" });
}

function requestUrl(origin: string, repositoryPath: string, suffix: string): URL {
  return new URL(`/repos/${repositoryPath}${suffix}`, origin);
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function httpError(response: Response, method: string, url: URL): Error {
  return new Error(`GitHub request failed: HTTP ${response.status} ${method} ${pathFor(url)}`);
}

async function expectStatus(response: Response, status: number, method: string, url: URL): Promise<void> {
  if (response.status === status) return;
  await cancelBody(response);
  throw httpError(response, method, url);
}

async function parseJson<T>(response: Response, schema: z.ZodType<T>, method: string, url: URL): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`GitHub response is not valid JSON: ${method} ${pathFor(url)}`);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error(`GitHub response has invalid metadata: ${method} ${pathFor(url)}`);
  return parsed.data;
}

function queryPage(url: URL, page: number): URL {
  url.searchParams.set("per_page", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  return url;
}

function bodyBytes(bytes: Uint8Array): BodyInit {
  return bytes as unknown as BodyInit;
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function readVerifiedAsset(response: Response, expected: DownloadExpected, path: string, signal: AbortSignal): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/u.test(declaredLength) && Number(declaredLength) > expected.byteSize) {
    await cancelBody(response);
    throw new Error(`GitHub asset size mismatch: ${path}`);
  }

  if (response.body === null) {
    if (expected.byteSize !== 0 || expected.checksum !== createHash("sha256").digest("hex")) {
      throw new Error(`GitHub asset size or checksum mismatch: ${path}`);
    }
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await withAbort(reader.read(), signal);
      if (result.done) break;
      if (total + result.value.byteLength > expected.byteSize) {
        throw new Error(`GitHub asset size mismatch: ${path}`);
      }
      total += result.value.byteLength;
      hash.update(result.value);
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (total !== expected.byteSize || hash.digest("hex") !== expected.checksum) {
    throw new Error(`GitHub asset size or checksum mismatch: ${path}`);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createReleaseStore(options: ReleaseStoreOptions): ReleaseStore {
  assertRepository(options.repository);
  if (typeof options.token !== "string" || options.token.trim().length === 0) throw new Error("GitHub token is required.");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transferTimeoutMs = options.transferTimeoutMs ?? options.timeoutMs ?? DEFAULT_TRANSFER_TIMEOUT_MS;
  assertTimeout(timeoutMs, "timeoutMs");
  assertTimeout(transferTimeoutMs, "transferTimeoutMs");
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new Error("A fetch implementation is required.");

  const repositoryPath = options.repository.split("/").map(encodeURIComponent).join("/");

  async function request(request: RequestOptions): Promise<Response> {
    const signal = request.signal ?? AbortSignal.timeout(timeoutMs);
    const init: RequestInit = {
      method: request.method,
      redirect: "manual",
      signal,
    };
    if (request.headers !== undefined) init.headers = request.headers;
    if (request.body !== undefined) init.body = request.body;
    return fetchImplementation(request.url, init);
  }

  return {
    async listReleases(): Promise<Release[]> {
      const releases: Release[] = [];
      for (let page = 1; ; page += 1) {
        const url = queryPage(requestUrl(API_ORIGIN, repositoryPath, "/releases"), page);
        const response = await request({ method: "GET", url, headers: apiHeaders(options.token) });
        await expectStatus(response, 200, "GET", url);
        const pageReleases = await parseJson(response, ReleaseListSchema, "GET", url);
        releases.push(...pageReleases);
        if (pageReleases.length < PAGE_SIZE) return releases;
      }
    },

    async getRelease(tag: string): Promise<Release | null> {
      assertNonEmpty(tag, "Release tag");
      const url = requestUrl(API_ORIGIN, repositoryPath, `/releases/tags/${encodeURIComponent(tag)}`);
      const response = await request({ method: "GET", url, headers: apiHeaders(options.token) });
      if (response.status === 404) {
        await cancelBody(response);
        return null;
      }
      await expectStatus(response, 200, "GET", url);
      return parseJson(response, ReleaseSchema, "GET", url);
    },

    async createDraft(input: CreateDraftInput): Promise<Release> {
      assertReleaseTag(input.tag);
      assertNonEmpty(input.targetCommitish, "Release target commitish");
      if (typeof input.body !== "string") throw new Error("Release body is required.");
      const url = requestUrl(API_ORIGIN, repositoryPath, "/releases");
      const response = await request({
        method: "POST",
        url,
        headers: apiHeaders(options.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          tag_name: input.tag,
          target_commitish: input.targetCommitish,
          body: input.body,
          draft: true,
        }),
      });
      await expectStatus(response, 201, "POST", url);
      return parseJson(response, ReleaseSchema, "POST", url);
    },

    async listAssets(releaseId: number): Promise<ReleaseAsset[]> {
      assertId(releaseId, "Release id");
      const assets: ReleaseAsset[] = [];
      for (let page = 1; ; page += 1) {
        const url = queryPage(requestUrl(API_ORIGIN, repositoryPath, `/releases/${releaseId}/assets`), page);
        const response = await request({ method: "GET", url, headers: apiHeaders(options.token) });
        await expectStatus(response, 200, "GET", url);
        const pageAssets = await parseJson(response, ReleaseAssetListSchema, "GET", url);
        assets.push(...pageAssets);
        if (pageAssets.length < PAGE_SIZE) return assets;
      }
    },

    async uploadAsset(releaseId: number, input: UploadAssetInput): Promise<ReleaseAsset> {
      assertId(releaseId, "Release id");
      assertAssetName(input.name);
      if (!(input.bytes instanceof Uint8Array)) throw new Error("Release asset bytes must be a Uint8Array.");
      if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("Release asset must be smaller than 2 GiB.");
      assertNonEmpty(input.contentType, "Release asset content type");
      const url = requestUrl(UPLOADS_ORIGIN, repositoryPath, `/releases/${releaseId}/assets`);
      url.searchParams.set("name", input.name);
      const response = await request({
        method: "POST",
        url,
        headers: apiHeaders(options.token, {
          "Content-Type": input.contentType,
          "Content-Length": String(input.bytes.byteLength),
        }),
        body: bodyBytes(input.bytes),
        signal: AbortSignal.timeout(transferTimeoutMs),
      });
      await expectStatus(response, 201, "POST", url);
      return parseJson(response, ReleaseAssetSchema, "POST", url);
    },

    async downloadAsset(assetId: number, expected: DownloadExpected): Promise<Uint8Array> {
      assertId(assetId, "Asset id");
      assertExpected(expected);
      let url = requestUrl(API_ORIGIN, repositoryPath, `/releases/assets/${assetId}`);
      let token: string | null = options.token;
      const transferSignal = AbortSignal.timeout(transferTimeoutMs);
      for (let redirects = 0; ; redirects += 1) {
        const response = await request({ method: "GET", url, headers: assetDownloadHeaders(token), signal: transferSignal });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await cancelBody(response);
          if (location === null) throw new Error(`GitHub asset redirect has no Location header: ${pathFor(url)}`);
          if (redirects >= MAX_REDIRECTS) throw new Error(`GitHub asset exceeded redirect limit: ${pathFor(url)}`);
          const next = new URL(location, url);
          if (
            next.protocol !== "https:"
            || (next.port !== "" && next.port !== "443")
            || next.username.length > 0
            || next.password.length > 0
            || !ASSET_REDIRECT_HOSTS.has(next.hostname.toLowerCase())
          ) {
            throw new Error(`GitHub asset redirect host is not trusted: ${next.hostname}`);
          }
          url = next;
          token = null;
          continue;
        }
        await expectStatus(response, 200, "GET", url);
        return readVerifiedAsset(response, expected, pathFor(url), transferSignal);
      }
    },

    async publishDraft(releaseId: number): Promise<Release> {
      assertId(releaseId, "Release id");
      const url = requestUrl(API_ORIGIN, repositoryPath, `/releases/${releaseId}`);
      const response = await request({
        method: "PATCH",
        url,
        headers: apiHeaders(options.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ draft: false }),
      });
      await expectStatus(response, 200, "PATCH", url);
      return parseJson(response, ReleaseSchema, "PATCH", url);
    },
  };
}
