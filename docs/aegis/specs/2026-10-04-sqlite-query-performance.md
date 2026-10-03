# SQLite Query Performance Proposal

Date: 2026-10-04
Status: implemented, verified and deployed in Releases A/B on 2026-10-04.

## Intent And Boundaries

Reduce cold comparison latency and unnecessary database reads while preserving
GitHub-only hosting, SQL.js-HTTPVFS, exact identities, participating team eras,
per-game membership, filters, pagination, saved links and export behavior.
The public SQLite remains the sole browser facts/query owner. Existing private
checkpoint lineage, source gates and media eligibility are unchanged.

TaskIntentDraft: improve cold and subsequent comparisons, demonstrate equal
results and measured Range reductions, then publish a reproducible Pages rebuild.
No backend service, whole-database GET fallback, alternative JSON query engine,
new service worker or persistent browser database is proposed.

BaselineReadSetHint / BaselineUsageDraft: reviewed BASELINE-GOVERNANCE.md,
the 2026-10-03 GitHub/SQLite baseline, sqlite-development.md, current schema,
SQLite query owner, snapshot reader, manifest contract and comparison component.
Architecture remains aligned; physical query/index and transport tuning need
improvement. No fact or identity migration is needed for performance alone.

ImpactStatementDraft: packages/domain SQL/indexes, packages/contracts manifest
validation, apps/data export, apps/web query/cache integration and existing
browser measurement/E2E tools. Reuse these owners; add no parallel cache owner.

Requirement Ready Check: the user approved the implementation plan on 2026-10-04.
The targets below are release gates. Actual results and limits are recorded in
../work/2026-10-04-sqlite-performance/90-evidence.md; the research measurements
below remain historical observations.

## Evidence And Limits

The measured public database checksum is
72ec05b414f33a14fddb26c71f5cd639b0eb8a81398ef268e49a4af9f660ea44,
with 7,045,120 bytes and a 4,096-byte SQLite page size.

| Browser experiment | Range GETs | Response bytes | Navigation to summary |
| --- | ---: | ---: | ---: |
| Production 4 KiB request unit | 173 | 913,508 | 57,070 ms |
| Diagnostic 64 KiB request unit | 24 | 2,097,252 | 17,311 ms |

Both cold browser sessions used the same published assets, database and default
T1/LPL filter: 2019-2026, Worlds, BO5. Both returned 9-0 series and 27-6 games.
Every database GET returned 206; there were no identical repeated Range headers
or page errors. The fixed ?chunk=0 URL identifies the single server file; it
does not mean that every request reads the same bytes.

The diagnostic 64 KiB setting was injected into Worker configuration only.
Production code/manifest was untouched. The current manifest validator accepts
only 4,096, so changing the published manifest alone is invalid.

Production request median latency was 165 ms and p95 was 448 ms; summed response
latencies were 38.8 seconds. Approximately 440 KiB of fetched pages belonged to
series_facts. The default query against the same local database took about 10 ms
and returned the same summaries. Native SQLite query plans also show broad
candidate traversal and correlated player membership checks.

These are single-run observations on the local connection using a TLS CONNECT
proxy to bypass local DNS problems. Asset-start time and network conditions
differ between runs; 57/17 is not a controlled speedup guarantee. Native SQLite
plans are diagnostic hints, not proof of the bundled WASM planner's choices.
Raw traces remain local at /tmp/riftversus-query-diagnosis.json and
/tmp/riftversus-query-diagnosis-65536.json; reproducible measurements must be
captured through repository-owned tools during implementation.

Upstream also recommends selective/covering indexes for HTTPVFS:
https://github.com/phiresky/sql.js-httpvfs#debugging-data-fetching.

## Options

| Approach | Benefit | Cost / Limit | Decision |
| --- | --- | --- | --- |
| Enlarge request unit alone | Fewer network round trips; small change | Diagnostic transfer grew 2.3 times; unrelated rows still scanned | Useful tuning, insufficient alone |
| Selective SQL/indexes plus bounded request tuning | Less irrelevant data and fewer round trips; scales with facts | Query semantics and WASM plans require parity testing | Recommended |
| Browser-persistent range cache | May accelerate revisits | Does not fix first visit; adds cache/version/eviction/206 ownership | Defer until measured need |

## Stage 1: Selective Queries And Indexes

Keep SQLite page size at 4 KiB. Add only indexes justified by actual plans and
read measurements, rather than creating every possible subject combination.

- Team queries: candidate indexes begin with side_a_team_id or side_b_team_id,
  followed by an appropriate date/series key. Use separately indexable branches
  for the two orientations where the current OR prevents selective access.
- Region queries: evaluate corresponding region-leading indexes for region-only
  comparisons. Choose the more selective selected subject as the candidate
  anchor for mixed team/region queries. Verify both broad and narrow filters.
- Player queries: evaluate (player_entity_id, game_id, side) on game_players.
  Start from the selected player's game IDs, apply the opposing subject to those
  games, then derive distinct series IDs. Preserve direct-game membership,
  including two-player comparisons, roster changes and opposing-side checks.
