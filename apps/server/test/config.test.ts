import { describe, expect, it } from "vitest";

import { loadConfig, safeConfigSummary } from "../src/config.js";

const databaseUrl = "postgresql://riftversus:password@localhost:5432/riftversus";
const leaguepediaEnvironment = {
  LEAGUEPEDIA_ENDPOINT: "https://leaguepedia.example/api.php",
  LEAGUEPEDIA_USER_AGENT: "RiftVersus/0.1 (+https://riftversus.example; ops@riftversus.example)",
  LEAGUEPEDIA_MEDIA_HOSTS: "media.leaguepedia.example",
} as const;

describe("loadConfig", () => {
  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("requires explicitly reviewed Leaguepedia source settings", () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl })).toThrow();
    for (const missing of Object.keys(leaguepediaEnvironment)) {
      const environment = { DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, [missing]: undefined };
      expect(() => loadConfig(environment)).toThrow();
    }
  });

  it("applies production-safe defaults", () => {
    expect(loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment })).toMatchObject({
      databaseUrl,
      port: 3000,
      host: "0.0.0.0",
      logLevel: "info",
      syncCron: "0 3 * * *",
      syncTimezone: "UTC",
      leaguepediaEndpoint: leaguepediaEnvironment.LEAGUEPEDIA_ENDPOINT,
      leaguepediaUserAgent: leaguepediaEnvironment.LEAGUEPEDIA_USER_AGENT,
      mediaDelivery: "proxy",
      s3: undefined,
    });
  });

  it("validates bounded Leaguepedia sync settings", () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_ENDPOINT: "http://lol.example/api.php" })).toThrow(/endpoint/i);
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_SYNC_YEARS: "" })).toThrow();
    const config = loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_SYNC_YEARS: "2023,2024", LEAGUEPEDIA_SYNC_COMPETITIONS: "Worlds,MSI", LEAGUEPEDIA_COMPETITION_MAP: '{"Worlds":{"2023":"2023 Season World Championship","2024":"2024 Season World Championship"},"MSI":{"2023":"2023 Mid-Season Invitational","2024":"2024 Mid-Season Invitational"}}', LEAGUEPEDIA_MEDIA_HOSTS: "media.leaguepedia.example,images.example" });
    expect(config.leaguepedia).toMatchObject({ syncYears: [2023, 2024], syncCompetitions: ["Worlds", "MSI"], mediaHosts: ["media.leaguepedia.example", "images.example"] });
    expect(config.leaguepedia.competitionMap.Worlds).toEqual({ "2023": "2023 Season World Championship", "2024": "2024 Season World Championship" });
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_COMPETITION_MAP: '{"Worlds":"2024 Season World Championship"}' })).toThrow(/logical competition.*year/i);
  });

  it.each([
    "https://leaguepedia.example/api.php?",
    "https://leaguepedia.example/api.php#",
    "https://user:password@leaguepedia.example/api.php",
    "https://localhost/api.php",
    "https://leaguepedia.example/",
    "https://leaguepedia.example/not-api",
  ])("rejects unsafe or non-API Leaguepedia endpoint %s", (endpoint) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_ENDPOINT: endpoint })).toThrow(/endpoint/i);
  });

  it.each([
    "RiftVersus/0.1 (https://)",
    "RiftVersus/0.1 (https://?)",
    "RiftVersus/0.1 (https://localhost)",
    "RiftVersus/0.1 .ops@riftversus.example",
    "RiftVersus/0.1 ops..team@riftversus.example",
    "RiftVersus/0.1 ops.@riftversus.example",
    "RiftVersus/0.1 contact@example.invalid\r\nInjected: header",
    "RiftVersus/0.1 contact@example.invalid\u0000",
    "RiftVersus/0.1 contact@example.invalid\u007f",
  ])("rejects unsafe or invalid Leaguepedia user agent", (userAgent) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_USER_AGENT: userAgent })).toThrow(/user.agent/i);
  });

  it.each([
    "RiftVersus/0.1 (+https://riftversus.example/contact)",
    "RiftVersus/0.1 ops@riftversus.example",
  ])("accepts a descriptive Leaguepedia user agent with a valid contact", (userAgent) => {
    expect(loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_USER_AGENT: userAgent }).leaguepediaUserAgent).toBe(userAgent);
  });

  it("rejects partial S3 configuration", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: databaseUrl,
        ...leaguepediaEnvironment,
        S3_ENDPOINT: "http://localhost:9000",
        S3_ACCESS_KEY_ID: "access-key",
      }),
    ).toThrow();
  });

  it("requires complete S3 configuration for redirect media delivery", () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, MEDIA_DELIVERY: "redirect" })).toThrow();
  });

  it("rejects S3 endpoints that could leak credentials or signed URL data", () => {
    const s3Config = {
      DATABASE_URL: databaseUrl,
      ...leaguepediaEnvironment,
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
        ...leaguepediaEnvironment,
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
      ...leaguepediaEnvironment,
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
