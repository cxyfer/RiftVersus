import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface DatabaseResponse {
  requestedRange: string | undefined;
  status: number;
  contentRange: string | undefined;
  contentLength: number | undefined;
}

interface StaticNetwork {
  databaseSize: number | undefined;
  databaseRequests: string[];
  databaseResponses: DatabaseResponse[];
  workerUrls: string[];
  wasmUrls: string[];
}

function observeStaticNetwork(page: Page): StaticNetwork {
  const network: StaticNetwork = {
    databaseSize: undefined,
    databaseRequests: [],
    databaseResponses: [],
    workerUrls: [],
    wasmUrls: [],
  };

  page.on("request", (request) => {
    const url = new URL(request.url());
    const pathname = url.pathname.toLowerCase();
    if (pathname.endsWith("/database.sqlite")) {
      const range = request.headers().range;
      if (range !== undefined) network.databaseRequests.push(range);
    }
    if (pathname.includes("worker") || pathname.includes("httpvfs")) network.workerUrls.push(request.url());
    if (pathname.endsWith(".wasm")) network.wasmUrls.push(request.url());
  });

  page.on("response", async (response) => {
    const url = new URL(response.url());
    const pathname = url.pathname.toLowerCase();
    if (pathname.endsWith("/manifest.json")) {
      try {
        const manifest = await response.json() as { database?: { byteSize?: number } };
        if (typeof manifest.database?.byteSize === "number") network.databaseSize = manifest.database.byteSize;
      } catch {
        // The corruption test intentionally allows the startup response to fail parsing.
      }
    }
    if (pathname.endsWith("/database.sqlite")) {
      const contentLength = response.headers()["content-length"];
      network.databaseResponses.push({
        requestedRange: response.request().headers().range,
        status: response.status(),
        contentRange: response.headers()["content-range"],
        contentLength: contentLength === undefined ? undefined : Number(contentLength),
      });
    }
  });
  return network;
}

function rangeBytes(value: string): { start: number; end: number; total: number } | null {
  const match = /^bytes=(\d+)-(\d+)$/u.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start
    ? { start, end, total: end - start + 1 }
    : null;
}

function contentRangeBytes(value: string): { start: number; end: number; total: number } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number.isSafeInteger(total) && end >= start
    ? { start, end, total }
    : null;
}

async function assertSqliteTransport(network: StaticNetwork, responseStart = 0): Promise<void> {
  await expect.poll(() => network.databaseSize).toBeGreaterThan(0);
  await expect.poll(() => network.databaseResponses.length).toBeGreaterThan(responseStart);
  expect(network.workerUrls.length).toBeGreaterThan(0);
  expect(network.wasmUrls.length).toBeGreaterThan(0);
  expect(network.databaseRequests).toContain("bytes=0-99");

  const rangedResponses = network.databaseResponses.slice(responseStart).filter((response) => response.requestedRange !== undefined);
  expect(rangedResponses.length).toBeGreaterThan(0);
  const ranges = rangedResponses.map((response) => {
    expect(response.status).toBe(206);
    expect(response.contentRange).toBeDefined();
    const parsed = contentRangeBytes(response.contentRange!);
    expect(parsed).not.toBeNull();
    const requested = response.requestedRange === undefined ? null : rangeBytes(response.requestedRange);
    expect(requested).not.toBeNull();
    expect(parsed!.start).toBe(requested!.start);
    expect(parsed!.end).toBe(requested!.end);
    expect(parsed!.total).toBe(network.databaseSize);
    expect(response.contentLength).toBe(parsed!.total === undefined ? undefined : parsed!.end - parsed!.start + 1);
    return { start: parsed!.start, end: parsed!.end };
  });
  const uniqueRanges = new Map(ranges.map((range) => [`${range.start}-${range.end}`, range]));
  const uniqueCoverageBytes = [...uniqueRanges.values()].reduce((sum, range) => sum + range.end - range.start + 1, 0);
  const actualResponseBytes = rangedResponses.reduce((sum, response) => sum + (response.contentLength ?? 0), 0);
  expect(actualResponseBytes).toBeLessThan(network.databaseSize!);
  console.log(`[sqlite-httpvfs] databaseBytes=${network.databaseSize} actualResponseBytes=${actualResponseBytes} uniqueCoverageBytes=${uniqueCoverageBytes} uniqueRanges=${[...uniqueRanges.keys()].join(",")}`);
}

