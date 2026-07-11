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
        fact_table text not null check (fact_table in ('series_facts', 'game_facts')),
        fact_id uuid not null,
        provenance_kind text not null check (provenance_kind in ('source_object', 'override_application')),
        provenance_id uuid not null,
        created_at timestamptz not null default now(),
        primary key (transaction_id, backend_pid, fact_table, fact_id, provenance_kind, provenance_id)
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
        side_a_score smallint check (side_a_score is null or (side_a_score >= 0 and side_a_score <= (best_of + 1) / 2)),
        side_b_score smallint check (side_b_score is null or (side_b_score >= 0 and side_b_score <= (best_of + 1) / 2)),
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
          (winner_team_id = side_a_team_id and side_a_score = (best_of + 1) / 2 and side_b_score < (best_of + 1) / 2) or
          (winner_team_id = side_b_team_id and side_b_score = (best_of + 1) / 2 and side_a_score < (best_of + 1) / 2)
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

      create table fact_mutation_audits (
        audit_id bigint generated always as identity primary key,
        fact_table text not null check (fact_table in ('series_facts', 'game_facts')),
        fact_id uuid not null,
        source_object_id uuid references source_objects(id),
        override_application_id uuid references override_applications(id),
        changed_at timestamptz not null default now(),
        old_payload jsonb not null,
        new_payload jsonb not null,
        constraint fact_mutation_audits_one_provenance check (
          (source_object_id is not null)::integer + (override_application_id is not null)::integer = 1
        )
      );

      create function riftversus_authorize_fact_update(target_fact regclass, target_fact_id uuid, provenance_kind text, provenance_id uuid)
      returns void
      language plpgsql
      security definer
      set search_path = pg_catalog
      as $$
      declare
        fact_schema text;
        fact_table text;
        fact_exists boolean;
        provenance_exists boolean;
      begin
        select namespace.nspname, class.relname into fact_schema, fact_table
        from pg_class class
        join pg_namespace namespace on namespace.oid = class.relnamespace
        where class.oid = target_fact;

        if fact_table not in ('series_facts', 'game_facts') then
          raise exception 'Only canonical fact tables may be authorized';
        end if;

        execute format('select exists (select 1 from %I.%I where id = $1)', fact_schema, fact_table)
          into fact_exists using target_fact_id;
        if not fact_exists then
          raise exception 'Fact does not exist: %.%', fact_table, target_fact_id;
        end if;

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
          'insert into %I.fact_mutation_authorizations (transaction_id, backend_pid, fact_table, fact_id, provenance_kind, provenance_id) values (txid_current(), pg_backend_pid(), $1, $2, $3, $4) on conflict do nothing',
          fact_schema
        ) using fact_table, target_fact_id, provenance_kind, provenance_id;
        perform set_config('riftversus.fact_update_fact_table', fact_table, true);
        perform set_config('riftversus.fact_update_fact_id', target_fact_id::text, true);
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
        context_fact_table text := current_setting('riftversus.fact_update_fact_table', true);
        context_fact_id_text text := current_setting('riftversus.fact_update_fact_id', true);
        provenance_kind text := current_setting('riftversus.fact_update_provenance_kind', true);
        provenance_id_text text := current_setting('riftversus.fact_update_provenance_id', true);
        context_fact_id uuid;
        provenance_id uuid;
        provenance_exists boolean;
        authorization_exists boolean;
        old_payload jsonb;
        new_payload jsonb;
      begin
        if row(new.*) is not distinct from row(old.*) then
          return new;
        end if;

        if context_fact_table is distinct from tg_table_name or context_fact_id_text is null or provenance_kind is null or provenance_id_text is null then
          raise exception 'Canonical fact updates require exact transaction-local fact and provenance authorization';
        end if;

        if provenance_kind not in ('source_object', 'override_application') then
          raise exception 'Invalid fact update provenance kind: %', provenance_kind;
        end if;

        begin
          context_fact_id := context_fact_id_text::uuid;
          provenance_id := provenance_id_text::uuid;
        exception when invalid_text_representation then
          raise exception 'Invalid fact update context';
        end;

        if context_fact_id <> old.id then
          raise exception 'Fact update authorization does not match this fact';
        end if;

        if provenance_kind = 'source_object' then
          execute format('select exists (select 1 from %I.source_objects where id = $1)', tg_table_schema)
            into provenance_exists using provenance_id;
        else
          execute format('select exists (select 1 from %I.override_applications where id = $1)', tg_table_schema)
            into provenance_exists using provenance_id;
        end if;

        execute format(
          'select exists (select 1 from %I.fact_mutation_authorizations where transaction_id = txid_current() and backend_pid = pg_backend_pid() and fact_table = $1 and fact_id = $2 and provenance_kind = $3 and provenance_id = $4)',
          tg_table_schema
        ) into authorization_exists using tg_table_name, old.id, provenance_kind, provenance_id;

        if not provenance_exists or not authorization_exists then
          raise exception 'Canonical fact update is not authorized by current transaction provenance';
        end if;

        old_payload := to_jsonb(old);
        new_payload := to_jsonb(new);
        if provenance_kind = 'source_object' then
          execute format(
            'insert into %I.fact_mutation_audits (fact_table, fact_id, source_object_id, old_payload, new_payload) values ($1, $2, $3, $4, $5)',
            tg_table_schema
          ) using tg_table_name, old.id, provenance_id, old_payload, new_payload;
        else
          execute format(
            'insert into %I.fact_mutation_audits (fact_table, fact_id, override_application_id, old_payload, new_payload) values ($1, $2, $3, $4, $5)',
            tg_table_schema
          ) using tg_table_name, old.id, provenance_id, old_payload, new_payload;
        end if;

        return new;
      end;
      $$;

      create function riftversus_reject_append_only_mutation()
      returns trigger
      language plpgsql
      security definer
      set search_path = pg_catalog
      as $$
      begin
        raise exception '% is append-only', tg_table_name;
      end;
      $$;

      create function riftversus_require_entity_kind(entity_schema text, entity_id uuid, expected_kind text, reference_name text)
      returns void
      language plpgsql
      security definer
      set search_path = pg_catalog
      as $$
      declare
        actual_kind text;
      begin
        execute format('select kind from %I.entities where id = $1', entity_schema)
          into actual_kind using entity_id;
        if actual_kind is distinct from expected_kind then
          raise exception '% must reference an entity of kind %, got %', reference_name, expected_kind, coalesce(actual_kind, 'missing');
        end if;
      end;
      $$;

      create function riftversus_enforce_entity_kinds()
      returns trigger
      language plpgsql
      security definer
      set search_path = pg_catalog
      as $$
      begin
        if tg_table_name = 'team_eras' then
          execute format('select %I.riftversus_require_entity_kind($1, $2, $3, $4)', tg_table_schema)
            using tg_table_schema, new.team_entity_id, 'team', 'team_eras.team_entity_id';
        elsif tg_table_name in ('series_facts', 'game_facts') then
          execute format('select %I.riftversus_require_entity_kind($1, $2, $3, $4)', tg_table_schema)
            using tg_table_schema, new.side_a_team_id, 'team', tg_table_name || '.side_a_team_id';
          execute format('select %I.riftversus_require_entity_kind($1, $2, $3, $4)', tg_table_schema)
            using tg_table_schema, new.side_b_team_id, 'team', tg_table_name || '.side_b_team_id';
          if new.side_a_region_id is not null then
            execute format('select %I.riftversus_require_entity_kind($1, $2, $3, $4)', tg_table_schema)
              using tg_table_schema, new.side_a_region_id, 'region', tg_table_name || '.side_a_region_id';
          end if;
          if new.side_b_region_id is not null then
            execute format('select %I.riftversus_require_entity_kind($1, $2, $3, $4)', tg_table_schema)
              using tg_table_schema, new.side_b_region_id, 'region', tg_table_name || '.side_b_region_id';
          end if;
          if new.winner_team_id is not null then
            execute format('select %I.riftversus_require_entity_kind($1, $2, $3, $4)', tg_table_schema)
              using tg_table_schema, new.winner_team_id, 'team', tg_table_name || '.winner_team_id';
          end if;
        elsif tg_table_name = 'game_players' then
          execute format('select %I.riftversus_require_entity_kind($1, $2, $3, $4)', tg_table_schema)
            using tg_table_schema, new.player_entity_id, 'player', 'game_players.player_entity_id';
          execute format('select %I.riftversus_require_entity_kind($1, $2, $3, $4)', tg_table_schema)
            using tg_table_schema, new.team_entity_id, 'team', 'game_players.team_entity_id';
        elsif tg_table_name = 'team_region_history' then
          execute format('select %I.riftversus_require_entity_kind($1, $2, $3, $4)', tg_table_schema)
            using tg_table_schema, new.team_entity_id, 'team', 'team_region_history.team_entity_id';
          execute format('select %I.riftversus_require_entity_kind($1, $2, $3, $4)', tg_table_schema)
            using tg_table_schema, new.region_entity_id, 'region', 'team_region_history.region_entity_id';
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
      create trigger source_objects_append_only_before_mutation
        before update or delete on source_objects
        for each row execute function riftversus_reject_append_only_mutation();
      create trigger override_applications_append_only_before_mutation
        before update or delete on override_applications
        for each row execute function riftversus_reject_append_only_mutation();
      create trigger fact_mutation_audits_append_only_before_mutation
        before update or delete on fact_mutation_audits
        for each row execute function riftversus_reject_append_only_mutation();
      create trigger team_eras_require_entity_kinds_before_write
        before insert or update on team_eras
        for each row execute function riftversus_enforce_entity_kinds();
      create trigger series_facts_require_entity_kinds_before_write
        before insert or update on series_facts
        for each row execute function riftversus_enforce_entity_kinds();
      create trigger game_facts_require_entity_kinds_before_write
        before insert or update on game_facts
        for each row execute function riftversus_enforce_entity_kinds();
      create trigger game_players_require_entity_kinds_before_write
        before insert or update on game_players
        for each row execute function riftversus_enforce_entity_kinds();
      create trigger team_region_history_require_entity_kinds_before_write
        before insert or update on team_region_history
        for each row execute function riftversus_enforce_entity_kinds();

      revoke all on table fact_mutation_authorizations from public;
      revoke all on table fact_mutation_audits from public;
      revoke all on function riftversus_authorize_fact_update(regclass, uuid, text, uuid) from public;
      revoke all on function riftversus_enforce_fact_update_provenance() from public;
      revoke all on function riftversus_reject_append_only_mutation() from public;
      revoke all on function riftversus_require_entity_kind(text, uuid, text, text) from public;
      revoke all on function riftversus_enforce_entity_kinds() from public;
      comment on function riftversus_authorize_fact_update(regclass, uuid, text, uuid) is
        'SECURITY DEFINER controlled update route. EXECUTE is revoked from PUBLIC; grant it explicitly to a trusted sync writer. The function owner is the DBA trust boundary.';

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
      create index fact_mutation_audits_fact_lookup on fact_mutation_audits (fact_table, fact_id, changed_at);

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
      drop trigger if exists source_objects_append_only_before_mutation on source_objects;
      drop trigger if exists override_applications_append_only_before_mutation on override_applications;
      drop trigger if exists fact_mutation_audits_append_only_before_mutation on fact_mutation_audits;
      drop trigger if exists team_eras_require_entity_kinds_before_write on team_eras;
      drop trigger if exists series_facts_require_entity_kinds_before_write on series_facts;
      drop trigger if exists game_facts_require_entity_kinds_before_write on game_facts;
      drop trigger if exists game_players_require_entity_kinds_before_write on game_players;
      drop trigger if exists team_region_history_require_entity_kinds_before_write on team_region_history;
      drop function if exists riftversus_enforce_fact_update_provenance();
      drop function if exists riftversus_authorize_fact_update(regclass, uuid, text, uuid);
      drop function if exists riftversus_reject_append_only_mutation();
      drop function if exists riftversus_require_entity_kind(text, uuid, text, text);
      drop function if exists riftversus_enforce_entity_kinds();
      drop table if exists fact_mutation_audits;
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
