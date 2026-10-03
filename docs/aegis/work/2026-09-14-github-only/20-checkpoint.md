# GitHub-only execution checkpoint

## Current Resume Point - 2026-10-03

SQLite / real HTTPVFS, GitHub bootstrap/cold restore, hosted desktop/mobile,
current sync and independent site rollback are verified. Sequence-2 checkpoint
is authoritative. Full history refresh failed closed on missing upstream Levi
dimension; failed attempt is archived without promotion. Retirement is locally
verified and committed (a27ddbf / 3214e59). Remote CI 37113562693 passed 475 unit,
70 integration and six E2E tests; Publish 37113562724 passed hosted desktop/mobile.
Original app/sync are stopped with restart=no. Persistent volumes, retained
containers and the user's `.gitignore` change are preserved. Final evidence is
recorded below; fresh history remains source-blocked. Earlier status
sections below are chronological evidence, not current completion claims.

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

Commit: `d217293`.

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

## SQLite S3 partial: CI and site archive tools

- Added read-only PR/main CI: locked Node 24/pnpm install, build/typecheck/lint,
  unit suites, temporary PostgreSQL 17 integration, matching PG17 client tools,
  and production synthetic SQLite Playwright with Chromium installation.
- Site archives permit SQLite and WASM, reject JSON fact shards/private dumps,
  and verify the ZIP/index/data/presentation before publication and download.
- Explicit site publish/download CLI does not deploy Pages or rewind data.
  Previous-site retention copies only the prior build's own checksum inventory;
  three-deployment regression proves older inherited assets do not accumulate.
- Latest full suite: 600 unit/workspace tests passed, including 50 data tests and
  four CI contract tests. Production browser E2E: five passed after canonical
  homepage IDs and base-path preview fixes. Build/lint/diff checks passed.
- No live Actions run, Release upload or Pages deployment occurred. CI contract
  tests validate configuration, not remote permissions or hosted runner behavior.
- S3 remains partial: single-writer publish workflow, persistent failed-attempt
  evidence and its failure/retry scenarios are not yet implemented. S4 remains
  pending repository configuration and real bootstrap/cutover verification.

## S3 continuation: publishing and forensic attempts

- Implemented opt-in Publish workflow with a production-only concurrency group,
  default-branch/private-repository checks, and repeated SHA guards. Nondefault
  skipped runs cannot replace a pending production run. Default single pending
  slot semantics and manual retriggers are documented, not hidden.
- Preparation composes verified restore, bounded current/history/backfill or
  reexport, complete requested coverage, SQLite acceptance, validated checkpoint
  archive, secret-free frontend build/smoke, site archive and verified download.
- Rebuild does not implicitly migrate; rollback never restores or mutates a DB.
  Upload/deploy/smoke failures can archive attempt metadata with durable state.
- Attempt archives preserve verified failed staging DB/objects, never checkpoint
  lineage. Index-only verified summaries count data failures since a baseline.
  Oversized payloads are rejected before allocation/download (index 2 MiB,
  ZIP/uncompressed 256 MiB); unavailable evidence remains explicitly unknown.
- Full unit/workspace suite after quality fixes: 634 passed. Data 80 and workflow
  contract 4 passed. Build/typecheck and lint passed.
- Real production build/smoke operations (not injected browser mocks) passed on
  retained SQLite: /tmp/riftversus-publish-runtime-mnkfWx; both desktop/mobile
  read 876,644 / 6,889,472 bytes through 166 Range GETs and one bodyless HEAD.
- actionlint 1.7.12 passed syntax/expression validation for both workflows;
  external shellcheck integration was disabled. Download SHA matched the
  official release checksums. Pages action SHAs verified from upstream git tags.
- Spec review passed after pre-allocation bounds fixes. Quality review reproduced
  forged ZIP inflation and a Node adapter shutdown race. Both archive readers now
  share bounded internalStream extraction with pause and guarded callbacks;
  child-process regression covers a forged 64 MiB entry without uncaught errors.
  In-flight inflater output is bounded overhead, not a strict process RSS budget.
  Independent final quality recheck passed: forged 64/257 MiB entries both stop
  after 16,842,752 bytes of in-flight output with no uncaught errors or continuing
  chunks; observed helper RSS growth was 17.8/14.9 MiB, not full-payload growth.
- Drift: SQLite/HTTPVFS remains sole public query path; raw data stays private;
  no remote exists, no Actions/Release/Pages operation or legacy shutdown ran.
