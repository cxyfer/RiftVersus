import { expect, test } from "@playwright/test";

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
