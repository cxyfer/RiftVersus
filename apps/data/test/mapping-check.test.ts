import { describe, expect, it } from "vitest";
import { loadSyncConfig } from "@riftversus/sync";
import { checkLeaguepediaMappings } from "../src/mapping-check.js";

const base = { DATABASE_URL: "postgresql://example.test/db", LEAGUEPEDIA_ENDPOINT: "https://leaguepedia.acme.org/api.php", LEAGUEPEDIA_USER_AGENT: "RiftVersus/0.1 ops@acme.org", LEAGUEPEDIA_MEDIA_HOSTS: "static.acme.org" };

describe("checkLeaguepediaMappings", () => {
  it("reports every missing required pair", () => {
    const config = loadSyncConfig({ ...base, LEAGUEPEDIA_MAPPING_COMPETITIONS: "LCK,LPL", LEAGUEPEDIA_MAPPING_YEARS: "2011,2012", LEAGUEPEDIA_COMPETITION_MAP: '{"LCK":{"2011":["Champions 2011"]}}' });
    expect(checkLeaguepediaMappings(config)).toMatchObject({ missing: [{ competition: "LCK", year: 2012 }, { competition: "LPL", year: 2011 }, { competition: "LPL", year: 2012 }] });
  });

  it("records arrays as split/playoff mappings", () => {
    const config = loadSyncConfig({ ...base, LEAGUEPEDIA_MAPPING_COMPETITIONS: "LCK", LEAGUEPEDIA_MAPPING_YEARS: "2024", LEAGUEPEDIA_COMPETITION_MAP: '{"LCK":{"2024":["LCK 2024 Spring","LCK 2024 Spring Playoffs"]}}' });
    expect(checkLeaguepediaMappings(config).mapped[0]?.sourceKeys).toEqual(["LCK 2024 Spring", "LCK 2024 Spring Playoffs"]);
  });
});
