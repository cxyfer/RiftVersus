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

## SQL Work In Progress

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
