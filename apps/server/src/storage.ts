import { createS3ObjectStore, type ObjectStore, type S3ObjectStoreConfig } from "@riftversus/sync";

import type { Config } from "./config.js";

export function createConfiguredObjectStore(config: Pick<Config, "s3">, factory: (input: S3ObjectStoreConfig) => ObjectStore = createS3ObjectStore): ObjectStore | undefined {
  return config.s3 === undefined ? undefined : factory(config.s3);
}
