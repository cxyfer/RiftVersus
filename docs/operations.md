# Operations

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
