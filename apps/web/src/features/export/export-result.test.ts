import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ComparisonQuery, ComparisonResponse } from "@riftversus/contracts";

import { downloadExportArtifact, exportComparison, partitionSeries, waitForExportImages } from "./export-result.js";

const mocks = vi.hoisted(() => ({
  toPng: vi.fn<(root: HTMLElement) => Promise<string>>(async () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+IE4C8QAAAABJRU5ErkJggg=="),
  zipGenerateAsync: vi.fn(async () => new Blob(["zip"], { type: "application/zip" })),
  zipFile: vi.fn(),
}));

vi.mock("html-to-image", () => ({ toPng: mocks.toPng }));
vi.mock("jszip", () => ({ default: class { file = mocks.zipFile; generateAsync = mocks.zipGenerateAsync; } }));

const query: ComparisonQuery = {
  left: { kind: "team", id: "11111111-1111-4111-8111-111111111111" },
  right: { kind: "region", id: "77777777-7777-4777-8777-777777777777" },
  eventCategories: ["worlds"],
  leagues: ["lpl"],
  bestOf: [5],
  tournamentIds: [],
  limit: 50,
};
type SeriesRow = ComparisonResponse["rows"][number];

function row(index: number): SeriesRow {
  return {
    id: `88888888-8888-4888-8888-${String(index).padStart(12, "0")}`,
    date: `2025-11-${String((index % 28) + 1).padStart(2, "0")}`,
    event: { id: `99999999-9999-4999-8999-${String(index).padStart(12, "0")}`, name: `Worlds ${index}`, category: "worlds" },
    bestOf: 5,
    leftName: "SK Telecom T1",
    rightName: "Weibo Gaming",
    leftScore: 3,
    rightScore: index % 2,
    winner: "left",
  };
}

function response(rows: SeriesRow[], nextCursor?: string, options?: { query?: ComparisonQuery; version?: string }): ComparisonResponse {
  return {
    subjects: {
      left: { kind: "team", id: query.left.id, displayName: "T1 / Unsafe" },
      right: { kind: "region", id: query.right.id, displayName: "LPL: Elite" },
    },
    query: options?.query ?? query,
    seriesSummary: { wins: rows.length, losses: 0, total: rows.length, winRate: rows.length ? 1 : 0 },
    gameSummary: { wins: rows.length * 3, losses: rows.length, total: rows.length * 4, winRate: rows.length ? 0.75 : 0 },
    rows,
    ...(nextCursor ? { nextCursor } : {}),
    dataset: { version: options?.version ?? "release/2026.07", lastSuccessfulSyncAt: "2026-07-12T00:00:00.000Z", coverage: { from: "2019-01-01", to: "2026-07-12" } },
    coverageWarnings: [],
    mediaUrls: { left: "/media/t1.svg", right: "/media/lpl.svg" },
  };
}

function apiFor(rows: SeriesRow[]) {
  return {
    compare: vi.fn(async (request: ComparisonQuery) => {
      const start = request.cursor ? Number(request.cursor) : 0;
      const page = rows.slice(start, start + 50);
      const next = start + page.length < rows.length ? String(start + page.length) : undefined;
      return response(page, next);
    }),
  };
}

describe("browser comparison export", () => {
  const completeDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete");
  const naturalWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth");

  beforeEach(() => {
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 100 });
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.querySelectorAll(".export-sheet").forEach((node) => node.remove());
    if (completeDescriptor) Object.defineProperty(HTMLImageElement.prototype, "complete", completeDescriptor);
    if (naturalWidthDescriptor) Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", naturalWidthDescriptor);
  });

  it("partitions series rows at the requested page size without reordering", () => {
    expect(partitionSeries([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(partitionSeries([], 50)).toEqual([]);
  });

  it.each([0, 1, 50] as const)("exports %s rows as one valid PNG", async (count) => {
    const rows = Array.from({ length: count }, (_, index) => row(index + 1));
    const api = apiFor(rows);
    const artifact = await exportComparison({ api, query, initial: response(rows.slice(0, 50), count > 50 ? "50" : undefined), now: new Date("2026-07-12T12:34:56.000Z") });

    expect(artifact.kind).toBe("png");
    expect(artifact.blob.type).toBe("image/png");
    expect(artifact.filename).toMatch(/^riftversus-t1-unsafe-vs-lpl-elite-release-2026-07\.png$/);
    expect(mocks.toPng).toHaveBeenCalledTimes(1);
    expect((mocks.toPng.mock.calls[0]?.[0] as HTMLElement).textContent).toContain("WORLDS");
    expect(document.querySelector(".export-sheet")).toBeNull();
  });

  it.each([[51, 2], [101, 3]] as const)("exports %s rows into a %s-page ZIP preserving 50-row pages", async (count, pages) => {
    const rows = Array.from({ length: count }, (_, index) => row(index + 1));
    const api = apiFor(rows);
    const artifact = await exportComparison({ api, query, initial: response(rows.slice(0, 50), count > 50 ? "50" : undefined), now: new Date("2026-07-12T12:34:56.000Z") });

    expect(artifact.kind).toBe("zip");
    expect(artifact.blob.type).toBe("application/zip");
    expect(mocks.zipFile).toHaveBeenCalledTimes(pages);
    expect(mocks.zipFile.mock.calls.map(([filename]) => filename)).toEqual(Array.from({ length: pages }, (_, index) => `riftversus-t1-unsafe-vs-lpl-elite-release-2026-07-${String(index + 1).padStart(2, "0")}.png`));
    expect(mocks.toPng).toHaveBeenCalledTimes(pages);
    expect(api.compare).toHaveBeenCalledTimes(pages - 1);
  });

  it("keeps active metadata and source row order on every exported page", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => row(index + 1));
    await exportComparison({ api: apiFor(rows), query, initial: response(rows.slice(0, 50), "50"), now: new Date("2026-07-12T12:34:56.000Z") });

    const firstRoot = mocks.toPng.mock.calls[0]?.[0] as HTMLElement;
    const secondRoot = mocks.toPng.mock.calls[1]?.[0] as HTMLElement;
    expect(firstRoot.textContent).toContain("DATASET release/2026.07");
    expect(firstRoot.textContent).toContain("WORLDS · LPL · BO5");
    expect(firstRoot.textContent).toContain("T1 / Unsafe");
    expect(firstRoot.textContent).toContain("LPL: Elite");
    expect(firstRoot.textContent).toContain("SK Telecom T1 3:1 Weibo Gaming");
    expect(secondRoot.textContent).toContain("SK Telecom T1 3:1 Weibo Gaming");
    expect(firstRoot.textContent).not.toContain("T1 / Unsafe 3:1 LPL: Elite");
    expect(secondRoot.textContent).toContain("GENERATED 2026-07-12 12:34:56 UTC");
    expect(Array.from(firstRoot.querySelectorAll(".export-sheet__row strong"), (node) => node.textContent)).toEqual(rows.slice(0, 50).map((item) => `${item.leftName} ${item.leftScore}:${item.rightScore} ${item.rightName}`));
    expect(Array.from(secondRoot.querySelectorAll(".export-sheet__row strong"), (node) => node.textContent)).toEqual(rows.slice(50).map((item) => `${item.leftName} ${item.leftScore}:${item.rightScore} ${item.rightName}`));
  });

  it("stops before capture when sequential pagination exceeds the 1000 row cap", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => row(index + 1));
    await expect(exportComparison({ api: apiFor(rows), query, initial: response(rows.slice(0, 50), "50") })).rejects.toThrow(/1,000/);
    expect(mocks.toPng).not.toHaveBeenCalled();
  });

  it("does not mix pages from a different dataset publication", async () => {
    const api = { compare: vi.fn(async () => response([row(2)], undefined, { version: "release/2026.08" })) };
    await expect(exportComparison({ api, query, initial: response([row(1)], "next") })).rejects.toThrow(/資料集版本/);
    expect(mocks.toPng).not.toHaveBeenCalled();
  });

  it("does not mix pages whose filter query changed", async () => {
    const changedQuery: ComparisonQuery = { ...query, bestOf: [1] };
    const api = { compare: vi.fn(async () => response([row(2)], undefined, { query: changedQuery })) };
    await expect(exportComparison({ api, query, initial: response([row(1)], "next") })).rejects.toThrow(/篩選條件/);
    expect(mocks.toPng).not.toHaveBeenCalled();
  });

  it("accepts equivalent filters with a different array order", async () => {
    const initialQuery: ComparisonQuery = { ...query, eventCategories: ["worlds", "league"], bestOf: [5, 3] };
    const reorderedQuery: ComparisonQuery = { ...initialQuery, eventCategories: ["league", "worlds"], bestOf: [3, 5] };
    const api = { compare: vi.fn(async () => response([row(2)], undefined, { query: reorderedQuery })) };
    await expect(exportComparison({ api, query: initialQuery, initial: response([row(1)], "next", { query: initialQuery }) })).resolves.toMatchObject({ rowCount: 2 });
  });

  it("rejects an empty page that attempts to advance its cursor", async () => {
    const api = { compare: vi.fn(async () => response([], "another-cursor")) };
    await expect(exportComparison({ api, query, initial: response([row(1)], "next") })).rejects.toThrow(/未傳回紀錄/);
    expect(mocks.toPng).not.toHaveBeenCalled();
  });

  it("waits for the fallback load before allowing the export image promise to resolve", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", { configurable: true, value: false });
    root.append(image);
    const waiting = waitForExportImages(root);
    image.dispatchEvent(new Event("error"));
    await vi.waitFor(() => expect(image.getAttribute("src")).toBe("/media-placeholder.svg"));
    let settled = false;
    void waiting.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    image.dispatchEvent(new Event("load"));
    await waiting;
  });

  it("replaces an already complete but broken image with the neutral placeholder", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    image.setAttribute("src", "/media/broken.svg");
    Object.defineProperty(image, "complete", { configurable: true, get: () => image.getAttribute("src") !== "/media-placeholder.svg" });
    Object.defineProperty(image, "naturalWidth", { configurable: true, get: () => image.getAttribute("src") === "/media-placeholder.svg" ? 100 : 0 });
    root.append(image);
    const waiting = waitForExportImages(root);
    await Promise.resolve();
    expect(image.getAttribute("src")).toBe("/media-placeholder.svg");
    image.dispatchEvent(new Event("load"));
    await waiting;
  });

  it("rejects when the placeholder itself cannot load", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", { configurable: true, value: false });
    root.append(image);
    const waiting = waitForExportImages(root);
    image.dispatchEvent(new Event("error"));
    await vi.waitFor(() => expect(image.getAttribute("src")).toBe("/media-placeholder.svg"));
    image.dispatchEvent(new Event("error"));
    await expect(waiting).rejects.toThrow(/預設圖片/);
  });

  it("rejects when placeholder decoding fails after the original image error", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", { configurable: true, get: () => image.getAttribute("src") === "/media-placeholder.svg" });
    Object.defineProperty(image, "naturalWidth", { configurable: true, get: () => 100 });
    image.decode = vi.fn(async () => { throw new Error("placeholder decode failed"); });
    root.append(image);
    const waiting = waitForExportImages(root);
    image.dispatchEvent(new Event("error"));
    await expect(waiting).rejects.toThrow(/預設圖片/);
  });

  it("does not call toPng until failed export media has loaded its placeholder", async () => {
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => false });
    const exportPromise = exportComparison({ api: apiFor([row(1)]), query, initial: response([row(1)]) });
    await vi.waitFor(() => expect(document.querySelectorAll(".export-sheet img")).toHaveLength(2));
    const images = Array.from(document.querySelectorAll<HTMLImageElement>(".export-sheet img"));
    images.forEach((image) => image.dispatchEvent(new Event("error")));
    await vi.waitFor(() => expect(images.every((image) => image.getAttribute("src") === "/media-placeholder.svg")).toBe(true));
    expect(mocks.toPng).not.toHaveBeenCalled();
    images.forEach((image) => image.dispatchEvent(new Event("load")));
    await exportPromise;
    expect(mocks.toPng).toHaveBeenCalledTimes(1);
  });

  it("downloads through a temporary object URL and revokes it after the click tick", async () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:temporary");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    downloadExportArtifact({ blob: new Blob(["png"], { type: "image/png" }), filename: "result.png", kind: "png", pageCount: 1, rowCount: 1 });

    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download="result.png"]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(revoke).toHaveBeenCalledWith("blob:temporary");
    click.mockRestore();
    vi.useRealTimers();
  });
});
