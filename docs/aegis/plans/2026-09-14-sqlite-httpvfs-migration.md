# SQLite / SQL.js-HTTPVFS Migration

Status: GitHub / SQLite implementation and cutover complete on
`design/github-pages-actions`; full fresh historical sync remains source-blocked.
Authority: user explicitly requires SQLite / SQL.js-HTTPVFS, replacing JSON snapshots.
Root owns architecture and commits; gpt-5.6-luna implementers own bounded files.

## Retained Work

P0 `42199d4`, P1 `93a443b`, P2 `44535e8` remain valid: preserved source baseline,
one-shot data CLI/filesystem storage, verified private Release checkpoint transport.
Persistent DBs, objects, named volumes and retained containers are preserved.
User's unrelated `.gitignore` change remains untouched.

## S1: SQLite Data And Queries

Status: verified and committed as `214d9cc`; 375 real-data parity cases and five
PostgreSQL integration tests passed, current SQLite acceptance ready.

- Replace public JSON shard contract with schema v2 SQLite manifest.
- Export normalized indexed SQLite using Node 24 `node:sqlite`; no extra DB server.
- PostgreSQL stays build-only for established ingestion/publication/provenance.
- Add parameterized shared SQLite query module used by browser and acceptance.
- SQLite executes search/filter/aggregation/pagination; JS only maps result rows.
- Delete uncommitted JSON query engine, shard writer and associated obsolete tests.
- Run integrity/checksum tests, historical assertions and PostgreSQL/SQLite parity.
- Commit this phase only after verification; record any blocked archive evidence.

## S2: Browser HTTPVFS

Status: implemented and locally verified with actual worker/WASM and retained
data. Cold default query reads 876,644 / 6,889,472 database bytes on both tested
viewports. Commit/evidence tracked in the migration checkpoint.

- Pin `sql.js-httpvfs@0.8.12`; bundle actual worker JS and WASM with Vite asset URLs.
- Read only small manifest before opening immutable SQLite over HTTP Range.
- Hosted Pages verification exposed gzip HEAD responses despite identity Range
  GETs. Use upstream's known-size single server chunk configuration (logical DB
  size and server chunk size equal manifest byteSize), mapping chunk 0 to the
  same database path with `?chunk=0`. Preflight this exact URL. HEAD remains a
  capability check; its compressed Content-Length is not authoritative.
- Probe 206/Content-Range/header/page size; verify DB's internal snapshot identity.
- Same-origin, Pages base path, sticky per-page DB, failure cleanup/retry.
- No full DB fetch, JSON facts, SQL-in-JS simulation, API or mock fallback.
- Production Playwright: actual worker/WASM, Range 206, downloaded byte evidence,
  search/filters/share/history/PNG/ZIP, mobile layout, unsupported Range failure.
- Commit verified browser migration separately.

## S3: Archive And CI Adaptation

Status: local implementation and verification complete. PR CI, SQLite site
archives, single-writer publishing and persistent failed-attempt archives are
implemented. Full suite 634, build/lint, actionlint and real local HTTPVFS smoke
passed; independent spec/quality reviews have no remaining blockers. Actual
Actions runs, permissions and hosted Pages transport remain S4 evidence.

Continuation implementation boundaries:

- `publish-plan.ts` owns validated modes and paths; `publish-run.ts` owns ordered
  staging/archive composition with injected operations for failure tests.
- GitHub preflight checks the current default-branch revision and private archive
  repository before writes. Repeat revision checks before irreversible promotion.
- One `publish.yml` workflow lock spans preparation, deployment and smoke. Tokens
  are limited to trusted archive steps; frontend build subprocesses receive an
  explicit non-secret environment allowlist.
- Modes: current/history/backfill/reexport/rebuild and explicit site rollback.
  Retries use GitHub run ID plus run attempt; no overwrite or implicit bootstrap.
- Failed staging checkpoints are forensic `attempt-*` archives, never sync bases.
  Failure indexes contain stage codes, not raw exceptions or environment values.
- New owner files are necessary to separate execution policy, private archive
  transport and CLI wiring. Existing CLI receives dispatch-only changes; existing
  checkpoint/schema/source identities are not redefined.
- Local validation covers failure ordering and real retained-data static serving.
  Actual GitHub bootstrap, permissions, schedules and cutover remain S4 evidence.

- Change site allowlist/validation from JSON shards to SQLite + worker/WASM.
- Preserve current and previous immutable DB/assets in each deployable site.
- PR CI uses explicit synthetic SQLite fixture without production credentials.
- Single publishing writer restores checkpoint, syncs, validates SQLite, archives
  new data/site, then deploys Pages; website rollback never rewinds data lineage.
