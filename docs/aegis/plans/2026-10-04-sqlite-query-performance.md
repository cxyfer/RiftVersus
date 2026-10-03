# SQLite Performance Implementation And Deployment Plan

Date: 2026-10-04
Status: implemented, verified and deployed on 2026-10-04. Results and limits:
../work/2026-10-04-sqlite-performance/90-evidence.md.

Goal: implement the selective-query, bounded-request and comparison-reuse design
in [the performance spec](../specs/2026-10-04-sqlite-query-performance.md).
Architecture: one indexed public SQLite, one pinned browser HTTPVFS session,
existing QueryClient ownership and existing GitHub publication pipeline.
Tech Stack: Node 24 SQLite exporter, sql.js-httpvfs 0.8.12, React Query 5,
Playwright, PostgreSQL 17 staging, GitHub Actions and Pages.
Baseline/Authority Refs: BASELINE-GOVERNANCE.md, the 2026-10-03 GitHub/SQLite
baseline, docs/sqlite-development.md, docs/github-publishing.md and the spec.
Compatibility Boundary: exact UUID/public-ID ownership, schema 2/3 archived
sites, 4 KiB manifests, historical series/game orientation and snapshot cursors.
Verification: focused contract/query/export/web tests, same-facts browser parity,
controlled network measurements, current publication tests and actual Pages smoke.

## Research Readback

- Checked current code, not just workflow YAML: publish prepare already runs
  productionPublishOperations.smoke before site archive/upload. It uses the same
  measurement script as the post-deploy check. Extend this owner.
- Rebuild runs staging migrate and export, with no source sync and no new
  checkpoint. Rollback downloads an explicit archived website and smoke-tests it.
- Live repository metadata confirms main is the default branch, the repository
  is private, PUBLISH_ENABLED=true, DATA_REPOSITORY=cxyfer/RiftVersus-data and
  RIFTVERSUS_DATA_TOKEN exists. Only secret metadata was read.
- Live Pages still advertises site-37136621705-1, code f1c0efb765c06934e87346b64324d8a5290e4f9e
  and checkpoint-3-37136621705-1. Recheck these at actual release time.
- A copied SQLite with team/region-leading series indexes and a player-leading
  roster index lets the native planner use MULTI-INDEX OR for T1/LPL. The unchanged
  player query still uses correlated game-first roster lookups and does not use
  the new player-leading index as its candidate source. Indexes alone do not
  establish the player-query fix. No production database was edited.
- SQLite documents that indexable OR branches may use separate indexes but that
  this remains cost-based. EXPLAIN text is not a stable machine interface; record
  plans as evidence and gate measured reads/results rather than exact plan text.
  Sources: https://www.sqlite.org/optoverview.html#or_optimizations and
  https://www.sqlite.org/eqp.html.

Requirement Ready Check: the user requested further implementation/deployment
research. The existing spec supplies candidate scope/targets; this plan makes
the sequence and release risks concrete without treating research as execution.
BaselineUsageDraft: architecture and source/identity gates are preserved. The
rebuild runbook row was outdated and is corrected alongside this plan.
Change Necessity: config-only tuning is insufficient because the manifest
rejects larger request units and player SQL never anchors on player identity.
Existence Check: reuse domain, exporter, reader, QueryClient, measurement script
and publication smoke. A measurement-only loopback shaper is justified to exercise
actual Worker traffic; it must not become a production transport or service.
Plan-Time Complexity Check: sqlite-query.ts currently has 392 lines and is the
SQL owner; use focused candidate-builder functions there, not a parallel engine.
Keep app.tsx focused by putting pure query-key normalization in model.ts.

## Task 1: Establish Reproducible Browser Evidence

Files: scripts/measure-static-sqlite.mjs, apps/web/e2e/comparison.spec.ts,
apps/data/test/publish.test.ts and docs/sqlite-development.md.

1. Extend the current script's optional CLI arguments, preserving its existing
   URL/output positional arguments: --profile=controlled, --runs=10 and
   --enforce-performance. Unknown options and nonpositive/excessive runs fail.
   The ordinary hosted mode remains unshaped and captures desktop/mobile images.
