import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  type BucketLocationConstraint,
} from "@aws-sdk/client-s3";

import type { S3ObjectStoreConfig } from "../storage.js";

interface S3BucketClientLike {
  send(command: HeadBucketCommand | CreateBucketCommand): Promise<unknown>;
}

function isMissingBucket(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    value.name === "NotFound" ||
    value.name === "NoSuchBucket" ||
    value.$metadata?.httpStatusCode === 404
  );
}

function isCreateConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return value.name === "BucketAlreadyOwnedByYou" || value.name === "BucketAlreadyExists" || value.$metadata?.httpStatusCode === 409;
}

function createClient(config: S3ObjectStoreConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function bootstrapS3Bucket(
  config: S3ObjectStoreConfig,
  autoCreate: boolean,
  dependencies: { client?: S3BucketClientLike } = {},
): Promise<"existing" | "created"> {
  const client = dependencies.client ?? createClient(config);
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return "existing";
  } catch (error) {
    if (!isMissingBucket(error)) throw error;
    if (!autoCreate) {
      throw new Error(
        `S3 bucket ${config.bucket} does not exist and automatic creation is disabled.`,
        { cause: error },
      );
    }
  }

  try {
    await client.send(
      new CreateBucketCommand({
        Bucket: config.bucket,
        ...(config.region === "us-east-1"
          ? {}
          : {
              CreateBucketConfiguration: {
                LocationConstraint: config.region as BucketLocationConstraint,
              },
            }),
      }),
    );
    return "created";
  } catch (error) {
    if (!isCreateConflict(error)) throw error;
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return "existing";
  }
}