- Keep current/historical/failed attempts/retry modes from original operations plan.
- Never claim simulated Release tests as real GitHub permission verification.
- Commit verified workflow/packaging phase separately.

## S4: Bootstrap, Cutover And Retirement

Status: remote cutover and legacy retirement verified.
Private website `cxyfer/RiftVersus` and
archive `cxyfer/RiftVersus-data` exist; Pages workflow hosting, archive-only
Actions credential, remote CI and generation-8 archive bootstrap/cold restore
are verified. After repairing gzip HEAD length inference, commit `917acf9`
passed full remote CI and Publish run 37110172714 passed hosted desktop/mobile
Worker/WASM/Range smoke. Current source synchronization 37110413823 and explicit
site rollback 37110806436 passed. Historical source synchronization 37111081562
failed closed because the upstream Players dimension lacks Levi; its failure
archive and baseline isolation were independently verified. See the amended
retirement evidence boundary below. Retirement `a27ddbf` plus documentation fix
`3214e59` passed CI 37113562693 (475 unit, 70 integration, six production E2E)
and Publish 37113562724, including clean restore and hosted desktop/mobile.
Latest sequence-2 data is served again after the rollback exercise. Original
application/sync containers are stopped with restart=no; volumes remain intact.

- `origin` targets the private website repository; deployment branch is `main`.
- Configure private archive token and Pages permissions; do not expose token publicly.
- Restore from real GitHub archive on a clean runner; test actual Pages Range 206.
- Verify current sync, hosted smoke, recovery and site rollback; exercise history
  and independently diagnose any provider blocker without weakening its gates.
- Retire obsolete API/S3/cron/Docker code using the recorded cutover decision.
- Preserve independent backups and all named volumes; physical deletion is out of scope.

### Retirement Slice

Historical run 37111081562 exercised both reviewed batches and failed closed
at the shared provider gate: PlayerRedirects points to Levi but Players has no
matching OverviewPage. Independent direct Players lookup returned empty, while
the identical Faker control returned its row. Failure was archived and sequence
2 remained authoritative. Root decision: retire the old carriers after full
regressions using verified current sync, GitHub cold restore, hosted smoke,
rollback and historical failure isolation as cutover evidence. The old carriers
use this same provider and do not repair the missing upstream fact. Successful
full historical refresh remains explicitly blocked, not waived or synthesized.
No publication validation is weakened to complete retirement.
Deletion class: internal code retirement. Path: delete-first. New owners are
Pages/SQLite HTTPVFS for browser queries, apps/data plus filesystem staging for
imports, private checkpoint Releases for durable state, and publish.yml for
the single scheduled writer. Persistent-state risk: none; no rows, volumes,
source objects, Releases or retained containers are deleted.

- Move data-owned acceptance, mapping, sync-health and sync-service tests out of
  apps/server first, preserving historical/provenance/media and PG coverage.
- Delete the Fastify server workspace and server-only tests, scheduler/cron and
  S3 transports/dependencies; keep Leaguepedia provider, one-shot runner,
  filesystem ObjectStore, migrations and PostgreSQL build/restore tooling.
- Remove old Docker application/migrate/sync carriers and image-artifact checks.
  Retain explicitly selected local PostgreSQL tooling and legacy MinIO recovery
  services with named volumes; neither is a production writer.
- Update sample settings, scripts, lockfile, current operator entrypoints and
  architecture records. Historical runbooks remain labelled historical records.
- Existing PostgreSQL comparison helpers remain the pinned archival acceptance
  implementation and differential test oracle for snapshot/SQLite parity; they
  have no HTTP serving carrier.
- Verify full unit/consumer/build/lint, fresh PostgreSQL integration, negative
  active-source/dependency references and production static/hosted HTTPVFS CI.

## Verification Boundaries

Build-time normalized projection is not a second browser query engine. It is an
input/output representation for SQLite export and source/row verification only.
Do not store a full JSON projection in SQLite as a shortcut to loading everything.
Use indexes and measure Range I/O on retained real data. A small synthetic DB may
be read entirely by SQLite; distinguish that from an application-level full GET.

Pinned gen4 archival acceptance still requires its matching historical checkpoint.
Current acceptance checks active provenance and unchanged historical expectations;
it must not pretend the archival gate passed against gen7.

Sources inspected: upstream sql.js-httpvfs README and npm registry (0.8.12).
Upstream states no cache eviction and limited browser/production guarantees; keep
byte budgets and explicit worker/Range failure handling. No invisible engine swap.
