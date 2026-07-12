# RiftVersus MVP Implementation Plan

> Source Tasks 7-9 are superseded by
> `docs/aegis/plans/2026-07-12-leaguepedia-primary-mvp.md`. Completed Tasks
> 1-6 and 10-11 remain historical execution authority.

Date: `2026-07-12`  
Status: `ready for execution`  
Architecture review required: `yes`  
TDD route: `light—test first for contracts, domain, database, sync, API, and export; direct verification for configuration and documentation`

## Goal

Implement the approved RiftVersus first release: a portable TypeScript web
application that compares player, team, or region head-to-head records, reads
canonical facts from PostgreSQL, imports daily/historical data through bounded
source adapters, serves cached subject media from S3-compatible storage, and
exports long results as PNG/ZIP in the browser.

The plan stops when the approved behavior has implementation evidence. It does
not add accounts, bookmarks, live-game data, secondary leagues, Redis, a
precomputed all-pairs matrix, or a second backend language.

## Architecture

Use one pnpm/TypeScript workspace and one production image:

```text
apps/web -> packages/contracts -> GET /api/*
apps/server -> packages/contracts + domain + database + sync composition
packages/domain -> pure comparison and classification rules
packages/database -> migrations, canonical facts, repositories, SQL
packages/sync -> Oracle's Elixir + Leaguepedia adapters, object storage, publish
PostgreSQL -> only runtime source of comparison truth
S3-compatible storage -> immutable source objects + cached media
```

`serve`, `sync`, `sync --once`, `backfill`, and `migrate` are commands of the
same built server artifact. API handlers never call upstream sources.

## Tech Stack

- TypeScript with strict compiler settings and ESM;
- pnpm workspace;
- React, Vite, React Router, TanStack Query;
- Fastify;
- Zod;
- Kysely and `pg`;
- AWS SDK for JavaScript S3 client;
- `csv-parse`, `yaml`, `croner`;
- Vitest and Playwright;
- `html-to-image` and JSZip;
- PostgreSQL and MinIO in Docker Compose;
- multi-stage Node.js slim production image.

Dependencies are installed with `--save-exact`; `pnpm-lock.yaml` is the version
authority. Do not write floating framework versions into documentation.

## Baseline / Authority Refs

- `docs/aegis/BASELINE-GOVERNANCE.md`;
- `docs/aegis/specs/2026-07-12-riftversus-design.md`, approved 2026-07-12;
- user-provided repository instructions: Traditional Chinese communication,
  `rtk` command prefix, and repository-aware commit messages;
- Oracle's Elixir download page and Riot policy links cited by the Design Spec;
- Leaguepedia MediaWiki API cited by the Design Spec.

There is no existing implementation, schema, ADR, or valid Git history. The
empty `.git/` directory is not an implementation baseline.

## Compatibility Boundary

- local and remote deployments use the same `DATABASE_URL` and migrations;
- MinIO, R2, and AWS S3 use one S3 configuration contract;
- API and sync share canonical contracts and facts, not duplicated models;
- public URL filters remain round-trippable;
- comparison meaning remains the approved opposing-side model;
- a provider change cannot silently alter normalized results;
- failed sync runs cannot replace the currently published dataset version;
- no runtime scraper, D1 path, SQLite path, Rust service, Redis fallback, or
  server-side Chromium path is retained.

## Verification

The implementation is complete only when all applicable commands pass:

```bash
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test
rtk pnpm test:integration
rtk pnpm build
rtk pnpm test:e2e
rtk docker compose config
rtk docker compose up -d postgres minio
rtk docker compose run --rm migrate
rtk docker compose run --rm app node apps/server/dist/cli.js sync --once --fixture
rtk docker compose up -d app
rtk curl --fail http://localhost:3000/health/ready
rtk docker image inspect riftversus:local
```

Docker-dependent evidence is currently unavailable in this WSL environment
because Docker Desktop integration is disabled. Non-Docker batches may execute;
the Docker verification gate must remain open until integration is enabled.

## Planning Checks

### Aegis Visibility

Planning is necessary because this greenfield build introduces the canonical
schema, public API, source adapters, storage contract, deployment surface, and
historical semantics simultaneously; explicit owners and gates reduce the risk
of creating duplicate truth or publishing plausible but incorrect records.

### Plan Basis

- Fact: the Design Spec is approved.
- Fact: the repository contains only Aegis documents.
- Fact: Leaguepedia's public MediaWiki API responds without authentication.
- Fact: Oracle's Elixir publicly describes daily CSV downloads.
- Fact: the previously observed programmatic `oe.datalisk.io/matchData`
  endpoint currently responds with authentication failure.
- Assumption to verify before a production import: stable public Google Drive
  file IDs or direct URLs can be pinned in a reviewed source manifest.
- Unknown to measure: exact 2011–2013 tier-one completeness and current-year
  Oracle distribution stability.

### BaselineUsageDraft

- Required baseline refs: governance and approved Design Spec.
- Delivered context refs: user repository instructions.
- Acknowledged before plan refs: governance, Design Spec, Aegis index.
- Cited in plan refs: governance, Design Spec, provider references through the
  Design Spec.
- Missing refs: none required to begin; provider coverage remains an evidence
  checkpoint.
- Decision: continue.

### Requirement Ready Check

- Requirement source refs: approved Design Spec.
- Goals and scope refs: Design Spec sections 1–2.
- User/scenario refs: Design Spec sections 2–3 and 12.3.
- Requirement item refs: Design Spec sections 2–11.
- Acceptance/verification refs: Design Spec section 12 and this plan's task
  verification commands.
- Open blocker questions: none for foundation execution; provider access and
  2011–2013 completeness are bounded stop/checkpoint decisions in Tasks 7–8.
- Decision: ready.

### Change Necessity

- User-visible need: query and export direct historical esports records.
- No-change/non-code option: documentation or an external dashboard cannot
  provide the approved cross-type semantics, lineage filter, portable Docker
  deployment, and reproducible source provenance.
- Why code is necessary: canonical normalization, opposing-side queries,
  publication safety, and client rendering are application behavior.
- Minimum boundary: the six approved workspace owners plus deployment files.
- Decision: code-change.

### Existence Check

- `packages/contracts`: required once to prevent web/API schema duplication.
- `packages/domain`: required once to own comparison meaning independently of
  SQL and UI.
- `packages/database`: required once to own canonical persistence and queries.
- `packages/sync`: required once because upstream formats must not enter API
  handlers; only two provider adapters are approved.
- `data/overrides`: required for reviewable identity conflicts; no admin UI.
- dataset version and source manifest: required for atomic publication and
  reproducible access; no runtime provider fallback.
- Decision: add-with-proof under the owners above.

### Architecture Integrity Lens

- Invariant: all public results come from one published PostgreSQL dataset.
- Canonical owner/contract: domain semantics plus database facts.
- Responsibility overlap: contracts describe shape, domain describes meaning,
  database persists/queries, sync imports, server composes, web presents.
- Higher-level simplification: one workspace and one image; no duplicated
  service model or language.
- Retirement/falsifier: new providers, caches, or services require evidence
  that the existing owner cannot meet an approved budget.
