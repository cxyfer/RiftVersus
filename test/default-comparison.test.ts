import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { DEFAULT_COMPARISON_SUBJECTS } from "../packages/domain/src/default-comparison.js";
import { defaultRouteState, toContractQuery } from "../apps/web/src/model.js";

it("uses reviewed canonical identities for the homepage and synthetic fixture", async () => {
  const reviewed = JSON.parse(await readFile(new URL("../data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json", import.meta.url), "utf8"));
  expect(DEFAULT_COMPARISON_SUBJECTS).toEqual(reviewed.comparison);
  const query = toContractQuery(defaultRouteState);
  expect(query.left).toEqual(DEFAULT_COMPARISON_SUBJECTS.left);
  expect(query.right).toEqual(DEFAULT_COMPARISON_SUBJECTS.right);
  const fixture = await readFile(new URL("../scripts/build-static-fixture.mjs", import.meta.url), "utf8");
  expect(fixture).toContain("DEFAULT_COMPARISON_SUBJECTS.left.id");
  expect(fixture).toContain("DEFAULT_COMPARISON_SUBJECTS.right.id");
});
