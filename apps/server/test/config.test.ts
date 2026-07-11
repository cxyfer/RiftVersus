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
      mediaDelivery: "proxy",
      s3: undefined,
    });
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
