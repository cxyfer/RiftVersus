import { expect, it } from "vitest";

import { canAdoptUpstreamPlayerRealName, resolveEntitySlugs } from "../packages/database/src/repositories/sync.js";

it("freezes every published slug and derives one only for a new entity", () => {
  const published = [
    { id: "aaaaaaaa-0000-5000-8000-000000000001", slug: "pedro-seixas" },
    { id: "bbbbbbbb-0000-5000-8000-000000000002", slug: "kim-dong-hyeon" },
  ];
  const staged = [
    { id: "aaaaaaaa-0000-5000-8000-000000000001", slug: "pedro-seixas-brito" },
    { id: "bbbbbbbb-0000-5000-8000-000000000002", slug: "kim-dong-hyeon" },
    { id: "cccccccc-0000-5000-8000-000000000003", slug: "kim-dong-hyeon" },
    { id: "dddddddd-0000-5000-8000-000000000004", slug: "fresh-name" },
  ];

  expect([...resolveEntitySlugs(staged, published)]).toEqual([
    ["aaaaaaaa-0000-5000-8000-000000000001", "pedro-seixas"],
    ["bbbbbbbb-0000-5000-8000-000000000002", "kim-dong-hyeon"],
    ["cccccccc-0000-5000-8000-000000000003", "kim-dong-hyeon-cccccccc-0000-5000-8000-000000000003"],
    ["dddddddd-0000-5000-8000-000000000004", "fresh-name"],
  ]);
});

it("refuses a disambiguated slug that a published entity already owns", () => {
  const published = [
    { id: "aaaaaaaa-0000-5000-8000-000000000001", slug: "taken" },
    { id: "bbbbbbbb-0000-5000-8000-000000000002", slug: "taken-cccccccc-0000-5000-8000-000000000003" },
  ];

  expect(() => resolveEntitySlugs([{ id: "cccccccc-0000-5000-8000-000000000003", slug: "taken" }], published))
    .toThrow(/Canonical slug taken-cccccccc-0000-5000-8000-000000000003 conflicts with published entity bbbbbbbb-0000-5000-8000-000000000002/);
});

it("adopts an upstream player real name only while a public ID anchors the identity", () => {
  const player = (playerId: string | null) => ({ kind: "player" as const, playerId });
  const team = { kind: "team" as const, playerId: null };

  expect(canAdoptUpstreamPlayerRealName(player("Tatu"), player("Tatu"))).toBe(true);
  // A legacy row published before migration 009 still exposes canonical_name as its label.
  expect(canAdoptUpstreamPlayerRealName(player(null), player("Tatu"))).toBe(false);
  expect(canAdoptUpstreamPlayerRealName(player("Tatu"), player(null))).toBe(false);
  // Team and region names remain immutable identity surfaces.
  expect(canAdoptUpstreamPlayerRealName(team, team)).toBe(false);
});