2. In controlled mode, proxy an allowlisted loopback preview through an ephemeral
   local HTTP listener. Delay each response 150 ms and stream bodies through a
   shared 1,250,000-byte/s limiter (10 Mbit/s). Shape assets and database alike;
   preserve HEAD, Range, response status and Content-Range without compression.
   Forward only the configured local preview origin. Close proxy/listeners and
   browsers in finally, including timeout and assertion failures.
3. Verify the shaper with a known-size response and actual Worker Range events.
   Do not assume main-page CDP throttling automatically covers worker XHR.
   Ten independent browser contexts must fetch cold, with no shared HTTPVFS or
   query cache. Set bounded startup/query timeouts; avoid retrying slow runs.
4. Record each readyMs, database-phase time, Range bytes/count, exact repeated
   ranges, profile, snapshot/database identity and summary. Preserve existing
   error/206/no-full-GET assertions. Images are a separate untimed step; do not
   take twenty full-page screenshots for the ten timing repetitions.
5. Pin/checksum the current SQLite and baseline build before performance edits.
   Run the baseline under the same controlled profile as candidates. Store all
   runs, not only the best. Retain production-data evidence outside synthetic
   apps/web/dist fixture generation.

Verification commands after these options exist:

```sh
rtk proxy pnpm --filter @riftversus/web test:e2e
rtk proxy node scripts/measure-static-sqlite.mjs http://127.0.0.1:4188/RiftVersus/ /tmp/riftversus-perf-baseline --profile=controlled --runs=10
```

Commit: test(perf), only after actual worker traffic and cleanup are verified.

## Task 2: Make Subject Lookup Selective

Files: packages/domain/src/sqlite-query.ts, packages/domain/src/sqlite-schema.ts,
packages/domain/test/sqlite-query.test.ts, apps/data/test/export-snapshot.test.ts.

1. Extend current fixtures for opposite-side players, within-series substitutions,
   team-era filters, reversed presentation, tied first-game times and empty
   matches. Assert exact summaries and every paginated row, not only row counts.
2. Evaluate this bounded index set with ANALYZE and actual WASM/network plans:

```sql
CREATE INDEX series_facts_team_a_idx ON series_facts(side_a_team_id, date, id);
CREATE INDEX series_facts_team_b_idx ON series_facts(side_b_team_id, date, id);
CREATE INDEX series_facts_region_a_idx ON series_facts(side_a_region_id, date, id);
CREATE INDEX series_facts_region_b_idx ON series_facts(side_b_region_id, date, id);
CREATE INDEX game_players_player_idx ON game_players(player_entity_id, game_id, side);
```

3. For non-player queries, anchor candidates on a selected team if present,
   otherwise a region. Try the existing indexed OR first; use a candidate-ID
   UNION of side-a and side-b branches if actual reads remain broad. Join these
   IDs back to facts and apply exact opponent/era/tournament/date filters. Bind
   values as parameters. Both branches must preserve original assignment rules.
4. For a query containing a player, derive matching game IDs from the player
   index, join game_facts by ID and validate the full opposite-side assignment.
   Derive distinct series IDs from directly matching games before joining series
   and tournaments. Preserve series filters as series filters; do not convert
   them into per-game date/category filters.
5. Reuse direct matching games for game summaries. Only a player on the left
   needs the earliest directly matching game for series orientation; other
   orientations come from series facts. Keep keyset order played_at DESC/id DESC
   and snapshot cursor checks unchanged. Compare the complete result with the
   pinned baseline and existing domain reference before replacing old SQL.
6. Keep only indexes proving useful across the required cases. Preserve logical
   schema 3 if tables/columns/reader requirements are unchanged; hashed physical
   SQLite naturally changes when index layout changes. Never require INDEXED BY
   references to new indexes in the reader: schema 2/3 older files must still
   execute correctly, albeit with their older index layout.

```sh
rtk proxy pnpm build
rtk proxy pnpm --filter @riftversus/domain exec vitest run test/sqlite-query.test.ts
rtk proxy pnpm --filter @riftversus/data exec vitest run --config ../../vitest.unit.config.ts test/export-snapshot.test.ts
rtk proxy pnpm --filter @riftversus/web test:e2e
```

Commit: perf(domain), after semantic parity and lower controlled reads are proven.