- Verdict: proceed.

### Plan Pressure Test

- Owner/contract/retirement: explicit and aligned with the Design Spec.
- Architecture integrity/higher-level path: no simpler system meets offline
  ingestion, canonical querying, media caching, and Docker portability.
- Verification scope: unit, PostgreSQL integration, provider fixtures,
  Playwright, Docker, source coverage, and query plans.
- Task executability: each task has exact files, commands, expected state, and a
  commit boundary.
- Pressure result: proceed with provider and Docker checkpoints visible.

### Plan-Time Complexity Check

- Artifact class: greenfield multi-package application.
- Current pressure: no source files.
- Projected pressure: query SQL, import orchestration, and result UI are likely
  hotspots.
- Budget result: within-budget only if each hotspot is split by owner.
- Planned governance: route modules contain composition only; pure semantics,
  repositories, adapters, and export logic remain separate and tested.
- Better file boundary: one file per public route, repository, provider, and
  major UI feature; shared types live only in contracts.
- Recommendation: add owner files and split tasks; do not grow one server or
  sync manager file.

## File Map

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
tsconfig.base.json
vitest.workspace.ts
.editorconfig
.gitignore
.env.example
Dockerfile
compose.yaml

apps/server/
  package.json
  tsconfig.json
  src/cli.ts
  src/app.ts
  src/config.ts
  src/errors.ts
  src/routes/{entities,filters,comparisons,dataset,media,health}.ts
  test/{app,cli}.test.ts

apps/web/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/main.tsx
  src/app.tsx
  src/api/client.ts
  src/features/comparison/{query-state,ComparisonForm,ComparisonPage,ResultCard,SeriesList}.tsx
  src/features/export/export-result.ts
  src/features/export/ExportButton.tsx
  src/styles.css
  public/media-placeholder.svg
  test/{query-state,export-result}.test.tsx
  e2e/comparison.spec.ts

packages/contracts/
  package.json
  tsconfig.json
  src/{entities,comparison,dataset,errors,index}.ts
  test/contracts.test.ts

packages/domain/
  package.json
  tsconfig.json
  src/{comparison,tournament-category,series-grouping,index}.ts
  test/{comparison,tournament-category,series-grouping}.test.ts

packages/database/
  package.json
  tsconfig.json
  src/{db,types,migrator,index}.ts
  src/migrations/001_initial.ts
  src/repositories/{entities,filters,comparison,dataset,media,sync}.ts
  test/{migrations,comparison,sync-publication}.integration.test.ts
  test/fixtures/seed.ts

packages/sync/
  package.json
  tsconfig.json
  src/{types,runner,publication,overrides,index}.ts
  src/storage/s3.ts
  src/providers/oracles-elixir/{manifest,download,parse,normalize}.ts
  src/providers/leaguepedia/{client,entities,series,media,normalize}.ts
  test/fixtures/{oracle-small.csv,leaguepedia-pages.json,leaguepedia-series.json}
  test/{runner,oracle,leaguepedia,storage}.test.ts

