import { loadSyncConfig } from "@riftversus/sync";
import { z } from "zod";

const S3_VARIABLES = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
] as const;

const S3EndpointSchema = z.url().refine(
  (endpoint) => {
    const url = new URL(endpoint);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  },
  "S3_ENDPOINT must be an HTTP(S) URL without userinfo, query parameters, or a fragment.",
);

const ServerEnvironmentSchema = z
  .object({
    S3_ENDPOINT: S3EndpointSchema.optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
    S3_AUTO_CREATE_BUCKET: z.enum(["true", "false"]).default("false"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default("0.0.0.0"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    SYNC_CRON: z.string().min(1).default("0 3 * * *"),
    SYNC_TIMEZONE: z.string().min(1).default("UTC"),
    SYNC_HISTORY_CRON: z.string().min(1).optional(),
    SYNC_RUN_ON_START: z.enum(["true", "false"]).default("false"),
    MEDIA_DELIVERY: z.enum(["proxy", "redirect"]).default("proxy"),
  })
  .superRefine((environment, context) => {
    const configuredS3Variables = S3_VARIABLES.filter((key) => environment[key] !== undefined);

    if (configuredS3Variables.length > 0 && configuredS3Variables.length < S3_VARIABLES.length) {
      context.addIssue({
        code: "custom",
        message: "S3 configuration must include endpoint, region, bucket, credentials, and path-style mode.",
        path: configuredS3Variables,
      });
    }
    if (environment.MEDIA_DELIVERY === "redirect" && configuredS3Variables.length !== S3_VARIABLES.length) {
      context.addIssue({ code: "custom", message: "MEDIA_DELIVERY=redirect requires complete S3 configuration.", path: ["MEDIA_DELIVERY"] });
    }
    if (environment.S3_AUTO_CREATE_BUCKET === "true") {
      if (configuredS3Variables.length !== S3_VARIABLES.length) {
        context.addIssue({ code: "custom", message: "S3_AUTO_CREATE_BUCKET requires complete S3 configuration.", path: ["S3_AUTO_CREATE_BUCKET"] });
      } else {
        const hostname = new URL(environment.S3_ENDPOINT!).hostname.toLowerCase();
        if (!["localhost", "127.0.0.1", "::1", "minio"].includes(hostname)) context.addIssue({ code: "custom", message: "S3 automatic bucket creation is local-only; remote object stores must be provisioned separately.", path: ["S3_AUTO_CREATE_BUCKET"] });
      }
    }
  });

export type Environment = Record<string, string | undefined>;

export function loadConfig(environment: Environment) {
  const parsed = ServerEnvironmentSchema.parse(environment);
  const syncConfig = loadSyncConfig({
    ...environment,
    SYNC_HISTORY_ENABLED: parsed.SYNC_HISTORY_CRON === undefined ? "false" : "true",
  });
  const hasS3 = S3_VARIABLES.every((key) => parsed[key] !== undefined);

  return {
    ...syncConfig,
    historyEnabled: parsed.SYNC_HISTORY_CRON !== undefined,
    port: parsed.PORT,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    syncCron: parsed.SYNC_CRON,
    syncTimezone: parsed.SYNC_TIMEZONE,
    syncHistoryCron: parsed.SYNC_HISTORY_CRON,
    syncRunOnStart: parsed.SYNC_RUN_ON_START === "true",
    mediaDelivery: parsed.MEDIA_DELIVERY,
    s3AutoCreateBucket: parsed.S3_AUTO_CREATE_BUCKET === "true",
    s3: hasS3
      ? {
          endpoint: parsed.S3_ENDPOINT!,
          region: parsed.S3_REGION!,
          bucket: parsed.S3_BUCKET!,
          accessKeyId: parsed.S3_ACCESS_KEY_ID!,
          secretAccessKey: parsed.S3_SECRET_ACCESS_KEY!,
          forcePathStyle: parsed.S3_FORCE_PATH_STYLE === "true",
        }
      : undefined,
  };
}

export type Config = ReturnType<typeof loadConfig>;

export function safeConfigSummary(config: Config) {
  return {
    endpoint: config.s3?.endpoint ?? null,
    region: config.s3?.region ?? null,
    bucket: config.s3?.bucket ?? null,
    mode: config.mediaDelivery,
  };
}
