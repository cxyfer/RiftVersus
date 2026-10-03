import { describe, expect, it } from "vitest";
import { bindReviewedMedia, ReviewedMediaManifestSchema, type MediaOwnerInventory } from "../src/media-service.js";

const player = "00000000-0000-4000-8000-000000000001";
const team = "00000000-0000-4000-8000-000000000002";
const oldEra = "00000000-0000-4000-8000-000000000003";
const inventory: MediaOwnerInventory = {
  entities: [{ id: player, kind: "player", canonicalName: "Lee Sang-hyeok" }, { id: team, kind: "team", canonicalName: "T1" }],
  aliases: [{ entityId: player, sourceKey: "Faker" }, { entityId: team, sourceKey: "T1" }],
  eras: [{ id: oldEra, teamEntityId: team, displayName: "SK Telecom T1" }],
};
const asset = { sourceUrl: "https://static.wikia.nocookie.net/example.png", attribution: "Leaguepedia source; artist not stated.",
  rightsBasis: { kind: "editorial-use", policy: "leaguepedia-editorial-v1", sourcePageUrl: "https://lol.fandom.com/wiki/File:Example.png", revisionId: 1, fileChecksum: "a".repeat(64), statement: "No explicit per-file license.", reviewedNote: "Reviewed exact subject image." },
  owners: [{ kind: "player", id: player, sourceKey: "Faker" }] };

describe("reviewed media identity binding", () => {
  it("binds a player by exact UUID and source page, with a null license", () => {
    const manifest = ReviewedMediaManifestSchema.parse({ version: 1, status: "reviewed", assets: [asset] });
    expect(bindReviewedMedia(manifest, inventory)).toEqual([expect.objectContaining({ entityId: player, license: null, rightsBasis: asset.rightsBasis })]);
  });
  it.each([
    { kind: "player", id: player, sourceKey: "Other player" },
    { kind: "team", id: player, sourceKey: "Faker" },
    { kind: "team-era", id: oldEra, sourceKey: "T1" },
    { kind: "team", id: team, sourceKey: "SK Telecom T1" },
  ])("rejects wrong source, kind or historical identity: %j", owner => {
    const manifest = ReviewedMediaManifestSchema.parse({ version: 1, status: "reviewed", assets: [{ ...asset, owners: [owner] }] });
    expect(() => bindReviewedMedia(manifest, inventory)).toThrow(/match/);
  });
  it("rejects drafts and conflicting images for the same owner", () => {
    expect(() => ReviewedMediaManifestSchema.parse({ version: 1, status: "draft", assets: [asset] })).toThrow();
    const manifest = ReviewedMediaManifestSchema.parse({ version: 1, status: "reviewed", assets: [asset, asset] });
    expect(() => bindReviewedMedia(manifest, inventory)).toThrow(/Conflicting/);
  });
});
