# SQLite Performance Evidence

## Measurement Baseline

Production database 72ec05b414f33a14fddb26c71f5cd639b0eb8a81398ef268e49a4af9f660ea44
was checksum-verified and copied into a separately frozen baseline build.
Ten cold contexts with 150 ms response latency / shared 10 Mbit/s transfer:
median 31,972.8 ms, 173 identity-206 GETs, 913,508 bytes in every repetition.
Raw evidence: /tmp/riftversus-performance-baseline/measurement.json.
Controlled runs omit screenshots; hosted ordinary screenshots remain required.

node --test scripts/static-network-profile.test.mjs: 2 tests passed.
pnpm lint, pnpm build and pnpm typecheck passed for the current edits.

## SQL Verification

13 focused domain tests passed, including all six kind pairs/reverse orientation,
complete pagination and differing series/game date checks. Independently captured
48 production-data paginated results before edits; new SQL matches every result
on the old physical SQLite, also proving correctness without new indexes.
Raw parity: /tmp/riftversus-performance-parity-baseline.json.
First narrow-anchor candidate: 81 GETs / 1,032,292 bytes / 17,793 ms. This did
not meet final budgets; candidate filtering/index coverage is being improved.

Subject/opponent covering indexes alone worsened reads (135 GETs / 1,294,436
bytes). Actual WASM EXPLAIN showed game-summary CTE flattening selected broad
region scans. CROSS JOIN candidate/series/tournament/game boundaries preserve
the finite candidate-first order without requiring any new index name in SQL.
The corrected query: 77 GETs / 757,860 bytes / 16,474.9 ms at 4 KiB. Results
remain identical and actual WASM plans now use covering candidates, PK series
lookups and series-index game lookups. Raw plan: /tmp/riftversus-wasm-plan.json;
measurement: /tmp/riftversus-performance-fixed-order/measurement.json.

pnpm test: 504 unit/workspace tests passed (67 + 12 + 38 + 169 + 141 + 77).

## Final Layout And Unit Matrix

One fixed-layout database, same logical facts/snapshot, ten cold contexts per
unit with all asset/Worker traffic shaped at 150 ms / 10 Mbit/s:

| Request unit | Range GETs | DB bytes | Median ready ms | Result |
| --- | ---: | ---: | ---: | --- |
| 4 KiB | 44 | 401,508 | 10,939.3 | Count/time fail |
| 16 KiB | 26 | 884,836 | 8,362.3 | Selected, smallest passing unit |
| 32 KiB | 20 | 884,836 | 6,866.2 | Pass |
| 64 KiB | 15 | 1,114,212 | 6,354.1 | Transfer fail |

Every repetition had the same counts/bytes and summary (series 9-0, games 27-6),
identity 206 and no identical repeated ranges or page errors. Raw files:
/tmp/riftversus-performance-matrix-UNIT/measurement.json. CPU/startup conditions
are local observations, not a real-user percentile. The first 4 KiB and 16 KiB
contexts overlapped ordinary local regression tooling; no competing benchmark
or baseline browser workload ran during the matrix.

Identity/team candidate/game-series covering indexes avoid table-page scatter.
Non-player UNION candidates carry the series columns directly; actual WASM plans
show covering team and game-series lookups. Removed game_players_game_idx:
its exact columns/order already exist in the primary-key index, and no active
source refers to its name. The local matrix SQLite is 8,830,976 bytes, checksum
b6adfc58aadaf2dc71ebfd386f67d374dc9a87ceff48c701bb65041b5ae5063a;
25.35% larger than the original 7,045,120 bytes. This storage trade-off reduces
the controlled default median by 73.8% and Range GETs by 85.0%, with slightly
less transfer. Schema/page size/logical facts are unchanged.

48 complete paginated production comparisons match the before-edit reference
on both old and final SQLite layouts. Current local suite: 507 tests passed;
38 domain tests, four export tests, 19 publication tests, five workflow tests,
lint/typecheck and two controlled-profile tests passed.

Actual Worker cache check: first canonicalized comparison issued exactly two
comparison SQL statements (summary/page) and 26 GETs. Repeat Apply plus focus
and online events left both counts unchanged. Raw: /tmp/riftversus-performance-cache.json.
App replacement-session regression verifies a different API cannot reuse that
QueryClient/observer cache.

## Release A

PR #1 merged normally after CI 37144057651 passed unit, PostgreSQL 17 integration
and six real production SQLite E2E checks. Inventory-test fix ea9c61c selects the
second deployment's owned DB rather than the first hash-sorted retained file.
Publish 37144301983 passed restore/acceptance/site archive/download, actual Pages
deployment, identity/206 Worker/WASM, screenshots and hosted user workflows.
Live site-37144301983-1 advertises code 7c36af1d212d41119f5ec1113bfd99e3000708bc
and unchanged checkpoint-3-37136621705-1 / logical snapshot. Requests remain
4 KiB in this reader-first release: 77 GETs, 757,860 bytes; hosted ready times
2,072.1 ms desktop / 1,490.9 ms mobile. Root downloaded and inspected the desktop
screenshot. Hosted evidence: /tmp/riftversus-performance-release-a-hosted.

## Broad Cases And Regression Gates

