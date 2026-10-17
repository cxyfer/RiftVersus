# Operations

## Current Production

Production uses [GitHub Pages/Actions publishing](github-publishing.md), private
checkpoint Releases and SQLite/SQL.js-HTTPVFS. The daily and weekly schedules
are owned only by `publish.yml`. Use its manual modes for sync, rebuild and
website rollback. Checkpoint restore instructions are in [checkpoints](checkpoints.md).

For local data tools, configure `.env` for a filesystem ObjectStore and a
disposable PostgreSQL database. The `tools` profile starts only PostgreSQL:

```sh
docker compose --profile tools up -d postgres
pnpm install --frozen-lockfile
pnpm build
pnpm data --help
```

The `legacy-recovery` profile additionally exposes the retained MinIO service
inside the Compose network, with existing named-volume definitions. Select the
original Compose project name explicitly when accessing retained volumes.
Neither profile starts an application or scheduled writer. No volume cleanup
is part of migration or recovery. Restore checkpoints into a fresh empty
database and filesystem directory, never over the retained original state.

## Historical Runtime Records

The remaining sections record previous stack operations and source mapping
evidence. Application images/commands below belong to their recorded Git
revision; they are not executable production entrypoints in the migrated
checkout. Existing containers, PostgreSQL/MinIO volumes and independent backups
remain retained. Current operators should use the GitHub runbook above.

## Local Compose quick start

Copy `.env.example` to `.env`, replace every `change-me` value, and insert the
currently reviewed Leaguepedia endpoint/media hosts. Database and object-store
ports are intentionally private to the Compose network; only the application
port is published.

```bash
docker compose build
docker compose up -d postgres minio
docker compose run --rm migrate
docker compose run --rm sync sync --once --fixture leaguepedia-small
docker compose up -d app sync
curl --fail http://localhost:3000/health/ready
```

The synthetic fixture checks plumbing only. It is not historical acceptance
evidence. `S3_AUTO_CREATE_BUCKET=true` is accepted only for the local
`minio`/loopback endpoint. Create remote buckets separately and leave the flag
false.

## 2026-07-16 local historical stack deployment record

This run established a local, live Leaguepedia stack with Worlds 2013-2025 and
MSI 2015-2026. MSI 2020 is intentionally absent because the event was
cancelled. MSI 2017-2019 uses the exact `Main Event` source keys; later MSI
years use the complete event source key available from Leaguepedia.

This is an operator record for a local deployment, not a signed release or a
replacement for the reviewed release acceptance snapshot. Commands below are
repository-root relative and omit the local `rtk` command wrapper used by the
recording environment.

### Scope and reviewed source mappings

The live run used these logical-to-source mappings in
`LEAGUEPEDIA_COMPETITION_MAP`:

- Worlds 2013: `Worlds Season 3`;
- Worlds 2014-2016: `Worlds YYYY`;
- Worlds 2017-2023 and 2025: `Worlds YYYY Main Event`;
- Worlds 2024: `Worlds 2024 Main Event`;
- MSI 2015-2016: `MSI YYYY`;
- MSI 2017-2019: `MSI YYYY Main Event`;
- MSI 2021-2026: `MSI YYYY`.

Before importing, review the current source pages and update the mapping rather
than guessing a source key. The run also added explicit reviewed era boundaries
for these official rename lineages:

| Canonical team | Source era | Validity used by the import |
| --- | --- | --- |
| Saigon Buffalo | Phong Vũ Buffalo | through 2019-05-30 |
| Saigon Buffalo | Saigon Buffalo | from 2020-05-25 |
| LYON | Movistar R7 | through 2024-10-30 |
| LYON | LYON | from 2024-10-31 |
| Movistar KOI | Splyce | through 2019-11-28 |
| Movistar KOI | MAD Lions KOI | 2019-11-29 through 2024-12-05 |
| Movistar KOI | Movistar KOI | from 2024-12-06 |

