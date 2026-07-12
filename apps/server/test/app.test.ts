import type { ComparisonResponse, Dataset, ResolvedSubject } from "@riftversus/contracts";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";

const leftId = "00000000-0000-4000-8000-000000000001";
const rightId = "00000000-0000-4000-8000-000000000002";

const dataset: Dataset = {
  version: "2026-07-12.1",
  lastSuccessfulSyncAt: "2026-07-12T00:00:00.000Z",
  coverage: { from: "2020-01-01", to: "2026-07-12" },
};

const left: ResolvedSubject = { id: leftId, kind: "team", displayName: "Left" };
const right: ResolvedSubject = { id: rightId, kind: "team", displayName: "Right" };

function comparison(): ComparisonResponse {
  return {
    subjects: { left, right },
    query: { left: { id: leftId, kind: "team" }, right: { id: rightId, kind: "team" }, eventCategories: [], leagues: [], bestOf: [], tournamentIds: [], limit: 50 },
    seriesSummary: { wins: 1, losses: 0, total: 1, winRate: 1 },
    gameSummary: { wins: 2, losses: 0, total: 2, winRate: 1 },
    rows: [],
    dataset,
    coverageWarnings: [],
    mediaUrls: { left: "/media/left.png", right: "/media/right.png" },
  };
}

function createDependencies(overrides: Partial<Parameters<typeof buildApp>[0]> = {}) {
  return {
    searchEntities: vi.fn(async () => ({ entities: [left] })),
    listFilters: vi.fn(async () => ({ eventCategories: ["worlds" as const], tournaments: [], bestOf: [5 as const] })),
    compare: vi.fn(async () => comparison()),
    getDataset: vi.fn(async () => dataset),
    getMedia: vi.fn(async () => null),
    ...overrides,
  };
}

const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createApp(overrides: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const dependencies = createDependencies(overrides);
  const app = buildApp(dependencies);
  apps.push(app);
  return { app, dependencies };
}

