import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

test("compares T1 against LPL with Worlds BO5", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("World Championship").first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "比較對象" })).toHaveValue("T1");
  await expect(page.getByRole("combobox", { name: "對戰對象" })).toHaveValue("LPL");
  await expect(page.getByRole("button", { name: "Worlds" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "BO5" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "套用篩選" }).click();
  await expect(page).toHaveURL(/events=worlds/);
  await expect(page).toHaveURL(/bestOf=5/);
  await expect(page.getByText("3 series wins")).toBeVisible();
});

test("exports a short fixture as a PNG", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("World Championship").first()).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出 PNG / ZIP" }).click();
  const file = await download;
  const path = await file.path();
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  expect((await readFile(path!)).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});

test("exports a long fixture as a multi-page ZIP", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("riftversus.playwright-fixture", "long"));
  await page.goto("/");
  await expect(page.getByText("World Championship 1").first()).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出 PNG / ZIP" }).click();
  const file = await download;
  const path = await file.path();
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
  const binary = await readFile(path!);
  expect(binary.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const archive = await JSZip.loadAsync(binary);
  expect(Object.keys(archive.files)).toEqual([
    "riftversus-t1-vs-lpl-mock-2026-07-01.png",
    "riftversus-t1-vs-lpl-mock-2026-07-02.png",
    "riftversus-t1-vs-lpl-mock-2026-07-03.png",
  ]);
  for (const entry of Object.values(archive.files)) {
    const png = await entry.async("uint8array");
    expect(Buffer.from(png).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
});
