import type { Readable } from "node:stream";

/** Provider-neutral immutable object storage boundary owned by sync. */
export interface ObjectStore {
  get(key: string): Promise<Readable | null>;
  signedGetUrl(key: string, ttlSeconds: number): Promise<string>;
}

export interface S3ObjectStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}
