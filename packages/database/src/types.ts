import type { ColumnType, Generated } from "kysely";

export type DefaultTimestamp = ColumnType<Date, Date | string | undefined, Date | string | undefined>;
export type RequiredTimestamp = ColumnType<Date, Date | string, Date | string>;
export type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null | undefined>;
export type DateColumn = ColumnType<string, string, string>;
export type NullableDateColumn = ColumnType<string | null, string | null | undefined, string | null | undefined>;

export type EntityKind = "player" | "team" | "region";
export type TournamentCategory = "league" | "fst" | "msi" | "worlds" | "other";
export type CompetitiveSide = "a" | "b";

export interface EntitiesTable {
  id: string;
  kind: EntityKind;
  canonical_name: string;
  slug: string;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface EntityAliasesTable {
  id: string;
  entity_id: string;
  provider: string;
  source_key: string;
  display_name: string;
  valid_from: NullableDateColumn;
  valid_to: NullableDateColumn;
  searchable: Generated<boolean>;
}

export interface TeamErasTable {
  id: string;
  team_entity_id: string;
  display_name: string;
  slug: string;
  valid_from: NullableDateColumn;
  valid_to: NullableDateColumn;
}

export interface MediaAssetsTable {
  id: string;
  entity_id: string | null;
  team_era_id: string | null;
  kind: string;
  source_url: string;
  object_key: string;
  checksum: string | null;
  content_type: string | null;
  attribution: string | null;
  license: string | null;
  is_current: Generated<boolean>;
}

export interface TournamentsTable {
  id: string;
  provider: string;
  source_key: string;
  name: string;
  league_slug: string | null;
  category: TournamentCategory;
  tier: string | null;
  start_date: NullableDateColumn;
  end_date: NullableDateColumn;
}

export interface SeriesFactsTable {
  id: string;
  provider: string;
  source_key: string;
  tournament_id: string;
  played_at: RequiredTimestamp;
  best_of: 1 | 3 | 5;
  completed: boolean;
  side_a_team_id: string;
  side_a_era_id: string | null;
  side_a_region_id: string | null;
  side_b_team_id: string;
  side_b_era_id: string | null;
  side_b_region_id: string | null;
  side_a_score: number | null;
  side_b_score: number | null;
  winner_team_id: string | null;
}

export interface GameFactsTable {
  id: string;
  provider: string;
  source_key: string;
  series_id: string;
  game_number: number;
  played_at: RequiredTimestamp;
  side_a_team_id: string;
  side_a_era_id: string | null;
  side_a_region_id: string | null;
  side_b_team_id: string;
  side_b_era_id: string | null;
  side_b_region_id: string | null;
  winner_team_id: string | null;
}

export interface GamePlayersTable {
  game_id: string;
  player_entity_id: string;
  side: CompetitiveSide;
  team_entity_id: string;
}

export interface TeamRegionHistoryTable {
  team_entity_id: string;
  region_entity_id: string;
  valid_from: DateColumn;
  valid_to: NullableDateColumn;
  provider: string;
  source_key: string;
}

export interface SyncRunsTable {
  id: string;
  provider: string;
  mode: string;
  status: string;
  parser_version: string;
  started_at: DefaultTimestamp;
  finished_at: NullableTimestamp;
  source_count: Generated<number>;
  inserted_count: Generated<number>;
  updated_count: Generated<number>;
  warning_count: Generated<number>;
  error: string | null;
}

export interface SourceObjectsTable {
  id: string;
  provider: string;
  source_key: string;
  source_url: string;
  object_key: string;
  checksum: string;
  content_type: string | null;
  byte_size: string | null;
  retrieved_at: DefaultTimestamp;
  parser_version: string;
}

export interface SourceCursorsTable {
  provider: string;
  cursor_key: string;
  cursor_value: string;
  updated_at: DefaultTimestamp;
}

export interface DatasetVersionsTable {
  id: string;
  version: string;
  published_at: DefaultTimestamp;
  sync_run_id: string;
}

export interface CoverageStatusTable {
  id: string;
  dataset_version_id: string;
  provider: string;
  competition: string;
  season_year: number;
  earliest_date: NullableDateColumn;
  latest_date: NullableDateColumn;
  status: string;
  detail: string | null;
}

export interface OverrideApplicationsTable {
  id: string;
  override_file: string;
  checksum: string;
  applied_at: DefaultTimestamp;
  sync_run_id: string | null;
}

export interface FactMutationAuditsTable {
  audit_id: Generated<string>;
  fact_table: "series_facts" | "game_facts";
  fact_id: string;
  source_object_id: string | null;
  override_application_id: string | null;
  changed_at: DefaultTimestamp;
  old_payload: unknown;
  new_payload: unknown;
}

export interface Database {
  entities: EntitiesTable;
  entity_aliases: EntityAliasesTable;
  team_eras: TeamErasTable;
  media_assets: MediaAssetsTable;
  tournaments: TournamentsTable;
  series_facts: SeriesFactsTable;
  game_facts: GameFactsTable;
  game_players: GamePlayersTable;
  team_region_history: TeamRegionHistoryTable;
  sync_runs: SyncRunsTable;
  source_objects: SourceObjectsTable;
  source_cursors: SourceCursorsTable;
  dataset_versions: DatasetVersionsTable;
  coverage_status: CoverageStatusTable;
  override_applications: OverrideApplicationsTable;
  fact_mutation_audits: FactMutationAuditsTable;
}
