import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { loadConfig, safeConfigSummary } from "../src/config.js";

const databaseUrl = "postgresql://riftversus:password@localhost:5432/riftversus";
const leaguepediaEnvironment = {
  LEAGUEPEDIA_ENDPOINT: "https://leaguepedia.acme.org/api.php",
  LEAGUEPEDIA_USER_AGENT: "RiftVersus/0.1 (+https://riftversus.acme.org; ops@acme.org)",
  LEAGUEPEDIA_MEDIA_HOSTS: "static.acme.org",
} as const;
const reservedDomains = ["leaguepedia.example", "leaguepedia.invalid", "leaguepedia.test", "service.localhost", "example.com", "example.net", "example.org"];

function exampleEnvironmentValue(name: string): string {
  const contents = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
  const line = contents.split(/\r?\n/u).find((candidate) => candidate.startsWith(`${name}=`));
  if (line === undefined) throw new Error(`Missing ${name} in .env.example.`);
  return line.slice(name.length + 1);
}

describe("loadConfig", () => {
  it("validates scheduler health thresholds and explicit startup opt-in", () => {
    const environment = { DATABASE_URL: databaseUrl, ...leaguepediaEnvironment };
    expect(loadConfig(environment)).toMatchObject({ syncRunOnStart: false, syncMaxAgeHours: 36, syncHistoryMaxAgeHours: 192, syncFailureThreshold: 3 });
    for (const key of ["SYNC_MAX_AGE_HOURS", "SYNC_HISTORY_MAX_AGE_HOURS", "SYNC_FAILURE_THRESHOLD"]) {
      expect(() => loadConfig({ ...environment, [key]: "0" })).toThrow();
    }
    expect(() => loadConfig({ ...environment, SYNC_RUN_ON_START: "yes" })).toThrow();
  });
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
      s3AutoCreateBucket: false,
      leaguepedia: { requestIntervalMs: 1_000, resourceLimits: { maxReviewedPages: 5_000 } },
      s3: undefined,
    });
  });

  it("allows bucket creation only for an explicitly local S3 endpoint", () => {
    const local = {
      DATABASE_URL: databaseUrl,
      ...leaguepediaEnvironment,
      S3_ENDPOINT: "http://minio:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "riftversus",
      S3_ACCESS_KEY_ID: "local-access",
      S3_SECRET_ACCESS_KEY: "local-secret",
      S3_FORCE_PATH_STYLE: "true",
      S3_AUTO_CREATE_BUCKET: "true",
    } as const;
    expect(loadConfig(local).s3AutoCreateBucket).toBe(true);
    expect(() => loadConfig({ ...local, S3_ENDPOINT: "https://objects.acme.org" })).toThrow(/auto.*local/i);
  });

  it("validates bounded Leaguepedia sync settings", () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_ENDPOINT: "http://leaguepedia.acme.org/api.php" })).toThrow(/endpoint/i);
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_SYNC_YEARS: "" })).toThrow();
    const config = loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_SYNC_YEARS: "2023,2024", LEAGUEPEDIA_SYNC_COMPETITIONS: "Worlds,MSI", LEAGUEPEDIA_COMPETITION_MAP: '{"Worlds":{"2023":"Worlds 2023 Main Event","2024":"Worlds 2024 Main Event"},"MSI":{"2023":"2023 Mid-Season Invitational","2024":"2024 Mid-Season Invitational"}}', LEAGUEPEDIA_MEDIA_HOSTS: "static.acme.org,images.acme.org" });
    expect(config.leaguepedia).toMatchObject({ syncYears: [2023, 2024], syncCompetitions: ["Worlds", "MSI"], mediaHosts: ["static.acme.org", "images.acme.org"] });
    expect(loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_MAX_REVIEWED_PAGES: "123" }).leaguepedia.resourceLimits.maxReviewedPages).toBe(123);
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_MAX_REVIEWED_PAGES: "0" })).toThrow();
    expect(exampleEnvironmentValue("LEAGUEPEDIA_MAX_REVIEWED_PAGES")).toBe("5000");
    expect(loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_REQUEST_INTERVAL_MS: "2500" }).leaguepedia.requestIntervalMs).toBe(2_500);
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_REQUEST_INTERVAL_MS: "999" })).toThrow();
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_REQUEST_INTERVAL_MS: "60001" })).toThrow();
    expect(exampleEnvironmentValue("LEAGUEPEDIA_REQUEST_INTERVAL_MS")).toBe("1000");
    expect(config.leaguepedia.competitionMap.Worlds).toEqual({ "2023": "Worlds 2023 Main Event", "2024": "Worlds 2024 Main Event" });
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_COMPETITION_MAP: '{"Worlds":"2024 Season World Championship"}' })).toThrow(/logical competition.*year/i);
  });

  it("accepts multiple exact source keys for one competition and year", () => {
    const config = loadConfig({ ...leaguepediaEnvironment, DATABASE_URL: databaseUrl,
      LEAGUEPEDIA_COMPETITION_MAP: '{"LCK":{"2024":["LCK 2024 Spring","LCK 2024 Spring Playoffs"]}}',
      LEAGUEPEDIA_MAPPING_COMPETITIONS: "LCK", LEAGUEPEDIA_MAPPING_YEARS: "2024" });
    expect(config.leaguepedia.competitionMap.LCK?.["2024"]).toEqual(["LCK 2024 Spring", "LCK 2024 Spring Playoffs"]);
  });

  it.each([
    "https://leaguepedia.acme.org/api.php?",
    "https://leaguepedia.acme.org/api.php#",
    "https://user:password@leaguepedia.acme.org/api.php",
    "https://localhost/api.php",
    "https://leaguepedia.acme.org/",
    "https://leaguepedia.acme.org/not-api",
  ])("rejects unsafe or non-API Leaguepedia endpoint %s", (endpoint) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_ENDPOINT: endpoint })).toThrow(/endpoint/i);
  });

  it.each([
    "RiftVersus/0.1 (https://)",
    "RiftVersus/0.1 (https://?)",
    "RiftVersus/0.1 (https://localhost)",
    "RiftVersus/0.1 .ops@acme.org",
    "RiftVersus/0.1 ops..team@acme.org",
    "RiftVersus/0.1 ops.@acme.org",
    "RiftVersus/0.1 contact@acme.org\r\nInjected: header",
    "RiftVersus/0.1 contact@acme.org\u0000",
    "RiftVersus/0.1 contact@acme.org\u007f",
  ])("rejects unsafe or invalid Leaguepedia user agent", (userAgent) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_USER_AGENT: userAgent })).toThrow(/user.agent/i);
  });

  it.each([
    "RiftVersus/0.1 (+https://riftversus.acme.org/contact)",
    "RiftVersus/0.1 ops@acme.org",
  ])("accepts a descriptive Leaguepedia user agent with a valid contact", (userAgent) => {
    expect(loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_USER_AGENT: userAgent }).leaguepediaUserAgent).toBe(userAgent);
  });

  it.each(reservedDomains)("rejects reserved Leaguepedia endpoint host %s", (hostname) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_ENDPOINT: `https://${hostname}/api.php` })).toThrow(/endpoint/i);
  });

  it.each(reservedDomains)("rejects reserved Leaguepedia user-agent URL host %s", (hostname) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_USER_AGENT: `RiftVersus/0.1 (+https://${hostname}/contact)` })).toThrow(/user.agent/i);
  });

  it.each(reservedDomains)("rejects reserved Leaguepedia user-agent email domain %s", (hostname) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_USER_AGENT: `RiftVersus/0.1 ops@${hostname}` })).toThrow(/user.agent/i);
  });

  it.each(reservedDomains)("rejects reserved Leaguepedia media host %s", (hostname) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_MEDIA_HOSTS: `static.acme.org,${hostname}` })).toThrow(/media.host/i);
  });

  it.each(["https://static.acme.org", "static.acme.org/path", "static.acme.org:443", "user@static.acme.org", ".static.acme.org", "static..acme.org"])("rejects non-host Leaguepedia media value %s", (hostname) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ...leaguepediaEnvironment, LEAGUEPEDIA_MEDIA_HOSTS: hostname })).toThrow(/media.host/i);
  });

  it("rejects unedited Leaguepedia placeholders from .env.example", () => {
    expect(() => loadConfig({
      DATABASE_URL: databaseUrl,
      LEAGUEPEDIA_ENDPOINT: exampleEnvironmentValue("LEAGUEPEDIA_ENDPOINT"),
      LEAGUEPEDIA_USER_AGENT: exampleEnvironmentValue("LEAGUEPEDIA_USER_AGENT"),
      LEAGUEPEDIA_MEDIA_HOSTS: exampleEnvironmentValue("LEAGUEPEDIA_MEDIA_HOSTS"),
    })).toThrow();
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
