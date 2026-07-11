import type { ComparisonResponse, Dataset, ResolvedSubject } from "@riftversus/contracts";
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
    query: { left: { id: leftId, kind: "team" }, right: { id: rightId, kind: "team" }, eventCategories: [], bestOf: [], tournamentIds: [], limit: 50 },
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

    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(first.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(second.statusCode).toBe(304);
    expect(dependencies.compare).toHaveBeenCalledTimes(2);

    const changed = createApp({ compare: vi.fn(async () => ({ ...comparison(), dataset: { ...dataset, version: "2026-07-12.2" } })) });
    const changedResponse = await changed.app.inject(url);
    expect(changedResponse.headers.etag).not.toBe(first.headers.etag);
  });

  it("does not use the SPA fallback for API or media paths", async () => {
    const { app } = createApp({ staticHtml: "<main>RiftVersus</main>" });

    await expect(app.inject("/comparison/left/right")).resolves.toMatchObject({ statusCode: 200, body: "<main>RiftVersus</main>" });
    await expect(app.inject("/api/not-a-route")).resolves.toMatchObject({ statusCode: 404 });
    const media = await app.inject("/media/missing.png");
    expect(media.statusCode).toBe(404);
    expect(media.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
