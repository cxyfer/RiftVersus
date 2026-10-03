import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const url = process.argv[2];
if (!url || !/^https?:\/\//u.test(url)) throw new Error("Provide an HTTP(S) hosted site URL.");
const output = resolve(process.argv[3] ?? "/tmp/riftversus-hosted-workflows");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  await page.goto(url);
  const summary = page.getByRole("region", { name: "比較摘要" });
  await expect(summary).toBeVisible({ timeout: 30_000 });
  const originalSummary = await summary.innerText();
  const sharedUrl = page.url();
  await page.reload();
  await expect(summary).toHaveText(originalSummary, { timeout: 30_000 });
  assert.equal(page.url(), sharedUrl);
  checks.push("default comparison and shared URL survive reload");

  await page.getByRole("button", { name: "保存目前比較" }).click();
  await page.getByRole("button", { name: "查看保存結果" }).click();
  const saved = page.getByRole("complementary", { name: "已保存結果" });
  await expect(saved).toBeVisible();
  await expect(saved.getByRole("button", { name: /T1.*LPL/u })).toBeVisible();
  await page.getByRole("button", { name: "關閉保存結果" }).click();
  checks.push("save comparison and open saved results");

  const subject = page.getByRole("combobox", { name: "比較對象" });
  await subject.click();
  await subject.fill("Faker");
  const faker = page.getByRole("option", { name: /Faker \(Lee Sang-hyeok\)/u });
  await expect(faker).toBeVisible({ timeout: 30_000 });
  await faker.click();
  await page.getByRole("button", { name: "套用篩選" }).click();
  await expect(page).toHaveURL(/leftKind=player/u);
  await expect(summary).toContainText("Faker", { timeout: 30_000 });
  checks.push("search real player ID/name and apply player comparison");

  await page.getByLabel("起始日期").fill("2017-01-01");
  await page.getByLabel("結束日期").fill("2017-12-31");
  await page.getByRole("button", { name: "套用篩選" }).click();
  await expect(summary).toContainText("1-0", { timeout: 30_000 });
  await expect(page.getByText("SK Telecom T1 3:2 Royal Never Give Up")).toBeVisible();
  checks.push("2017 filter preserves participating historical team names");

  const downloaded = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "匯出 PNG / ZIP" }).click();
  const download = await downloaded;
  assert.match(download.suggestedFilename(), /\.png$/u);
  const bytes = await readFile(await download.path());
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const imageWidth = bytes.readUInt32BE(16);
  const imageHeight = bytes.readUInt32BE(20);
  assert.ok(imageWidth > 0 && imageHeight > 0);
  await download.saveAs(resolve(output, "historical-player-export.png"));
  checks.push("real historical PNG export has valid image dimensions");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
  await page.screenshot({ path: resolve(output, "mobile-player.png"), fullPage: true });
  assert.deepEqual(errors, []);
  assert.ok(!requests.some(value => new URL(value).pathname.includes("/api/")));
  checks.push("mobile player results fit viewport with no page errors or API requests");
  await context.close();
} finally {
  await browser.close();
}
const evidence = { checks };
await writeFile(resolve(output, "workflows.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