## Task 3: Publish Reader Compatibility First

Files: packages/contracts/src/snapshot.ts, packages/contracts/test/contracts.test.ts,
apps/web/src/api/snapshot-client.test.ts, apps/data/test/export-snapshot.test.ts.

1. Permit only request units 4096/16384/32768/65536, retaining pageSize=4096.
   Exercise all supported values and reject 0, negative, misaligned, arbitrary
   oversized and wrong-page manifests before Worker creation.
2. Confirm createSnapshotClient forwards the verified request unit unchanged,
   while serverChunkSize remains database byteSize and range preflight remains
   bytes=0-99. Retain compression/length/header/Worker-failure tests.
3. Keep the exporter default at 4096 for this compatibility release. Verify old
   schema 2/3 sites and legacy URLs against the new reader. Run one optional
   temporary measurement matrix to validate real Worker behavior with all units.
4. Publish the compatible reader plus selective SQL using rebuild after green
   branch/default-branch checks. First release records performance; final strict
   budgets are activated only once tuning has been selected in Task 5.

```sh
rtk proxy pnpm --filter @riftversus/contracts test
rtk proxy pnpm --filter @riftversus/web exec vitest run src/api/snapshot-client.test.ts
rtk proxy pnpm --filter @riftversus/data exec vitest run --config ../../vitest.unit.config.ts test/export-snapshot.test.ts
```

Commit: feat(contracts). Release A must pass Pages transport before Release B.
An already-open successful session stays pinned to its old SQLite. Very old
cached HTML that boots an incompatible reader after a later manifest update can
still fail closed; use the existing reload recovery. Reader-first release reduces
this transition risk but does not guarantee that every browser cache has updated.

## Task 4: Reuse The Canonical Comparison

Files: apps/web/src/app.tsx, apps/web/src/model.ts, apps/web/src/app.test.tsx,
apps/web/src/model.test.ts, apps/web/e2e/comparison.spec.ts.

1. Split route resolution from comparison execution using the existing API and
   mounted QueryClient. Build the comparison key from resolved UUIDs/eras and
   normalized filters, not displayed URL strings; preserve subject orientation.
2. Enable comparison only when both route subjects resolve. Canonical URL updates
   must not lose draft filters, reset visible results or trigger a second compare.
   Keep loading/error/export behavior intact while resolution is pending or fails.
3. Set staleTime=Infinity and disable focus/reconnect refetch for immutable
   comparison results, leaving search query defaults alone. Keep normal bounded
   QueryClient eviction; do not make every visited result permanent in memory.
4. Preserve per-App cache isolation. The mounted API/snapshot session is its cache
   boundary; an API instance change must replace the QueryClient/session boundary.
   No new ComparisonApi method or global cache is necessary. Verify different
   App mounts/API sessions never return each other's comparison data.
5. Assert one compare call for UUID normalization, repeated-submit cache reuse,
   focus/reconnect behavior, saved links, swapped subjects and pagination. Verify
   repeating an immediately cached query needs zero additional Range reads.

```sh
rtk proxy pnpm --filter @riftversus/web exec vitest run src/app.test.tsx src/model.test.ts
rtk proxy pnpm --filter @riftversus/web test:e2e
```

Commit: perf(web), after cache ownership and URL regression tests pass.

## Task 5: Select A Unit And Enforce Candidate Budgets

Files: packages/domain/src/sqlite-schema.ts, apps/data/test/export-snapshot.test.ts,
scripts/measure-static-sqlite.mjs, apps/data/src/publish-run.ts,
apps/data/test/publish.test.ts, .github/workflows/publish.yml,
docs/sqlite-development.md, docs/github-publishing.md.

1. Export the same facts with each supported request unit and benchmark ten cold
   sessions per configuration. Keep database content/index layout fixed. Select
   the smallest unit meeting default <=30 Range GETs, <=1 MiB database transfer
   and median <=10 seconds under the controlled profile. Record all results and
   required broad-query cases; 32 KiB is provisional, not a predetermined answer.
2. Set the selected exporter default and fixture expectations together. Stop
   release if none meets the spec; return to SQL/index measurements instead of
   quietly relaxing budgets or adding full-download/cache fallbacks.
