# SQLite / SQL.js-HTTPVFS Migration

Status: implementing on `design/github-pages-actions`.
Authority: user explicitly requires SQLite / SQL.js-HTTPVFS, replacing JSON snapshots.
Root owns architecture and commits; gpt-5.6-luna implementers own bounded files.

## Retained Work

P0 `42199d4`, P1 `93a443b`, P2 `44535e8` remain valid: preserved source baseline,
one-shot data CLI/filesystem storage, verified private Release checkpoint transport.
No production service, persistent DB, object, or volume has been removed.
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

Status: not started; website/private archive repository identities and remote
configuration have not been provided. No existing service has been retired.

- Need explicit website/data repository identities; checkout currently has no remote.
- Configure private archive token and Pages permissions; do not expose token publicly.
- Restore from real GitHub archive on a clean runner; test actual Pages Range 206.
- Verify current and historical sync, smoke, recovery and site rollback.
- Only then stop old scheduler/services and retire obsolete API/S3/cron/Docker code.
- Preserve independent backups and all named volumes; physical deletion is out of scope.

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
