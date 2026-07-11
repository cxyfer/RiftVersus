import type { ComparisonResponse, Dataset, EntityKind, EventCategory, ResolvedSubject } from "@riftversus/contracts";

export interface EntitySearchQuery {
  query: string;
  kinds?: readonly EntityKind[];
  limit?: number;
}

export interface EntitySearchResponse {
  entities: ResolvedSubject[];
}

export interface FilterOptions {
  eventCategories: EventCategory[];
  tournaments: Array<{ id: string; name: string; category: EventCategory }>;
  bestOf: Array<1 | 3 | 5>;
}

export interface DatasetStatus extends Dataset {
  coverageStatus: Array<{
    provider: string;
    competition: string;
    seasonYear: number;
    earliestDate: string | null;
    latestDate: string | null;
    status: "complete" | "partial" | "missing";
    detail: string | null;
  }>;
}

export interface MediaAsset {
  objectKey: string;
  sourceUrl: string;
  contentType: string | null;
  entityId: string | null;
  teamEraId: string | null;
}

export interface SyncRun {
  id: string;
  provider: string;
  mode: "sync" | "backfill";
  status: "running" | "succeeded" | "failed";
  parserVersion: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface DatasetVersion {
  id: string;
  version: string;
  publishedAt: string;
  syncRunId: string;
  generation: string;
}

export interface BeginSyncRunInput {
  provider: string;
  mode: "sync" | "backfill";
  parserVersion: string;
}

export interface SourceObjectInput {
  provider: string;
  sourceKey: string;
  sourceUrl: string;
  objectKey: string;
  checksum: string;
  contentType?: string | null;
  byteSize?: string | null;
  parserVersion: string;
}

export interface CoverageInput {
  provider: string;
  competition: string;
  seasonYear: number;
  earliestDate?: string | null;
  latestDate?: string | null;
  status: "complete" | "partial" | "missing";
  detail?: string | null;
}

export interface PublishDatasetInput {
  syncRunId: string;
  version: string;
  coverage: readonly CoverageInput[];
  sourceObjectId?: string;
  facts?: CanonicalFacts;
  /** Every listed game has an authoritative roster, including an intentionally empty one. */
  rosterGameIds?: readonly string[];
}

export interface SeriesFactInput {
  id: string; provider: string; sourceKey: string; tournamentId: string; playedAt: Date;
  bestOf: 1 | 3 | 5; completed: boolean; sideATeamId: string; sideAEraId?: string | null; sideARegionId?: string | null;
  sideBTeamId: string; sideBEraId?: string | null; sideBRegionId?: string | null; sideAScore?: number | null; sideBScore?: number | null; winnerTeamId?: string | null;
}
export interface GameFactInput {
  id: string; provider: string; sourceKey: string; seriesId: string; gameNumber: number; playedAt: Date;
  sideATeamId: string; sideAEraId?: string | null; sideARegionId?: string | null; sideBTeamId: string; sideBEraId?: string | null; sideBRegionId?: string | null; winnerTeamId?: string | null;
}
export interface GamePlayerInput { gameId: string; playerEntityId: string; side: "a" | "b"; teamEntityId: string; }
export interface CanonicalFacts { series?: readonly SeriesFactInput[]; games?: readonly GameFactInput[]; gamePlayers?: readonly GamePlayerInput[]; }

export interface FailSyncRunInput {
  syncRunId: string;
  error: string;
}

export type { ComparisonResponse };
