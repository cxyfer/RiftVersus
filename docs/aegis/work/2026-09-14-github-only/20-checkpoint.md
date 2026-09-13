# GitHub-only execution checkpoint

## Active User Correction

User explicitly requires SQLite / SQL.js-HTTPVFS. The JSON shard/browser-array
engine implementation is superseded and is being removed, not kept as fallback.
Active plan: docs/aegis/plans/2026-09-14-sqlite-httpvfs-migration.md.
P2 committed as 44535e8. P0-P2 backup/ingestion work remains valid.
The earlier P3/P4 results below describe the abandoned JSON implementation only;
they are not evidence that the SQLite replacement passes.
All subagents were idle at the correction; new bounded SQLite tasks were assigned.

## Intent and authority

User authorized implementation of P0-P7 and one verified commit per stage.
Root owns design and Git mutations. User requested root gpt-6-astra and child
gpt-5.6-luna; root model switching is not exposed. The fixed gpt-5.6-luna triage
role is used only for read-only inventories; no alternate model is selected.
Execution uses executing-plans, long-task-continuation and commit skills.
TDD mode off: meaningful regression and restore checks, no prescribed strict TDD.

## Start

- Branch: design/github-pages-actions; HEAD 53095f2.
- No remote; single checkout; no active Git operation.
- Preexisting .gitignore change belongs to user and remains untouched.
- Prior-turn proposal/docs belong to this migration and are included in P0.
- Baseline: ADR-0001, identity/avatar v2, scheduled refresh, GitHub-only plan.

## Stages

- P0 committed: 42199d4, isolated database restore and referenced object export.
- P1 committed: 93a443b, filesystem object store and build-time data CLI.
- P2 local implementation verified: checkpoint bundle, Release transport and
  empty-database restore; preparing commit. Live archive bootstrap remains P6.
- P3 active: static projection and SQL parity verified; pinned provenance gate
  remains blocked on the preexisting generation mismatch described below.
- P4 active: static browser runtime and production fixture E2E.
- P5-P7 pending. No old runtime has been retired or stopped.

## P0 evidence

- Captured 2026-09-13T18:12:15.926Z (September 14 Asia/Taipei).
- Private local bundle: /tmp/riftversus-github-migration-p0/.
- database.dump: 1,261,399 bytes; SHA-256
  5344d92ce228c39afdb6b3dffeb680a9ff6aa12b78ac9cfd205d10d18ea33904.
- Restored into a task-created PostgreSQL 17 container; container removed after
  successful verification. Production containers/volumes were not changed.
- 714 entities, 1,066 series, 1,664 games, 16,640 game_players, 7 generations.
- 7 source objects / 68,981,907 bytes; every object's streamed SHA-256, size,
  content type and remote metadata matched the restored database references.
- 0 retained media objects. Historical coverage rows remain in the database;
  they are not flattened or confused with unique active scopes.
- Bundle contains the full manifest and raw bytes outside Git. It is a local
  migration staging copy, not a durable remote checkpoint or live acceptance.

## Boundaries and next step

P0 supports beginning implementation. Live source access is not needed for P1.
Remote repository and archive credentials remain prerequisites for P6, not P1.
Next: checkpoint bundle and verified restore, then GitHub Release transport.
Strict historical acceptance and SQL/static parity belong to P3, before any
HTTP/SQL retirement. No claimed data or presentation semantics have changed.

## P1 evidence and known baseline gap

- Core ObjectStore no longer requires signedGetUrl; old S3 HTTP delivery keeps
  a narrow SignedObjectStore until P7. Filesystem storage rejects corrupt bytes,
  conflicting metadata, traversal and linked files; atomic directory publication.
- apps/data owns sync composition, history scope planning, mapping, freshness,
  avatar generation and acceptance logic. Server imports this single owner.
- New CLI supports migrate, bounded backfill, sync --once/--history-once,
  mapping and freshness. No server or scheduler is started by this CLI.
- Build and lint passed; full pnpm test passed: root 60, contracts 12, domain 19,
  sync 190, data 7, server 187, web 52. Consumer TypeScript checks passed.
- Fresh PostgreSQL 17 integration passed 64/64, zero skips.
- Isolated fixture migrated all nine migrations, published once then returned
  unchanged on retry using only filesystem ObjectStore.
- Imported all P0 source bytes into the filesystem store and ran acceptance
  against restored gen7. Result matched the existing deployed S3 CLI exactly.
- Strict pinned historical acceptance remains BLOCKED on both old/new CLIs:
  pinned snapshot version/coverage and fact provenance do not match gen7.
  No expectations were changed. This is an existing baseline mismatch, not a
  successful release acceptance; P3/P6 must resolve with authentic evidence.
- P1 audit script: /tmp/riftversus-p1-check.mjs; it removes only its own test
  container. Production app/sync/PostgreSQL/MinIO and user .gitignore preserved.

## P2 evidence

- `checkpoint pack|verify|restore` uses PostgreSQL 17 exported snapshots and
  immutable filesystem objects. Full bundle validation precedes restoration;
  nonempty staging databases are rejected rather than overwritten.
- `archive resolve|publish` uses a private GitHub data repository, hashed index
  assets and ordered chunks of at most 256 MiB. Unchanged raw chunks reference
  existing verified asset IDs. Database dumps are uploaded per checkpoint.
