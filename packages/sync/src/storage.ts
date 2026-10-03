import type { Readable } from "node:stream";

/** Provider-neutral immutable object storage boundary owned by sync. */
export interface ObjectStore {
  get(key: string): Promise<Readable | null>;
  head(key: string): Promise<StoredObjectMetadata | null>;
  putImmutable(object: ImmutableObject): Promise<"inserted" | "existing">;
}

export interface StoredObjectMetadata {
  checksum: string;
  contentType: string | null;
  byteSize: number | null;
}

export interface ImmutableObject {
  key: string;
  bytes: Uint8Array;
  checksum: string;
  contentType: string;
}
