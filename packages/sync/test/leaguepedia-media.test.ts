import { describe, expect, it } from "vitest";
import { inspectLeaguepediaMedia } from "../src/providers/leaguepedia/media.js";
import { selectPlayerProfiles } from "../src/providers/leaguepedia/fetch.js";

const image = { sourceKey: "logo.png", entityKey: "Old Team", sourceUrl: "https://example.com/logo.png", contentType: "image/png", license: "CC BY", attribution: "Reviewed owner" };
describe("Leaguepedia media eligibility and era ownership", () => {
  it("binds numeric player IDs returned by Cargo without accepting fractional identifiers", () => {
    const profiles = selectPlayerProfiles([
      { PlayerPage: 369, PlayerRedirect: 369, IsProfileImage: 1, FileName: "TES 369.png" },
      { PlayerPage: 9.57, PlayerRedirect: 9.57, IsProfileImage: 1, FileName: "Wrong.png" },
    ], [{ OverviewPage: 369, AllName: 369 }, { OverviewPage: 9.57, AllName: 9.57 }]);
    expect([...profiles]).toEqual([["369", "TES 369.png"]]);
  });
  it("binds the historical logo to its exact era and deduplicates identical evidence", () => {
    const result = inspectLeaguepediaMedia([image, image], new Map([["Old Team", "team"]]), new Map([["Old Team", "old-era"]]));
    expect(result.media).toEqual([{ sourceUrl: image.sourceUrl, license: image.license, attribution: image.attribution, teamEraId: "old-era" }]);
    expect(result.inventory.eligible).toBe(1);
  });
  it("reports missing, rights-blocked, invalid and conflicting images without publishing them", () => {
    const result = inspectLeaguepediaMedia([
      { ...image, sourceUrl: null }, { ...image, license: null }, { ...image, sourceUrl: "invalid" },
      image, { ...image, sourceUrl: "https://example.com/other.png" },
    ], new Map([["Old Team", "team"]]));
    expect(result.media).toEqual([]);
    expect(result.inventory).toEqual({ candidates: 5, eligible: 0, missing: 1, rightsBlocked: 1, invalid: 1, unbound: 0, ambiguous: 2 });
  });
});
