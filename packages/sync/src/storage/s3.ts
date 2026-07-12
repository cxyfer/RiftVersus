import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import type { ObjectStore, S3ObjectStoreConfig } from "../storage.js";

interface S3ClientLike {
  send(command: GetObjectCommand): Promise<{ Body?: unknown }>;
}

type Signer = (client: S3Client, command: GetObjectCommand, options: { expiresIn: number }) => Promise<string>;

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { name?: unknown }).name === "NoSuchKey";
}

function toNodeReadable(body: unknown): Readable | null {
  if (body instanceof Readable) return body;
  if (body && typeof body === "object" && "getReader" in body) return Readable.fromWeb(body as NodeReadableStream);
  return null;
}

export function createS3ObjectStore(config: S3ObjectStoreConfig, dependencies?: { client?: S3ClientLike; sign?: Signer }): ObjectStore {
  const client = dependencies?.client ?? new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const sign = dependencies?.sign ?? getSignedUrl;
  const command = (key: string) => new GetObjectCommand({ Bucket: config.bucket, Key: key });
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
  };
}