- Derive series orientation from the series team/era facts when the left subject
  is a team/region. Compute the earliest direct-game orientation only when the
  left subject is a player, preserving played_at/id tie ordering.
- Retain separate series and direct-game summaries. A series counts once even
  when several games match; game summaries count only directly matching games.
- Reduce repeated CTE work only when the bundled SQLite plan and measurements
  justify materialization/query reshaping. Do not assume Node and WASM planners
  choose identical plans or versions support identical optimizer syntax.

Retain exporter ANALYZE and VACUUM. Index-only layout changes normally keep
logical schema 3 and produce a new physical database checksum; bump schema only
if required tables/columns or reader compatibility actually change. Existing
schema 2/3 immutable sites remain readable.

## Stage 2: Bounded HTTPVFS Request Units

Benchmark 4, 16, 32 and 64 KiB on the optimized database. Provisionally prefer
32 KiB, but select the smallest measured unit meeting the latency/read budget.
An enlarged unit must be an integer multiple of the unchanged SQLite page size.

Replace z.literal(4096) for requestChunkSize with an explicit supported set and
page-alignment validation. Retain 4 KiB compatibility. The exporter publishes
one selected unit in the manifest; the browser follows that manifest. Avoid
user-agent heuristics, automatic network adaptation and reader-only overrides.

Retain immutable hash URLs, verified length/header preflight, identity 206 reads,
session page cache, snapshot-bound cursors and the existing read budget. Leave
serverChunkSize and the single physical file unchanged in this phase; server
file splitting is a separate CDN/storage decision, not this tuning parameter.

## Stage 3: Reuse Comparison Results

The current comparison key includes serialized URL identifiers. Successful UUID
to public-ID normalization changes that key and can execute the same comparison
again. Treat this as redundant computation, not the cause of duplicate ranges:
the observed cold run had no identical repeated Range headers.

Resolve routes through the existing API and key comparisons by resolved entity
UUIDs, eras, normalized filters and the pinned snapshot/session identity. Keep
readable URLs as presentation. Reuse the existing mounted QueryClient and its
isolation; do not add a separate global result cache. Validate canonicalization
performs one comparison and sharing/saved links retain their behavior.

An immutable snapshot's comparison result does not become stale after five
seconds. Configure comparison queries to avoid focus/time-based refetches for
that snapshot. A new snapshot/client mount must have separate cache ownership.
Retain the existing HTTPVFS page cache for different filters. Do not change
search caching or summary-per-page response contracts without new evidence.

## Verification And Proposed Acceptance

Extend scripts/measure-static-sqlite.mjs and existing E2E/CI rather than adding
another benchmark pipeline. Retain real Worker/WASM, identity-206, no-full-GET,
desktop/mobile and export checks. Record snapshot identity, request headers,
bytes, time to summary and query execution count where instrumentation permits.

- Pin the same restored facts for before/after comparison. Verify summaries,
  row ordering, historical labels and complete paginated row sets against the
  existing reference before retiring the superseded query implementation.
- Cover all six unordered subject-kind combinations, both display orientations,
  team eras, player substitutions, date/event/league/BO filters, empty results,
  pagination and UUID/public-ID equivalent links.
- Capture actual WASM EXPLAIN QUERY PLAN and network traces. Selective team and
  player queries should use subject-leading lookup rather than traverse every
  series as the initial candidate set.
- Use a controlled Range server with 150 ms response delay and 10 Mbit/s transfer
  shaping. Apply equivalent conditions to baseline and candidate, run ten cold
  sessions and record median plus individual readyMs values. Define whether
  asset traffic is shaped consistently; keep both navigation and database-phase
  times to separate startup costs.
- Proposed default-query target: at most 30 Range GETs, at most 1 MiB database
  response bytes, and median navigation-to-summary at most 10 seconds under
  the specified controlled profile. This is an acceptance target, not a claim
  that the existing 64 KiB experiment meets it (its transfer exceeded 1 MiB).
- Broad region/all-history comparisons have inherently larger result sets;
  report their separate read/time budgets from baseline and preserve correctness.
  No required subject-kind case may regress median latency; explain legitimate
  index-storage/transfer trade-offs before selecting the final unit.
- Repeating an already cached identical comparison in the same session should
  trigger no additional database Range reads or SQL comparison execution.
- Verify actual Pages cold desktop/mobile reads after publishing; controlled
  tests do not establish real-user latency percentiles.

## Publication And Recovery

Use the existing rebuild publication path to restore the authoritative private
checkpoint and regenerate the public SQLite/site. Performance-only publication
does not require another source sync or advance checkpoint lineage. Preserve
immutable archived sites and select a known-good archived site for rollback.

Each implementation stage receives a focused verified commit. New site assets,
compatible manifest validation and selected request unit are deployed together.
Do not edit historical immutable manifests/database artifacts in place. Document
measured results and residual limits in the existing SQLite development runbook.
