export const SQLITE_PAGE_SIZE = 4096;
export const SQLITE_REQUEST_CHUNK_SIZE = 4096;
export const SQLITE_SCHEMA_VERSION = 3;

/** Shared public snapshot schema for both the Node exporter and the browser query layer. */
export const SQLITE_SCHEMA_SQL = `
CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE entity_variants (
  variant_id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('player', 'team', 'region')),
  team_era_id TEXT,
  display_name TEXT NOT NULL,
  real_name TEXT,
  era_label TEXT,
  canonical_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  avatar_label TEXT NOT NULL,
  retained_object_key TEXT,
  media_url TEXT NOT NULL
);
CREATE TABLE public_ids (
  kind TEXT NOT NULL,
  public_id TEXT NOT NULL,
  entity_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (kind, public_id)
);
CREATE TABLE public_era_ids (
  entity_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  team_era_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (entity_id, public_id)
);
CREATE INDEX entity_variants_entity_id_idx ON entity_variants (entity_id);
CREATE INDEX entity_variants_kind_name_idx ON entity_variants (kind, canonical_name, entity_id, team_era_id);

CREATE TABLE entity_aliases (
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  PRIMARY KEY (entity_id, alias)
);
CREATE INDEX entity_aliases_entity_id_idx ON entity_aliases (entity_id);

CREATE TABLE search_terms (
  entity_id TEXT NOT NULL,
  term TEXT NOT NULL,
  PRIMARY KEY (entity_id, term)
);
CREATE INDEX search_terms_term_idx ON search_terms (term, entity_id);

CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  league_slug TEXT
);

CREATE TABLE series_facts (
  id TEXT PRIMARY KEY,
  played_at TEXT NOT NULL,
  date TEXT NOT NULL,
  tournament_id TEXT NOT NULL,
  best_of INTEGER NOT NULL,
  side_a_team_id TEXT NOT NULL,
  side_b_team_id TEXT NOT NULL,
  side_a_era_id TEXT,
  side_b_era_id TEXT,
  side_a_region_id TEXT,
  side_b_region_id TEXT,
  side_a_name TEXT NOT NULL,
  side_b_name TEXT NOT NULL,
  side_a_score INTEGER NOT NULL,
  side_b_score INTEGER NOT NULL,
  winner_team_id TEXT
);
CREATE INDEX series_facts_played_at_idx ON series_facts (played_at, id);
CREATE INDEX series_facts_tournament_idx ON series_facts (tournament_id, played_at, id);

CREATE TABLE game_facts (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  played_at TEXT NOT NULL,
  game_number INTEGER NOT NULL,
  side_a_team_id TEXT NOT NULL,
  side_b_team_id TEXT NOT NULL,
  side_a_era_id TEXT,
  side_b_era_id TEXT,
  side_a_region_id TEXT,
  side_b_region_id TEXT,
  side_a_name TEXT NOT NULL,
  side_b_name TEXT NOT NULL,
  winner_team_id TEXT
);
CREATE INDEX game_facts_series_idx ON game_facts (series_id, played_at, id);

CREATE TABLE game_players (
  game_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('a', 'b')),
  player_entity_id TEXT NOT NULL,
  PRIMARY KEY (game_id, side, player_entity_id)
);
CREATE INDEX game_players_game_idx ON game_players (game_id, side, player_entity_id);
`;

export function createSqliteSchema(database: { exec(sql: string): void }): void {
  database.exec(SQLITE_SCHEMA_SQL);
}
