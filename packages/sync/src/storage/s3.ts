import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import type { ImmutableObject, SignedObjectStore, S3ObjectStoreConfig, StoredObjectMetadata } from "../storage.js";

interface S3ClientLike {
  send(command: GetObjectCommand | HeadObjectCommand | PutObjectCommand): Promise<{ Body?: unknown; Metadata?: Record<string, string>; ContentLength?: number; ContentType?: string }>;
}

type Signer = (client: S3Client, command: GetObjectCommand, options: { expiresIn: number }) => Promise<string>;

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { name?: unknown }).name === "NoSuchKey";
}

function isMissingHeadObject(error: unknown): boolean {
  if (isMissingObject(error)) return true;
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return value.name === "NotFound" || value.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return value.name === "PreconditionFailed" || value.$metadata?.httpStatusCode === 412;
}

function toNodeReadable(body: unknown): Readable | null {
  if (body instanceof Readable) return body;
  if (body && typeof body === "object" && "getReader" in body) return Readable.fromWeb(body as NodeReadableStream);
  return null;
}

export function createS3ObjectStore(config: S3ObjectStoreConfig, dependencies?: { client?: S3ClientLike; sign?: Signer }): SignedObjectStore {
  const client = dependencies?.client ?? new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const sign = dependencies?.sign ?? getSignedUrl;
  const command = (key: string) => new GetObjectCommand({ Bucket: config.bucket, Key: key });
  const head = async (key: string): Promise<StoredObjectMetadata | null> => {
    try {
      const response = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      return {
        checksum: response.Metadata?.sha256 ?? "",
        contentType: response.ContentType ?? null,
        byteSize: response.ContentLength ?? null,
      };
    } catch (error) {
      if (isMissingHeadObject(error)) return null;
      throw error;
    }
  };
  const verifyExisting = (existing: StoredObjectMetadata, object: ImmutableObject): "existing" => {
    if (existing.checksum.length === 0) throw new Error(`Immutable object is missing required checksum metadata for ${object.key}.`);
    if (existing.byteSize === null) throw new Error(`Immutable object is missing required byte size metadata for ${object.key}.`);
    if (existing.contentType === null || existing.contentType.length === 0) throw new Error(`Immutable object is missing required content type metadata for ${object.key}.`);
    if (existing.checksum !== object.checksum) throw new Error(`Immutable object checksum conflict for ${object.key}.`);
    if (existing.byteSize !== object.bytes.byteLength) throw new Error(`Immutable object byte size conflict for ${object.key}.`);
    if (existing.contentType !== object.contentType) throw new Error(`Immutable object content type conflict for ${object.key}.`);
    return "existing";
  };
  return {
    async get(key) {
      try {
        const response = await client.send(command(key));
        return toNodeReadable(response.Body);
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },
    signedGetUrl(key, ttlSeconds) {
      return sign(client as S3Client, command(key), { expiresIn: ttlSeconds });
    },
    head,
    async putImmutable(object) {
      const existing = await head(object.key);
      if (existing !== null) return verifyExisting(existing, object);
      try {
        await client.send(new PutObjectCommand({
          Bucket: config.bucket,
          Key: object.key,
          Body: object.bytes,
          ContentType: object.contentType,
          Metadata: { sha256: object.checksum },
          IfNoneMatch: "*",
        }));
        return "inserted";
      } catch (error) {
        if (!isPreconditionFailure(error)) throw error;
        const raced = await head(object.key);
        if (raced === null) throw error;
        return verifyExisting(raced, object);
      }
    },
  };
}
