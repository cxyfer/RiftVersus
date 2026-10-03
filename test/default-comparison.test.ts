import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { DEFAULT_COMPARISON_SUBJECTS } from "../packages/domain/src/default-comparison.js";
import { defaultRouteState, toContractQuery, toRouteQuery } from "../apps/web/src/model.js";
import { mockApi } from "../apps/web/src/api/mock-runtime.js";

it("uses reviewed canonical identities for the homepage and synthetic fixture", async () => {
  const reviewed = JSON.parse(await readFile(new URL("../data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json", import.meta.url), "utf8"));
  expect(DEFAULT_COMPARISON_SUBJECTS).toEqual(reviewed.comparison);
  const route = toRouteQuery(defaultRouteState);
  expect(route.left).toEqual({ kind: "team", id: "t1" });
  expect(route.right).toEqual({ kind: "region", id: "lpl" });
  const query = toContractQuery(defaultRouteState, { left: await mockApi.resolveSubject(route.left), right: await mockApi.resolveSubject(route.right) });
  expect(query.left).toEqual(DEFAULT_COMPARISON_SUBJECTS.left);
  expect(query.right).toEqual(DEFAULT_COMPARISON_SUBJECTS.right);
  const fixture = await readFile(new URL("../scripts/build-static-fixture.mjs", import.meta.url), "utf8");
  expect(fixture).toContain("DEFAULT_COMPARISON_SUBJECTS.left.id");
  expect(fixture).toContain("DEFAULT_COMPARISON_SUBJECTS.right.id");
});
