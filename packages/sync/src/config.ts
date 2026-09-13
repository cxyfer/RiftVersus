import { z } from "zod";

const csv = (value: string, name: string) => {
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length === 0 || new Set(items).size !== items.length) throw new Error(`${name} must contain unique comma-separated values.`);
  return items;
};

const years = (value: string) => csv(value, "LEAGUEPEDIA_SYNC_YEARS").map((item) => {
  const year = Number(item); if (!Number.isInteger(year) || year < 2011 || year > 2100) throw new Error("LEAGUEPEDIA_SYNC_YEARS contains an invalid year."); return year;
});

type CompetitionMapValue = string | string[];
type CompetitionMap = Record<string, Record<string, CompetitionMapValue>>;

function competitionMap(value: string): CompetitionMap {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("LEAGUEPEDIA_COMPETITION_MAP must map each logical competition and year to an exact source key.");
  const output: CompetitionMap = {};
  for (const [competition, years] of Object.entries(parsed)) {
    if (typeof years !== "object" || years === null || Array.isArray(years) || Object.keys(years).length === 0) throw new Error("LEAGUEPEDIA_COMPETITION_MAP must map each logical competition and year to an exact source key.");
    output[competition] = {};
    for (const [year, sourceKey] of Object.entries(years)) {
      if (!/^\d{4}$/.test(year)) throw new Error("LEAGUEPEDIA_COMPETITION_MAP must map each logical competition and year to an exact source key.");
      if (typeof sourceKey === "string" && sourceKey.trim()) output[competition]![year] = sourceKey.trim();
      else if (Array.isArray(sourceKey) && sourceKey.length > 0 && sourceKey.every((item) => typeof item === "string" && item.trim()) && new Set(sourceKey).size === sourceKey.length) output[competition]![year] = sourceKey.map((item) => item.trim());
      else throw new Error("LEAGUEPEDIA_COMPETITION_MAP must map each logical competition and year to one or more exact source keys.");
    }
  }
  return output;
}

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

const SyncEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SYNC_HISTORY_ENABLED: z.enum(["true", "false"]).default("true"),
  SYNC_MAX_AGE_HOURS: z.coerce.number().int().positive().max(8760).default(36),
  SYNC_HISTORY_MAX_AGE_HOURS: z.coerce.number().int().positive().max(8760).default(192),
  SYNC_FAILURE_THRESHOLD: z.coerce.number().int().positive().max(100).default(3),
  LEAGUEPEDIA_ENDPOINT: LeaguepediaEndpointSchema,
  LEAGUEPEDIA_USER_AGENT: LeaguepediaUserAgentSchema,
  LEAGUEPEDIA_REQUEST_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(1_000),
  LEAGUEPEDIA_SYNC_YEARS: z.string().min(1).default("2023,2024"),
  LEAGUEPEDIA_SYNC_COMPETITIONS: z.string().min(1).default("Worlds"),
  LEAGUEPEDIA_COMPETITION_MAP: z.string().min(2).default('{"Worlds":{"2023":"Worlds 2023 Main Event","2024":"Worlds 2024 Main Event"}}'),
  LEAGUEPEDIA_MAPPING_YEARS: z.string().min(1).default("2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025,2026"),
  LEAGUEPEDIA_MAPPING_COMPETITIONS: z.string().min(1).default("LCK,LPL,LEC,LCS,MSI,Worlds"),
  LEAGUEPEDIA_MEDIA_HOSTS: z.string().min(1),
  LEAGUEPEDIA_OVERRIDES_DIR: z.string().min(1).default("data/overrides"),
  LEAGUEPEDIA_FIXTURE_PATH: z.string().min(1).default("data/fixtures/leaguepedia-small.json"),
  LEAGUEPEDIA_MAX_BYTES: z.coerce.number().int().positive().max(500_000_000).default(100_000_000),
  LEAGUEPEDIA_MAX_PAGES: z.coerce.number().int().positive().max(10_000).default(2_000),
  LEAGUEPEDIA_MAX_ROWS: z.coerce.number().int().positive().max(2_000_000).default(500_000),
  LEAGUEPEDIA_MAX_REVIEWED_PAGES: z.coerce.number().int().positive().max(50_000).default(5_000),
});

export type SyncEnvironment = Record<string, string | undefined>;

export function loadSyncConfig(environment: SyncEnvironment) {
  const parsed = SyncEnvironmentSchema.parse(environment);
  const parsedCompetitionMap = competitionMap(parsed.LEAGUEPEDIA_COMPETITION_MAP);

  return {
    databaseUrl: parsed.DATABASE_URL,
    historyEnabled: parsed.SYNC_HISTORY_ENABLED === "true",
    syncMaxAgeHours: parsed.SYNC_MAX_AGE_HOURS,
    syncHistoryMaxAgeHours: parsed.SYNC_HISTORY_MAX_AGE_HOURS,
    syncFailureThreshold: parsed.SYNC_FAILURE_THRESHOLD,
    leaguepediaEndpoint: parsed.LEAGUEPEDIA_ENDPOINT,
    leaguepediaUserAgent: parsed.LEAGUEPEDIA_USER_AGENT,
    leaguepedia: {
      endpoint: parsed.LEAGUEPEDIA_ENDPOINT,
      userAgent: parsed.LEAGUEPEDIA_USER_AGENT,
      requestIntervalMs: parsed.LEAGUEPEDIA_REQUEST_INTERVAL_MS,
      syncYears: years(parsed.LEAGUEPEDIA_SYNC_YEARS),
      syncCompetitions: csv(parsed.LEAGUEPEDIA_SYNC_COMPETITIONS, "LEAGUEPEDIA_SYNC_COMPETITIONS"),
      competitionMap: parsedCompetitionMap,
      mappingYears: years(parsed.LEAGUEPEDIA_MAPPING_YEARS),
      mappingCompetitions: csv(parsed.LEAGUEPEDIA_MAPPING_COMPETITIONS, "LEAGUEPEDIA_MAPPING_COMPETITIONS"),
      mediaHosts: mediaHosts(parsed.LEAGUEPEDIA_MEDIA_HOSTS),
      overridesDir: parsed.LEAGUEPEDIA_OVERRIDES_DIR,
      fixturePath: parsed.LEAGUEPEDIA_FIXTURE_PATH,
      resourceLimits: { maxBytes: parsed.LEAGUEPEDIA_MAX_BYTES, maxPages: parsed.LEAGUEPEDIA_MAX_PAGES, maxRows: parsed.LEAGUEPEDIA_MAX_ROWS, maxReviewedPages: parsed.LEAGUEPEDIA_MAX_REVIEWED_PAGES },
    },
  };
}

export type SyncConfig = ReturnType<typeof loadSyncConfig>;