The reviewed evidence is recorded with page/revision notes in
`data/overrides/identities.yaml`. The relevant current Leaguepedia timelines
are [Saigon Buffalo](https://lol.fandom.com/wiki/Saigon_Buffalo),
[Movistar R7](https://lol.fandom.com/wiki/Movistar_R7),
[LYON](https://lol.fandom.com/wiki/LYON_%282024_American_Team%29), and
[MAD Lions KOI](https://lol.fandom.com/wiki/MAD_Lions_KOI).

### Build and initialize a clean stack

Use an isolated Compose project when reviewed identity rules change. Published
entities, aliases, and eras are immutable, so applying a new canonical merge to
an existing database is expected to fail closed. The one deliberate exception is
a player real name: `canonical_name` follows a corrected value — an upstream
`Players.Name` or a reviewed `canonicalName` override — when a public ID anchors
the identity on both sides, while the published slug and every other identity
surface stay fixed. See
[Player real-name corrections](#player-real-name-corrections).

```bash
export COMPOSE_PROJECT_NAME=riftversus-complete-2013-2026

docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml build app
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml up -d postgres minio
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml run --rm migrate
```

The migration job must report migrations `001` through `014` as successful.
Migration `009` additively introduces nullable `entities.player_id` and its
search index/constraint; it does not delete or rewrite facts, entities, media,
or source objects. Existing players remain readable through the documented real
name fallback until a successful fresh Leaguepedia publication populates their
public IDs.
Building `app` produces the shared `riftversus:local` image used by `app`,
`sync`, and `migrate`.

For an existing retained stack, record the running container/image IDs, current
dataset version, applied migration names, and a backup/rollback location before
building or migrating. Then apply the additive migration and publish through
the normal live provider path:

```bash
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml build app
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml run --rm migrate
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml run --rm sync sync --once
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml up -d --no-build --force-recreate app
```

Do not use a fixture for release publication. A failed migration or provider
run must be investigated without resetting, truncating, dropping, or deleting
persistent database rows, named volumes, or object-store objects. Publication
is atomic: a failed run retains the previously visible generation, which is the
non-destructive rollback while the source/configuration problem is corrected.

### Player real-name corrections

A player's real name is descriptive, so publication adopts a corrected value
instead of failing closed, provided both the published row and the incoming
entity carry a non-null `entities.player_id`. The competitive ID, the published
slug, and the `entity_public_ids` route key never move, and the superseded name
stays searchable through the append-only `entity_aliases` row that the previous
publication wrote.

Two cases still stop publication, and both need an operator:

- **A conflicting non-null public ID.** The public ID is the identity; review
  `data/overrides/identities.yaml` before changing it.
- **A legacy row whose `entities.player_id` is still `NULL`.** The guard fails
  closed, the transaction rolls back, and the same conflict recurs on every run:
  the `player_id` coalesce never commits, so the row cannot bootstrap itself out
  of the legacy state. Confirm the row, then resolve it deliberately rather than
  by editing published rows:

  ```sql
  select id, kind, canonical_name, player_id, slug from entities
  where provider = 'leaguepedia' and player_id is null and kind = 'player';
  ```

  Either revert the upstream name so the pending correction disappears, or add a
  reviewed identity override that pins the published `canonicalName` and
  `canonicalId` for that source key. Do not hand-write `canonical_name`.

A brand-new entity still needs a slug, but a name with no ASCII alphanumerics
(for example a CJK-only real name) falls back to an opaque
`entity-<canonical-id>` slug instead of aborting the publication. `slug` is only
a search surface, and the name, its aliases, and the public ID all remain
searchable. An already published entity is unaffected because its slug is never
re-derived. Entity names are rejected when they are empty, contain control
characters, or exceed 120 characters; migration `014` enforces the same bound in
the database.

Leaguepedia occasionally HTML-encodes `Players.Name`, including the double
encoded `&amp;nbsp;` that used to reach the site as literal text. Only the
free-text player real name is decoded (character references, then whitespace
collapse); team names stay untouched because they are reviewed identity pinned
by `identities.yaml` and by the exact `canonicalName` that `media.json` binds a
logo to.

### Import Worlds and MSI

Publish Worlds first so its known count can act as a baseline, then publish MSI
into the same clean database. Both commands use the same fail-closed sync and
publication path.

```bash
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml run --rm sync \
  backfill \
  --year 2013 --year 2014 --year 2015 --year 2016 --year 2017 \
  --year 2018 --year 2019 --year 2020 --year 2021 --year 2022 \
  --year 2023 --year 2024 --year 2025 \
  --competition Worlds

docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml run --rm sync \
  backfill \
  --year 2015 --year 2016 --year 2017 --year 2018 --year 2019 \
  --year 2021 --year 2022 --year 2023 --year 2024 --year 2025 \
  --year 2026 \
  --competition MSI
```

Do not add MSI 2020 as a synthetic zero-row event. A cancelled or nonexistent
event has no source mapping and should not be represented as complete coverage.

### Database verification

Verify active fact counts, generation coverage, retirement state, and team-era
overlap before starting the HTTP process:

```bash
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml exec -T postgres \
  psql -U riftversus -d riftversus -P pager=off -c \
  "select t.category, count(distinct s.id) as series, count(g.id) as games
   from tournaments t
   join series_facts s on s.tournament_id = t.id
   join game_facts g on g.series_id = s.id
   where s.retired_generation is null and g.retired_generation is null
   group by t.category order by t.category;"

docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml exec -T postgres \
  psql -U riftversus -d riftversus -P pager=off -c \
  "select dv.generation, c.competition,
          count(*) filter (where c.status = 'complete') as complete_years,
          count(*) as total_years,
          min(c.season_year) as first_year,
          max(c.season_year) as last_year
   from dataset_versions dv
   join coverage_status c on c.dataset_version_id = dv.id
   group by dv.generation, c.competition
   order by dv.generation;"

docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml exec -T postgres \
  psql -U riftversus -d riftversus -P pager=off -c \
  "select count(*) as overlapping_team_era_pairs
   from team_eras a
   join team_eras b on b.team_entity_id = a.team_entity_id and b.id > a.id
   where coalesce(a.valid_from, '-infinity'::date) <= coalesce(b.valid_to, 'infinity'::date)
     and coalesce(b.valid_from, '-infinity'::date) <= coalesce(a.valid_to, 'infinity'::date);"
```

The recorded run produced:

| Dataset | Complete years | Series | Games |
| --- | ---: | ---: | ---: |
| Worlds 2013-2025 | 13/13 | 686 | 1,005 |
| MSI 2015-2019 and 2021-2026 | 11/11 | 380 | 659 |
| MSI 2026 only | 1/1 | 20 | 71 |

Additional database checks returned zero retired series, zero retired games,
and zero overlapping team-era pairs. The published versions were:

- Worlds generation 1:
  `leaguepedia-355e88d369c654f9f4b3e075a751c2a282c3ef4b15b045ae206848861eb32188`;
- MSI generation 2:
  `leaguepedia-a7938870a47288faa79c1e4fdd2b175535c0629f12575555139fbd05ce61284d`.

### Start and verify the preview

Only the HTTP application was started for this local preview. The scheduled
`sync` service remained stopped so an unreviewed schedule could not alter the
historical stack.

```bash
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml up -d --no-build app
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml ps

curl --fail --silent --show-error http://127.0.0.1:3001/health/ready
curl --fail --silent --show-error http://127.0.0.1:3001/api/dataset
curl --fail --silent --show-error http://127.0.0.1:3001/api/filters
```

The recorded deployment exposed `http://localhost:3001`, reported all three
containers healthy, and returned dataset coverage from `2015-05-07` through
`2026-07-12`. `/api/filters` listed both `msi` and `worlds`, including
`MSI 2026`.

### Failures encountered and recovery decisions

1. Docker was initially unavailable. No deployment commands were retried until
   the daemon was running and responsive.
2. Sequential Worlds/MSI imports inferred different team-era dates for
   Movistar KOI and Saigon Buffalo. Exact reviewed dates replaced the
   scope-dependent inference; the importer was not weakened.
3. MSI 2026 introduced the official `Movistar R7 -> LYON` lineage. Because an
   earlier database had already published Movistar R7 under another immutable
   identity, the final run used a new Compose project and clean named volumes.
4. A retained failed snapshot and its successful retry used different source
   keys for the same content-addressed object. `recordSourceObjectWithId` was
   made idempotent by object key while still requiring provider, checksum,
   content type, byte size, and parser version to match. The retry path is
   covered by a PostgreSQL integration test.
5. Failed imports never advanced the visible dataset generation. Previously
   published Worlds/MSI generations remained available until the clean stack
   passed all checks.

No prior named volumes were deleted during this work. The final active project
is `riftversus-complete-2013-2026`; earlier diagnostic projects were stopped and
retained as rollback evidence. A temporary pre-MSI checkpoint was also created
at `/tmp/riftversus-worlds-before-msi.dump` with a matching MinIO copy at
`/tmp/riftversus-worlds-before-msi-minio`. Because `/tmp` is not durable backup
storage, move or recreate these backups before relying on them for recovery.

### Verification recorded for this run

- `pnpm test:workspace`: 389 tests passed;
- `TEST_DATABASE_URL=... pnpm test:integration`: 40 tests passed;
- `pnpm typecheck`: passed;
- `pnpm lint`: passed;
- production Docker build and runtime artifact pruning: passed;
- Compose `app`, PostgreSQL, and MinIO health checks: passed;
- database fact, coverage, retirement, and era-overlap checks: passed;
- HTTP readiness, dataset, filters, and entity-search probes: passed.

The root `pnpm test` source-retirement guard could not execute in the recording
workspace because `.git` was an empty directory and `git ls-files` rejected the
checkout. Restore real Git metadata and rerun the root command before treating
this local deployment record as release evidence.

## Preflight

Set all required PostgreSQL, S3, and Leaguepedia variables from
`.env.example`. Verify that the selected endpoint is the currently reviewed
official MediaWiki API. These probes are deliberately limited to metadata and
one known page; they are not a bulk import:

```bash
curl --fail --silent --show-error --max-time 15 \
  --user-agent "$LEAGUEPEDIA_USER_AGENT" \
  "$LEAGUEPEDIA_ENDPOINT?action=query&meta=siteinfo&format=json&formatversion=2"

curl --fail --silent --show-error --max-time 15 \
  --user-agent "$LEAGUEPEDIA_USER_AGENT" \
  "$LEAGUEPEDIA_ENDPOINT?action=query&prop=info%7Crevisions&rvprop=ids%7Ctimestamp&titles=T1&format=json&formatversion=2"
```

Do not approve the endpoint when either response is non-JSON, requires
authentication unexpectedly, redirects to an unrelated host, or omits the
expected site/page fields. Review observed media hosts separately before
adding them to `LEAGUEPEDIA_MEDIA_HOSTS`.

## Commands

Build before invoking the CLI:

```bash
pnpm build
node apps/server/dist/cli.js migrate
node apps/server/dist/cli.js serve
node apps/server/dist/cli.js sync
node apps/server/dist/cli.js sync --once
node apps/server/dist/cli.js backfill --year 2024 --competition Worlds
node apps/server/dist/cli.js sync --once --fixture leaguepedia-small
node apps/server/dist/cli.js backfill --year 2024 --competition Worlds --fixture leaguepedia-small
```

`serve` starts only the HTTP server. It never schedules or performs an import.
`sync` is the long-running scheduled process using `SYNC_CRON` and
`SYNC_TIMEZONE`; it prevents overlapping ticks and reports rejected runs.
`sync --once` and `backfill` execute the same provider-neutral runner once.
Run scheduled sync and HTTP serving as separate processes/containers.

### Automatic refresh and freshness checks

The `sync` process owns both schedules. Configure these runtime variables:

```dotenv
SYNC_CRON=0 3 * * *
SYNC_TIMEZONE=UTC
SYNC_HISTORY_CRON=0 5 * * 0
SYNC_RUN_ON_START=true
SYNC_MAX_AGE_HOURS=36
SYNC_HISTORY_MAX_AGE_HOURS=192
SYNC_FAILURE_THRESHOLD=3
LEAGUEPEDIA_SYNC_YEARS=2026
LEAGUEPEDIA_SYNC_COMPETITIONS=MSI
```

This runs the active scope daily at 11:00 Asia/Taipei and historical refresh
on Sundays at 13:00 Asia/Taipei. Leave `SYNC_HISTORY_CRON` unset to disable
history. The history job takes only explicitly mapped years older than the
oldest active sync year, grouped by competition (at most 20 years per group).
Thus an absent MSI 2020 mapping is not invented, and future mappings are not
implicitly activated. Review `LEAGUEPEDIA_COMPETITION_MAP` and overrides before
adding a new competition/year; years do not advance automatically.

`SYNC_RUN_ON_START=true` performs one current refresh after startup. It does not
replay missed cron ticks or run the entire historical job on every restart.
Current and historical ticks cannot overlap within the scheduler; a busy tick
is logged and skipped. The database provider lock also protects against other
processes. History continues remaining groups after a group failure, then
reports batch failure. Shutdown stops new groups and waits for the active one;
Compose allows ten minutes before forced termination.

Before enabling the schedules, validate both paths using the same image/env:

```bash
docker compose run --rm --no-deps sync sync --once
docker compose run --rm --no-deps sync sync --history-once
docker compose up -d --no-deps app sync
docker compose exec -T sync node apps/server/dist/cli.js sync-health
docker compose logs --since 24h --timestamps sync
curl --fail http://localhost:3001/health/sync
```

Use the deployment's existing Compose project name (`-p`) and port. The local
historical stack uses `-p riftversus-complete-2013-2026`. Never start a second
project against new volumes by accidentally omitting that name.

`/health/sync` returns 200 only when all configured current/history scopes have
fresh, complete coverage and neither enabled mode has reached the consecutive
failure threshold. Otherwise it returns 503, including per-scope check times,
coverage and mode failure counts. Successful unchanged checks refresh the
scope timestamp. A fresh historical check cannot hide stale current data.
Failure counts are consecutive failed database runs per mode, reset by that
mode's next success; scope age remains independently enforced. No raw upstream
errors or credentials are exposed by this endpoint.

The same check runs in Docker every five minutes after a ten-minute startup
grace period. `unhealthy` is an observable alert signal, not a Docker restart
policy or an email/webhook notification. Wire HTTP 503 or container health to
the operator's monitoring system for external delivery. `/health/ready`
continues to describe HTTP availability so stale retained data remains usable.

`sync_result` logs include mode, outcome, dataset version and elapsed
milliseconds. The importer still reads bounded snapshots and shared dimension
tables; this is not incremental ingestion. Measure real durations before
increasing frequency. Dataset coverage is the latest retained status for each
competition/year, rather than just the most recently updated group.

### League mapping workflow

Leaguepedia's `Tournament` field is an exact source key. A logical competition
and year may map to one key or to an array of keys when the year contains
separate Spring, Summer, Playoffs, Championship, or Regional Finals events.
Each key becomes a bounded slice; coverage is aggregated by logical
competition/year and publication keeps the source scope for retirement.

Before adding a league to the automatic schedule:

1. Use the Leaguepedia tournament page and Cargo data to verify every exact
   `Tournament` value, including historical renames such as EU LCS/LCS.
2. Add the reviewed key(s) to `LEAGUEPEDIA_COMPETITION_MAP`. Use an array for
   multiple split/playoff keys, for example:

   ```json
   {"LCK":{"2024":["LCK 2024 Spring","LCK 2024 Spring Playoffs","LCK 2024 Summer","LCK 2024 Summer Playoffs"]}}
   ```

3. Set the audit scope with `LEAGUEPEDIA_MAPPING_COMPETITIONS` and
   `LEAGUEPEDIA_MAPPING_YEARS`, then run:

   ```bash
   docker compose run --rm --no-deps sync sync-map-check
   ```

   The command exits nonzero and lists every missing competition/year pair.
   It does not contact Leaguepedia and never treats an empty mapping as valid.
4. Run a bounded import for one year, inspect `coverage_status` for complete
   coverage and unresolved rows, then expand the mapping year by year.
5. Add only verified mappings to the scheduled `LEAGUEPEDIA_SYNC_COMPETITIONS`
   set. A missing source key fails before a sync run opens; a source returning
   no games remains visible as missing/partial coverage.

The current deployment's audit scope is `LCK,LPL,LEC,LCS,MSI,Worlds` for
2011-2026. Its active data map is intentionally incomplete: Worlds starts in
2013, MSI has no 2020 event, and regional-league split/playoff keys have not
yet been reviewed. Run `sync-map-check` before claiming full 2011-2026 league
coverage. This explicit gate prevents guessed page names from entering the
canonical publication.

Release browser tests keep the reviewed historical match expectations, but
compare version metadata and export names against the current API publication.
Run them without a concurrent publication. The separate `acceptance:check`
still verifies the pinned source/revision snapshot; a browser pass does not
renew that historical provenance evidence.

### 2026-09-13 container-owned refresh deployment

The existing `riftversus-complete-2013-2026` project now runs the dedicated
`sync` service alongside app, PostgreSQL and MinIO. No host scheduler or LLM
agent is part of recurring execution. Both app and sync use
`riftversus:scheduled-refresh-20260913`, image ID
`sha256:b6dbce31d4049685fac8e91a90c2f5b4613921def129dd813c24a73bfb9ea7b6`,
with `restart: unless-stopped`. Local `.env` pins that image, daily MSI 2026,
and the daily/weekly UTC schedules documented above.

Before publishing, the live PostgreSQL database was backed up to
`/tmp/riftversus-before-scheduled-refresh-20260913.dump`, SHA-256
`7a97c431586cc98a0cde0c9f40656b5735c0d863eecedf55a309d7c1f4ab3e94`.
No live volumes or source objects were deleted and no schema migration was
needed. The temporary PostgreSQL test container and its volume were removed.

Initial live verification, before starting the resident scheduler:

| Scope | Outcome | Duration | Generation |
| --- | --- | --- | --- |
| MSI 2026 | complete | 157.254 seconds | 5 |
| Worlds 2013-2025 | 13 complete years | 223.995 seconds | 6 |
| MSI 2015-2025, excluding unmapped 2020 | 10 complete years | 197.673 seconds | 7 |

The current-scope snapshot retained 156 API responses (not a count of retries)
and 8,417,327 bytes. Active facts remained 1,066 series and 1,664 games.
`/health/sync` returned HTTP 200 with 24/24 fresh complete scopes and zero
consecutive failures. `/api/dataset` retained coverage from 2013-09-15 through
2026-07-12, despite the final job updating only historical MSI.

Validation passed: `pnpm test` (503 tests plus consumer checks), real
PostgreSQL integration (64 tests, no skips), typecheck, lint, Docker build and
production browser E2E (4 tests). The final coverage-query adjustment also
passed 25 targeted PostgreSQL tests. Both app and sync reported Docker
`healthy` on the same image. The scheduler emitted `sync_started` itself on
startup and logged the daily and historical cron registrations.
Its independently triggered startup run then completed as `unchanged` in
156,666 ms and advanced MSI 2026's successful check time to
`2026-09-13T15:13:20.993Z`. HTTP sync health stayed 200 with all 24 scopes fresh.
This verifies container-owned execution and unchanged-run freshness without
issuing a one-off sync command to the resident container.

Rebuild/recreate using the same project and retain the private `.env`:

```bash
docker build --target production -t riftversus:scheduled-refresh-20260913 .
docker compose -p riftversus-complete-2013-2026 up -d --no-deps app sync
```

This command is deployment maintenance, not a recurring update requirement.
Normal daily/weekly refresh is entirely inside the running sync container.

## Shutdown and recovery

`docker compose stop app sync` sends the containers a termination signal. The
entrypoint uses `exec`, so the Node processes receive it directly; the HTTP
server closes its listener/database and the scheduler stops accepting ticks
before exit. A failed import retains the previous published generation. Inspect
logs, correct the source/configuration problem, then rerun `sync --once` before
restarting the schedule.

## PostgreSQL backup and restore

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > riftversus.dump
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < riftversus.dump
```

Stop `app` and `sync` during a destructive restore. Back up the S3/MinIO bucket
with the provider's versioned replication or object-copy tooling; database rows
refer to immutable object keys, so restore both systems to a consistent point.

## Release evidence gate

```bash
pnpm acceptance:check
pnpm test:runtime-artifact
RIFTVERSUS_E2E_BASE_URL=http://127.0.0.1:3000 pnpm test:e2e:release
docker image inspect riftversus:local --format '{{.Size}}'
docker stats --no-stream
```

`acceptance:check` requires the deployment's PostgreSQL and ObjectStore runtime
configuration. It queries the canonical comparison, verifies licensed retained
media or canonical generated-avatar bytes for each subject, and re-hashes
registered immutable source objects. It exits non-zero until the
reviewed snapshot records page/revision IDs, retrieval timestamps, raw
checksums, exact series/game IDs, publication-generation source lineage,
same-origin presentation identity/checksums/content types, attribution,
complete coverage, all
resolved series, and independent review metadata. Record actual image bytes, idle/request RSS, query plans, and
Playwright results; never fill these fields with estimates.

`test:e2e:release` requires an already-running production/Docker deployment and
does not start the development mock server. Its main path reads the reviewed
snapshot IDs but queries the deployment's real HTTP API for the 12-0 series and
36-9 game record. Separate browser cases exercise missing-media recovery, HTTP
503 presentation, and a 390x844 mobile viewport. Keep `test:e2e` as the fast
mock-backed PNG/ZIP regression suite; it is not release evidence.

### Official historical stack benchmark sample

The following retained-data and API benchmark sample was measured read-only on
`2026-07-15T11:01:04.436Z` through `2026-07-15T11:01:05.697Z`. The environment
was Linux `5.15.167.4-microsoft-standard-WSL2` on `x86_64`, application image
`sha256:03bf367a2357eec67d5df48c2bd29cb2ff3f391182f6a43f932d126cdcb1dd48`,
Node.js `v24.12.0`, and PostgreSQL `17.10`:

That image identifies the benchmark environment only; it is not the signed
release artifact. Because this document is copied into the image, embedding
the image's own final digest here would create a circular, unstable build.
Record the authoritative signed image digest, exact byte size, snapshot hash,
and final RSS in the external release evidence produced by the verification
workflow.

- PostgreSQL `pg_database_size(current_database())`: `17,069,747` bytes.
- `source_objects`: `6` retained immutable rows totalling `52,966,661` bytes.
- `media_objects`: `0` rows and `0` bytes. Generated avatars are recomputable
  presentation and are not persisted media.
- MinIO bucket: `6` actual objects totalling `52,966,661` bytes, matching the
  retained source-object metadata count and byte sum. The accepted publication
  generation's exact raw lineage remains pinned separately in the acceptance
  snapshot; these figures measure all raw objects currently retained by this
  stack.

API latency was sampled sequentially from the WSL2 host to the published
`127.0.0.1:3001` container port. Each endpoint received 5 warm-up requests and
50 measured requests. Every response body was fully consumed, all 50 measured
responses returned HTTP 200, and p95 uses the nearest-rank method:

| Request | Response | p95 | Runtime budget | Result |
| --- | --- | ---: | ---: | --- |
| `GET /api/entities?q=T1&kinds=team&limit=10` | 464 bytes | 9.533 ms | 150 ms | pass |
| reviewed T1-versus-LPL Worlds BO5 `GET /api/comparisons` with `limit=50` | 4,204 bytes; 12 rows, 12-0 series, 36-9 games | 18.215 ms | 500 ms summary / 750 ms first page | pass / pass |

The comparison summary and first page are returned in that single measured API
response, so the same p95 is compared with both budgets. These database,
object-store, and latency figures describe this retained dataset, image, host,
and warm-cache measurement only; they are not portable capacity claims.

Measure the application process itself after the Compose `app` service is
healthy. Let the stack sit without requests before the first command, then run
the reviewed comparison once and sample immediately again:

```bash
docker compose ps app
app_rss() {
  docker compose exec -T app sh -c '
    found=0
    for cmdline in /proc/[0-9]*/cmdline; do
      command=$(tr "\0" " " < "$cmdline")
      case "$command" in
        "node /app/apps/server/dist/cli.js serve "*)
          grep "^VmRSS:" "${cmdline%/cmdline}/status"
          found=$((found + 1))
          ;;
      esac
    done
    test "$found" -eq 1
  '
}
app_rss
curl --fail --output /dev/null 'http://127.0.0.1:3000/api/comparisons?left.kind=team&left.id=11111111-1111-5111-8111-111111111111&right.kind=region&right.id=33333333-3333-5333-8333-333333333333&from=2013-01-01&to=2025-12-31&eventCategories=worlds&bestOf=5&limit=50'
app_rss
```

Record the image digest, host/runtime, timestamp, idle `VmRSS`, and post-request
`VmRSS` with the release evidence. These instantaneous values describe that
environment only; they are not a portable peak-memory claim. The commands read
only process status and the public comparison endpoint, not runtime secrets.

`test:runtime-artifact` is a non-Docker static preflight. It deploys production
dependencies to a temporary directory, removes source/tests/declarations/maps,
and checks compiled CLI and migration artifacts. Its directory size is not an
image-size measurement and it does not replace Compose/container smoke tests.
A release remains blocked until Docker, PostgreSQL, the official reviewed
snapshot, query plans, final image bytes, and idle/request RSS all have fresh
external evidence. Do not infer the current signed artifact from the benchmark
image shown above.

## Retry and resource budgets

Each API request has a 10-second timeout and at most two retries (three total
attempts). Every query, Cargo request, continuation, and retry shares one
serialized request-start gate. `LEAGUEPEDIA_REQUEST_INTERVAL_MS` defaults to
`1000`, accepts `1000` to `60000`, and applies even when snapshot traversal uses
bounded concurrency. Only transient network errors, retryable HTTP statuses,
rate-limit, and max-lag responses retry. `Retry-After` is honored with a
30-second cap. HTTP 429 without `Retry-After` waits 30 seconds; a MediaWiki
`ratelimited` envelope without any retry guidance fails fast and tells the
operator to retry the sync later instead of rapidly retrying. Other transient
retries retain bounded exponential backoff. A single API response is capped at
5 MB.

The snapshot is also bounded by `LEAGUEPEDIA_MAX_BYTES`,
`LEAGUEPEDIA_MAX_PAGES`, `LEAGUEPEDIA_MAX_ROWS`, and `LEAGUEPEDIA_MAX_REVIEWED_PAGES` (default `5000`). Cargo traversal uses
500-row pages and bounded concurrency. Media downloads allow only configured
hosts and image content types, with a 20-second timeout and 10 MB maximum per
object. Raising any limit requires review of upstream policy, memory use,
object storage growth, and the acceptance evidence.

On any fetch, validation, storage, or publication failure, the run records a
failure and does not advance the published dataset. Coverage must be inspected
after every backfill; `partial` and `missing` are operator-visible outcomes,
not successful completeness claims.

Malformed rows from the site-wide Teams, Players, or Tournaments dimensions
are ignored only when no bounded game, player fact, tournament mapping, or
team-lineage closure references them. The coverage detail records the ignored
row count and sample source keys, while the retained raw wrapper preserves the
full response for audit. These unrelated optional rows do not downgrade a
complete tournament/date fact traversal. A referenced malformed row remains a
hard validation failure.

Team and player names in facts are resolved only through the corresponding
official Cargo redirect table. `TeamRedirects.AllName` selects one exact
`TeamRedirects._pageName` and `PlayerRedirects.AllName` selects one exact
`Players.OverviewPage`; matching trims surrounding whitespace and ignores case.
Player collisions are filtered by structural row validity and must leave
exactly one valid target. Zero or multiple valid targets fail the run. Display
names, short names, current teams, and other dimension fields are not fallback
resolvers. Malformed rejected candidates remain in retained raw evidence and in
the optional-row audit.

Series identity and completion metadata are owned only by retained
`MatchSchedule` rows. After bounded
`ScoreboardGames` traversal, the importer fetches `MatchSchedule` in exact
`MatchId` chunks of at most 100 and requires one row per imported match. The
schedule row owns tournament, scheduled provenance, teams, `BestOf`, final
score, and winner; `ScoreboardGames` owns actual temporal facts as well as
individual game IDs, numbers, sides, and winners. Canonical series `playedAt`
is the minimum actual game timestamp for the exact `MatchId`, independent of
row order. Missing, duplicate, or orphan schedules fail closed. Game sides
must match the schedule pair in either order, game numbers must be contiguous,
and game count/winner counts must exactly explain the schedule final score.
`ScoreboardGames` score fields and inferred `BestOf` are not fallback owners.

The 2026-07-13 official acceptance probe traversed all 5,753 TeamRedirects rows
in 12 CargoExport pages and all 32,922 PlayerRedirects rows in 66 pages. Both
tables remain subject to the same per-table 100,000-row/200-page bounds and the
aggregate snapshot resource budget; a later count change is acceptable only if
the bounded traversal still completes and the retained evidence records it.

Published dimensions are bounded to teams used by imported facts plus only the
forward rename paths needed to connect two such directly referenced teams,
players used by imported game-player facts,
and tournaments resolved by imported games. Valid site-wide dimension rows
outside that boundary are not published or considered for media downloads.
Forward renames whose targets have no imported facts are retained as a separate
audit count/sample instead of forcing future identities into the snapshot. The
coverage detail records both audits, and the complete CargoExport pages remain
in raw evidence.

## PostgreSQL query-plan regression gate

`packages/database/test/query-plan.integration.test.ts` runs against PostgreSQL
17 with the default planner configuration and uses `EXPLAIN (ANALYZE, BUFFERS,
FORMAT JSON)`. Its deterministic pressure fixture contains 100,000 searchable
entities, 100,000 aliases, 5,000 unrelated series and games, and 10,000
unrelated player memberships. Canonical-name, slug, and alias targets are each
selective and exercise the production `searchEntities` SQL. The comparison gate
uses the production candidate, summary, and direct-game SQL for a player versus
player query.

The CI execution ceilings are 500 ms for each entity search, 500 ms for the
comparison candidate and summary statements, and 750 ms for the direct-game
statement. Output rows, scanned rows, and rows removed are separately bounded.
Critical tables may not use a sequential scan. Entity paths must use their
specific `pg_trgm` index (`entities_canonical_name_trgm`,
`entities_slug_trgm`, or `entity_aliases_display_name_trgm`). Comparison plans
accept only index families that implement publication visibility, participant
lookup, game-to-series lookup, or primary-key joins; an arbitrary index on the
same table is not sufficient. These are deterministic CI regression budgets,
not runtime latency measurements. Record API p95 separately on the deployed
stack and continue to apply the 150 ms entity-search and 500/750 ms comparison
runtime budgets.

### 2026-10-08 Actions 同步失敗：EWC 隊伍名稱交替

`Publish` run `37732580243` 在 `sync` 階段失敗；build、lint、tests 及
mapping 設定檢查已通過。先前 run `37544386020` 的完整 2026 raw input
（object `60503e1993c6c61ffe65d9e63b841f36f0f82927166ec93e65fed18864c0ae07`）
可重現兩個相連問題：未覆核的 Team Secret lineage，以及合併 canonical ID 後
EWC 2026-07-15 事實超出推算的 `open..2026-07-02` 舊 era。
先前 MSI-only 子批次的 replay 通過不足以證明完整 current 匯入可行。

Leaguepedia [EWC 2026 參賽隊伍註記](https://lol.fandom.com/wiki/Esports_World_Cup_2026)
說明 Team Secret Whales 為 EWC club championship 積分以 Team Secret 名稱出賽。
[Team Secret 官方聯合公告](https://teamsecret.gg/blogs/league-of-legends/team-secret-x-team-whales-union-announcement)
描述的是 Team Secret 與 Team Whales 的合作，不能單憑這份公告將所有歷史隊伍年代合併。

修正由既有 `sourceCorrections` 擁有：對 EWC 的兩個精確 MatchId、四個 GameId、
及每局五位選手的 GameId + PlayerName，將隊伍 reference 指向既有 Team Secret Whales。
每項都檢查 expected 值；upstream 已修復時冪等，出現其他值時拒絕。
撤回未指定日期的全域 Team Secret lineage overrides。
原始 API envelope、比分、勝者、時間及歷史隊伍身分均保留；修正檔 checksum 照常納入 provenance。
這些精確修正只保留至來源修復，未命中的年度與比賽不受影響。

驗證包括從封存資料縮小的 `leaguepedia-ewc-team-secret.json`：一場較早 MSI 加兩場 EWC，
驗證單一 Secret Whales era、穩定 canonical ID、七局與完整 70 人 roster。
完整 raw input replay 得到 485 場系列賽、1,312 局、13,120 筆選手紀錄、零 quarantine。
這是解析與 normalization 證據；正式發布仍需通過 Actions checkpoint、SQLite export、
瀏覽器測試與 Pages 部署後驗證，不能由本機 replay 宣稱部署成功。

### 2026-10-15 Actions 同步失敗：選手真名更正

`Publish` run `38331760843`、`38483231974`、`38646689038`（#83–#85）逐字相同的
錯誤在 `prepare` job 的 `publish prepare` 失敗：

```
Published entity 8fa90906-1949-5964-8a2c-df2831ed5b79 canonical name conflicts
for source keys [Tatu (Pedro Seixas), ...]: existing "Pedro Seixas",
incoming "Pedro Seixas Brito".
```

`8fa90906-…` 是 `stableUuid("entity:player:Tatu (Pedro Seixas)")`，見
`data/overrides/media.json` 的 owner 綁定。Leaguepedia 編輯更正了該選手的
`Players.Name`（真名），而 `assertImmutableEntity` 對所有已發佈實體都把
`canonical_name` 當成不可變。`deploy` 的 `needs: prepare` 使其整段被跳過，
所以站台凍結在 `site-38239669584-2`，baseline 停在 `checkpoint-8`（2026-10-09）。

這是資料端變更而非程式回歸：2026-10-12 的成功 run 與 #83–#85 都在同一個
commit `fc2a733` 上。線上 snapshot 的 `entity_variants` 顯示
`display_name = "Tatu"` 與 `canonical_name = "Pedro Seixas"` 不同，即該列的
`entities.player_id` 非 null，符合採用修正的前提。

修正依循既有身分模型：選手的不可變身分是 public ID（`player_id`），真名只是描述性
欄位。`canonical_name` 現在會在兩側都有 public ID 時採用更正後的值；competitive ID、
已發佈 slug 與 `entity_public_ids` 路由鍵都不移動，被取代的舊名留在 append-only 的
`entity_aliases`。team/region 名稱、`kind`、public ID、era、tournament 與 slug 維持
fail-closed。細節與 operator 處置見
[Player real-name corrections](#player-real-name-corrections)。

`slug` 只在實體從未發佈時才推導，因此更正為 `slug` 無法羅馬化的名稱（例如純 CJK
真名）不會再中止發佈；已發佈 slug 的守衛現在是 drift detector。真名另加上界：
控制字元或超過 120 字元會被拒絕，避免上游把已發佈標籤改成任意長度或含控制字元的字串。

驗證以 PostgreSQL 17.10 執行：整合測試 82/83 通過（未通過的
`postgres-checkpoint` 需要 `pg_dump`，CI 另行安裝 PG17 client tools），加上 582 個
unit/workspace 測試。新增覆蓋包含真名採用且 slug 與路由鍵不動、純 CJK 更正、
team 改名仍 fail-closed、legacy 與無 public ID 的 player 改名仍 fail-closed、
大小寫不同的 entity id 仍會偵測到 staged 衝突。
