import type { ObjectStore } from "@riftversus/sync";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { createConfiguredObjectStore } from "../src/storage.js";

describe("configured object storage", () => {
  it("constructs an object store for complete S3 redirect configuration", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://user:password@localhost:5432/riftversus",
      LEAGUEPEDIA_ENDPOINT: "https://leaguepedia.acme.org/api.php",
      LEAGUEPEDIA_USER_AGENT: "RiftVersus/0.1 (+https://riftversus.acme.org; ops@acme.org)",
      LEAGUEPEDIA_MEDIA_HOSTS: "static.acme.org",
      MEDIA_DELIVERY: "redirect",
      S3_ENDPOINT: "https://storage.example.test",
      S3_REGION: "us-east-1",
      S3_BUCKET: "riftversus-media",
      S3_ACCESS_KEY_ID: "access-key",
      S3_SECRET_ACCESS_KEY: "secret-key",
      S3_FORCE_PATH_STYLE: "true",
    });
    const objectStore: ObjectStore = { get: vi.fn(), signedGetUrl: vi.fn() };
    const factory = vi.fn(() => objectStore);

    expect(createConfiguredObjectStore(config, factory)).toBe(objectStore);
    expect(factory).toHaveBeenCalledWith(config.s3);
  });
});