- Publication is draft -> download index and all referenced bytes -> verify ->
  restore a separate empty PostgreSQL database -> publish. Failures leave drafts.
- Resolver ignores drafts and rejects duplicate sequences or broken lineage.
  No deletion, overwrite, mutable latest tag, or timestamp ordering is exposed.
- Fresh build, focused ESLint and diff whitespace checks passed. Focused P2
  suite passed 28 tests including lineage and uploaded-index corruption checks.
  An actual 256 MiB split-boundary allocation has not been exercised locally.
- Real PostgreSQL 17 cold-restore integration passed (1 test, zero skips),
  including corrupt dump rejection and nonempty target rejection.
  Reproducer: /tmp/riftversus-p2-check.mjs. Host lacks PG client tools, so the
  test invokes real pg_dump/pg_restore in its disposable PostgreSQL container.
- Operations: docs/checkpoints.md. No Git remote exists and no live GitHub
  archive operation was attempted. Cross-repo permission validation is pending.

## P3 evidence in progress

Historical JSON implementation evidence only; superseded by SQLite S1 below.

- Fresh P0 restore: 375 real-data SQL/static comparisons matched exactly after
  excluding deliberately snapshot-bound cursor bytes. Five fixture PostgreSQL
  integration tests passed, including search, eras, players and pagination.
- Public export: 818 entity/era entries, 1,066 series, 1,664 games, 24 shards,
  2,589,223 data bytes. No raw objects or database dumps in the public directory.
- Public data directory: /tmp/riftversus-p3-public-5j83yN. The manifest and each
  shard are content-verified. V2 avatars are materialized as hashed assets under
  /RiftVersus/presentation/. Freshness and attribution are separate metadata.
- Reproducer: /tmp/riftversus-p3-check.mjs. It restores only a task-owned
  temporary PostgreSQL container, verifies, then removes that container.
- Reviewed gen4 acceptance remains unchanged. These parity checks do not turn
  the known gen7 provenance mismatch into a passing release gate.

## SQLite S1 verified

Commit: `214d9cc`.

- Normalized SQLite v2 replaces the uncommitted JSON shards and browser JS
  comparison engine. Node 24 exports indexed 4096-byte pages, ANALYZE/VACUUM,
  integrity checks, a physical DB SHA, and a separate logical snapshot ID.
- Fresh retained-data PostgreSQL restore: 375 PostgreSQL/SQLite comparisons
  matched; five actual PostgreSQL integration tests passed with zero skips.
- Public SQLite contains 818 entity/era variants, 1,066 series and 1,664 games;
  database size is 6,889,472 bytes. Reproducer: /tmp/riftversus-p3-check.mjs.
  Public output: /tmp/riftversus-sqlite-public-IJ6dhp.
- Current SQLite acceptance returned ready with no blockers after checking
  active provenance, source bytes and unchanged reviewed historical outcomes.
  Pinned gen4 archival acceptance remains separate and is not claimed passed.
- Real-data round-trip initially caught duplicate aliases normalized by SQLite
  uniqueness. Canonical projection hashing now deduplicates aliases before
  hashing; the integrity/digest checks remain enforced.
- Focused data suite: 43 passed. Domain suite: 25 passed. Build and lint passed.
- Existing production containers/volumes and unrelated .gitignore preserved.

## SQLite S2 verified

- Vite production and development use real sql.js-httpvfs 0.8.12; worker JS and
  WASM are hashed external assets. Browser search/filter/aggregation/pagination
  run shared parameterized SQLite SQL, with no JSON facts or HTTP API fallback.
- Range preflight validates HTTP 206, Content-Range, identity encoding, SQLite
  header and 4096-byte pages. Internal snapshot identity is JSON-decoded and
  compared to the manifest before exposing the executor.
- Upstream hides the native Worker. Pre-Worker failures retry; post-start errors
  are latched and the DB is closed where available. Reload recovery releases the
  page-owned Worker. We do not claim an unavailable terminate API.
- Real homepage testing caught synthetic default UUIDs. UI and synthetic fixture
  now share the reviewed canonical T1/LPL identities, with a regression test
  against the unchanged reviewed acceptance document.
- Real-data cold default query: desktop and mobile each read 876,644 database
  response bytes out of 6,889,472 bytes (12.724%). HTTPVFS also performs a bodyless
  HEAD; data GETs are HTTP 206. Worker/WASM load, no API calls or page errors.
- Measured readiness was approximately 2.49s desktop / 2.14s mobile on this local
  run including startup. These are single-run observations, not p95 guarantees.
- Reproducer: scripts/measure-static-sqlite.mjs. Evidence directory:
  /tmp/riftversus-sqlite-real-measurement (desktop/mobile PNG and measurement JSON).
- Real-data preview: http://127.0.0.1:4188/RiftVersus/;
  files: /tmp/riftversus-sqlite-site-ZisSUW. No synthetic data in this preview.
- Production synthetic Playwright covers search, historical labels, sharing,
  PNG, 101-series ZIP, bad Range rejection/reload and mobile layout.
- Fresh full unit/workspace test run passed 600 tests; build and lint passed.
  Actual Pages hosting and production credentials remain untested.
