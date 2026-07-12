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
function competitionMap(value: string): Record<string, Record<string, string>> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("LEAGUEPEDIA_COMPETITION_MAP must map each logical competition and year to an exact source key.");
  const output: Record<string, Record<string, string>> = {};
  for (const [competition, years] of Object.entries(parsed)) {
    if (typeof years !== "object" || years === null || Array.isArray(years) || Object.keys(years).length === 0) throw new Error("LEAGUEPEDIA_COMPETITION_MAP must map each logical competition and year to an exact source key.");
    output[competition] = {};
    for (const [year, sourceKey] of Object.entries(years)) {
      if (!/^\d{4}$/.test(year) || typeof sourceKey !== "string" || !sourceKey.trim()) throw new Error("LEAGUEPEDIA_COMPETITION_MAP must map each logical competition and year to an exact source key.");
      output[competition]![year] = sourceKey.trim();
    }
  }
  return output;
}

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

const EMAIL_CONTACT = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/iu;
const RESERVED_HOST_SUFFIXES = ["example", "invalid", "test", "localhost"] as const;
const RESERVED_EXAMPLE_DOMAINS = ["example.com", "example.net", "example.org"] as const;

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 31 || code === 127;
  });
}

function validHostname(hostname: string): boolean {
  if (hostname.length > 253 || !hostname.includes(".") || /^\d+(?:\.\d+){3}$/u.test(hostname)) return false;
  return hostname.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label));
}

function reservedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    RESERVED_HOST_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(`.${suffix}`))
    || RESERVED_EXAMPLE_DOMAINS.some((domain) => lower === domain || lower.endsWith(`.${domain}`))
  );
}

function validExternalHostname(hostname: string): boolean {
  return validHostname(hostname) && !reservedHostname(hostname);
}

function validContactUrl(token: string): boolean {
  try {
    const url = new URL(token);
    return (url.protocol === "https:" || url.protocol === "http:") && url.username === "" && url.password === "" && validExternalHostname(url.hostname);
  } catch {
    return false;
  }
}

function validEmailContact(token: string): boolean {
  if (!EMAIL_CONTACT.test(token)) return false;
  const localPart = token.slice(0, token.lastIndexOf("@"));
  const domain = token.slice(token.lastIndexOf("@") + 1);
  return !localPart.startsWith(".") && !localPart.endsWith(".") && !localPart.includes("..") && validExternalHostname(domain);
}

function hasValidContact(userAgent: string): boolean {
  const tokens = userAgent.split(/[\s();,]+/u).filter(Boolean).map((token) => token.startsWith("+") ? token.slice(1) : token);
  return tokens.some((token) => validEmailContact(token) || (/^https?:\/\//iu.test(token) && validContactUrl(token)));
}

const LeaguepediaEndpointSchema = z.string().min(1).superRefine((value, context) => {
  if (value.trim() !== value || hasControlCharacters(value) || value.includes("?") || value.includes("#")) {
    context.addIssue({ code: "custom", message: "LEAGUEPEDIA_ENDPOINT must not contain whitespace, control characters, a query delimiter, or a fragment delimiter." });
    return;
  }
  try {
    const endpoint = new URL(value);
    if (
      endpoint.protocol !== "https:"
      || endpoint.username !== ""
      || endpoint.password !== ""
      || !validExternalHostname(endpoint.hostname)
      || !endpoint.pathname.endsWith("/api.php")
    ) context.addIssue({ code: "custom", message: "LEAGUEPEDIA_ENDPOINT must be a clean HTTPS MediaWiki API URL with a valid hostname and /api.php path." });
  } catch {
    context.addIssue({ code: "custom", message: "LEAGUEPEDIA_ENDPOINT must be a valid HTTPS MediaWiki API URL." });
  }
});

const LeaguepediaUserAgentSchema = z.string().min(12).superRefine((value, context) => {
  if (hasControlCharacters(value)) {
    context.addIssue({ code: "custom", message: "LEAGUEPEDIA_USER_AGENT must not contain control characters." });
    return;
  }
  if (!hasValidContact(value)) context.addIssue({ code: "custom", message: "LEAGUEPEDIA_USER_AGENT must include a complete contact HTTP(S) URL or email token." });
});

function mediaHosts(value: string): string[] {
  const hosts = csv(value, "LEAGUEPEDIA_MEDIA_HOSTS").map((host) => host.toLowerCase());
  if (new Set(hosts).size !== hosts.length || hosts.some((host) => !validExternalHostname(host))) {
    throw new Error("LEAGUEPEDIA_MEDIA_HOSTS must contain unique, clean, non-reserved hostnames without schemes, ports, paths, or credentials.");
  }
  return hosts;
}

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
    LEAGUEPEDIA_ENDPOINT: LeaguepediaEndpointSchema,
    LEAGUEPEDIA_USER_AGENT: LeaguepediaUserAgentSchema,
    LEAGUEPEDIA_SYNC_YEARS: z.string().min(1).default("2023,2024"),
    LEAGUEPEDIA_SYNC_COMPETITIONS: z.string().min(1).default("Worlds"),
    LEAGUEPEDIA_COMPETITION_MAP: z.string().min(2).default('{"Worlds":{"2023":"2023 Season World Championship","2024":"2024 Season World Championship"}}'),
    LEAGUEPEDIA_MEDIA_HOSTS: z.string().min(1),
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
  const parsedCompetitionMap = competitionMap(parsed.LEAGUEPEDIA_COMPETITION_MAP);

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
      competitionMap: parsedCompetitionMap,
      mediaHosts: mediaHosts(parsed.LEAGUEPEDIA_MEDIA_HOSTS),
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