describe("HTTP API", () => {
  it("normalizes an entity query before passing it to the repository", async () => {
    const { app, dependencies } = createApp();

    const response = await app.inject("/api/entities?q=%20Left%20&kinds=team,region&limit=10");

    expect(response.statusCode).toBe(200);
    expect(dependencies.searchEntities).toHaveBeenCalledWith({ query: "Left", kinds: ["team", "region"], limit: 10 });
  });

  it("returns contract-shaped 400 errors for invalid comparison queries", async () => {
    const { app } = createApp();

    const response = await app.inject("/api/comparisons?left.id=not-a-uuid");

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("normalizes league filters before calling the comparison owner", async () => {
    const { app, dependencies } = createApp();
    const response = await app.inject(`/api/comparisons?left.kind=team&left.id=${leftId}&right.kind=team&right.id=${rightId}&leagues=lpl,lck`);
    expect(response.statusCode).toBe(200);
    expect(dependencies.compare).toHaveBeenCalledWith(expect.objectContaining({ leagues: ["lck", "lpl"] }));
  });

  it("rejects an invalid comparison cursor with a safe validation envelope", async () => {
    const { app, dependencies } = createApp();

    const response = await app.inject(`/api/comparisons?left.kind=team&left.id=${leftId}&right.kind=team&right.id=${rightId}&cursor=not-a-cursor`);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(dependencies.compare).not.toHaveBeenCalled();
  });

  it("rejects an empty comparison cursor with a validation envelope", async () => {
    const { app, dependencies } = createApp();

    const response = await app.inject(`/api/comparisons?left.kind=team&left.id=${leftId}&right.kind=team&right.id=${rightId}&cursor=`);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(dependencies.compare).not.toHaveBeenCalled();
  });

  it("returns 404 when comparison subjects are missing", async () => {
    const { app } = createApp({ compare: vi.fn(async () => null) });

    const response = await app.inject(`/api/comparisons?left.kind=team&left.id=${leftId}&right.kind=team&right.id=${rightId}`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("maps a repository unknown-subject error to 404", async () => {
    const { app } = createApp({ compare: vi.fn(async () => { throw new Error("Unknown team subject: missing"); }) });

    const response = await app.inject(`/api/comparisons?left.kind=team&left.id=${leftId}&right.kind=team&right.id=${rightId}`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("returns the current filter and dataset representations", async () => {
    const { app } = createApp();

    await expect(app.inject("/api/filters")).resolves.toMatchObject({ statusCode: 200 });
    const response = await app.inject("/api/dataset");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(dataset);
  });

  it("delivers nested published media keys and rejects traversal encodings", async () => {
    const { app, dependencies } = createApp({
      getMedia: vi.fn(async (key: string) => key === "media/faker.png" ? {
        objectKey: key, sourceUrl: "https://media.example.test/faker.png", contentType: "image/png", entityId: leftId, teamEraId: null,
      } : null),
    });
    const media = await app.inject("/media/media/faker.png");
    expect(media.statusCode).toBe(302);
    expect(media.headers.location).toBe("https://media.example.test/faker.png");
    expect(dependencies.getMedia).toHaveBeenCalledWith("media/faker.png");
    for (const url of ["/media/media%2Ffaker.png", "/media/../faker.png", "/media/%2e%2e/faker.png", "/media/%252e%252e/faker.png"]) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(404);
    }
  });

  it("reports liveness without dependencies and failed readiness as 503", async () => {
    const { app } = createApp({ getDataset: vi.fn(async () => { throw new Error("connection refused"); }) });

    await expect(app.inject("/health/live")).resolves.toMatchObject({ statusCode: 200 });
    const response = await app.inject("/health/ready");
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "NOT_READY" } });
  });

  it("hides unexpected failure details behind a correlation ID", async () => {
    const { app } = createApp({ listFilters: vi.fn(async () => { throw new Error("select * from passwords; provider token"); }) });

    const response = await app.inject("/api/filters");
    const body = response.json();

    expect(response.statusCode).toBe(500);
    expect(body).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(body.error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body).not.toContain("passwords");
    expect(response.body).not.toContain("provider token");
  });

  it("returns a stable version-scoped comparison ETag and honors If-None-Match", async () => {
    const { app, dependencies } = createApp();
    const url = `/api/comparisons?right.id=${rightId}&right.kind=team&left.id=${leftId}&left.kind=team`;

    const first = await app.inject(url);
    const second = await app.inject({ url, headers: { "if-none-match": first.headers.etag! } });
    const weak = await app.inject({ url, headers: { "if-none-match": `W/${first.headers.etag}` } });
    const list = await app.inject({ url, headers: { "if-none-match": `"other", W/${first.headers.etag}` } });

    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(first.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(second.statusCode).toBe(304);
    expect(weak.statusCode).toBe(304);
    expect(list.statusCode).toBe(304);
    expect(dependencies.compare).toHaveBeenCalledTimes(4);

    const changed = createApp({ compare: vi.fn(async () => ({ ...comparison(), dataset: { ...dataset, version: "2026-07-12.2" } })) });
    const changedResponse = await changed.app.inject(url);
    expect(changedResponse.headers.etag).not.toBe(first.headers.etag);
  });

  it("does not use the SPA fallback for API or media pathnames, including roots with query strings", async () => {
    const { app } = createApp({ staticHtml: "<main>RiftVersus</main>" });

    await expect(app.inject("/comparison/left/right")).resolves.toMatchObject({ statusCode: 200, body: "<main>RiftVersus</main>" });
    await expect(app.inject("/comparison/100%25")).resolves.toMatchObject({ statusCode: 200, body: "<main>RiftVersus</main>" });
    for (const url of ["/api", "/api?preview=1", "/api/not-a-route", "/api/not-a-route?preview=1", "/media", "/media?preview=1", "/media/missing.png", "/media/missing.png?preview=1", "/%61pi/unknown", "/api%2Funknown", "/media%2Fmissing", "/%2561pi/unknown"]) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    }
  });

  it("returns a safe validation envelope for malformed URI encoding", async () => {
    const { app } = createApp({ staticHtml: "<main>RiftVersus</main>" });

    const response = await app.inject("/%ZZ");

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("returns a safe API error when a static fallback index is unavailable", async () => {
    const { app } = createApp({ staticDir: resolve("test/fixtures") });

    const response = await app.inject("/comparison/left/right");

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
