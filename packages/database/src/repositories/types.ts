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
  mode: "sync" | "backfill" | "media";
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

export interface AcceptanceSourceObjectMetadata {
  id: string; provider: string; sourceUrl: string; objectKey: string; checksum: string;
  contentType: string | null; byteSize: string | null; retrievedAt: string; parserVersion: string;
}
export interface AcceptanceMediaObjectMetadata { objectKey: string; checksum: string; contentType: string; byteSize: string }
export interface AcceptanceCoverageEvidence {
  provider: string;
  competition: string;
  seasonYear: number;
  earliestDate: string | null;
  latestDate: string | null;
  status: string;
}
export interface AcceptanceDatasetEvidence {
  dataset: { generation: string; publishedAt: string } | null;
  coverage: AcceptanceCoverageEvidence[];
  facts: Array<{
    kind: "series" | "game"; id: string; seriesId?: string; provider: string;
    publicationGeneration: string; retiredGeneration: string | null; sourceObjectId: string | null;
  }>;
}

export interface BeginSyncRunInput {
  provider: string;
  mode: "sync" | "backfill" | "media";
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

export interface StagedEntityInput { id: string; provider: string; sourceKeys: readonly string[]; kind: "team" | "player"; canonicalName: string; playerId?: string | null; aliases: readonly string[] }
export interface StagedRegionInput { id: string; provider: string; sourceKey: string; name: string }
export interface StagedTeamEraInput { id: string; provider: string; sourceKey: string; teamEntityId: string; displayName: string; regionId?: string | null; validFrom?: string | null; validTo?: string | null }
export interface StagedTournamentInput { id: string; provider: string; sourceKey: string; name: string; aliases: readonly string[]; category: "league" | "fst" | "msi" | "worlds" | "other"; seasonYear?: number | null; validFrom?: string | null; validTo?: string | null }
export interface StagedDimensionsInput { entities: readonly StagedEntityInput[]; teamEras: readonly StagedTeamEraInput[]; regions: readonly StagedRegionInput[]; tournaments: readonly StagedTournamentInput[] }
export interface PublishedMediaInput { provider: string; sourceUrl: string; objectKey: string; checksum: string; contentType: string; byteSize: string; attribution: string; entityId?: string | null; teamEraId?: string | null; license?: string | null; rightsBasis?: import("@riftversus/contracts").MediaRightsBasis }
export interface OverrideApplicationInput { overrideFile: string; checksum: string }
export interface PublicationScopeInput { provider: string; tournamentSourceKey: string; from: string; to: string; status: "complete" | "partial" | "missing"; unresolvedRows: number }

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
  dimensions?: StagedDimensionsInput;
  media?: readonly PublishedMediaInput[];
  overrideApplications?: readonly OverrideApplicationInput[];
  publicationScopes?: readonly PublicationScopeInput[];
}

export interface CompleteUnchangedSyncRunInput { syncRunId: string; version: string }

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