async function openDefaultComparison(page: Page) {
  await page.goto("./");
  await expect(page.getByText("World Championship").first()).toBeVisible();
  await expect(page.getByText("3 series wins")).toBeVisible();
}

test("renders the default fixture, preserves sharing, and searches player identity", async ({ page }) => {
  const requests: string[] = [];
  const network = observeStaticNetwork(page);
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));

  await openDefaultComparison(page);
  await expect(page.getByRole("combobox", { name: "比較對象" })).toHaveValue("T1");
  await expect(page.getByRole("combobox", { name: "對戰對象" })).toHaveValue("LPL");
  await expect(page.getByRole("button", { name: "Worlds" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "BO5" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("T1 3:1 Weibo Gaming")).toBeVisible();
  await expect(page.getByText("SK Telecom T1 3:2 Weibo Gaming")).toBeVisible();
  expect(requests.some((pathname) => pathname.includes("/api/"))).toBe(false);
  await assertSqliteTransport(network);
  await page.screenshot({ path: "test-results/sqlite-desktop.png", fullPage: true });

  const sharedUrl = page.url();
  await page.reload();
  await expect(page.getByText("3 series wins")).toBeVisible();
  expect(page.url()).toBe(sharedUrl);

  const leftSubject = page.getByRole("combobox", { name: "比較對象" });
  await leftSubject.click();
  await leftSubject.fill("Faker");
  await expect(page.getByRole("option", { name: /Faker \(Lee Sang-hyeok\)/ })).toBeVisible();
  await page.getByRole("option", { name: /Faker \(Lee Sang-hyeok\)/ }).click();
  await page.getByRole("button", { name: "套用篩選" }).click();
  await expect(page).toHaveURL(/leftKind=player/);
  await expect(page.getByText("3 series wins")).toBeVisible();
  expect(requests.some((pathname) => pathname.startsWith("/api/"))).toBe(false);
});

test("exports the default comparison as a PNG", async ({ page }) => {
  await openDefaultComparison(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出 PNG / ZIP" }).click();
  const download = await downloadPromise;
  const path = await download.path();

  expect(download.suggestedFilename()).toMatch(/\.png$/u);
  expect((await readFile(path!)).subarray(0, PNG_HEADER.length)).toEqual(PNG_HEADER);
});

test("exports the broad fixture as a multi-page ZIP", async ({ page }) => {
  await openDefaultComparison(page);
  await page.getByRole("button", { name: "Worlds" }).click();
  await page.getByRole("button", { name: "套用篩選" }).click();
  await expect(page.getByText("101 series wins")).toBeVisible();
  await expect(page.getByRole("button", { name: "Worlds" })).toHaveAttribute("aria-pressed", "false");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出 PNG / ZIP" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const binary = await readFile(path!);
  const archive = await JSZip.loadAsync(binary);
  const files = Object.values(archive.files).filter((entry) => !entry.dir);

  expect(download.suggestedFilename()).toMatch(/\.zip$/u);
  expect(files).toHaveLength(3);
  expect(files.map((entry) => entry.name)).toEqual([
    "riftversus-t1-vs-lpl-static-fixture-v1-01.png",
    "riftversus-t1-vs-lpl-static-fixture-v1-02.png",
    "riftversus-t1-vs-lpl-static-fixture-v1-03.png",
  ]);
  for (const entry of files) {
    const png = await entry.async("uint8array");
    expect(Buffer.from(png).subarray(0, PNG_HEADER.length)).toEqual(PNG_HEADER);
  }
});

test("fails on a corrupt SQLite range and succeeds after retry", async ({ page }) => {
  const network = observeStaticNetwork(page);
  const corruptedRanges: string[] = [];
  await page.route("**/database.sqlite", (route) => {
    const range = route.request().headers().range;
    if (range !== undefined) corruptedRanges.push(range);
    return route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: Buffer.from("corrupt sqlite response"),
    });
  });
  await page.goto("./");
  await expect(page.getByText("資料目前無法取得")).toBeVisible();
  expect(corruptedRanges).toContain("bytes=0-99");
  const responseStart = network.databaseResponses.length;

  await page.unroute("**/database.sqlite");
  await page.reload();
  await openDefaultComparison(page);
  await assertSqliteTransport(network, responseStart);
});

test("keeps the static comparison within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDefaultComparison(page);

  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions).toEqual({ viewportWidth: 390, bodyWidth: 390, documentWidth: 390 });
  await page.screenshot({ path: "test-results/sqlite-mobile.png", fullPage: true });
});
