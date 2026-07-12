import { describe, expect, it } from "vitest";

import { loadConfig, safeConfigSummary } from "../src/config.js";

const databaseUrl = "postgresql://riftversus:password@localhost:5432/riftversus";

describe("loadConfig", () => {
  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("applies production-safe defaults", () => {
    expect(loadConfig({ DATABASE_URL: databaseUrl })).toMatchObject({
      databaseUrl,
      port: 3000,
      host: "0.0.0.0",
      logLevel: "info",
      syncCron: "0 3 * * *",
      syncTimezone: "UTC",
      leaguepediaEndpoint: "https://lol.fandom.com/api.php",
      leaguepediaUserAgent: "RiftVersus/0.1 (https://github.com/riftversus; contact@example.invalid)",
      mediaDelivery: "proxy",
      s3: undefined,
    });
  });

  it("validates bounded Leaguepedia sync settings", () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, LEAGUEPEDIA_ENDPOINT: "http://lol.example/api.php" })).toThrow(/endpoint/i);
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, LEAGUEPEDIA_SYNC_YEARS: "" })).toThrow();
    const config = loadConfig({ DATABASE_URL: databaseUrl, LEAGUEPEDIA_SYNC_YEARS: "2023,2024", LEAGUEPEDIA_SYNC_COMPETITIONS: "Worlds,MSI", LEAGUEPEDIA_COMPETITION_MAP: '{"Worlds":{"2023":"2023 Season World Championship","2024":"2024 Season World Championship"},"MSI":{"2023":"2023 Mid-Season Invitational","2024":"2024 Mid-Season Invitational"}}', LEAGUEPEDIA_MEDIA_HOSTS: "static.wikia.nocookie.net,images.example" });
    expect(config.leaguepedia).toMatchObject({ syncYears: [2023, 2024], syncCompetitions: ["Worlds", "MSI"], mediaHosts: ["static.wikia.nocookie.net", "images.example"] });
    expect(config.leaguepedia.competitionMap.Worlds).toEqual({ "2023": "2023 Season World Championship", "2024": "2024 Season World Championship" });
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, LEAGUEPEDIA_COMPETITION_MAP: '{"Worlds":"2024 Season World Championship"}' })).toThrow(/logical competition.*year/i);
  });

  it("rejects partial S3 configuration", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: databaseUrl,
        S3_ENDPOINT: "http://localhost:9000",
        S3_ACCESS_KEY_ID: "access-key",
      }),
    ).toThrow();
  });

  it("requires complete S3 configuration for redirect media delivery", () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, MEDIA_DELIVERY: "redirect" })).toThrow();
  });

  it("rejects S3 endpoints that could leak credentials or signed URL data", () => {
    const s3Config = {
      DATABASE_URL: databaseUrl,
      S3_REGION: "us-east-1",
      S3_BUCKET: "riftversus",
      S3_ACCESS_KEY_ID: "access-key",
      S3_SECRET_ACCESS_KEY: "secret-value",
      S3_FORCE_PATH_STYLE: "true",
    };

    for (const endpoint of [
      "https://username:password@s3.example.com",
      "https://s3.example.com?X-Amz-Signature=signed-value&querySecret=secret-value",
      "https://s3.example.com#X-Amz-Signature=signed-value",
      "mailto:storage@example.com",
      "javascript:alert(1)",
      "ftp://s3.example.com",
      "file:///var/lib/riftversus",
    ]) {
      expect(() => loadConfig({ ...s3Config, S3_ENDPOINT: endpoint })).toThrow();
    }
  });

  it("parses an all-or-nothing S3 configuration", () => {
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        S3_ENDPOINT: "http://localhost:9000",
        S3_REGION: "us-east-1",
        S3_BUCKET: "riftversus",
        S3_ACCESS_KEY_ID: "access-key",
        S3_SECRET_ACCESS_KEY: "secret-value",
        S3_FORCE_PATH_STYLE: "true",
        MEDIA_DELIVERY: "redirect",
      }),
    ).toMatchObject({
      mediaDelivery: "redirect",
      s3: {
        endpoint: "http://localhost:9000",
        region: "us-east-1",
        bucket: "riftversus",
        accessKeyId: "access-key",
        secretAccessKey: "secret-value",
        forcePathStyle: true,
      },
    });
  });

  it("never includes secrets in a safe config summary", () => {
    const config = loadConfig({
      DATABASE_URL: databaseUrl,
      S3_ENDPOINT: "http://localhost:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "riftversus",
      S3_ACCESS_KEY_ID: "access-key",
      S3_SECRET_ACCESS_KEY: "secret-value",
      S3_FORCE_PATH_STYLE: "false",
    });

    const summary = safeConfigSummary(config);
    expect(summary).toEqual({
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      bucket: "riftversus",
      mode: "proxy",
    });
    expect(JSON.stringify(summary)).not.toContain("password");
    expect(JSON.stringify(summary)).not.toContain("access-key");
    expect(JSON.stringify(summary)).not.toContain("secret-value");
  });
});
