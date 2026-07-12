import type { CanonicalFacts, CoverageInput } from "@riftversus/database";

export const LEAGUEPEDIA_CARGO_TABLES = ["Teams", "Players", "Tournaments", "ScoreboardGames", "ScoreboardPlayers"] as const;
export type LeaguepediaCargoTable = (typeof LEAGUEPEDIA_CARGO_TABLES)[number];

export interface LeaguepediaClientOptions {
  endpoint: string;
  userAgent: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface CargoPage { rows: readonly Record<string, unknown>[]; offset: number }
export interface OffsetInput { offset: number }
export interface GamesPageInput extends OffsetInput { from: string; to: string; competitions: readonly string[] }
export interface GamePlayersPageInput extends OffsetInput { gameIds: readonly string[] }
export interface TraversalEvidence { requestedPages: number; visitedPages: number; complete: boolean }

export interface LeaguepediaEntity {
  kind: "team" | "player";
  sourceKey: string;
  displayName: string;
  aliases: readonly string[];
  region?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  lineage?: string | null;
}

export interface LeaguepediaSeries {
  sourceKey: string;
  tournamentKey: string;
  playedAt: string;
  bestOf: 1 | 3 | 5;
  sideATeam: string;
  sideBTeam: string;
  sideAScore: number | null;
  sideBScore: number | null;
}

export interface LeaguepediaGame {
  sourceKey: string;
  seriesKey: string;
  gameNumber: number;
  playedAt: string;
  sideATeam: string;
  sideBTeam: string;
  winnerTeam: string | null;
}

export interface LeaguepediaGamePlayer { gameKey: string; playerKey: string; teamKey: string }
export interface LeaguepediaMedia {
  sourceKey: string;
  entityKey: string;
  sourceUrl: string | null;
  contentType: string | null;
  license: string | null;
  attribution: string | null;
}

export interface LeaguepediaSnapshot {
  revisionIds: readonly number[];
  sourceUrl: string;
  entities: readonly LeaguepediaEntity[];
  series: readonly LeaguepediaSeries[];
  games: readonly LeaguepediaGame[];
  gamePlayers: readonly LeaguepediaGamePlayer[];
  media: readonly LeaguepediaMedia[];
  traversal: TraversalEvidence;
}

export interface NormalizedLeaguepediaEntity extends LeaguepediaEntity {
  canonicalId: string;
  canonicalName: string;
  precedence: "override" | "leaguepedia";
}
export interface QuarantinedIdentity { sourceKey: string; reason: "ambiguous_name" | "ambiguous_alias" }
export interface LeaguepediaNormalizationResult {
  entities: readonly NormalizedLeaguepediaEntity[];
  entityIds: ReadonlyMap<string, string>;
  quarantine: readonly QuarantinedIdentity[];
  facts: CanonicalFacts;
  rosterGameIds: readonly string[];
}
export interface LeaguepediaCoverageEvidence {
  competition: string;
  seasonYear: number;
  observedRows: number;
  traversal: TraversalEvidence;
  earliestDate?: string | null;
  latestDate?: string | null;
}
export type LeaguepediaCoverage = CoverageInput;
