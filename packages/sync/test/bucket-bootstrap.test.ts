import { describe, expect, it, vi } from "vitest";

import type { S3ObjectStoreConfig } from "../src/storage.js";

const config: S3ObjectStoreConfig = {
  endpoint: "http://minio:9000",
  region: "us-east-1",
  bucket: "riftversus",
  accessKeyId: "local-access",
  secretAccessKey: "local-secret",
  forcePathStyle: true,
};

describe("S3 bucket bootstrap", () => {
  it("only inspects an existing bucket when auto-create is disabled", async () => {
    const module = await import("../src/storage/bootstrap.js");
    const send = vi.fn(async () => ({}));
    await expect(
      module.bootstrapS3Bucket(config, false, { client: { send } }),
    ).resolves.toBe("existing");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].constructor.name).toBe("HeadBucketCommand");
  });

  it("creates a missing local bucket only when explicitly enabled", async () => {
    const module = await import("../src/storage/bootstrap.js");
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("missing"), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        }),
      )
      .mockResolvedValueOnce({});
    await expect(
      module.bootstrapS3Bucket(config, true, { client: { send } }),
    ).resolves.toBe("created");
    expect(
      send.mock.calls.map(([command]) => command.constructor.name),
    ).toEqual(["HeadBucketCommand", "CreateBucketCommand"]);
  });

  it("fails closed when the bucket is missing and auto-create is disabled", async () => {
    const module = await import("../src/storage/bootstrap.js");
    const send = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("missing"), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        }),
      );
    await expect(
      module.bootstrapS3Bucket(config, false, { client: { send } }),
    ).rejects.toThrow(/does not exist/i);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("re-heads and succeeds when another creator wins the bucket race", async () => {
    const module = await import("../src/storage/bootstrap.js");
    const missing = Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    const conflict = Object.assign(new Error("race"), { name: "BucketAlreadyOwnedByYou", $metadata: { httpStatusCode: 409 } });
    const send = vi.fn().mockRejectedValueOnce(missing).mockRejectedValueOnce(conflict).mockResolvedValueOnce({});
    await expect(module.bootstrapS3Bucket(config, true, { client: { send } })).resolves.toBe("existing");
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual(["HeadBucketCommand", "CreateBucketCommand", "HeadBucketCommand"]);
  });
});