- S3 local implementation is verified; activation remains disabled. Next: commit
  this stage and obtain explicit website/private-archive repository identities
  for S4 activation. Remote permissions and hosted behavior are unverified
  (confidence B); no cutover or retirement is authorized by local test evidence.

## S4 remote deployment continuation (2026-10-03)

- User explicitly requested continuing deployment after creating the private
  website repository `cxyfer/RiftVersus`.
- `origin` now targets that repository; verified S3 HEAD `af9bfcd` was pushed
  as its initial `main` branch. CI run 37106630815 is in progress. Publish run
  37106630840 was skipped because publication is disabled.
- Pages creation succeeded with `build_type=workflow`, HTTPS enforced and URL
  `https://cxyfer.github.io/RiftVersus/`. No site artifact has been deployed yet.
- Created separate private `cxyfer/RiftVersus-data` with a `main` branch and
  enabled immutable Releases. Website variables name that archive and revision.
- `github-pages` environment permits only `main` branch deployments.
- `PUBLISH_ENABLED=false` remains the active activation boundary. Requested an
  archive-only fine-grained Contents read/write PAT in `RIFTVERSUS_DATA_TOKEN`.
  The general local gh OAuth token will not be persisted as an Actions secret.
- Active slice: verify retained authentic data and bootstrap/cold restore a
  private checkpoint; inspect remote CI, then prepare first Pages publication.
- Current host has no running RiftVersus containers. Inventory is read-only;
  no old volumes or unrelated containers have been changed.
- Drift: same SQLite/HTTPVFS/public artifact contract; no fallback or new query
  engine. Remote CI, checkpoint and hosted transport evidence are still pending.

### S4 first remote evidence

- CI run 37106630815 completed successfully, including real PostgreSQL integration
  and production SQLite/HTTPVFS E2E. Archive-only Actions secret is installed.
- Current import remains the reviewed 2026 MSI scope. Mapping preflight variables
  now follow this requested current scope; historical plans still derive only
  exact reviewed MSI/Worlds keys. Wider domestic-league mapping audit stays open.
- Preserved volumes contain generation 8, newer than the prior generation 7 P0.
  Temporarily started only PostgreSQL/MinIO, dumped a fresh consistent snapshot,
  restored it into a disposable PG17 instance and verified all 8 source objects.
  SQLite current acceptance: ready, no blockers. Counts: 714 entities, 1,066
  series, 1,664 games, 16,640 game_players and 8 generations.
- Dump: 1,270,508 bytes; SHA256
  63e8ff7cd17118eee80736c75e552bd25353d63824ac0014a4ce3f9088fe32ea.
  Independent local backup and checkpoint live under /tmp/riftversus-s4-20261003.
- First bootstrap uploaded all 9 chunks and index but failed download validation
  with the transport's 30-second timeout. Draft is retained, never promoted.
  General gh credential was used locally, never written to Actions or artifacts.
- All original services are again stopped; unrelated Docker services untouched.
  Next: diagnose download timing, retry with a new checkpoint ID, cold restore
  from GitHub, activate manual initial rebuild, then verify hosted Range traffic.
- Diagnosed transport owner `release-store.ts`: a valid 9,700,869-byte asset body
  took 41.1 seconds (42.4 seconds total), exceeding the existing 30-second signal.
  Fix boundary: separate bounded 10-minute transfer deadlines from 30-second
  metadata deadlines, preserving explicit old timeout overrides. Share a single
  download deadline across redirects and body. No new transport/fallback/retry
  path; drafts remain unchanged. Focused regression verification is required.
- Transfer fix verified locally: all 83 data tests, workspace build and lint
  passed. Root reviewed the changed signal ownership and preserved timeout
  override compatibility. Ready for a fresh bootstrap retry and remote CI.
- Committed transfer fix and remote setup evidence as `b289fdd`, pushed to main.
  CI run 37108024213 passed. Initial failed draft is retained.
- New initial checkpoint `checkpoint-1-bootstrap-20261003-retry-2` completed its
  actual GitHub download/restore publication gate. GitHub reports draft=false,
  immutable=true, 10 assets. It is the authoritative sequence-1 baseline.
- `PUBLISH_ENABLED=true`; explicit initial `rebuild` dispatched as run
  37108280050 against b289fdd. First site/hosted browser checks are in progress.
  A second independent local archive resolve/cold restore is also running.
- Independent local remote resolve/cold restore completed: exact generation-8
  counts and SQLite current acceptance ready. No staging container remains.
- Initial run 37108280050 prepared/archived/deployed `site-37108280050-1`, but
  hosted browser smoke failed. Its `attempt-37108280050-1` forensic archive is
  published; baseline remains sequence 1. No successful site claim yet.
