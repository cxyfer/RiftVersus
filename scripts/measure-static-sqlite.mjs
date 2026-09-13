import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { performance } from "node:perf_hooks";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const url = process.argv[2];
if (!url || !/^https?:\/\//u.test(url)) throw new Error("Provide an HTTP(S) static site URL.");
const output = resolve(process.argv[3] ?? "/tmp/riftversus-sqlite-measurement");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const measurements = [];
try {
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const requests = [];
    const databaseResponses = [];
    const pageErrors = [];
    page.on("request", request => requests.push(request.url()));
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("response", response => {
      if (!new URL(response.url()).pathname.endsWith("/database.sqlite")) return;
      databaseResponses.push({ status: response.status(), method: response.request().method(), range: response.request().headers().range,
        contentRange: response.headers()["content-range"] });
    });
    const started = performance.now();
    await page.goto(url);
    await page.getByRole("region", { name: "比較摘要" }).waitFor({ timeout: 30_000 });
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
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
    measurements.push({ name, databaseBytes, responseBytes,
      rangeRequests: databaseResponses.filter(response => response.method !== "HEAD").length,
      headRequests: databaseResponses.filter(response => response.method === "HEAD").length,
      fraction: responseBytes / databaseBytes, readyMs, summary });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(resolve(output, "measurement.json"), `${JSON.stringify(measurements, null, 2)}\n`);
console.log(JSON.stringify(measurements, null, 2));
