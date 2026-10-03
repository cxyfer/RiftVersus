import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createReleaseStore, MAX_UPLOAD_BYTES, type Release } from "../src/release-store.js";

const repository = "archive-owner/archive-repo";
const token = "secret-token";

function release(id: number, tag = `checkpoint-${id}`, draft = false): Release {
  return { id, tag_name: tag, draft };
}

function asset(id: number, name = `asset-${id}.bin`, size = 4) {
  return { id, name, size, content_type: "application/octet-stream" };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new Error("aborted"));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function delayedResponse(bytes: Uint8Array, milliseconds: number): Response {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        controller.enqueue(bytes);
        controller.close();
      }, milliseconds);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
    },
  });
  return new Response(body, { status: 200, headers: { "content-length": String(bytes.byteLength) } });
}

describe("GitHub release store", () => {
  it("rejects empty credentials and malformed repositories", () => {
    expect(() => createReleaseStore({ repository: "", token, fetch: vi.fn() })).toThrow("repository");
    expect(() => createReleaseStore({ repository: "owner/repo/extra", token, fetch: vi.fn() })).toThrow("repository");
    expect(() => createReleaseStore({ repository: "owner/../repo", token, fetch: vi.fn() })).toThrow("repository");
    expect(() => createReleaseStore({ repository: "owner/.", token, fetch: vi.fn() })).toThrow("repository");
    expect(() => createReleaseStore({ repository, token: "  ", fetch: vi.fn() })).toThrow("token");
  });

  it("validates API and transfer timeout options independently", () => {
    expect(() => createReleaseStore({ repository, token, timeoutMs: 0, fetch: vi.fn() })).toThrow("timeoutMs");
    expect(() => createReleaseStore({ repository, token, transferTimeoutMs: 0, fetch: vi.fn() })).toThrow("transferTimeoutMs");
  });

  it("paginates releases and assets with stable GitHub headers", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init: init ?? {} });
      if (url.pathname.endsWith("/releases") && url.searchParams.get("page") === "1") {
        return json(Array.from({ length: 100 }, (_, index) => release(index + 1)));
      }
      if (url.pathname.endsWith("/releases") && url.searchParams.get("page") === "2") {
        return json([release(101)]);
      }
      if (url.pathname.endsWith("/assets") && url.searchParams.get("page") === "1") {
        return json(Array.from({ length: 100 }, (_, index) => asset(index + 1)));
      }
      return json([asset(101)]);
    });
    const store = createReleaseStore({ repository, token, fetch });

    await expect(store.listReleases()).resolves.toHaveLength(101);
    await expect(store.listAssets(7)).resolves.toHaveLength(101);
    expect(calls.map(({ url }) => `${url.pathname}?${url.searchParams.toString()}`)).toEqual([
      "/repos/archive-owner/archive-repo/releases?per_page=100&page=1",
      "/repos/archive-owner/archive-repo/releases?per_page=100&page=2",
      "/repos/archive-owner/archive-repo/releases/7/assets?per_page=100&page=1",
      "/repos/archive-owner/archive-repo/releases/7/assets?per_page=100&page=2",
    ]);
    expect(calls[0]?.init.headers).toMatchObject({
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    });
  });

  it("returns null only for an exact release tag 404 and rejects auth failures", async () => {
    const notFound = createReleaseStore({ repository, token, fetch: vi.fn(async () => new Response(null, { status: 404 })) });
    await expect(notFound.getRelease("checkpoint-missing")).resolves.toBeNull();

    const unauthorized = createReleaseStore({ repository, token, fetch: vi.fn(async () => new Response("token must not leak", { status: 401 })) });
    await expect(unauthorized.getRelease("checkpoint-secret")).rejects.toThrow("HTTP 401 GET /repos/archive-owner/archive-repo/releases/tags/checkpoint-secret");
    await expect(unauthorized.getRelease("checkpoint-secret")).rejects.not.toThrow(token);

    let signedAssetRequest = false;
    const signedAssetFailure = createReleaseStore({
      repository,
      token,
      fetch: vi.fn(async () => {
        if (!signedAssetRequest) {
          signedAssetRequest = true;
          return new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/asset/12?X-Amz-Signature=secret" } });
        }
        return new Response("error", { status: 500 });
      }),
    });
    await expect(signedAssetFailure.downloadAsset(12, { byteSize: 0, checksum: digest(new Uint8Array()) })).rejects.toThrow("HTTP 500 GET /asset/12");
    await expect(signedAssetFailure.downloadAsset(12, { byteSize: 0, checksum: digest(new Uint8Array()) })).rejects.not.toThrow("X-Amz-Signature");
  });

  it("creates only approved draft tags and publishes drafts", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init: init ?? {} });
      return url.pathname.endsWith("/releases") ? json(release(9, "checkpoint-9", true), 201) : json(release(9, "checkpoint-9", false));
    });
    const store = createReleaseStore({ repository, token, fetch });

    await expect(store.createDraft({ tag: "checkpoint-9", targetCommitish: "archive-code-sha", body: "checkpoint" })).resolves.toMatchObject({ draft: true });
    await expect(store.publishDraft(9)).resolves.toMatchObject({ draft: false });
    await expect(store.createDraft({ tag: "release-9", targetCommitish: "archive-code-sha", body: "checkpoint" })).rejects.toThrow("checkpoint-, attempt-, or site-");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      tag_name: "checkpoint-9",
      target_commitish: "archive-code-sha",
      body: "checkpoint",
      draft: true,
    });
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ draft: false });
    expect(calls[0]?.init.headers).toMatchObject({ "X-GitHub-Api-Version": "2022-11-28" });
  });

  it("uploads assets through uploads.github.com and validates name and size before fetch", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init: init ?? {} });
      await delay(25, init?.signal);
      return json(asset(12, "database.dump", 3), 201);
    });
    const store = createReleaseStore({ repository, token, timeoutMs: 5, transferTimeoutMs: 100, fetch });
    const bytes = new TextEncoder().encode("dump");

    await expect(store.uploadAsset(9, { name: "database.dump", bytes, contentType: "application/octet-stream" })).resolves.toMatchObject({ id: 12, name: "database.dump" });
    expect(calls[0]?.url.origin).toBe("https://uploads.github.com");
    expect(calls[0]?.url.pathname).toBe("/repos/archive-owner/archive-repo/releases/9/assets");
    expect(calls[0]?.url.searchParams.get("name")).toBe("database.dump");
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
    });
    await expect(store.uploadAsset(9, { name: "../database.dump", bytes, contentType: "application/octet-stream" })).rejects.toThrow("valid basename");
    await expect(store.uploadAsset(9, { name: "資料.dump", bytes, contentType: "application/octet-stream" })).rejects.toThrow("valid basename");

    const oversized = new Uint8Array(1);
    Object.defineProperty(oversized, "byteLength", { value: MAX_UPLOAD_BYTES + 1 });
    await expect(store.uploadAsset(9, { name: "large.bin", bytes: oversized, contentType: "application/octet-stream" })).rejects.toThrow("smaller than 2 GiB");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the transfer timeout for slow bodies while metadata keeps the API timeout", async () => {
    const bytes = new TextEncoder().encode("slow asset");
    const metadata = createReleaseStore({
      repository,
      token,
      timeoutMs: 5,
      transferTimeoutMs: 100,
      fetch: vi.fn(async (_input, init) => {
        await delay(25, init?.signal);
        return json([release(1)]);
      }),
    });
    await expect(metadata.listReleases()).rejects.toMatchObject({ name: "TimeoutError" });

    const assetStore = createReleaseStore({
      repository,
      token,
      timeoutMs: 5,
      transferTimeoutMs: 100,
      fetch: vi.fn(async () => delayedResponse(bytes, 25)),
    });
    await expect(assetStore.downloadAsset(12, { byteSize: bytes.byteLength, checksum: digest(bytes) })).resolves.toEqual(bytes);
  });

  it("shares one transfer deadline across redirects and body streaming", async () => {
    const bytes = new TextEncoder().encode("slow asset");
    const signals: AbortSignal[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      if (signals.length === 1) {
        await delay(20);
        return new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/asset/12" } });
      }
      return delayedResponse(bytes, 20);
    });
    const store = createReleaseStore({ repository, token, timeoutMs: 5, transferTimeoutMs: 30, fetch });

    await expect(store.downloadAsset(12, { byteSize: bytes.byteLength, checksum: digest(bytes) })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
  });

  it("follows trusted asset redirects without forwarding Authorization", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const bytes = new TextEncoder().encode("asset bytes");
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init: init ?? {} });
      if (calls.length === 1) return new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/asset/12" } });
      return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.byteLength) } });
    });
    const store = createReleaseStore({ repository, token, fetch });

    await expect(store.downloadAsset(12, { byteSize: bytes.byteLength, checksum: digest(bytes) })).resolves.toEqual(bytes);
    expect(calls[0]?.url.origin).toBe("https://api.github.com");
    expect(calls[1]?.url.origin).toBe("https://release-assets.githubusercontent.com");
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
    expect(calls[1]?.init.headers).not.toHaveProperty("Authorization");
    expect(calls[1]?.init.headers).toMatchObject({ Accept: "application/octet-stream" });
  });

  it("rejects checksum mismatches and untrusted redirect hosts", async () => {
    const bytes = new TextEncoder().encode("actual");
    const mismatch = createReleaseStore({
      repository,
      token,
      fetch: vi.fn(async () => new Response(bytes, { status: 200 })),
    });
    await expect(mismatch.downloadAsset(12, { byteSize: bytes.byteLength, checksum: digest(new TextEncoder().encode("expected")) })).rejects.toThrow("checksum");

    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/asset/12" } }));
    const untrusted = createReleaseStore({ repository, token, fetch });
    await expect(untrusted.downloadAsset(12, { byteSize: 0, checksum: digest(new Uint8Array()) })).rejects.toThrow("not trusted");
    expect(fetch).toHaveBeenCalledTimes(1);

    for (const location of [
      "https://release-assets.githubusercontent.com:8443/asset/12",
      "https://user:password@release-assets.githubusercontent.com/asset/12?X-Amz-Signature=secret",
    ]) {
      const redirect = createReleaseStore({
        repository,
        token,
        fetch: vi.fn(async () => new Response(null, { status: 302, headers: { location } })),
      });
      await expect(redirect.downloadAsset(12, { byteSize: 0, checksum: digest(new Uint8Array()) })).rejects.toThrow("not trusted");
    }
  });
});
