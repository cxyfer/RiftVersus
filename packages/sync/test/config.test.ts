import { describe, expect, it } from "vitest";

import { loadSyncConfig } from "../src/config.js";

const baseEnvironment = {
  DATABASE_URL: "postgresql://riftversus:password@localhost:5432/riftversus",
  LEAGUEPEDIA_ENDPOINT: "https://leaguepedia.acme.org/api.php",
  LEAGUEPEDIA_USER_AGENT: "RiftVersus/0.1 (+https://riftversus.acme.org; ops@acme.org)",
  LEAGUEPEDIA_MEDIA_HOSTS: "static.acme.org",
} as const;

describe("loadSyncConfig", () => {
  it("loads data settings without server or S3 settings", () => {
    expect(loadSyncConfig(baseEnvironment)).toMatchObject({
      databaseUrl: baseEnvironment.DATABASE_URL,
      historyEnabled: true,
      syncMaxAgeHours: 36,
      syncHistoryMaxAgeHours: 192,
      syncFailureThreshold: 3,
      leaguepediaEndpoint: baseEnvironment.LEAGUEPEDIA_ENDPOINT,
      leaguepediaUserAgent: baseEnvironment.LEAGUEPEDIA_USER_AGENT,
      leaguepedia: {
        requestIntervalMs: 1_000,
        syncYears: [2023, 2024],
        syncCompetitions: ["Worlds"],
        mappingYears: [2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
        mappingCompetitions: ["LCK", "LPL", "LEC", "LCS", "MSI", "Worlds"],
        resourceLimits: { maxBytes: 100_000_000, maxPages: 2_000, maxRows: 500_000, maxReviewedPages: 5_000 },
      },
    });
  });

  it("parses the history enabled flag independently of server scheduling", () => {
    expect(loadSyncConfig({ ...baseEnvironment, SYNC_HISTORY_ENABLED: "false" }).historyEnabled).toBe(false);
    expect(loadSyncConfig({ ...baseEnvironment, SYNC_HISTORY_ENABLED: "true" }).historyEnabled).toBe(true);
    expect(() => loadSyncConfig({ ...baseEnvironment, SYNC_HISTORY_ENABLED: "yes" })).toThrow();
  });

  it("requires exact Leaguepedia source settings and mappings", () => {
    expect(() => loadSyncConfig({ ...baseEnvironment, LEAGUEPEDIA_ENDPOINT: "http://leaguepedia.acme.org/api.php" })).toThrow(/endpoint/i);
    expect(() => loadSyncConfig({ ...baseEnvironment, LEAGUEPEDIA_USER_AGENT: "RiftVersus/0.1 (https://)" })).toThrow(/user.agent/i);
    expect(() => loadSyncConfig({ ...baseEnvironment, LEAGUEPEDIA_MEDIA_HOSTS: "https://static.acme.org" })).toThrow(/media.host/i);
    expect(() => loadSyncConfig({ ...baseEnvironment, LEAGUEPEDIA_COMPETITION_MAP: '{"Worlds":"Worlds 2024"}' })).toThrow(/logical competition.*year/i);

    const config = loadSyncConfig({
      ...baseEnvironment,
      LEAGUEPEDIA_SYNC_YEARS: "2023,2024",
      LEAGUEPEDIA_SYNC_COMPETITIONS: "Worlds,MSI",
      LEAGUEPEDIA_COMPETITION_MAP: '{"Worlds":{"2023":"Worlds 2023 Main Event","2024":"Worlds 2024 Main Event"},"MSI":{"2023":["MSI 2023","MSI 2023 Playoffs"],"2024":"MSI 2024"}}',
      LEAGUEPEDIA_MEDIA_HOSTS: "static.acme.org,images.acme.org",
    });
    expect(config.leaguepedia.competitionMap.MSI?.["2023"]).toEqual(["MSI 2023", "MSI 2023 Playoffs"]);
    expect(config.leaguepedia.mediaHosts).toEqual(["static.acme.org", "images.acme.org"]);
  });

  it("enforces synchronization and source resource bounds", () => {
    for (const key of ["SYNC_MAX_AGE_HOURS", "SYNC_HISTORY_MAX_AGE_HOURS", "SYNC_FAILURE_THRESHOLD"]) {
      expect(() => loadSyncConfig({ ...baseEnvironment, [key]: "0" })).toThrow();
    }
    expect(() => loadSyncConfig({ ...baseEnvironment, SYNC_MAX_AGE_HOURS: "8761" })).toThrow();
    expect(() => loadSyncConfig({ ...baseEnvironment, SYNC_FAILURE_THRESHOLD: "101" })).toThrow();
    expect(() => loadSyncConfig({ ...baseEnvironment, LEAGUEPEDIA_REQUEST_INTERVAL_MS: "999" })).toThrow();
    expect(() => loadSyncConfig({ ...baseEnvironment, LEAGUEPEDIA_REQUEST_INTERVAL_MS: "60001" })).toThrow();
    expect(() => loadSyncConfig({ ...baseEnvironment, LEAGUEPEDIA_MAX_REVIEWED_PAGES: "50001" })).toThrow();
  });
});
