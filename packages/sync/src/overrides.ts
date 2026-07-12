import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parse } from "yaml";

export interface IdentityOverride {
  sourceKey: string;
  canonicalName: string;
  canonicalId: string;
  kind?: "team" | "player";
  aliases: readonly string[];
  validFrom?: string;
  validTo?: string;
  reviewedNote: string;
}

export interface TournamentOverride {
  sourceKey: string;
  canonicalName: string;
  canonicalId: string;
  category: "league" | "fst" | "msi" | "worlds" | "other";
  reviewedNote: string;
}

export interface ReviewedOverrides {
  identities: ReadonlyMap<string, IdentityOverride>;
  tournaments: ReadonlyMap<string, TournamentOverride>;
  checksums: Readonly<Record<string, string>>;
}

export interface OverridePaths {
  identities: string;
  tournaments: string;
  logicalFiles?: { identities: string; tournaments: string };
}

export async function loadOverrides(paths: OverridePaths): Promise<ReviewedOverrides> {
  const [identitiesText, tournamentsText] = await Promise.all([
    readFile(paths.identities, "utf8"),
    readFile(paths.tournaments, "utf8"),
  ]);
  const identities = parseOverrideFile(parse(identitiesText), parseIdentity, "identity");
  const tournaments = parseOverrideFile(parse(tournamentsText), parseTournament, "tournament");
  return {
    identities,
    tournaments,
    checksums: {
      [paths.logicalFiles?.identities ?? paths.identities]: checksum(identitiesText),
      [paths.logicalFiles?.tournaments ?? paths.tournaments]: checksum(tournamentsText),
    },
  };
}

function parseOverrideFile<T extends { sourceKey: string }>(input: unknown, parseRule: (value: unknown) => T, kind: string): ReadonlyMap<string, T> {
  const record = asRecord(input, `${kind} override file`);
  if (record.version !== 1 || !Array.isArray(record.rules)) throw new Error(`${kind} override file must have version 1 and rules.`);
  const result = new Map<string, T>();
  for (const rawRule of record.rules) {
    const rule = parseRule(rawRule);
    if (result.has(rule.sourceKey)) throw new Error(`Duplicate ${kind} override sourceKey: ${rule.sourceKey}`);
    result.set(rule.sourceKey, rule);
  }
  return result;
}

function parseIdentity(input: unknown): IdentityOverride {
  const rule = asRecord(input, "identity override");
  const kind = rule.kind;
  if (kind !== undefined && kind !== "team" && kind !== "player") throw new Error("Identity override kind must be team or player.");
  return {
    sourceKey: requiredString(rule.sourceKey, "identity sourceKey"),
    canonicalName: requiredString(rule.canonicalName, "identity canonicalName"),
    canonicalId: uuid(rule.canonicalId, "identity canonicalId"),
    ...(kind === undefined ? {} : { kind }),
    aliases: stringArray(rule.aliases, "identity aliases"),
    ...(rule.validFrom === undefined ? {} : { validFrom: date(rule.validFrom, "identity validFrom") }),
    ...(rule.validTo === undefined ? {} : { validTo: date(rule.validTo, "identity validTo") }),
    reviewedNote: requiredString(rule.reviewedNote, "identity reviewedNote"),
  };
}

function parseTournament(input: unknown): TournamentOverride {
  const rule = asRecord(input, "tournament override");
  const category = rule.category;
  if (category !== "league" && category !== "fst" && category !== "msi" && category !== "worlds" && category !== "other") throw new Error("Tournament override category is invalid.");
  return {
    sourceKey: requiredString(rule.sourceKey, "tournament sourceKey"),
    canonicalName: requiredString(rule.canonicalName, "tournament canonicalName"),
    canonicalId: uuid(rule.canonicalId, "tournament canonicalId"),
    category,
    reviewedNote: requiredString(rule.reviewedNote, "tournament reviewedNote"),
  };
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function stringArray(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return [...new Set(value.map((item) => requiredString(item, name)))];
}
function uuid(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new Error(`${name} must be a UUID.`);
  return result.toLowerCase();
}
function date(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(`${name} must be YYYY-MM-DD.`);
  return result;
}
function checksum(value: string): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