data/overrides/{entities,tournaments}.yaml
data/sources/oracles-elixir.json
docker/entrypoint.sh
docs/{README,operations,data-sources,attribution}.md
```

## Task Batches

1. Foundation: Tasks 1–3.
2. Canonical semantics and query path: Tasks 4–6.
3. Ingestion and media: Tasks 7–9.
4. User experience and export: Tasks 10–11.
5. Deployment and acceptance: Tasks 12–13.

At the end of each batch, run root lint, typecheck, tests, and build. If a task
requires changing an approved contract or owner, stop, update the Design Spec,
and obtain approval before continuing.

## Tasks

### Task 1: Initialize the pnpm workspace and test/build baseline

**Files:** create the root configuration files and every package's
`package.json`, `tsconfig.json`, and `src/index.ts`; create
`test/workspace.test.ts`; include the existing `docs/aegis/` files in the first
commit.

**Why:** every later slice needs one reproducible dependency graph, strict
TypeScript settings, and common verification commands.

**Change Necessity:** configuration alone cannot prove package dependency
direction; the minimum source change is an empty public entry point per package
plus one import-boundary smoke test.

**Impact/Compatibility:** package dependencies must flow
`web/server/sync/database -> contracts/domain`; `domain` may depend only on
`contracts`; `contracts` has no internal dependency. Use Node ESM and prohibit
cross-package relative imports.

**Verification:** `rtk pnpm install`, `rtk pnpm lint`, `rtk pnpm typecheck`,
`rtk pnpm test`, and `rtk pnpm build` all exit 0. Expected result is six
buildable packages with no application behavior.

- [ ] **Write test:** create `test/workspace.test.ts` that imports the public
  entry point of `@riftversus/contracts`, `domain`, `database`, and `sync`, then
  asserts each exported `packageName` constant equals its package name. The
  test must not import files below another package's `src/` directory.
- [ ] **Verify RED:** run `rtk pnpm test`; expected failure is missing root
  package/workspace configuration or unresolved `@riftversus/*` modules.
- [ ] **Minimal code:** initialize Git with `rtk git init` because the current
  `.git/` is empty; create a private root `package.json` with scripts `build`,
  `lint`, `typecheck`, `test`, `test:integration`, and `test:e2e`; create
  `pnpm-workspace.yaml` covering `apps/*` and `packages/*`; enable
  `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `moduleResolution: Bundler`, and project references in `tsconfig.base.json`;
  install exact versions with:

  ```bash
  rtk pnpm add -Dw --save-exact typescript eslint @eslint/js typescript-eslint vitest @vitest/coverage-v8 prettier
  rtk pnpm add --filter @riftversus/contracts --save-exact zod
  rtk pnpm add --filter @riftversus/domain --save-exact @riftversus/contracts@workspace:*
  rtk pnpm add --filter @riftversus/database --save-exact @riftversus/contracts@workspace:* @riftversus/domain@workspace:* kysely pg
  rtk pnpm add --filter @riftversus/database -D --save-exact @types/pg
  rtk pnpm add --filter @riftversus/sync --save-exact @riftversus/contracts@workspace:* @riftversus/domain@workspace:* @riftversus/database@workspace:*
  ```

  Export only `packageName` from each initial entry point. Add `.env*`, build
  output, coverage, Playwright output, and local volumes to `.gitignore`; retain
  `.env.example`.
- [ ] **Verify GREEN:** run `rtk pnpm install --frozen-lockfile`, followed by
  the five non-Docker root verification commands. Expected output is zero test,
  type, lint, or build failures and a committed `pnpm-lock.yaml`.
- [ ] **Commit:** stage the scaffold and approved documents with `rtk git add`
  and commit using `🎉 init: scaffold typescript workspace`.

### Task 2: Define public contracts and runtime configuration

**Files:** create all `packages/contracts/src/*.ts`,
`packages/contracts/test/contracts.test.ts`, `apps/server/src/config.ts`,
`apps/server/test/config.test.ts`, and populate `.env.example`.

**Why:** web, server, database, and sync need one runtime-validated vocabulary
for subjects, filters, responses, errors, environment, and storage.

**Change Necessity:** TypeScript interfaces alone disappear at runtime; Zod
schemas are required at HTTP, environment, and provider boundaries.

**Impact/Compatibility:** enum wire values are lowercase and stable:
`player|team|region`, `league|fst|msi|worlds|other`, and `1|3|5` for best-of.
Dates use `YYYY-MM-DD`; IDs are UUID strings; pagination uses an opaque cursor
and `limit` from 1 through 100.

**Verification:** `rtk pnpm --filter @riftversus/contracts test` and
`rtk pnpm --filter @riftversus/server test -- config` exit 0.

- [ ] **Write test:** encode tables that accept all approved subject/event/best-
  of values; reject identical subject IDs, reversed date ranges, an exact-era
  ID on a non-team subject, limits above 100, missing `DATABASE_URL`, partial S3
  credentials, and secrets printed by `safeConfigSummary`. Assert a comparison
  response round-trips with series summary, game summary, rows, dataset version,
  coverage warnings, and media URLs.
- [ ] **Verify RED:** run the two package tests; expected failure is missing
  schemas and `loadConfig`.
- [ ] **Minimal code:** implement and export `EntityKindSchema`,
  `EventCategorySchema`, `BestOfSchema`, `SubjectRefSchema`,
  `ComparisonQuerySchema`, `ComparisonResponseSchema`, `DatasetSchema`, and
  `ApiErrorSchema`. `ComparisonQuerySchema` must normalize omitted filters to
  empty arrays, default `limit` to 50, treat a team subject without `teamEraId`
  as lineage mode, and reject same canonical subject IDs. Implement
  `loadConfig(env)` with these required
  production contracts:

  ```text
  DATABASE_URL
  S3_ENDPOINT, S3_REGION, S3_BUCKET
  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
  S3_FORCE_PATH_STYLE=true|false
  PORT=3000
  HOST=0.0.0.0
  LOG_LEVEL=info
  SYNC_CRON=0 3 * * *
  SYNC_TIMEZONE=UTC
  MEDIA_DELIVERY=proxy|redirect
  ```

  `safeConfigSummary` may expose endpoint/region/bucket/mode but never database
  credentials, S3 secret, or signed URLs.
  Install the direct runtime dependencies before implementation:

  ```bash
  rtk pnpm add --filter @riftversus/server --save-exact zod @riftversus/contracts@workspace:*
  ```
- [ ] **Verify GREEN:** run contract/server tests, root typecheck, and root lint;
  expected output is all accepted/rejected cases passing with no secret in test
  snapshots.
- [ ] **Commit:** commit using `✨ feat(contracts): define api and runtime schemas`.

### Task 3: Create the canonical PostgreSQL schema and migrator

**Files:** create `packages/database/src/types.ts`, `db.ts`, `migrator.ts`,
`migrations/001_initial.ts`, `test/migrations.integration.test.ts`, and
`test/fixtures/seed.ts`; add `apps/server/src/cli.ts` with only the `migrate`
command active.

**Why:** historical identity and opposing-side facts need one normalized,
queryable source of truth before domain or provider work begins.

**Change Necessity:** no existing persistence exists; the minimum schema must
represent approved identity eras, series/games/players, provenance, media,
coverage, and atomic dataset publication.

**Impact/Compatibility:** UUID primary keys use application-generated UUIDs;
all source uniqueness is `(provider, source_key)`; timestamps are `timestamptz`;
historical match dates are immutable after publication except through a new
source object/override application. Migration rollback is supported only for
an empty development database; production uses forward migrations.

**Verification:** with `TEST_DATABASE_URL` set, run
`rtk pnpm --filter @riftversus/database test:integration -- migrations` twice.
Expected result: first run creates all objects, second run is a no-op, and all
foreign keys/indexes exist.

- [ ] **Write test:** start from an empty test schema, run the migrator twice,
  query `information_schema`/`pg_indexes`, and assert these tables exist:
  `entities`, `entity_aliases`, `team_eras`, `media_assets`,
  `override_applications`, `tournaments`, `series_facts`, `game_facts`,
  `game_players`, `team_region_history`, `sync_runs`, `source_objects`,
  `source_cursors`, `dataset_versions`, and `coverage_status`. Assert invalid
  entity kind, best-of, game side, overlapping duplicate source key, and a game
  winner outside its two sides fail.
- [ ] **Verify RED:** run the migration integration test; expected failure is
  missing migrator/migration.
- [ ] **Minimal code:** implement `001_initial` with the following required
  ownership and constraints:

  ```bash
  rtk pnpm add --filter @riftversus/server --save-exact @riftversus/database@workspace:*
  ```

  ```text
  entities(id, kind, canonical_name, slug, created_at, updated_at)
  entity_aliases(id, entity_id, provider, source_key, display_name,
                 valid_from, valid_to, searchable)
  team_eras(id, team_entity_id, display_name, slug, valid_from, valid_to)
  media_assets(id, entity_id, team_era_id, kind, source_url, object_key,
               checksum, content_type, attribution, license, is_current)
  tournaments(id, provider, source_key, name, league_slug, category, tier,
              start_date, end_date)
  series_facts(id, provider, source_key, tournament_id, played_at, best_of,
               completed, side_a_team_id, side_a_era_id, side_a_region_id,
               side_b_team_id, side_b_era_id, side_b_region_id,
               side_a_score, side_b_score, winner_team_id)
  game_facts(id, provider, source_key, series_id, game_number, played_at,
             side_a_team_id, side_a_era_id, side_a_region_id,
             side_b_team_id, side_b_era_id, side_b_region_id,
             winner_team_id)
  game_players(game_id, player_entity_id, side, team_entity_id)
  team_region_history(team_entity_id, region_entity_id, valid_from, valid_to,
                      provider, source_key)
  sync_runs(id, provider, mode, status, parser_version, started_at, finished_at,
            source_count, inserted_count, updated_count, warning_count, error)
  source_objects(id, provider, source_key, source_url, object_key, checksum,
                 content_type, byte_size, retrieved_at, parser_version)
  source_cursors(provider, cursor_key, cursor_value, updated_at)
  dataset_versions(id, version, published_at, sync_run_id)
  coverage_status(id, dataset_version_id, provider, competition, season_year,
                  earliest_date, latest_date, status, detail)
  override_applications(id, override_file, checksum, applied_at, sync_run_id)
  ```

  Add check constraints for enum values and score/winner consistency; partial
  unique indexes for current media; search indexes for canonical/alias names;
  comparison indexes on date/category/best-of/side team/region; and player-game
  indexes in both directions. Implement `createDb`, `destroyDb`, and Kysely
  `Migrator`. The CLI accepts only `migrate` at this stage and exits non-zero on
  migration failure.
- [ ] **Verify GREEN:** run the migration test twice, root typecheck, lint, and
  build. Expected result is idempotent migration execution and no unconstrained
  public comparison join key.
- [ ] **Commit:** commit using `✨ feat(database): add canonical esports schema`.

### Task 4: Implement the comparison and classification domain rules

**Files:** create `packages/domain/src/comparison.ts`,
`tournament-category.ts`, `series-grouping.ts`, `index.ts`, and the three
corresponding test files.

**Why:** the defining product behavior must be executable independently of SQL,
providers, and UI so every implementation can be checked against one oracle.

**Change Necessity:** neither contracts nor database constraints express
opposing-side qualification, direct-game membership, lineage selection, or
series-once aggregation.

**Impact/Compatibility:** expose pure functions only. The database query must
match these functions; it must not fork the business definition. Tournament
classification accepts explicit overrides before deterministic name/league
rules.

**Verification:** `rtk pnpm --filter @riftversus/domain test` exits 0 with a
named case for every semantic bullet in Design Spec section 12.1.

- [ ] **Write test:** build one in-memory fixture containing T1/SKT eras, an LPL
  team, an LCK opponent, Faker, Xiaohu, a substitute, BO1/BO3/BO5 series, one
  incomplete series, and one team-region change. Assert:
  team-versus-own-region excludes the same side; player-versus-player requires
  both to appear on opposing sides in the same game; a qualifying player series
  counts once; a benched player receives no direct games; lineage includes both
  SKT/T1 while exact era does not; region follows stored match-time region; an
  incomplete series has no series result; filter categories and best-of values
  are respected.
- [ ] **Verify RED:** run the domain tests; expected failure is missing domain
  functions.
- [ ] **Minimal code:** implement these public functions with exhaustive
  discriminated unions:

  ```ts
  resolveDirectGame(query: ComparisonQuery, game: DomainGame): DirectGame | null
  summarizeComparison(query: ComparisonQuery, series: DomainSeries[]): ComparisonSummary
  qualifiesSeries(query: ComparisonQuery, series: DomainSeries): boolean
  classifyTournament(input: TournamentClassificationInput, overrides: TournamentOverride[]): EventCategory
  groupGamesIntoSeries(games: SourceGame[], explicit: ExplicitSeries[]): GroupingResult
  ```

  `resolveDirectGame` tests both left/right side assignments but requires
  distinct sides. `summarizeComparison` deduplicates by series ID and counts only
  completed series. `groupGamesIntoSeries` uses explicit metadata first; derived
  grouping requires same tournament, same opposing teams, a bounded match-time
  window, unique game numbers, and an unambiguous result. Ambiguous groups return
  validation errors rather than guessed series.
- [ ] **Verify GREEN:** run domain tests, root typecheck, and lint. Expected
  result is full semantic fixture coverage without database imports in the
  domain package.
- [ ] **Commit:** commit using `✨ feat(domain): implement comparison semantics`.

### Task 5: Implement canonical repositories and comparison SQL

**Files:** create every file under
`packages/database/src/repositories/`, populate `test/fixtures/seed.ts`, and
create `test/comparison.integration.test.ts` and
`sync-publication.integration.test.ts`.

**Why:** the website needs indexed PostgreSQL queries that are demonstrably
equivalent to the pure domain oracle and preserve atomic dataset publication.

**Change Necessity:** loading the full dataset into application memory is not a
bounded production query; repositories are the minimum persistence boundary.

**Impact/Compatibility:** repositories accept/return contract types or explicit
database DTOs. No Kysely row type leaks into routes. All public reads join the
latest `dataset_versions` row and never see unpublished staging data.

**Verification:** `rtk pnpm --filter @riftversus/database test:integration`
exits 0. `EXPLAIN (FORMAT JSON)` for seeded representative queries uses the
participant/player indexes and contains no sequential scan of `game_players`
or `series_facts` once the performance fixture exceeds the planner threshold.

- [ ] **Write test:** insert the exact Task 4 fixture through seed helpers and
  compare repository output to `summarizeComparison` for all nine cross-kind
  combinations, independent per-subject lineage/exact-era selection,
  categories, date range, best-of, and
  cursor pagination. Test entity alias search, derived filters, media lookup,
  coverage warnings, failed publication, repeated source-object idempotency,
  and advisory-lock exclusion.
- [ ] **Verify RED:** run database integration tests; expected failure is
  missing repositories.
- [ ] **Minimal code:** implement repositories with these public boundaries:

  ```ts
  searchEntities(query, db): Promise<EntitySearchResponse>
  listAvailableFilters(db): Promise<FilterOptions>
  compareHeadToHead(query, db): Promise<ComparisonResponse>
  getDatasetStatus(db): Promise<DatasetStatus>
  getMediaByKey(key, db): Promise<MediaAsset | null>
  beginSyncRun(input, db): Promise<SyncRun>
  recordSourceObject(input, db): Promise<'inserted' | 'existing'>
  publishDataset(input, db): Promise<DatasetVersion>
  failSyncRun(input, db): Promise<void>
  withSyncAdvisoryLock(provider, callback, db): Promise<'ran' | 'locked'>
  ```

  Build comparison SQL in two explicit stages: candidate series by dates,
  tournament category, best-of, and opposing team/region sides; direct games by
  optional player membership. Aggregate series from distinct qualifying series
  and games from distinct direct games. Use keyset cursor `(played_at,id)` and
  fetch `limit + 1`. Publish facts and one `dataset_versions` row in the same
  transaction. Canonical facts are current state, not copied per dataset
  version; the new append-only version row is inserted only after all canonical
  upserts and coverage writes succeed in the same transaction. Never mutate a
  previously published version row.
- [ ] **Verify GREEN:** run database integration tests and save representative
  explain output under test assertions. Expected result exactly matches the
  domain oracle, retrying one source object does not duplicate facts, and a
  thrown validation error leaves the old version current.
- [ ] **Commit:** commit using `✨ feat(database): add comparison repositories`.

### Task 6: Compose Fastify, CLI, HTTP caching, and health routes

**Files:** create `apps/server/src/app.ts`, `errors.ts`, all route files except
the media implementation body, and `test/app.test.ts`; extend `cli.ts` with
`serve`; add server dependencies.

**Why:** clients need one validated HTTP boundary and operators need predictable
liveness/readiness without exposing database or provider details.

**Change Necessity:** repository functions are not a public protocol; Fastify
must own input parsing, status mapping, caching, correlation IDs, and static SPA
delivery.

**Impact/Compatibility:** routes consume Zod contracts and repositories through
dependency injection. They do not import provider modules. Error bodies always
match `ApiErrorSchema`. CORS stays same-origin.

**Verification:** `rtk pnpm --filter @riftversus/server test` and
`rtk pnpm --filter @riftversus/server build` exit 0.

- [ ] **Write test:** use `app.inject` with fake repositories to verify every
  approved route: entity search, filters, comparison, dataset, live, and ready.
  Assert normalized query input, 400 invalid query, 404 entity/media lookup,
  503 failed readiness, correlation ID on 500, no SQL/upstream body in errors,
  ETag `304 Not Modified`, dataset-version cache key, and static fallback only
  for non-API GET paths.
- [ ] **Verify RED:** run server tests; expected failure is missing app/routes.
- [ ] **Minimal code:** install exact `fastify`, `@fastify/static`, and
  `@fastify/sensible`; implement `buildApp(dependencies)` without listening;
  keep `startServer(config)` in `cli.ts`. Register:

  ```text
  GET /api/entities
  GET /api/filters
  GET /api/comparisons
  GET /api/dataset
  GET /health/live
  GET /health/ready
  ```

  Compute comparison ETag as SHA-256 of canonical JSON containing normalized
  query and dataset version. Return `Cache-Control: public, max-age=60,
  stale-while-revalidate=300`. Map Zod errors to 400, missing subjects to 404,
  readiness dependency failure to 503, and unexpected errors to 500 with a
  generated request/correlation ID. Reserve `/media/:key` registration for Task
  9 rather than returning an unsafe URL proxy.
- [ ] **Verify GREEN:** run server tests, root typecheck/lint/build, and inspect
  the built CLI with `rtk node apps/server/dist/cli.js --help`. Expected output
  lists `serve` and `migrate`; tests show no provider imports in route modules.
- [ ] **Commit:** commit using `✨ feat(api): expose comparison endpoints`.

### Task 7: Build sync orchestration, object storage, and source-access proof

**Files:** create `packages/sync/src/types.ts`, `runner.ts`, `publication.ts`,
`storage/s3.ts`, `test/runner.test.ts`, `test/storage.test.ts`, and
`data/sources/oracles-elixir.json`; extend server config and CLI with
`sync --once`, `sync`, and `backfill` command parsing without provider logic.

**Why:** providers need one bounded download/provenance/publication workflow,
and the Oracle distribution path must be proven before parser code assumes a
stable endpoint.

**Change Necessity:** direct provider-to-database writes would duplicate retry,
locking, source retention, and publication rules; one runner/storage boundary is
the minimum safe owner.

**Impact/Compatibility:** storage uses generic S3 operations only. Source URLs
come from a reviewed manifest or provider configuration, never user input.
`sync` schedules one daily run through the same `runSync` used by `sync --once`;
`backfill` selects years but uses the same pipeline.

**Verification:** sync/storage unit tests pass against an in-memory S3 fake;
then `rtk pnpm --filter @riftversus/sync test`. A live source-access probe must
return a CSV header before Task 8 begins.

- [ ] **Write test:** verify SHA-256 object keys are immutable; a repeated upload
  is idempotent; byte/content-type/redirect limits reject unsafe downloads;
  runner obtains/relinquishes the advisory lock; a provider failure records a
  failed run and does not call publication; success stores source metadata then
  publishes; `sync` never overlaps ticks; manifest schema rejects duplicate
  years, non-HTTPS URLs, unapproved hosts, and missing attribution metadata.
- [ ] **Verify RED:** run sync tests; expected failure is missing runner,
  storage, and manifest schema.
- [ ] **Minimal code:** install exact `@aws-sdk/client-s3`, `croner`, and a test
  S3 fake dependency if required. Implement:

  ```bash
  rtk pnpm add --filter @riftversus/server --save-exact @riftversus/sync@workspace:*
  ```

  ```ts
  interface ObjectStore {
    putImmutable(input: PutObjectInput): Promise<StoredObject>;
    get(key: string): Promise<Readable>;
    head(key: string): Promise<StoredObject | null>;
    signedGetUrl(key: string, ttlSeconds: number): Promise<string>;
  }
  runSync(request: SyncRequest, dependencies: SyncDependencies): Promise<SyncResult>
  scheduleSync(cron: string, timezone: string, run: () => Promise<void>): StopHandle
  ```

  Object keys use `sources/<provider>/<sha256>` and
  `media/<sha256>.<validated-extension>`. Downloads allow only configured hosts,
  at most five redirects that remain allow-listed, explicit maximum bytes, and
  a request timeout. Create an Oracle manifest schema with
  `provider`, `folderUrl`, `attribution`, and entries containing `seasonYear`,
  stable public `fileId` or direct `https` URL, and `enabled`.

  Before committing, open the public Oracle Google Drive folder from the Design
  Spec, identify the current-year file, and prove that the pinned ID/URL returns
  a CSV whose required header includes `gameid`, `league`, `year`, `date`,
  `teamname`, `playername`, `side`, and `result`. Record only verified entries.
  If public access cannot be proven or requires credentials/terms not already
  authorized, stop this task and request a source-access decision; do not parse
  the download-page HTML or bypass authentication.
- [ ] **Verify GREEN:** run sync tests and a bounded live probe that downloads
  only the header/range needed for access verification. Expected result is a
  reviewed manifest, no secret in it, stable source metadata, and no publication
  on simulated failure.
- [ ] **Commit:** commit using `✨ feat(sync): add safe publication pipeline`.

### Task 8: Implement the Oracle's Elixir bulk-game adapter

**Files:** create all files under
`packages/sync/src/providers/oracles-elixir/`, fixture
`test/fixtures/oracle-small.csv`, `test/oracle.test.ts`, and populate
`data/overrides/tournaments.yaml` with only verified classification rules.

**Why:** Oracle CSV supplies the efficient bulk game/player facts needed for
daily updates and most historical coverage.

**Change Necessity:** raw wide CSV rows duplicate game/team totals and use
provider names; a streaming adapter must validate, group, normalize, and map
them before canonical publication.

**Impact/Compatibility:** the adapter emits provider-neutral normalized records
and validation issues. It never writes routes or performs ad hoc SQL. Unknown
columns are tolerated; missing required columns or ambiguous series grouping
fail publication.

**Verification:** `rtk pnpm --filter @riftversus/sync test -- oracle` exits 0;
an integration import of the fixture twice produces identical canonical row
counts and one source object.

- [ ] **Write test:** create a compact CSV with team and player rows for BO1,
  BO3, BO5, a substitute, two team-name eras, one invalid result, one duplicate
  game row, and one ambiguous series boundary. Assert streaming parse, required
  column validation, team/player row reconciliation, deterministic IDs,
  tournament classification, explicit error codes, idempotency, and bounded
  memory behavior through backpressure rather than `readFile`.
- [ ] **Verify RED:** run Oracle tests; expected failure is missing adapter.
- [ ] **Minimal code:** install exact `csv-parse`; implement:

  ```ts
  loadOracleManifest(path: string): Promise<OracleSource[]>
  downloadOracleSource(source, downloader, objectStore): Promise<SourceObject>
  parseOracleCsv(stream: Readable): AsyncIterable<OracleRowGroup>
  normalizeOracleRows(rows, identityResolver, overrides): NormalizationResult
  ```

  Parse by `gameid`, require one coherent team row per side, attach player rows
  by side/team, and convert result fields to one winner. Use explicit series
  metadata when present; otherwise call the domain `groupGamesIntoSeries` and
  reject ambiguity. Generate stable source keys from provider game/series IDs,
  not array order. Apply tournament override YAML before deterministic
  classification. Stage all normalized facts under the sync run and publish
  only after row-count, winner, participant, series-completion, and source-key
  validation passes.
- [ ] **Verify GREEN:** run Oracle unit/integration tests, root typecheck/lint,
  and import the fixture with `rtk node apps/server/dist/cli.js sync --once
  --fixture oracle-small`. Expected output reports one successful unpublished-
  then-published run, deterministic counts, and no duplicated facts on retry.
- [ ] **Commit:** commit using `✨ feat(sync): import oracle esports facts`.

### Task 9: Implement Leaguepedia identity, series, media, and coverage adapter

**Files:** create all files under
`packages/sync/src/providers/leaguepedia/`, fixtures
`leaguepedia-pages.json` and `leaguepedia-series.json`,
`test/leaguepedia.test.ts`, `src/overrides.ts`, both YAML override files, and
the server `routes/media.ts` implementation.

**Why:** Leaguepedia closes identity/era/media and early-history gaps that the
bulk game feed cannot safely infer.

**Change Necessity:** canonical aliases, rebrand eras, explicit series metadata,
licensed images, and 2011–2013 coverage need a source with provenance plus
reviewed conflict resolution.

**Impact/Compatibility:** precedence is fixed: reviewed overrides, then
Leaguepedia identity/series/media, then Oracle detailed game facts. The adapter
may enrich or reconcile facts but cannot silently replace a published source
key with a different match. Media is cached before public URL publication.

**Verification:** Leaguepedia fixture tests, media route tests, and one bounded
live MediaWiki API probe pass. The source's rate limits and attribution are
documented in sync metadata.

- [ ] **Write test:** fixture API pages must cover continuation tokens, aliases,
  duplicate display names, SKT-to-T1 era evidence, an ambiguous lineage, series
  metadata, imageinfo, missing image, and a 429 response. Assert bounded retry,
  descriptive User-Agent, precedence, explicit unresolved-conflict warnings,
  cached media checksum/license/attribution, same-origin media response, 404 for
  unknown key, and rejection of arbitrary upstream URLs/path traversal.
- [ ] **Verify RED:** run Leaguepedia and server media tests; expected failure is
  missing client/normalizers/media route.
- [ ] **Minimal code:** install exact `yaml` and implement a MediaWiki client for
  the configured `api.php` endpoint. Allow `action=query` for page/imageinfo and
  `action=cargoquery` for the structured `Teams`, `Players`, `Tournaments`,
  `ScoreboardGames`, and `ScoreboardPlayers` tables; reject arbitrary actions or
  table names. Use JSON format, MediaWiki continuation/Cargo offset pagination,
  timeout, and bounded exponential retries honoring `Retry-After`. Implement:

  ```ts
  fetchLeaguepediaEntities(client, cursor): AsyncIterable<SourceEntityPage>
  fetchLeaguepediaSeries(client, range, cursor): AsyncIterable<SourceSeriesPage>
  fetchLeaguepediaMedia(client, titles): Promise<SourceMedia[]>
  normalizeLeaguepedia(input, overrides): NormalizationResult
  loadOverrides(paths): Promise<ReviewedOverrides>
  ```

  Validate YAML through Zod and checksum each file before applying it. Require an
  explicit override for ambiguous lineage/alias conflicts. Cache validated
  `image/*` bytes in object storage, store original URL/license/attribution, and
  set `is_current` transactionally. Register `GET /media/:key`; look up the key
  in PostgreSQL before streaming or issuing a short-lived redirect, set immutable
  cache headers by checksum, and fall back in the UI—not the media route—to the
  bundled neutral SVG.

  Backfill 2011–2013 in bounded year/competition pages. Write `coverage_status`
  as `complete`, `partial`, or `missing` based on verified source facts. Never
  translate no rows into complete coverage.
- [ ] **Verify GREEN:** run Leaguepedia/storage/server tests and one live API
  request limited to siteinfo plus one known page. Expected result includes
  continuation-safe fixture import, deterministic lineage/media facts, correct
  attribution, and explicit partial/missing historical coverage when evidence
  is absent.
- [ ] **Commit:** commit using `✨ feat(sync): add leaguepedia identities and media`.

### Task 10: Build the comparison selection and result experience

**Files:** create the complete `apps/web/` application except export
implementation: API client, query state, comparison form/page, result card,
series list, styles, placeholder SVG, unit tests, and the initial Playwright
comparison journey.

**Why:** users need to discover subjects, express stable filters, understand
series/game records, see portraits/logos, and share the exact query URL.

**Change Necessity:** the API contract alone does not provide the interactive
selection, filter visibility, responsive result hierarchy, or accessible data
presentation.

**Impact/Compatibility:** URL search parameters are the client source of truth;
TanStack Query caches server responses but does not own filter state. UI imports
public contracts only. Media is same-origin through `/media/:key`, with the
bundled SVG on load error.

**Verification:** web unit tests, `rtk pnpm --filter @riftversus/web build`, and
the Playwright comparison journey pass against a deterministic API fixture.

- [ ] **Write test:** assert parsing/serialization round-trips player/team/region
  subjects, date range, category, league, best-of, and team era without losing
  values; invalid URL state renders a recoverable form; debounced entity search
  is keyboard accessible; swapping sides updates the URL; result hierarchy
  renders images, series first, games second, active filters, freshness,
  coverage warnings, empty state, API error, and paginated series rows; image
  error replaces the source with `/media-placeholder.svg` once.
- [ ] **Verify RED:** run web tests; expected failure is missing application and
  components.
- [ ] **Minimal code:** install exact `react`, `react-dom`, `react-router-dom`,
  `@tanstack/react-query`, Vite React plugin, Testing Library dependencies, and
  Playwright, including direct dependencies on
  `@riftversus/contracts@workspace:*`; install React/Node test type packages as
  development dependencies. Implement canonical URL keys:

  ```text
  leftKind, leftId, leftEraId
  rightKind, rightId, rightEraId
  from, to
  events (comma-separated sorted values)
  leagues (comma-separated sorted values)
  bestOf (comma-separated sorted numeric values)
  ```

  `ComparisonForm` uses two async comboboxes and filter controls. Submit parses
  through `ComparisonQuerySchema`, writes one canonical URL, and lets
  `ComparisonPage` fetch. `ResultCard` displays the two subject images/names,
  large series record, secondary game record, win rates, filter chips, freshness,
  and coverage warning. `SeriesList` renders chronological rows and a cursor-
  based “load more” action. Use semantic headings, labels, table/list roles,
  visible focus, reduced-motion support, a high-contrast esports editorial
  palette, and responsive layout without copying another site's branding.
- [ ] **Verify GREEN:** run web tests/build and Playwright against mocked fixture
  endpoints. Expected result restores a direct T1-vs-LPL URL, shows both logos,
  and changes URL/result after applying Worlds + BO5.
- [ ] **Commit:** commit using `✨ feat(web): build comparison experience`.

### Task 11: Add deterministic browser PNG and ZIP export

**Files:** create `apps/web/src/features/export/export-result.ts`,
`ExportButton.tsx`, `test/export-result.test.tsx`; update `ResultCard` and
`ComparisonPage`; extend Playwright coverage.

**Why:** the approved save behavior is a portable visual result with subject
images and long-record splitting, not a database bookmark.

**Change Necessity:** browser print/screenshot behavior does not guarantee row
boundaries, metadata, multiple files, or ZIP packaging.

**Impact/Compatibility:** export reuses the visible result presentation and API
pagination; it does not create a server render endpoint or add Chromium to the
application image. Each page contains at most 50 series rows.

**Verification:** unit tests prove page partitioning and filenames; Playwright
captures one short PNG and one multi-page ZIP without network requests to
unapproved image hosts.

- [ ] **Write test:** mock `html-to-image` and JSZip, then assert 0 rows still
  exports the summary; 1–50 rows create one PNG; 51 and 101 rows create 2 and 3
  PNG files in one ZIP; pages preserve order and repeat header/filter/dataset
  metadata; filenames are filesystem-safe; pagination fetches until exhausted;
  export stops with a visible error above the safety cap; media placeholder and
  image load completion precede rendering; object URLs are revoked.
- [ ] **Verify RED:** run export tests; expected failure is missing exporter.
- [ ] **Minimal code:** install exact `html-to-image` and `jszip`. Implement:

  ```ts
  partitionSeries<T>(rows: T[], pageSize = 50): T[][]
  waitForExportImages(root: HTMLElement): Promise<void>
  exportComparison(input: ExportInput): Promise<ExportArtifact>
  ```

  Fetch all result pages sequentially with a hard cap of 1,000 series rows,
  partition by 50, render an off-screen but styled export root one page at a
  time, wait for same-origin images, call `toPng` with a deterministic width and
  pixel ratio, and release each temporary node/blob URL. Include subject names,
  score summaries, active filters, dataset version, and generation time on every
  page. Return one `.png` blob for one page or one `.zip` blob containing
  zero-padded `-01.png` names for multiple pages. `ExportButton` exposes progress
  and disables duplicate runs.
- [ ] **Verify GREEN:** run export tests and both Playwright export fixtures.
  Expected result is a valid PNG signature for the short fixture and ZIP entries
  of 50/50/remainder rows for the long fixture, with no Chromium dependency in
  the server package.
- [ ] **Commit:** commit using `✨ feat(export): save results as png and zip`.

### Task 12: Package local and external-service Docker deployment

**Files:** create `Dockerfile`, `compose.yaml`, `docker/entrypoint.sh`; update
`.dockerignore`, server CLI/config, S3 storage bootstrap, and create
`docs/operations.md` plus CLI/container tests.

**Why:** users need a turnkey local PostgreSQL/MinIO template and the same image
for remote PostgreSQL/S3 deployments.

**Change Necessity:** development processes do not prove production artifact
contents, command separation, health dependencies, secrets boundary, or runtime
portability.

**Impact/Compatibility:** one immutable image runs every command. Local-only
bucket creation is guarded by `S3_AUTO_CREATE_BUCKET=true`; remote default is
false. Migrations remain an explicit one-shot operation. No process supervisor
runs API and sync together.

**Verification:** Docker build/Compose commands in the plan header pass; final
image `.Size` is below 200 MB; app and sync are separate containers using the
same image ID.

- [ ] **Write test:** add CLI tests for all five commands and signal-aware
  shutdown; add a shell/container smoke test that fails when the image lacks
  SPA assets or migrations, runs as root, contains dev dependencies, exposes
  secrets in history/config summary, or makes `serve` start the scheduler. Add
  a Compose configuration assertion for `app`, `sync`, `migrate`, `postgres`,
  and `minio`, named volumes, health checks, and no host-published database/S3
  port unless explicitly configured for development.
- [ ] **Verify RED:** run `rtk docker compose config` and container tests;
  expected failure is missing Dockerfile/Compose. If Docker Desktop integration
  is unavailable, record this gate as environment-blocked and continue only
  with non-Docker static checks; do not mark Task 12 complete.
- [ ] **Minimal code:** create a multi-stage Dockerfile with dependency,
  TypeScript/Vite build, production-prune, and Node slim runtime stages. Copy
  only built server/workspace runtime files, production dependencies, web
  assets, migrations, and entrypoint. Create a non-root runtime user, install
  only CA certificates and init support required by measured shutdown behavior,
  set `NODE_ENV=production`, and make the entrypoint execute:

  ```sh
  exec node /app/apps/server/dist/cli.js "$@"
  ```

  Compose services use the same `${RIFTVERSUS_IMAGE:-riftversus:local}`:

  ```text
  app: command serve; waits for migrated PostgreSQL; HTTP health check
  sync: command sync; waits for PostgreSQL and MinIO health
  migrate: command migrate; one-shot, no restart
  postgres: PostgreSQL health check + named data volume
  minio: MinIO health check + named object volume
  ```

  Add `S3_AUTO_CREATE_BUCKET` so the storage owner performs `HeadBucket` then
  `CreateBucket` only in local mode. Document local Compose, one-shot migration,
  one-shot sync, backup/restore, graceful shutdown, and remote commands using
  external `DATABASE_URL`/S3 environment without Compose dependency services.
- [ ] **Verify GREEN:** after enabling Docker integration, run a clean build,
  Compose config, local dependency startup, migration, fixture sync, app startup,
  readiness request, same-image ID comparison, non-root inspection, and image
  size inspection. Expected result is a healthy queryable stack, separate
  process ownership, persistent named volumes, and image size below 200 MB.
- [ ] **Commit:** commit using `🐳 docker: package portable application stack`.

### Task 13: Verify historical acceptance, performance, attribution, and handoff

**Files:** create `docs/README.md`, `docs/data-sources.md`,
`docs/attribution.md`, an acceptance fixture under
`packages/database/test/fixtures/acceptance/`, a comparison acceptance test,
query-plan tests, and final Playwright coverage; update the root `README.md` if
one is created during execution.

**Why:** a functioning scaffold is not sufficient; the motivating comparison,
coverage truth, source attribution, latency/index budgets, and deploy workflow
must be evidenced with reviewed data.

**Change Necessity:** provider fixtures prove mechanics but not real historical
identity/series correctness. A reviewed immutable acceptance snapshot is the
minimum regression authority.

**Impact/Compatibility:** acceptance data records source object checksums and
dataset version. It tests the generic comparison contract; it does not hard-code
“undefeated” into production logic. Missing historical coverage remains visible
rather than being replaced by synthetic rows.

**Verification:** all root verification commands pass; T1 versus LPL at Worlds
BO5 agrees with manually reviewed source rows for the pinned dataset; query
latency/index budgets and image budget are recorded; documentation contains no
secret or unsupported completeness claim.

- [ ] **Write test:** create an acceptance assertion that loads the reviewed
  snapshot, queries T1 lineage versus LPL region with Worlds and BO5, and checks
  subject resolution, both logos, series/game totals, chronological rows,
  source checksums, dataset version, and any coverage warning. Add query-plan
  budget tests for entity search and comparison, and Playwright coverage for
  shareable URL, long export, missing media, API error, and mobile viewport.
- [ ] **Verify RED:** run acceptance, query-plan, and end-to-end tests before
  creating the reviewed snapshot; expected failure is missing acceptance
  evidence rather than an invented expected score.
- [ ] **Minimal code:** run backfill for verified tier-one sources from 2011
  through the current season; export only the canonical rows and source
  checksums needed for the acceptance fixture; independently compare the T1/LPL
  Worlds BO5 series list against Leaguepedia pages and Oracle rows; record the
  reviewed expected totals in the fixture with review date and source links.
  If sources disagree, preserve both provenance records, add a reviewed YAML
  override only when evidence resolves the conflict, and rerun normalization.
  If evidence cannot resolve it, publish a coverage/conflict warning and do not
  assert “undefeated.”

  Write documentation covering architecture, quick start, filters/semantics,
  team lineage, data freshness/coverage, source terms/attribution, override
  review, migrations, local/remote deployment, backup/restore, sync recovery,
  resource measurement, and known source gaps. Measure:

  ```bash
  rtk pnpm test
  rtk pnpm build
  rtk pnpm test:e2e
  rtk docker image inspect riftversus:local
  rtk docker stats --no-stream
  ```

  Record final image bytes and observed idle/request RSS as environment-specific
  evidence; only the approved image budget is a release gate.
- [ ] **Verify GREEN:** run every plan-header command on a clean checkout and
  fresh volumes; confirm the acceptance snapshot, coverage metadata, API ETag,
  PNG/ZIP outputs, image size, query plans, and documentation. Expected result
  is no hidden historical gap and no claim stronger than the pinned evidence.
- [ ] **Commit:** commit using `🧪 test: verify historical comparison release`.

## Ripple Signal Triage

Every public contract/schema change affects web parsing, API validation,
repository DTOs, fixtures, and Playwright mocks. Every canonical schema change
affects migrations, sync normalization, comparison SQL, acceptance snapshots,
and backup/restore documentation. Provider-only raw fields do not ripple beyond
`packages/sync` unless promoted through an approved normalized contract.

Required expanded verification after a ripple:

```bash
rtk pnpm --filter @riftversus/contracts test
rtk pnpm --filter @riftversus/domain test
rtk pnpm --filter @riftversus/database test:integration
rtk pnpm --filter @riftversus/server test
rtk pnpm --filter @riftversus/web test
rtk pnpm typecheck
```

## Spec Coverage Matrix

| Design Spec surface | Owning tasks |
| --- | --- |
| Cross-kind opposing-side semantics | 2, 4, 5 |
| Filters, URL state, result hierarchy | 2, 5, 6, 10 |
| Team lineage, era, match-time region | 3, 4, 5, 9 |
| Series-first/game-second records | 4, 5, 10 |
| Oracle daily and historical facts | 7, 8, 13 |
| Leaguepedia identities, media, early history | 9, 13 |
| Provenance, coverage, atomic publication | 3, 5, 7–9, 13 |
| PNG split/ZIP export | 10–11 |
| Local and external database/storage modes | 2, 7, 12 |
| One image, separate API/sync processes | 1, 6–8, 12 |
| Security, health, failure behavior | 2, 5–9, 12 |
| T1 versus LPL acceptance | 10–11, 13 |

## Risks and Stop Conditions

- **Oracle access changes:** stop Task 7 if stable authorized public file access
  cannot be proven. Ask for an approved source or credentials; do not scrape
  authentication/challenge pages.
- **Leaguepedia terms/API changes:** stop affected live import, retain the last
  published dataset, and update the provider evidence/Design Spec before adding
  a new host or API.
- **Ambiguous identity/series:** do not publish the affected facts. Require a
  reviewed override or report partial/conflict coverage.
- **Schema drift:** retain raw object/checksum, fail validation, and keep the old
  dataset version current.
- **Query budget failure:** inspect plans/indexes and reduce query scope before
  proposing Redis or precomputed matrices.
- **Export memory failure:** keep sequential 50-row pages and 1,000-row safety
  cap; do not add server Chromium without a new design decision.
- **Docker unavailable:** Tasks 1–11 may gather non-Docker evidence, but Task 12
  and the clean-stack portion of Task 13 cannot complete until Docker works.
- **Design drift:** any new provider, public endpoint, persistence owner,
  fallback, auth/account feature, or backend language returns to design review.

## Rollback and Retirement

- Before first deployment, rollback is Git revert plus fresh local volumes.
- After persisted data exists, application rollback must use a version whose
  migrations are compatible with the deployed schema; destructive down
  migrations are not a production recovery strategy.
- Routine sync failure rolls back its transaction and leaves the previous
  canonical facts/version active. Repairing already-published bad source data
  replays retained source objects plus reviewed overrides in a new corrective
  publication; it does not pretend an old version row contains a full snapshot.
- The retired D1, Worker, SQLite, Rust, mixed-service, runtime-scraping, Redis,
  and server-Chromium paths have no code or compatibility adapter to preserve.
- Fixture-only source access helpers are removed if production access is proven
  through the manifest; they may not become a second production provider.
- ADR signals from the Design Spec are evaluated after Tasks 12–13 provide
  implementation evidence; planning intent alone does not create accepted ADRs.

## Execution Readiness View

- **Intent Lock:** build only the approved first-release comparison, ingestion,
  export, and Docker behavior.
- **Scope Fence:** no accounts, bookmarks, live games, predictions, champion
  analytics, secondary-league completeness, admin CMS, Redis, D1, Rust, or
  server-side browser.
- **Baseline Lock:** governance plus the approved 2026-07-12 Design Spec.
- **Approved Behavior:** opposing-side cross-kind comparisons, series primary,
  games secondary, filters/lineage, media, daily sync, coverage visibility,
  PNG/ZIP export, local/remote PostgreSQL/S3 deployment.
- **Owner/Contract Constraints:** contracts own wire shapes; domain owns meaning;
  database owns canonical facts; sync owns upstream normalization; server owns
  HTTP/CLI composition; web owns URL state/presentation/export.
- **Compatibility Boundary:** one migration/storage/API contract across local
  and remote modes; failed sync never displaces published truth.
- **Retirement Boundary:** old architecture alternatives remain absent; no
  compatibility carrier is justified because no deployed implementation exists.
- **Task Batches:** foundation 1–3; semantics/API 4–6; ingestion/media 7–9;
  UX/export 10–11; deployment/acceptance 12–13.
- **Test Obligations:** RED/GREEN per task, batch-wide type/lint/build, domain-SQL
  equivalence, provider fixture/live probes, Playwright, Docker clean-stack,
  historical acceptance.
- **Review Gates:** after Task 3 schema, Task 6 public API, Task 9 provider
  precedence/coverage, Task 11 export, and Task 13 release evidence.
- **Drift/Rewind Rules:** contract/owner/schema drift returns to the approved
  spec and plan; source access failure stops at Task 7/9; incorrect semantics
  rewinds to Task 4 rather than patching SQL/UI.
- **Evidence Required Before Completion:** exact verification outputs, source
  checksums/coverage, query-plan evidence, PNG/ZIP files, Docker image identity
  and size, clean deployment health, architecture review.
- **Advisory Boundary:** this is method-pack execution guidance, not a
  `GateDecision`, `PolicySnapshot`, or completion authority.

## Execution Order

Execute one task at a time and commit only after its GREEN verification. Run the
batch-wide commands before crossing each review gate. Do not combine Tasks 7–9
into one import manager or Tasks 10–11 into one untestable component. If a task
cannot reach its stated evidence, leave it uncommitted, report the exact gate,
and continue only where dependencies permit meaningful progress.
