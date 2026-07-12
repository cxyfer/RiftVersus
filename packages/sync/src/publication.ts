import { createHash } from "node:crypto";

import type { ImmutableObject, ObjectStore } from "./storage.js";
import type { RetainedMediaInput, RetainedMediaRecord, RetainedSourceInput, RetainedSourceRecord } from "./types.js";

const MEDIA_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sourceObjectKey(provider: string, bytes: Uint8Array): Promise<string> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(provider)) throw new Error("Invalid provider identifier.");
  return `sources/${provider}/${sha256(bytes)}`;
}

export async function mediaObjectKey(bytes: Uint8Array, contentType: string): Promise<string> {
  const extension = MEDIA_EXTENSIONS[contentType];
  if (extension === undefined) throw new Error(`Unsupported media content type: ${contentType}`);
  return `media/${sha256(bytes)}.${extension}`;
}

async function retain(store: ObjectStore, object: ImmutableObject): Promise<void> {
  await store.putImmutable(object);
}

export async function retainSource(store: ObjectStore, provider: string, parserVersion: string, input: RetainedSourceInput): Promise<RetainedSourceRecord> {
  const checksum = sha256(input.bytes);
  const objectKey = await sourceObjectKey(provider, input.bytes);
  await retain(store, { key: objectKey, bytes: input.bytes, checksum, contentType: input.contentType });
  return {
    provider,
    sourceKey: input.sourceKey,
    sourceUrl: input.sourceUrl,
    objectKey,
    checksum,
    contentType: input.contentType,
    byteSize: String(input.bytes.byteLength),
    parserVersion,
  };
}

export async function retainMedia(store: ObjectStore, provider: string, input: RetainedMediaInput & { bytes: Uint8Array; contentType: string }): Promise<RetainedMediaRecord> {
  const checksum = sha256(input.bytes);
  const objectKey = await mediaObjectKey(input.bytes, input.contentType);
  await retain(store, { key: objectKey, bytes: input.bytes, checksum, contentType: input.contentType });
  return {
    provider,
    sourceUrl: input.sourceUrl,
    objectKey,
    checksum,
    contentType: input.contentType,
    byteSize: String(input.bytes.byteLength),
    attribution: input.attribution,
    ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
    ...(input.teamEraId === undefined ? {} : { teamEraId: input.teamEraId }),
    ...(input.license === undefined ? {} : { license: input.license }),
  };
}