- Root-cause evidence: Range GET bytes=0-99 is identity 206 with full size
  6,889,472; HEAD is gzip with Content-Length 1,697,820. Upstream full mode
  throws because it cannot infer an identity length from that HEAD response.
- Minimum repair uses upstream's existing known-size single-chunk configuration,
  with databaseLengthBytes/serverChunkSize equal the validated manifest size.
  Exact preflight and worker both use the same SQLite path with `?chunk=0`.
  The DB artifact, schema, query engine and range offset semantics are unchanged.
  HEAD still occurs; its compressed size no longer controls SQLite file length.
  Avoid cacheBust; no fork, whole-file GET, extra database files or fallback.
- Root approved bounded client/unit/E2E edits after read-only upstream mapping
  review. Regression must include gzip HEAD plus identity ranged GETs, followed
  by a new real Pages deployment and browser verification before success.
- Root completed the gzip-HEAD regression using browser-context interception
  and the actual Worker/WASM. It passes with 536,676 of 1,040,384 fixture bytes
  read through identity Range GETs. Corrupt-range/retry regression also passes.
  All 64 web unit tests, web build/typecheck and workspace lint passed.
- Local screenshot failure is independently reproducible with a blank Chromium
  page, including outside the filesystem sandbox. No screenshot bypass or CDP
  workaround is committed. Full CI and real hosted screenshot/transport checks
  must pass on GitHub runners before the deployment is considered verified.
- Client fix committed/pushed as 917acf9. CI 37110172738 and Publish 37110172714
  succeeded. Hosted desktop/mobile smoke captured screenshots, loaded real
  Worker/WASM and read 876,644 / 6,889,472 bytes using 166 Range GETs plus one
  HEAD, with no API calls/page errors/viewport overflow. Site archive
  site-37110172714-1 is published and immutable. Data baseline unchanged.
- Dispatched real current synchronization as run 37110413823, reviewed scope
  2026/MSI. Rollback and reviewed historical sync still need actual evidence;
  no old code/runtime retirement claim yet.
- Independent local hosted DOM/transport validation passed desktop/mobile;
  evidence /tmp/riftversus-s4-20261003/hosted-dom-transport.json. Same site ID,
  code SHA and baseline were confirmed, with actual gzip HEAD and identity
  Range GETs. Default comparison is T1 versus LPL, 9-0 series / 27-6 games.
  This local check deliberately does not claim screenshot capture.
- Current run 37110413823 succeeded end to end: live reviewed 2026/MSI sync,
  current acceptance ready/no blockers, checkpoint-2-37110413823-1, immutable
  site-37110413823-1 and hosted desktop/mobile smoke. New snapshot is
  sha256:42139d40b506d4486a82a43aca08fefaf7950cfa5ed8938454bee5fc76b12401.
- Explicit rollback to the first verified fixed site (site-37110172714-1)
  dispatched as 37110806436. It must preserve sequence-2 checkpoint lineage.
- Rollback 37110806436 passed archive/local smoke, Pages deployment and hosted
  desktop/mobile smoke. Independent resolver and public identity checks confirm
  site-37110172714-1 is served while checkpoint-2-37110413823-1 remains the
  sequence-2 authoritative data baseline. Website recovery does not rewind data.
- Full reviewed historical mode dispatched as 37111081562. Preparing retention
  of data-owner tests before server retirement; only test relocation is currently
  delegated. Runtime deletion still requires this final live-sync evidence.
- Historical run 37111081562 failed in both reviewed batches; immutable
  attempt-37111081562-1 was downloaded and its dump cold-restored into a fresh
  forensic PG17 database. Both sync_runs errors identify missing Levi identity:
  PlayerRedirects has OverviewPage=Levi, but complete Players evidence lacks it.
  Independent direct no-cache Players lookup returns [], with Faker as positive
  control. This is upstream dimension absence, not a transport/hosting failure.
- Root cutover decision: retirement can use successful hosted/current/restore/
  rollback evidence plus verified historical failure isolation. The retired
  carriers use this exact provider and offer no repair for missing source data.
  Historical refresh remains blocked; no gate, identity or coverage is weakened.
- Reversible draft removes old server/Docker/cron/S3 carriers; all five data
  acceptance/service/mapping/health suites move to apps/data. Added pg dev
  dependencies for the moved integration test. Full consumer/unit suites (473),
  build/typecheck, lint and fresh PG17 integration (70) passed. Named volumes
  and original containers remain untouched; test PG uses only tmpfs/task temp.
