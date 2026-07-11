import { sql } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Canonical persistence owner for RiftVersus. Match facts deliberately have no
 * dataset_version_id: a dataset version is an append-only publication marker,
 * while sync transactions upsert the current canonical facts.
 */
export const initialMigration: Migration = {
  async up(db) {
    await sql.raw(`
      create table entities (
        id uuid primary key,
        kind text not null check (kind in ('player', 'team', 'region')),
        canonical_name text not null,
        slug text not null unique,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table entity_aliases (
        id uuid primary key,
        entity_id uuid not null references entities(id),
        provider text not null,
        source_key text not null,
        display_name text not null,
        valid_from date,
        valid_to date,
        searchable boolean not null default true,
        constraint entity_aliases_valid_range check (valid_to is null or valid_from is null or valid_to >= valid_from),
        constraint entity_aliases_provider_source_key_unique unique (provider, source_key)
      );

      create table team_eras (
        id uuid primary key,
        team_entity_id uuid not null references entities(id),
        display_name text not null,
        slug text not null,
        valid_from date,
        valid_to date,
        constraint team_eras_valid_range check (valid_to is null or valid_from is null or valid_to >= valid_from),
        constraint team_eras_team_slug_unique unique (team_entity_id, slug)
      );

      create table media_assets (
        id uuid primary key,
        entity_id uuid references entities(id),
        team_era_id uuid references team_eras(id),
        kind text not null,
        source_url text not null,
        object_key text not null unique,
        checksum text,
        content_type text,
        attribution text,
        license text,
        is_current boolean not null default false,
        constraint media_assets_owner_present check (entity_id is not null or team_era_id is not null)
      );

      create table tournaments (
        id uuid primary key,
        provider text not null,
        source_key text not null,
        name text not null,
        league_slug text,
        category text not null check (category in ('league', 'fst', 'msi', 'worlds', 'other')),
        tier text,
        start_date date,
        end_date date,
        constraint tournaments_provider_source_key_unique unique (provider, source_key),
        constraint tournaments_date_range check (end_date is null or start_date is null or end_date >= start_date)
      );

      create table sync_runs (
        id uuid primary key,
        provider text not null,
        mode text not null check (mode in ('sync', 'backfill')),
        status text not null check (status in ('running', 'succeeded', 'failed')),
        parser_version text not null,
        started_at timestamptz not null default now(),
        finished_at timestamptz,
        source_count integer not null default 0 check (source_count >= 0),
        inserted_count integer not null default 0 check (inserted_count >= 0),
        updated_count integer not null default 0 check (updated_count >= 0),
        warning_count integer not null default 0 check (warning_count >= 0),
        error text,
        constraint sync_runs_completion_state check (
          (status = 'running' and finished_at is null) or
          (status in ('succeeded', 'failed') and finished_at is not null)
        )
      );

      create table source_objects (
        id uuid primary key,
        provider text not null,
        source_key text not null,
        source_url text not null,
        object_key text not null unique,
        checksum text not null,
        content_type text,
        byte_size bigint check (byte_size is null or byte_size >= 0),
        retrieved_at timestamptz not null default now(),
        parser_version text not null,
        constraint source_objects_provider_source_key_unique unique (provider, source_key)
      );

      create table fact_mutation_authorizations (
        transaction_id bigint not null,
        backend_pid integer not null,
        provenance_kind text not null check (provenance_kind in ('source_object', 'override_application')),
        provenance_id uuid not null,
        created_at timestamptz not null default now(),
        primary key (transaction_id, backend_pid, provenance_kind, provenance_id)
      );

      create table series_facts (
        id uuid primary key,
        provider text not null,
        source_key text not null,
        tournament_id uuid not null references tournaments(id),
        played_at timestamptz not null,
        best_of smallint not null check (best_of in (1, 3, 5)),
        completed boolean not null,
        side_a_team_id uuid not null references entities(id),
        side_a_era_id uuid references team_eras(id),
        side_a_region_id uuid references entities(id),
        side_b_team_id uuid not null references entities(id),
        side_b_era_id uuid references team_eras(id),
        side_b_region_id uuid references entities(id),
        side_a_score smallint check (side_a_score is null or side_a_score >= 0),
        side_b_score smallint check (side_b_score is null or side_b_score >= 0),
        winner_team_id uuid references entities(id),
        constraint series_facts_provider_source_key_unique unique (provider, source_key),
        constraint series_facts_distinct_sides check (side_a_team_id <> side_b_team_id),
        constraint series_facts_winner_is_participant check (
          winner_team_id is null or winner_team_id in (side_a_team_id, side_b_team_id)
        ),
        constraint series_facts_completed_result check (
          (not completed and winner_team_id is null) or
          (completed and winner_team_id is not null and side_a_score is not null and side_b_score is not null)
        ),
        constraint series_facts_winner_matches_score check (
          winner_team_id is null or
          (winner_team_id = side_a_team_id and side_a_score > side_b_score) or
          (winner_team_id = side_b_team_id and side_b_score > side_a_score)
        )
      );

      create table game_facts (
        id uuid primary key,
        provider text not null,
        source_key text not null,
        series_id uuid not null references series_facts(id),
        game_number smallint not null check (game_number > 0),
        played_at timestamptz not null,
        side_a_team_id uuid not null references entities(id),
        side_a_era_id uuid references team_eras(id),
        side_a_region_id uuid references entities(id),
        side_b_team_id uuid not null references entities(id),
        side_b_era_id uuid references team_eras(id),
        side_b_region_id uuid references entities(id),
        winner_team_id uuid references entities(id),
        constraint game_facts_provider_source_key_unique unique (provider, source_key),
        constraint game_facts_series_game_number_unique unique (series_id, game_number),
        constraint game_facts_distinct_sides check (side_a_team_id <> side_b_team_id),
        constraint game_facts_winner_is_participant check (
          winner_team_id is null or winner_team_id in (side_a_team_id, side_b_team_id)
        )
      );

      create table game_players (
        game_id uuid not null references game_facts(id),
        player_entity_id uuid not null references entities(id),
        side text not null check (side in ('a', 'b')),
        team_entity_id uuid not null references entities(id),
        primary key (game_id, player_entity_id)
      );

      create table team_region_history (
        team_entity_id uuid not null references entities(id),
        region_entity_id uuid not null references entities(id),
        valid_from date not null,
        valid_to date,
        provider text not null,
        source_key text not null,
        primary key (provider, source_key),
        constraint team_region_history_valid_range check (valid_to is null or valid_to >= valid_from)
      );

      create table source_cursors (
        provider text not null,
        cursor_key text not null,
        cursor_value text not null,
        updated_at timestamptz not null default now(),
        primary key (provider, cursor_key)
      );

      create table dataset_versions (
        id uuid primary key,
        version text not null unique,
        published_at timestamptz not null default now(),
        sync_run_id uuid not null references sync_runs(id)
      );

      create table coverage_status (
        id uuid primary key,
        dataset_version_id uuid not null references dataset_versions(id),
        provider text not null,
        competition text not null,
        season_year integer not null check (season_year >= 2011),
        earliest_date date,
        latest_date date,
        status text not null check (status in ('complete', 'partial', 'missing')),
        detail text,
        constraint coverage_status_date_range check (latest_date is null or earliest_date is null or latest_date >= earliest_date),
        constraint coverage_status_version_competition_unique unique (dataset_version_id, provider, competition, season_year)
      );

      create table override_applications (
        id uuid primary key,
        override_file text not null,
        checksum text not null,
        applied_at timestamptz not null default now(),
        sync_run_id uuid references sync_runs(id),
        constraint override_applications_file_checksum_unique unique (override_file, checksum)
      );

      create function riftversus_authorize_fact_update(provenance_kind text, provenance_id uuid)
      returns void
      language plpgsql
      security definer
      set search_path from current
      as $$
      declare
        fact_schema text := current_schema();
        provenance_exists boolean;
      begin
        if provenance_kind = 'source_object' then
          execute format('select exists (select 1 from %I.source_objects where id = $1)', fact_schema)
            into provenance_exists using provenance_id;
        elsif provenance_kind = 'override_application' then
          execute format('select exists (select 1 from %I.override_applications where id = $1)', fact_schema)
            into provenance_exists using provenance_id;
        else
          raise exception 'Unknown fact update provenance kind: %', provenance_kind;
        end if;

        if not provenance_exists then
          raise exception 'Fact update provenance does not exist: % %', provenance_kind, provenance_id;
        end if;

        execute format(
          'insert into %I.fact_mutation_authorizations (transaction_id, backend_pid, provenance_kind, provenance_id) values (txid_current(), pg_backend_pid(), $1, $2) on conflict do nothing',
          fact_schema
        ) using provenance_kind, provenance_id;
        perform set_config('riftversus.fact_update_provenance_kind', provenance_kind, true);
        perform set_config('riftversus.fact_update_provenance_id', provenance_id::text, true);
      end;
      $$;

      create function riftversus_enforce_fact_update_provenance()
      returns trigger
      language plpgsql
      security definer
      set search_path = pg_catalog
      as $$
      declare
        provenance_kind text := current_setting('riftversus.fact_update_provenance_kind', true);
        provenance_id_text text := current_setting('riftversus.fact_update_provenance_id', true);
        provenance_id uuid;
        provenance_exists boolean;
        authorization_exists boolean;
      begin
        if row(new.*) is not distinct from row(old.*) then
          return new;
        end if;

        if provenance_kind is null or provenance_id_text is null then
          raise exception 'Canonical fact updates require transaction-local source object or override application provenance';
        end if;

        if provenance_kind not in ('source_object', 'override_application') then
          raise exception 'Invalid fact update provenance kind: %', provenance_kind;
        end if;

        begin
          provenance_id := provenance_id_text::uuid;
        exception when invalid_text_representation then
          raise exception 'Invalid fact update provenance id';
        end;

        if provenance_kind = 'source_object' then
          execute format('select exists (select 1 from %I.source_objects where id = $1)', tg_table_schema)
            into provenance_exists using provenance_id;
        else
          execute format('select exists (select 1 from %I.override_applications where id = $1)', tg_table_schema)
            into provenance_exists using provenance_id;
        end if;

        execute format(
          'select exists (select 1 from %I.fact_mutation_authorizations where transaction_id = txid_current() and backend_pid = pg_backend_pid() and provenance_kind = $1 and provenance_id = $2)',
          tg_table_schema
        ) into authorization_exists using provenance_kind, provenance_id;

        if not provenance_exists or not authorization_exists then
          raise exception 'Canonical fact update is not authorized by current transaction provenance';
        end if;

        return new;
      end;
      $$;

      create trigger series_facts_require_provenance_before_update
        before update on series_facts
        for each row execute function riftversus_enforce_fact_update_provenance();
      create trigger game_facts_require_provenance_before_update
        before update on game_facts
        for each row execute function riftversus_enforce_fact_update_provenance();

      revoke all on table fact_mutation_authorizations from public;
      revoke all on function riftversus_authorize_fact_update(text, uuid) from public;

      create index entities_canonical_name_search on entities (lower(canonical_name));
      create index entity_aliases_display_name_search on entity_aliases (lower(display_name)) where searchable;
      create unique index media_assets_current_entity_kind_unique on media_assets (entity_id, kind)
        where is_current and entity_id is not null;
      create unique index media_assets_current_era_kind_unique on media_assets (team_era_id, kind)
        where is_current and team_era_id is not null;
      create index tournaments_category_lookup on tournaments (category, league_slug, start_date);
      create index series_facts_comparison_lookup on series_facts
        (played_at, best_of, side_a_team_id, side_b_team_id, side_a_region_id, side_b_region_id);
      create index game_facts_comparison_lookup on game_facts
        (played_at, side_a_team_id, side_b_team_id, side_a_region_id, side_b_region_id);
      create index game_players_player_game_lookup on game_players (player_entity_id, game_id);
      create index game_players_game_player_lookup on game_players (game_id, player_entity_id);
      create index team_region_history_lookup on team_region_history (team_entity_id, valid_from, valid_to);

      comment on table series_facts is
        'Updates require riftversus_authorize_fact_update in the same transaction with existing source_objects or override_applications provenance; dataset_versions are append-only publication markers.';
      comment on table game_facts is
        'Updates require riftversus_authorize_fact_update in the same transaction with existing source_objects or override_applications provenance; dataset_versions are append-only publication markers.';
      comment on table dataset_versions is
        'Append-only publication/cache version. Canonical series_facts and game_facts intentionally do not reference this table.';
    `).execute(db);
  },

  async down(db) {
    await sql.raw(`
      drop trigger if exists series_facts_require_provenance_before_update on series_facts;
      drop trigger if exists game_facts_require_provenance_before_update on game_facts;
      drop function if exists riftversus_enforce_fact_update_provenance();
      drop function if exists riftversus_authorize_fact_update(text, uuid);
      drop table if exists override_applications;
      drop table if exists coverage_status;
      drop table if exists dataset_versions;
      drop table if exists source_cursors;
      drop table if exists team_region_history;
      drop table if exists game_players;
      drop table if exists game_facts;
      drop table if exists series_facts;
      drop table if exists source_objects;
      drop table if exists fact_mutation_authorizations;
      drop table if exists sync_runs;
      drop table if exists tournaments;
      drop table if exists media_assets;
      drop table if exists team_eras;
      drop table if exists entity_aliases;
      drop table if exists entities;
    `).execute(db);
  },
};
