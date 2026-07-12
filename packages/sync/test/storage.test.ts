import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { createS3ObjectStore } from "../src/storage/s3.js";

const config = {
  endpoint: "https://storage.example.test",
  region: "us-east-1",
  bucket: "riftversus-media",
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
  forcePathStyle: true,
};

async function read(stream: Readable): Promise<string> {
  let value = "";
  for await (const chunk of stream) value += chunk;
  return value;
}

describe("S3 object store", () => {
  it("reads configured bucket objects and signs URLs with the requested TTL", async () => {
    const client = { send: vi.fn(async () => ({ Body: Readable.from("cached-image") })) };
    const sign = vi.fn(async () => "https://storage.example.test/signed/media/faker.png");
    const store = createS3ObjectStore(config, { client, sign });

    const object = await store.get("media/faker.png");
    expect(object).not.toBeNull();
    expect(await read(object!)).toBe("cached-image");
    expect(client.send).toHaveBeenCalledOnce();
    expect(client.send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect((client.send.mock.calls[0]?.[0] as GetObjectCommand).input).toMatchObject({ Bucket: config.bucket, Key: "media/faker.png" });

    await expect(store.signedGetUrl("media/faker.png", 300)).resolves.toBe("https://storage.example.test/signed/media/faker.png");
    expect(sign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ input: { Bucket: config.bucket, Key: "media/faker.png" } }), { expiresIn: 300 });
  });

  it("returns null for an explicit S3 NoSuchKey error", async () => {
    const missing = createS3ObjectStore(config, { client: { send: vi.fn(async () => { throw { name: "NoSuchKey" }; }) } });
    await expect(missing.get("media/missing.png")).resolves.toBeNull();
  });

  it("propagates generic NotFound and bare 404 provider errors", async () => {
    const notFound = Object.assign(new Error("not found"), { name: "NotFound" });
    const genericNotFound = createS3ObjectStore(config, { client: { send: vi.fn(async () => { throw notFound; }) } });
    await expect(genericNotFound.get("media/faker.png")).rejects.toBe(notFound);

    const http404 = { $metadata: { httpStatusCode: 404 } };
    const generic404 = createS3ObjectStore(config, { client: { send: vi.fn(async () => { throw http404; }) } });
    await expect(generic404.get("media/faker.png")).rejects.toBe(http404);
  });

  it("propagates non-missing provider failures", async () => {
    const unavailable = createS3ObjectStore(config, { client: { send: vi.fn(async () => { throw new Error("storage offline"); }) } });
    await expect(unavailable.get("media/faker.png")).rejects.toThrow("storage offline");
  });

  it("stores a missing immutable object and returns existing for a matching checksum", async () => {
    const client = { send: vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) throw { name: "NoSuchKey" };
      if (command instanceof PutObjectCommand) return {};
      return {};
    }) };
    const store = createS3ObjectStore(config, { client });
    const object = { key: "sources/fixture/abc", bytes: new Uint8Array([1, 2]), checksum: "abc", contentType: "application/json" };
    await expect(store.putImmutable(object)).resolves.toBe("inserted");
    expect(client.send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(true);

    vi.mocked(client.send).mockResolvedValue({ Metadata: { sha256: "abc" }, ContentLength: 2, ContentType: "application/json" });
    await expect(store.putImmutable(object)).resolves.toBe("existing");
    expect(client.send.mock.calls.at(-1)?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("treats an S3 HeadObject 404 as a missing object without weakening GetObject errors", async () => {
    const client = { send: vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
      if (command instanceof PutObjectCommand) return {};
      throw new Error("unexpected command");
    }) };
    const store = createS3ObjectStore(config, { client });
    await expect(store.putImmutable({ key: "sources/fixture/new", bytes: new Uint8Array([1]), checksum: "new", contentType: "application/json" })).resolves.toBe("inserted");
  });

  it("refuses an existing object with the wrong checksum", async () => {
    const store = createS3ObjectStore(config, { client: { send: vi.fn(async () => ({ Metadata: { sha256: "different" }, ContentLength: 2, ContentType: "application/json" })) } });
    await expect(store.putImmutable({ key: "sources/fixture/abc", bytes: new Uint8Array([1, 2]), checksum: "abc", contentType: "application/json" })).rejects.toThrow("checksum");
  });

  it.each(["checksum", "byteSize", "contentType"] as const)("fails closed when initial HEAD omits %s metadata", async (missing) => {
    const response = {
      Metadata: missing === "checksum" ? {} : { sha256: "abc" },
      ...(missing === "byteSize" ? {} : { ContentLength: 2 }),
      ...(missing === "contentType" ? {} : { ContentType: "application/json" }),
    };
    const store = createS3ObjectStore(config, { client: { send: vi.fn(async () => response) } });
    await expect(store.putImmutable({ key: "sources/fixture/abc", bytes: new Uint8Array([1, 2]), checksum: "abc", contentType: "application/json" })).rejects.toThrow(/metadata|conflict/);
  });

  it("accepts a conditional-put race only after a matching re-HEAD", async () => {
    let heads = 0;
    const client = { send: vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        heads += 1;
        if (heads === 1) throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
        return { Metadata: { sha256: "abc" }, ContentLength: 2, ContentType: "application/json" };
      }
      if (command instanceof PutObjectCommand) throw { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } };
      return {};
    }) };
    const store = createS3ObjectStore(config, { client });
    await expect(store.putImmutable({ key: "sources/fixture/abc", bytes: new Uint8Array([1, 2]), checksum: "abc", contentType: "application/json" })).resolves.toBe("existing");
    expect(heads).toBe(2);
  });

  it("rejects a conditional-put race whose re-HEAD checksum conflicts", async () => {
    let heads = 0;
    const client = { send: vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        heads += 1;
        if (heads === 1) throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
        return { Metadata: { sha256: "other" }, ContentLength: 2, ContentType: "application/json" };
      }
      if (command instanceof PutObjectCommand) throw { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } };
      return {};
    }) };
    const store = createS3ObjectStore(config, { client });
    await expect(store.putImmutable({ key: "sources/fixture/abc", bytes: new Uint8Array([1, 2]), checksum: "abc", contentType: "application/json" })).rejects.toThrow("checksum conflict");
    expect(heads).toBe(2);
  });

  it.each(["checksum", "byteSize", "contentType"] as const)("fails closed when a 412 re-HEAD omits %s metadata", async (missing) => {
    let heads = 0;
    const client = { send: vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        heads += 1;
        if (heads === 1) throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
        return {
          Metadata: missing === "checksum" ? {} : { sha256: "abc" },
          ...(missing === "byteSize" ? {} : { ContentLength: 2 }),
          ...(missing === "contentType" ? {} : { ContentType: "application/json" }),
        };
      }
      if (command instanceof PutObjectCommand) throw { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } };
      return {};
    }) };
    const store = createS3ObjectStore(config, { client });
    await expect(store.putImmutable({ key: "sources/fixture/abc", bytes: new Uint8Array([1, 2]), checksum: "abc", contentType: "application/json" })).rejects.toThrow(/metadata|conflict/);
  });
});
