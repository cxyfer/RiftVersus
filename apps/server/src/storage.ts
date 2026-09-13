import { createS3ObjectStore, type SignedObjectStore, type S3ObjectStoreConfig } from "@riftversus/sync";

import type { Config } from "./config.js";

export function createConfiguredObjectStore(config: Pick<Config, "s3">, factory: (input: S3ObjectStoreConfig) => SignedObjectStore = createS3ObjectStore): SignedObjectStore | undefined {
  return config.s3 === undefined ? undefined : factory(config.s3);
}