- Follow-up inspection confirmed the database migration wrapper already throws
  Kysely errors. No extra CLI guard is needed. CLI regressions verify migration
  failures propagate and the database connection is destroyed, plus bounded
  history batches continue collecting errors before rejecting publication.
- Independent read-only retirement review found no new evidenced blockers.
  Final local gates passed: 475 unit tests, consumer checks, build/typecheck and
  lint. ADR amendment and indexed 2026-10-03 baseline record new canonical
  owners and the historical provider blocker. Post-retirement remote CI/hosted
  verification follows the stage commit.
- Retirement committed/pushed as a27ddbf. CI 37113352542 and Publish 37113352536
  failed before archive access/deployment because the final documentation edit
  called the parity reference an oracle, matching the retired-provider guard.
  Root corrected only the active documentation wording; guard unchanged.
  Re-run the source guard after final documentation edits, then push the fix.
- Documentation fix 3214e59 passed the unchanged 32-test source guard and was
  pushed. CI 37113562693 passed 475 unit, 70 PG17 integration and six production
  SQLite E2E tests. Publish 37113562724 passed current acceptance, GitHub restore,
  private immutable site archive and hosted desktop/mobile smoke/screenshots.
- Independent archive/public check confirmed site-37113562724-1 serves the
  sequence-2 checkpoint with its unchanged bootstrap parent and current snapshot
  sha256:42139d40b506d4486a82a43aca08fefaf7950cfa5ed8938454bee5fc76b12401.
  Local desktop/mobile DOM/transport checks passed with 166 identity 206 Range
  GETs, actual gzip HEAD and 876,644 / 6,889,472 bytes. Evidence files:
  /tmp/riftversus-s4-20261003/retirement-final-state.json and
  /tmp/riftversus-s4-20261003/retirement-hosted-dom-transport.json.
- After hosted success, docker update --restart=no applied only to retained
  original app/sync. Inspection confirms both exited/restart=no and both named
  PostgreSQL/MinIO data volumes exist. No container, image or volume was removed.
- Final completion audit found successful hosted screenshots were generated but
  not downloadable after runner disposal. Add a pinned official artifact upload
  of public screenshots/measurement only, retained 14 days, so direct visual
  review can verify the actual deployed desktop/mobile site. No data or runtime
  owner changes; original hosted screenshot/Range checks remain required.
- Completion audit confirmed Vite and TypeScript both bind the browser alias
  exclusively to static-runtime, but four unreferenced legacy HTTP client/runtime
  files remained (one carrier-specific test included). Delete these dead paths;
  keep explicit mock fixtures used by UI unit tests. No published bundle/runtime
  behavior changes. Recheck web tests/build/lint and actual hosted evidence.
- Artifact retention commit 247b6e2 passed CI 37114564223 and Publish 37114564168.
  Root downloaded and visually reviewed actual hosted desktop/mobile PNGs under
  /tmp/riftversus-s4-20261003/screenshots-37114564168: rendered controls, avatars,
  comparison summary and historical rows fit both viewports without overlap.
- Add hosted workflow checks for real sharing/saving/player search/date filters/
  historical team names/PNG export/mobile results. They run on GitHub Chromium
  because local actionability waits, like screenshots, can time out in this
  environment. Do not weaken production interaction checks with forced clicks.
  Legacy HTTP cleanup passed web 63 tests, workspace build and lint; workflow
  source guards and actionlint passed. Actual hosted workflow run remains required.
- Hosted workflow commit 99e84e9 passed CI 37115041845 (474 unit after removing
  the dead HTTP-client test). Publish 37115041856 passed original hosted smoke
  but failed the new reload assertion: expected innerText included line breaks,
  while toHaveText defaulted to textContent. Use its supported useInnerText
  option for consistent full-summary comparison; no product/gate relaxation.
  Preserve generated public screenshot evidence even when a later check fails.
- Direct final upstream audit at 2026-10-03T10:03:53Z still returned HTTP 200 / []
  for OverviewPage=Levi and HTTP 200 / one matching row for Faker. Full fresh
  history remains a source repair requirement, independent of site deployment.
- a8994c8 / CI 37115468022 passed. Publish 37115468074 verified rendered reload
  and actually saved/opened the comparison, then its broad saved-button regex
  matched both load and delete buttons. Anchor the load label at T1; preserve
  strict locator uniqueness. Public screenshot artifact was retained on failure.
  Independent read-only review of the corrected verifier found no additional
  evidenced locator, Playwright, historical-row or PNG-header issues.
