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
    leftName: "T1 / Unsafe",
    rightName: "LPL: Elite",
    leftScore: 3,
    rightScore: index % 2,
    winner: "left",
  };
}

function response(rows: SeriesRow[], nextCursor?: string): ComparisonResponse {
  return {
    subjects: {
      left: { kind: "team", id: query.left.id, displayName: "T1 / Unsafe" },
      right: { kind: "region", id: query.right.id, displayName: "LPL: Elite" },
    },
    query,
    seriesSummary: { wins: rows.length, losses: 0, total: rows.length, winRate: rows.length ? 1 : 0 },
    gameSummary: { wins: rows.length * 3, losses: rows.length, total: rows.length * 4, winRate: rows.length ? 0.75 : 0 },
    rows,
    ...(nextCursor ? { nextCursor } : {}),
    dataset: { version: "release/2026.07", lastSuccessfulSyncAt: "2026-07-12T00:00:00.000Z", coverage: { from: "2019-01-01", to: "2026-07-12" } },
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

  beforeEach(() => {
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.querySelectorAll(".export-sheet").forEach((node) => node.remove());
    if (completeDescriptor) Object.defineProperty(HTMLImageElement.prototype, "complete", completeDescriptor);
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
    expect(firstRoot.textContent).toContain("T1 / Unsafe 3:1 LPL: Elite");
    expect(secondRoot.textContent).toContain("T1 / Unsafe 3:1 LPL: Elite");
    expect(secondRoot.textContent).toContain("GENERATED 2026-07-12 12:34:56 UTC");
    expect(Array.from(firstRoot.querySelectorAll(".export-sheet__row strong"), (node) => node.textContent)).toEqual(rows.slice(0, 50).map((item) => `${item.leftName} ${item.leftScore}:${item.rightScore} ${item.rightName}`));
    expect(Array.from(secondRoot.querySelectorAll(".export-sheet__row strong"), (node) => node.textContent)).toEqual(rows.slice(50).map((item) => `${item.leftName} ${item.leftScore}:${item.rightScore} ${item.rightName}`));
  });

  it("stops before capture when sequential pagination exceeds the 1000 row cap", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => row(index + 1));
    await expect(exportComparison({ api: apiFor(rows), query, initial: response(rows.slice(0, 50), "50") })).rejects.toThrow(/1,000/);
    expect(mocks.toPng).not.toHaveBeenCalled();
  });

  it("waits for export images and replaces a failed image with the neutral placeholder", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", { configurable: true, value: false });
    root.append(image);
    const waiting = waitForExportImages(root);
    image.dispatchEvent(new Event("error"));
    await waiting;
    expect(image.getAttribute("src")).toBe("/media-placeholder.svg");
  });

  it("downloads through a temporary object URL and always revokes it", () => {
    const create = vi.fn(() => "blob:temporary");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    downloadExportArtifact({ blob: new Blob(["png"], { type: "image/png" }), filename: "result.png", kind: "png", pageCount: 1, rowCount: 1 });

    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:temporary");
    expect(document.querySelector('a[download="result.png"]')).toBeNull();
    click.mockRestore();
  });
});
