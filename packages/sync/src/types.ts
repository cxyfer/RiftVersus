import type { CanonicalFacts, CoverageInput } from "@riftversus/database";

import type { DownloadResult } from "./download.js";
import type { ObjectStore } from "./storage.js";

export type SyncRequest =
  | { mode: "sync" | "sync-once" }
  | { mode: "backfill"; years: readonly number[]; competitions: readonly string[] };

export interface RetainedSourceInput {
  sourceKey: string;
  sourceUrl: string;
  bytes: Uint8Array;
  contentType: string;
}

export class RetainableStageError extends Error {
  constructor(message: string, readonly source: RetainedSourceInput, options?: ErrorOptions) {
    super(message, options);
    this.name = "RetainableStageError";
  }
}

export interface RetainedMediaInput {
  sourceUrl: string;
  attribution: string;
  entityId?: string | null;
  teamEraId?: string | null;
  license?: string | null;
}

export interface StagedEntityDefinition {
  id: string;
  provider: string;
  sourceKeys: readonly string[];
  kind: "team" | "player";
  canonicalName: string;
  aliases: readonly string[];
}

export interface StagedTeamEraDefinition {
  id: string;
  provider: string;
  sourceKey: string;
  teamEntityId: string;
  displayName: string;
  regionId?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface StagedRegionDefinition {
  id: string;
  provider: string;
  sourceKey: string;
  name: string;
}

export interface StagedTournamentDefinition {
  id: string;
  provider: string;
  sourceKey: string;
  name: string;
  aliases: readonly string[];
  category: "league" | "fst" | "msi" | "worlds" | "other";
  seasonYear?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface StagedDimensions {
  entities: readonly StagedEntityDefinition[];
  teamEras: readonly StagedTeamEraDefinition[];
  regions: readonly StagedRegionDefinition[];
  tournaments: readonly StagedTournamentDefinition[];
}

export interface StagedVersionProvenance {
  sourceDigest: `sha256:${string}`;
  parserVersion: string;
  overrideFiles: readonly { file: string; checksum: `sha256:${string}` }[];
}

export interface StagedSyncBatch {
  version: string;
  provenance: StagedVersionProvenance;
  source: RetainedSourceInput;
  media: readonly RetainedMediaInput[];
  coverage: readonly CoverageInput[];
  dimensions: StagedDimensions;
  facts: CanonicalFacts;
  rosterGameIds: readonly string[];
}

export interface SyncProvider {
  readonly id: string;
  readonly parserVersion: string;
  stage(request: SyncRequest): Promise<StagedSyncBatch>;
}

export interface RetainedSourceRecord {
  provider: string;
  sourceKey: string;
  sourceUrl: string;
  objectKey: string;
  checksum: string;
  contentType: string;
  byteSize: string;
  parserVersion: string;
}

export interface RetainedMediaRecord {
  provider: string;
  sourceUrl: string;
  objectKey: string;
  checksum: string;
  contentType: string;
  byteSize: string;
  attribution: string;
  entityId?: string | null;
  teamEraId?: string | null;
  license?: string | null;
}

export interface SyncPublicationInput {
  syncRunId: string;
  version: string;
  provenance: StagedVersionProvenance;
  sourceObjectId: string;
  media: readonly RetainedMediaRecord[];
  coverage: readonly CoverageInput[];
  dimensions: StagedDimensions;
  facts: CanonicalFacts;
  rosterGameIds: readonly string[];
}

export interface SyncRepository {
  withLock(provider: string, operation: () => Promise<void>): Promise<"ran" | "locked">;
  beginRun(input: { provider: string; mode: "sync" | "backfill"; parserVersion: string }): Promise<{ id: string }>;
  failRun(input: { syncRunId: string; error: string }): Promise<void>;
  recordSource(input: RetainedSourceRecord): Promise<{ id: string }>;
  findPublication(version: string): Promise<{ version: string } | null>;
  completeUnchanged(input: { syncRunId: string; version: string }): Promise<void>;
  publish(input: SyncPublicationInput): Promise<{ version: string }>;
}

export interface SyncDependencies {
  objectStore: ObjectStore;
  repository: SyncRepository;
  downloadMedia(sourceUrl: string): Promise<DownloadResult>;
  validate(batch: StagedSyncBatch): Promise<void> | void;
}

export type SyncResult = { status: "locked" } | { status: "published" | "unchanged"; version: string };

export function validateSyncRequest(input: unknown): SyncRequest {
  if (!input || typeof input !== "object") throw new Error("Sync request must be an object.");
  const request = input as Record<string, unknown>;
  if (request.mode === "sync" || request.mode === "sync-once") return { mode: request.mode };
  if (request.mode !== "backfill") throw new Error("Unsupported sync mode.");
  const years = request.years;
  const competitions = request.competitions;
  if (!Array.isArray(years) || years.length === 0 || years.length > 20 || years.some((year) => !Number.isInteger(year) || year < 2009 || year > 2100)) {
    throw new Error("Backfill years must contain between 1 and 20 valid years.");
  }
  if (new Set(years).size !== years.length) throw new Error("Backfill years must be unique.");
  if (!Array.isArray(competitions) || competitions.length === 0 || competitions.length > 50 || competitions.some((competition) => typeof competition !== "string" || competition.trim().length === 0 || competition.length > 120)) {
    throw new Error("Backfill competitions must contain between 1 and 50 names.");
  }
  if (new Set(competitions).size !== competitions.length) throw new Error("Backfill competitions must be unique.");
  return { mode: "backfill", years: [...years] as number[], competitions: [...competitions] as string[] };
}
