import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

interface ReviewedSnapshot {
  status: string;
  datasetVersion: string;
  comparison: {
    left: { kind: "team"; id: string };
    right: { kind: "region"; id: string };
  };
  expected: {
    leftDisplayName: string;
    rightDisplayName: string;
    seriesWins: number;
    seriesLosses: number;
    gameWins: number;
    gameLosses: number;
    rows: Array<{
      id: string;
      date: string;
      leftName: string;
      rightName: string;
      leftScore: number;
      rightScore: number;
      winner: "left" | "right";
    }>;
  };
}

const snapshotUrl = new URL(
  "../../../data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json",
  import.meta.url,
);
const snapshot = JSON.parse(
  await readFile(snapshotUrl, "utf8"),
) as ReviewedSnapshot;

if (snapshot.status !== "reviewed") {
  throw new Error("Release E2E requires the reviewed Leaguepedia acceptance snapshot.");
}

const comparisonPath = (() => {
  const params = new URLSearchParams({
    leftKind: snapshot.comparison.left.kind,
    leftId: snapshot.comparison.left.id,
    rightKind: snapshot.comparison.right.kind,
    rightId: snapshot.comparison.right.id,
    from: "2013-01-01",
    to: "2025-12-31",
    events: "worlds",
    bestOf: "5",
  });
  return `/?${params.toString()}`;
})();

test("renders the reviewed T1 versus LPL Worlds BO5 publication", async ({
  page,
}) => {
  const comparisonResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/comparisons" && response.status() === 200;
  });

  await page.goto(comparisonPath);
  const response = await comparisonResponse;
  const payload = (await response.json()) as {
    subjects: {
      left: { kind: string; id: string; displayName: string };
      right: { kind: string; id: string; displayName: string };
    };
    seriesSummary: { wins: number; losses: number; total: number };
    gameSummary: { wins: number; losses: number; total: number };
    rows: Array<{
      id: string;
      date: string;
      leftName: string;
      rightName: string;
      leftScore: number;
      rightScore: number;
      winner: "left" | "right";
    }>;
    dataset: { version: string };
    coverageWarnings: unknown[];
    mediaUrls: { left: string; right: string };
  };

  expect(payload.subjects.left).toMatchObject({
    kind: snapshot.comparison.left.kind,
    id: snapshot.comparison.left.id,
    displayName: snapshot.expected.leftDisplayName,
  });
  expect(payload.subjects.right).toMatchObject({
    kind: snapshot.comparison.right.kind,
    id: snapshot.comparison.right.id,
    displayName: snapshot.expected.rightDisplayName,
  });
  expect(payload.seriesSummary).toEqual({ wins: 12, losses: 0, total: 12, winRate: 1 });
  expect(payload.gameSummary).toEqual({ wins: 36, losses: 9, total: 45, winRate: 0.8 });
  expect(payload.rows).toHaveLength(12);
  expect(payload.rows.map(({ id, date, leftName, rightName, leftScore, rightScore, winner }) => ({
    id, date, leftName, rightName, leftScore, rightScore, winner,
  }))).toEqual(snapshot.expected.rows.map(({ id, date, leftName, rightName, leftScore, rightScore, winner }) => ({
    id, date, leftName, rightName, leftScore, rightScore, winner,
  })));
  expect(payload.dataset.version).toBe(snapshot.datasetVersion);
  expect(payload.coverageWarnings).toEqual([]);
  expect(payload.mediaUrls).toEqual({
    left: `/avatars/v2/team/${snapshot.comparison.left.id}.svg`,
    right: `/avatars/v2/region/${snapshot.comparison.right.id}.svg`,
  });

  await expect(page.getByRole("combobox", { name: "比較對象" })).toHaveValue("T1");
  await expect(page.getByRole("combobox", { name: "對戰對象" })).toHaveValue("LPL");
  await expect(page.getByText("12 series wins")).toBeVisible();
  await expect(page.getByText("Games 36-9")).toBeVisible();
  const matchTable = page.getByRole("table", { name: "對戰紀錄" });
  await expect(matchTable.getByText("T1 3:0 Top Esports").first()).toBeVisible();
  await expect(matchTable.getByText("SK Telecom T1 3:0 Royal Club").first()).toBeVisible();
  await expect(matchTable.getByRole("row")).toHaveCount(13);
  await expect(page).toHaveURL(comparisonPath);

  const images = page.locator(".result-summary img");
  await expect(images).toHaveCount(2);
  await expect(images.nth(0)).toHaveAttribute(
    "src",
    `/avatars/v2/team/${snapshot.comparison.left.id}.svg`,
  );
  await expect(images.nth(1)).toHaveAttribute(
    "src",
    `/avatars/v2/region/${snapshot.comparison.right.id}.svg`,
  );
  await expect
    .poll(() =>
      images.evaluateAll((elements) =>
        elements.every(
          (element) =>
            (element as HTMLImageElement).complete &&
            (element as HTMLImageElement).naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);

  const desktopMetadata = await page.locator(".chip").first().evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      right: Math.round(bounds.right),
      viewportWidth: window.innerWidth,
      singleLine: element.scrollHeight === element.clientHeight,
    };
  });
  expect(desktopMetadata.right).toBeLessThanOrEqual(
    desktopMetadata.viewportWidth,
  );
  expect(desktopMetadata.singleLine).toBe(true);
});

test("falls back to neutral media when published avatars fail", async ({
  page,
}) => {
  let failedAvatarRequests = 0;
  await page.route("**/avatars/**", (route) => {
    failedAvatarRequests += 1;
    return route.fulfill({ status: 404, body: "missing" });
  });

  await page.goto(comparisonPath);
  await expect(page.getByText("12 series wins")).toBeVisible();

  const images = page.locator(".result-summary img");
  await expect(images).toHaveCount(2);
  await expect
    .poll(() =>
      images.evaluateAll((elements) =>
        elements.every((element) => {
          const image = element as HTMLImageElement;
          return (
            image.getAttribute("src") === "/media-placeholder.svg" &&
            image.complete &&
            image.naturalWidth > 0
          );
        }),
      ),
    )
    .toBe(true);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出 PNG / ZIP" }).click();
  const file = await download;
  const path = await file.path();
  expect(file.suggestedFilename()).toBe(
    `riftversus-t1-vs-lpl-${snapshot.datasetVersion.slice(0, 56)}.png`,
  );
  expect((await readFile(path!)).subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(failedAvatarRequests).toBeGreaterThanOrEqual(2);
});

test("shows the API error state when the production comparison is unavailable", async ({
  page,
}) => {
  let unavailableResponses = 0;
  await page.route("**/api/comparisons?*", (route) => {
    unavailableResponses += 1;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "release-e2e-unavailable" }),
    });
  });

  await page.goto(comparisonPath);

  await expect(page.getByText("資料目前無法取得")).toBeVisible();
  await expect(page.locator(".result-summary")).toHaveCount(0);
  expect(unavailableResponses).toBe(1);
});

test("keeps the reviewed comparison within a 390 by 844 viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(comparisonPath);
  await expect(page.getByText("12 series wins")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions).toEqual({
    viewportWidth: 390,
    bodyWidth: 390,
    documentWidth: 390,
  });
});
