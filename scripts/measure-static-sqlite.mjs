import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { performance } from "node:perf_hooks";
import { createControlledPreview } from "./static-network-profile.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const url = process.argv[2];
if (!url || !/^https?:\/\//u.test(url)) throw new Error("Provide an HTTP(S) static site URL.");
const output = resolve(process.argv[3] ?? "/tmp/riftversus-sqlite-measurement");
const options = process.argv.slice(4);
assert.ok(options.every(value => value === "--profile=controlled" || value === "--enforce-performance" || /^--runs=\d+$/u.test(value)), "Unknown measurement option.");
const controlled = options.includes("--profile=controlled");
const runs = Number(options.find(value => value.startsWith("--runs="))?.slice(7) ?? "1");
assert.ok(Number.isSafeInteger(runs) && runs > 0 && runs <= 20, "Runs must be between 1 and 20.");
const enforce = options.includes("--enforce-performance");
assert.ok(!enforce || (controlled && runs >= 10), "Performance enforcement requires at least ten controlled runs.");
await mkdir(output, { recursive: true });
const profile = controlled ? await createControlledPreview(url) : undefined;
let browser;
const measurements = [];
try {
  browser = await chromium.launch({ headless: true });
  const viewports = controlled ? Array.from({ length: runs }, (_, index) => [`cold-${index + 1}`, 1440, 1000]) : [["desktop", 1440, 1000], ["mobile", 390, 844]];
  for (const [name, width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const requests = [];
    const databaseResponses = [];
    const pageErrors = [];
    let firstDatabaseAt;
    let lastDatabaseAt;
    page.on("request", request => { requests.push(request.url()); if (request.url().includes("/database.sqlite")) firstDatabaseAt ??= performance.now(); });
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("response", response => {
      if (!new URL(response.url()).pathname.endsWith("/database.sqlite")) return;
      lastDatabaseAt = performance.now();
      databaseResponses.push({ status: response.status(), method: response.request().method(), range: response.request().headers().range,
        contentRange: response.headers()["content-range"] });
    });
    const started = performance.now();
    await page.goto(profile?.url ?? url, { timeout: 60_000, waitUntil: "domcontentloaded" });
    await page.getByRole("region", { name: "比較摘要" }).waitFor({ timeout: 90_000 });
    const readyMs = performance.now() - started;
    await page.waitForLoadState("networkidle");
    let databaseBytes;
    let responseBytes = 0;
    for (const response of databaseResponses) {
      if (response.method === "HEAD") {
        assert.equal(response.status, 200);
        continue;
      }
      assert.equal(response.status, 206, JSON.stringify(response));
      const range = /^bytes=(\d+)-(\d+)$/u.exec(response.range ?? "");
      const content = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(response.contentRange ?? "");
      assert.ok(range && content, "Every SQLite response must have valid ranges");
      assert.equal(range[1], content[1]);
      assert.equal(range[2], content[2]);
      databaseBytes ??= Number(content[3]);
      assert.equal(Number(content[3]), databaseBytes);
      responseBytes += Number(content[2]) - Number(content[1]) + 1;
    }
    assert.ok(databaseResponses.some(response => response.range === "bytes=0-99"));
    assert.ok(requests.some(value => /sqlite\.worker[^/]*\.js/u.test(value)), "Actual Worker must load");
    assert.ok(requests.some(value => new URL(value).pathname.endsWith(".wasm")), "Actual WASM must load");
    assert.ok(!requests.some(value => new URL(value).pathname.includes("/api/")));
    assert.ok(responseBytes > 0 && responseBytes < databaseBytes, "Cold default query must read less than the full DB");
    assert.deepEqual(pageErrors, []);
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    const summary = await page.getByRole("region", { name: "比較摘要" }).innerText();
    const manifest = await page.evaluate(async () => (await globalThis.fetch(new URL("data/manifest.json", globalThis.location.href))).json());
    const rangeCounts = new Map();
    for (const response of databaseResponses.filter(value => value.method !== "HEAD")) rangeCounts.set(response.range, (rangeCounts.get(response.range) ?? 0) + 1);
    if (!controlled) await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true, timeout: 30_000 });
    measurements.push({ name, databaseBytes, responseBytes,
      rangeRequests: databaseResponses.filter(response => response.method !== "HEAD").length,
      headRequests: databaseResponses.filter(response => response.method === "HEAD").length,
      fraction: responseBytes / databaseBytes, readyMs, summary,
      databasePhaseMs: lastDatabaseAt - firstDatabaseAt,
      snapshotId: manifest.snapshotId, checksum: manifest.database.checksum, requestChunkSize: manifest.database.requestChunkSize,
      profile: profile?.profile ?? "hosted", duplicateRanges: [...rangeCounts].filter(([, count]) => count > 1), databaseResponses });
    await writeFile(resolve(output, "measurement.json"), `${JSON.stringify(measurements, null, 2)}\n`);
    await context.close();
  }
} catch (error) {
  await writeFile(resolve(output, "failure.json"), `${JSON.stringify({ completedRuns: measurements.length, reason: error instanceof Error ? error.message : "Browser measurement failed." }, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close();
  await profile?.close();
}
await writeFile(resolve(output, "measurement.json"), `${JSON.stringify(measurements, null, 2)}\n`);
const times = measurements.map(value => value.readyMs).sort((left, right) => left - right);
const medianReadyMs = (times[Math.floor((times.length - 1) / 2)] + times[Math.ceil((times.length - 1) / 2)]) / 2;
console.log(JSON.stringify({ medianReadyMs, measurements: measurements.map(({ databaseResponses, ...value }) => { void databaseResponses; return value; }) }, null, 2));
if (enforce) {
  assert.ok(measurements.every(value => value.rangeRequests <= 30), "Default comparison exceeds 30 Range GETs.");
  assert.ok(measurements.every(value => value.responseBytes <= 1024 * 1024), "Default comparison exceeds 1 MiB of database reads.");
  assert.ok(medianReadyMs <= 10_000, "Controlled median exceeds ten seconds.");
}
