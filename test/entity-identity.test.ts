import { expect, it } from "vitest";

import { assertPublishableEntityName, canAdoptUpstreamPlayerRealName, resolveEntitySlugs } from "../packages/database/src/repositories/sync.js";
import { decodeSourceName } from "../packages/sync/src/providers/leaguepedia/fetch.js";

it("freezes every published slug and derives one only for a new entity", () => {
  const published = [
    { id: "aaaaaaaa-0000-5000-8000-000000000001", slug: "pedro-seixas" },
    { id: "bbbbbbbb-0000-5000-8000-000000000002", slug: "kim-dong-hyeon" },
  ];
  const staged = [
    { id: "aaaaaaaa-0000-5000-8000-000000000001", canonicalName: "Pedro Seixas Brito" },
    { id: "bbbbbbbb-0000-5000-8000-000000000002", canonicalName: "Kim Dong-hyeon" },
    { id: "cccccccc-0000-5000-8000-000000000003", canonicalName: "Kim Dong-hyeon" },
    { id: "dddddddd-0000-5000-8000-000000000004", canonicalName: "Fresh Name" },
  ];

  expect(resolveEntitySlugs(staged, published)).toEqual([
    { id: "aaaaaaaa-0000-5000-8000-000000000001", canonicalName: "Pedro Seixas Brito", slug: "pedro-seixas" },
    { id: "bbbbbbbb-0000-5000-8000-000000000002", canonicalName: "Kim Dong-hyeon", slug: "kim-dong-hyeon" },
    { id: "cccccccc-0000-5000-8000-000000000003", canonicalName: "Kim Dong-hyeon", slug: "kim-dong-hyeon-cccccccc-0000-5000-8000-000000000003" },
    { id: "dddddddd-0000-5000-8000-000000000004", canonicalName: "Fresh Name", slug: "fresh-name" },
  ]);
});

it("never derives a slug for a published entity, so a name it cannot romanize still publishes", () => {
  const published = [{ id: "aaaaaaaa-0000-5000-8000-000000000001", slug: "pedro-seixas" }];

  expect(resolveEntitySlugs([{ id: "aaaaaaaa-0000-5000-8000-000000000001", canonicalName: "이상혁" }], published))
    .toEqual([{ id: "aaaaaaaa-0000-5000-8000-000000000001", canonicalName: "이상혁", slug: "pedro-seixas" }]);
  // A brand-new entity still needs a slug, so an unromanizable name falls back to an opaque
  // ID-keyed slug rather than aborting the publication; the name stays searchable.
  expect(resolveEntitySlugs([{ id: "eeeeeeee-0000-5000-8000-000000000005", canonicalName: "이상혁" }], published))
    .toEqual([{ id: "eeeeeeee-0000-5000-8000-000000000005", canonicalName: "이상혁", slug: "entity-eeeeeeee-0000-5000-8000-000000000005" }]);
});

it("refuses a disambiguated slug that a published entity already owns", () => {
  const published = [
    { id: "aaaaaaaa-0000-5000-8000-000000000001", slug: "taken" },
    { id: "bbbbbbbb-0000-5000-8000-000000000002", slug: "taken-cccccccc-0000-5000-8000-000000000003" },
  ];

  expect(() => resolveEntitySlugs([{ id: "cccccccc-0000-5000-8000-000000000003", canonicalName: "Taken" }], published))
    .toThrow(/Canonical slug taken-cccccccc-0000-5000-8000-000000000003 conflicts with published entity bbbbbbbb-0000-5000-8000-000000000002/);
});

it("adopts a player real name only while a public ID anchors the identity on both sides", () => {
  const player = (playerId: string | null) => ({ kind: "player" as const, playerId });
  const team = (playerId: string | null) => ({ kind: "team" as const, playerId });

  expect(canAdoptUpstreamPlayerRealName(player("Tatu"), player("Tatu"))).toBe(true);
  // A legacy row published before migration 009 still exposes canonical_name as its label.
  expect(canAdoptUpstreamPlayerRealName(player(null), player("Tatu"))).toBe(false);
  expect(canAdoptUpstreamPlayerRealName(player("Tatu"), player(null))).toBe(false);
  // Team and region names remain immutable identity surfaces.
  expect(canAdoptUpstreamPlayerRealName(team("T1"), team("T1"))).toBe(false);
  expect(canAdoptUpstreamPlayerRealName(team("T1"), player("T1"))).toBe(false);
});

it("refuses only entity names that cannot be published safely", () => {
  for (const name of ["Pedro Seixas Brito", "이상혁", "李相赫", "O'Brien-Şahin", "Gen.G"]) {
    expect(() => assertPublishableEntityName(name, "entity")).not.toThrow();
  }
  expect(() => assertPublishableEntityName("bad\u0000name", "entity")).toThrow(/control characters/);
  expect(() => assertPublishableEntityName("x".repeat(121), "entity")).toThrow(/exceeds 120 characters/);
  expect(() => assertPublishableEntityName("   ", "entity")).toThrow(/is empty/);
});

it("decodes HTML character references in a source name", () => {
  // The double encoding Leaguepedia actually ships, plus plain text that must not change.
  expect(decodeSourceName("Amadeu&amp;nbsp;Jesus Dias de Carvalho")).toBe("Amadeu Jesus Dias de Carvalho");
  expect(decodeSourceName("Rekkles")).toBe("Rekkles");
  expect(decodeSourceName("AT&T")).toBe("AT&T");
  expect(decodeSourceName("Foo &quot;Bar&quot;")).toBe('Foo "Bar"');
  expect(decodeSourceName("Lee&#32;Sang-hyeok")).toBe("Lee Sang-hyeok");
  expect(decodeSourceName("Lee&#x20;Sang-hyeok")).toBe("Lee Sang-hyeok");
  expect(decodeSourceName("Keep &bogus; intact")).toBe("Keep &bogus; intact");
  expect(decodeSourceName("  spaced   out  ")).toBe("spaced out");
});