3. Extend productionPublishOperations.smoke to invoke controlled budget enforcement
   for newly built candidates before site publish/upload. Retain its ordinary
   screenshot/206 smoke. Rollback must retain ordinary identity/transport smoke
   without enforcing new performance budgets on an older known-good site.
4. Exercise publication failure ordering: a performance failure in rebuild must
   archive the failed attempt, not publish a site/upload output, and leave the
   authoritative checkpoint and current Pages unchanged. Current/history can
   publish their accepted data checkpoint before site-smoke under existing policy;
   do not claim a later website failure undoes that promotion.
5. Preserve evidence from prepare, including failures: add artifact retention for
   the public browser-evidence subdirectory only, using always() and existing
   workflow upload-artifact conventions. Private dumps/raw objects stay excluded.
   Post-deploy runs keep unshaped measurements and identity checks; internet timing
   is reported, not compared to the controlled 10-second threshold.

```sh
rtk proxy pnpm --filter @riftversus/data exec vitest run --config ../../vitest.unit.config.ts test/publish.test.ts test/export-snapshot.test.ts
rtk proxy node scripts/measure-static-sqlite.mjs http://127.0.0.1:4188/RiftVersus/ /tmp/riftversus-perf-candidate --profile=controlled --runs=10 --enforce-performance
rtk proxy pnpm typecheck
rtk proxy pnpm lint
rtk proxy pnpm test
rtk proxy pnpm test:integration
rtk proxy pnpm test:e2e
```

Integration tests need isolated PostgreSQL 17 databases with TEST_DATABASE_URL,
CHECKPOINT_TEST_SOURCE_DATABASE_URL and CHECKPOINT_TEST_TARGET_DATABASE_URL set,
as in .github/workflows/ci.yml. Missing URLs can skip these suites; a successful
exit without actual integration execution is insufficient release evidence.
Commit: perf(snapshot), plus a separate build(publish) commit for the verified gate.

## Release B And Recovery

1. Capture the currently deployed site ID and authoritative checkpoint before
   deployment. Last checked known-good site is site-37136621705-1. Verify its
   immutable archive remains available; deployment-time evidence supersedes this
   research snapshot. Never overwrite existing immutable site/database paths.
2. Push the feature branch for CI first. Publish on a non-default branch skips
   by design. Use normal reviewed integration to main with green required checks;
   plan research is not authorization to bypass branch protection.
3. A main push already triggers rebuild; wait for that complete run rather than
   dispatching a duplicate. If no push-triggered run exists, manually dispatch:

```sh
rtk proxy gh workflow run publish.yml --repo cxyfer/RiftVersus --ref main -f mode=rebuild
rtk proxy gh run list --repo cxyfer/RiftVersus --workflow publish.yml --limit 5
```

4. Use the selected run's real ID with gh run watch --exit-status. Confirm restore,
   acceptance, controlled budget, site archive/download, upload, SHA guard, Pages
   deployment and hosted smoke all pass. Re-read site-manifest and data manifest;
   verify code SHA/checkpoint identity, SQLite checksum, chosen unit and actual
   HTTPVFS reads. Rebuild must leave checkpoint sequence/parent unchanged.
5. Hosted smoke failure marks the workflow failed; it does not automatically
   restore the old site. Dispatch explicit recovery after checking queued runs:

```sh
rtk proxy gh workflow run publish.yml --repo cxyfer/RiftVersus --ref main -f mode=rollback -f site_id=site-37136621705-1
```

The concrete ID above is the currently verified recovery candidate. Refresh it
before actual release. A site rollback does not rewind data checkpoints. After
website recovery, fix/revert the faulty release code through the normal branch
flow before another rebuild; rollback alone does not change main or schedules.

Execution Readiness View: the branch can implement these bounded tasks once
execution is requested. SQL semantics and archive identity are locked boundaries;
request size is selected by measurement. Main Agent owns SQL/compatibility/release
decisions. Independent test/tool work can be delegated under the user's existing
preference. Commit each verified stage and stop a failed release before promotion.
Retirement: replace superseded query/key logic after parity; retain archived
schema/manifest support. No source provider, checkpoint or old recovery volume
is deleted by this work.
