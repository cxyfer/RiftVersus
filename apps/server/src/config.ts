import { z } from "zod";

const S3_VARIABLES = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
] as const;

const csv = (value: string, name: string) => {
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length === 0 || new Set(items).size !== items.length) throw new Error(`${name} must contain unique comma-separated values.`);
  return items;
};
const years = (value: string) => csv(value, "LEAGUEPEDIA_SYNC_YEARS").map((item) => {
  const year = Number(item); if (!Number.isInteger(year) || year < 2011 || year > 2100) throw new Error("LEAGUEPEDIA_SYNC_YEARS contains an invalid year."); return year;
});

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

const EnvironmentSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    S3_ENDPOINT: S3EndpointSchema.optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default("0.0.0.0"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    SYNC_CRON: z.string().min(1).default("0 3 * * *"),
    SYNC_TIMEZONE: z.string().min(1).default("UTC"),
    LEAGUEPEDIA_ENDPOINT: z.url().refine((value) => new URL(value).protocol === "https:", "LEAGUEPEDIA_ENDPOINT must use HTTPS.").default("https://lol.fandom.com/api.php"),
    LEAGUEPEDIA_USER_AGENT: z.string().min(12).default("RiftVersus/0.1 (https://github.com/riftversus; contact@example.invalid)"),
    LEAGUEPEDIA_SYNC_YEARS: z.string().min(1).default("2024"),
    LEAGUEPEDIA_SYNC_COMPETITIONS: z.string().min(1).default("Worlds"),
    LEAGUEPEDIA_COMPETITION_MAP: z.string().min(2).default('{"Worlds":"2024 Season World Championship"}'),
    LEAGUEPEDIA_MEDIA_HOSTS: z.string().min(1).default("static.wikia.nocookie.net"),
    LEAGUEPEDIA_OVERRIDES_DIR: z.string().min(1).default("data/overrides"),
    LEAGUEPEDIA_FIXTURE_PATH: z.string().min(1).default("data/fixtures/leaguepedia-small.json"),
    LEAGUEPEDIA_MAX_BYTES: z.coerce.number().int().positive().max(500_000_000).default(100_000_000),
    LEAGUEPEDIA_MAX_PAGES: z.coerce.number().int().positive().max(10_000).default(2_000),
    LEAGUEPEDIA_MAX_ROWS: z.coerce.number().int().positive().max(2_000_000).default(500_000),
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
  });

export type Environment = Record<string, string | undefined>;

export function loadConfig(environment: Environment) {
  const parsed = EnvironmentSchema.parse(environment);
  const hasS3 = S3_VARIABLES.every((key) => parsed[key] !== undefined);
  const competitionMap = JSON.parse(parsed.LEAGUEPEDIA_COMPETITION_MAP) as unknown;
  if (typeof competitionMap !== "object" || competitionMap === null || Array.isArray(competitionMap) || Object.values(competitionMap).some((value) => typeof value !== "string" || !value.trim())) throw new Error("LEAGUEPEDIA_COMPETITION_MAP must be a JSON string map.");

  return {
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.PORT,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    syncCron: parsed.SYNC_CRON,
    syncTimezone: parsed.SYNC_TIMEZONE,
    leaguepediaEndpoint: parsed.LEAGUEPEDIA_ENDPOINT,
    leaguepediaUserAgent: parsed.LEAGUEPEDIA_USER_AGENT,
    leaguepedia: {
      endpoint: parsed.LEAGUEPEDIA_ENDPOINT,
      userAgent: parsed.LEAGUEPEDIA_USER_AGENT,
      syncYears: years(parsed.LEAGUEPEDIA_SYNC_YEARS),
      syncCompetitions: csv(parsed.LEAGUEPEDIA_SYNC_COMPETITIONS, "LEAGUEPEDIA_SYNC_COMPETITIONS"),
      competitionMap: competitionMap as Record<string, string>,
      mediaHosts: csv(parsed.LEAGUEPEDIA_MEDIA_HOSTS, "LEAGUEPEDIA_MEDIA_HOSTS"),
      overridesDir: parsed.LEAGUEPEDIA_OVERRIDES_DIR,
      fixturePath: parsed.LEAGUEPEDIA_FIXTURE_PATH,
      resourceLimits: { maxBytes: parsed.LEAGUEPEDIA_MAX_BYTES, maxPages: parsed.LEAGUEPEDIA_MAX_PAGES, maxRows: parsed.LEAGUEPEDIA_MAX_ROWS },
    },
    mediaDelivery: parsed.MEDIA_DELIVERY,
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