Each pair below used all retained history without date/event/BO filters, three
cold contexts per version under the same controlled profile. Every summary
matched across all repetitions and versions; no pair regressed median latency.
These are separate broad-query observations, outside the default-query budget.

| Pair | Old GETs / bytes | New GETs / bytes | Old median s | New median s |
| --- | ---: | ---: | ---: | ---: |
| T1 / Bilibili Gaming | 165 / 974,948 | 22 / 1,146,980 | 30.56 | 7.80 |
| T1 / Xiaohu | 550 / 4,423,780 | 98 / 3,063,908 | 94.34 | 22.80 |
| Faker / Xiaohu | 134 / 4,997,220 | 77 / 2,850,916 | 31.92 | 19.28 |
| Faker / LPL | 611 / 4,780,132 | 124 / 3,915,876 | 107.79 | 27.19 |
| LCK / LPL | 306 / 1,400,932 | 53 / 1,867,876 | 53.36 | 13.52 |

Team/team and region/region bytes increase 17.6% and 33.3% respectively while
latency falls substantially. Remaining all-history queries can still take
19-27 seconds under this profile; do not present the ten-second default gate as
a universal latency promise. The first old T1/Xiaohu attempt hit the previous
90-second diagnostic limit. A separate unshaped DOM check confirmed a valid
result/no page error; the complete baseline rerun used --summary-timeout-ms=300000.
The stricter default publication timing budget is unchanged.

Committed public samples: performance-results.json (all individual times,
counts/bytes/identity and summaries). wasm-query-plans.json preserves actual
Worker EXPLAIN for default and player queries; the player candidate uses
game_players_player_idx and exact opposing-side PK membership checks.

Release B CI 37145196584 passed all 507 unit/workspace tests, 72 PostgreSQL 17
integration tests and six production SQLite E2E tests. Earlier CI 37144840942
stopped before deployment because the synthetic fixture hardcoded 4 KiB;
60c0fad replaces that assertion with the shared page/request constants. Actual
fixture generation, lint and the full remote rerun passed.

## Release B And Closeout

PR #2 merged normally as b6827a08f8a5e11676110e38416c10aa639dca31. Main CI
37146401258 and Publish 37146401357 both passed. Prepare ran the new ten-context
controlled gate before site publication: every run had 26 GETs / 884,836 bytes,
with median 7,678.7 ms. Its ordinary screenshot/206 smoke also passed. Public
candidate-browser-evidence-37146401357-1 was downloaded and inspected separately
from the post-deployment pages-browser-evidence-37146401357-1 artifact.

Actual Pages site-37146401357-1 advertises the merged code SHA, unchanged
checkpoint-3-37136621705-1 and unchanged logical snapshot. Deployed SQLite:
8,830,976 bytes, 4 KiB pages, 16 KiB requests, checksum
b3a1233c7f5468c597281f2d491f1aa860904d262df74b51ac7c79dd1ef13e23.
The deployment's physical checksum differs from the local exporter output;
the entire downloaded public database passed the manifest checksum, SQLite
integrity, logical snapshot digest and all 48 full paginated comparisons.
Independent counts: 819 variants, 1,066 series, 1,664 games, 16,640 game players.
Private Release inventory confirms checkpoint 3 remains published and no new
checkpoint was promoted by either rebuild. Known-good site-37144301983-1 remains
available for explicit rollback, retaining the compatible reader/4 KiB producer.

Hosted desktop/mobile each used 26 identity Range GETs and 884,836 bytes, with
readiness 2,204.3 / 1,524.3 ms. Root directly reviewed both downloaded screenshots.
Shared URL reload, saved comparisons, real player search, historical 2017 team
labels, player/image selection and mobile bounds passed. The decoded historical
PNG is 2400 x 1436 with 2.828% non-background detail; the visible-content gate
passed. No browser API calls or page errors occurred.

Fresh root workflow/retirement tests: 68 passed after recording public samples;
full code tests, typecheck/lint, 72 actual PostgreSQL tests and six real E2E tests
are covered by green remote CI. All ten temporary preview servers were stopped;
original persistent containers/volumes were not modified. Closeout records are
committed on the original design/github-pages-actions branch; deployed code is
main b6827a0.

Evidence links:
- https://github.com/cxyfer/RiftVersus/pull/1
- https://github.com/cxyfer/RiftVersus/pull/2
- https://github.com/cxyfer/RiftVersus/actions/runs/37145196584
- https://github.com/cxyfer/RiftVersus/actions/runs/37146401258
- https://github.com/cxyfer/RiftVersus/actions/runs/37146401357
- https://cxyfer.github.io/RiftVersus/

Impact and safety receipt: requirement/architecture aligned; no new runtime,
fact, identity, checkpoint or result-cache owner. Retired the old URL-identifier
comparison key, automatic immutable-result refetch and duplicate game membership
index. Keep archived 4 KiB transport support for recovery; retire it only when
the supported immutable inventory no longer needs it. Fresh parity, controlled
and hosted evidence covers the approved release criteria. Confidence B: real-user
latency percentiles and future dataset growth are not measured; broad queries
retain their documented storage/transfer trade-offs and may exceed ten seconds.
