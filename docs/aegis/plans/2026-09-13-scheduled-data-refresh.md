# Scheduled data refresh

## Intent and baseline

User approved daily current-data sync, weekly historical refresh, freshness
monitoring, and Docker deployment verification. Reuse the single Leaguepedia
provider, existing PostgreSQL publication transactions and locks, and retained
S3 evidence (ADR-0001; 2026-07-18 baseline; docs/operations.md).

TaskStartSnapshot: main at 8cf9ef38ca2e6a2e47916e5807c2fdfa8d942870,
clean worktree, one checkout. Docker app/postgres/minio are healthy; no sync
container is running. Last successful database run was 2026-07-18.

## Scope and decisions

- Daily scopes remain explicit reviewed competition/year pairs. Local active
  scope is MSI 2026; never guess a Worlds 2026 source mapping.
- Add optional weekly history cron in the existing sync process. Group mapped
  years older than the oldest active year by competition, respecting backfill
  bounds. Do not invent absent years or replay future mappings.
- Optional immediate current sync on startup; no replay of every missed tick.
- Keep all schedules non-overlapping within the process, retain DB locks,
  continue other history groups after a failed group, and log durations/results.
- Add a database-backed sync health command/endpoint with per-scope freshness,
  coverage and consecutive failure counts. Unchanged successful runs count.
- Query coverage across retained scopes, not just the latest publication.
- No schema migration, new provider, notification destination, data deletion,
  incremental source cursor, or UI redesign. No commit requested.

Code necessity: cron configuration alone cannot provide two bounded schedules
or detect stale scopes; changes stay in config/CLI, scheduler, database status
queries, health route and directly related tests. Architecture review: verify
single publisher and operational health separate from HTTP availability.
TDD Route: mode off; strict decision skipped; post-change regression tests.

## Execution and validation

1. Add config, history request selection, startup scheduling and structured logs.
2. Add status queries, health evaluation/command/route and Compose healthcheck.
3. Cover overlap, shutdown, history gaps, unchanged sync freshness, missing and
   partial scopes, failure counts and coverage retention with targeted tests.
4. Run build/typecheck/lint and relevant unit plus real PostgreSQL integration.
5. Back up live database, build image, run bounded live current/history checks,
   then recreate only this project's app/sync services. Record measured runtime,
   publication, health and deployment evidence in docs/operations.md.

Risk: upstream errors and reviewed identity conflicts may block live publication;
retain old data and report evidence. Never relax validation to make a job pass.
External alerts are exposed as nonzero health checks and structured logs; no
messages to third parties. Rollback: prior image and env, preserving volumes.

## Checkpoint

Implementation and unit/integration gates passed. Current live MSI 2026 sync
published generation 5 in 157.254 seconds (156 retained API responses,
8,417,327 raw bytes). Historical live validation published generations 6 and 7:
Worlds 13 years and MSI 10 years. All 24 scopes are fresh and complete. Active
facts remain 1,066 series / 1,664 games. App and resident sync share the final
image and report healthy. The resident startup sync completed autonomously as
unchanged in 156,666 ms; checkedAt advanced to 2026-09-13T15:13:20.993Z.
All implementation, Docker deployment and verification tasks are complete;
the recurring scheduler remains running. No commit was requested or created.

Browser verification exposed two pinned-version assertions incompatible with
automatic refresh. Rebind only UI version/export expectations to the live API;
retain exact historical match assertions and the independent pinned provenance
acceptance command. This is a test-contract adjustment required by refresh,
not permission to change source evidence or accept different historical facts.
