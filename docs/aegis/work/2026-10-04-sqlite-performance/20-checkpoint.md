# SQLite Performance Execution Checkpoint

Status: completed, verified and deployed on 2026-10-04.
User approved implementation and deployment on 2026-10-04.
Parent: ../../plans/2026-10-04-sqlite-query-performance.md.
Branch: design/github-pages-actions. Preserve unrelated .gitignore edits.

Intent / baseline / impact: follow the parent execution readiness view; preserve
GitHub-only SQLite, exact fact/identity semantics, schema 2/3, legacy links and
checkpoint lineage. Change SQL, indexes, manifest validation, session cache and
existing measurement/publication owners only. No runtime fallback or new service.

## Tasks

1. Measurement/profile/baseline: committed 22aaa0f.
2. Selective SQL/indexes/parity: committed baa5782.
3. Compatible reader: 4955a18; PR #1 CI 37144057651 passed and merged
   as 7c36af1. Release A Publish 37144301983 passed hosted verification.
4. Canonical comparison reuse: 9552987; 29 App tests, lint/typecheck passed.
5. Unit selection: 64fc319 (16 KiB); gate: 9494152; fixture fix 60c0fad.
   PR #2 CI 37145196584 passed, merge b6827a0. Main CI 37146401258 and
   Release B 37146401357 passed all candidate/hosted checks.
6. Final evidence/runbook: complete in this closeout commit on the original
   branch. Deployed implementation is integrated on main b6827a0.

Evidence: prior diagnosis and proposal commits 7a1b05b / af917cf.
Blockers: none currently. Local screenshots previously time out; remote runner
screenshots remain mandatory. Local diagnostic contexts may use explicit DOM
measurements without claiming screenshot verification.
Next/blockers within approved scope: none. Full results: 90-evidence.md,
performance-results.json and wasm-query-plans.json. Historical execution notes
below preserve measured experiments and failures, superseded by final results.
Baseline: 10 runs, median 31,972.8 ms, 173 GETs and
913,508 bytes each. Profile tests (2), lint, build and typecheck passed. Candidate
SQL passed 13 tests and 48 complete production-data paginated comparisons.
Final SQL with unchanged 4 KiB request size: 77 GETs / 757,860 bytes / 16,474.9 ms.
Actual WASM EXPLAIN confirms covering subject-index candidates followed by
primary-key series lookups and series-index game lookups. All 504 unit/workspace
tests passed at that phase. Final request selection/targets are now verified.
Drift check: aligned; no source/fact/checkpoint authority changes.

CI exposed a pre-existing flaky inventory assertion: secondBundle includes the
first retained DB, so selecting its first DB by hash order is not ownership.
ea9c61c uses secondOwned; nine site-bundle tests and full remote CI passed.
Further measured SQL/index refinement avoids PK lookups for non-player
candidates, covers identity/series/game reads, and removes the duplicate
game_players_game_idx (the PK already has exactly its columns). Final candidate
ten cold runs at 16 KiB: 26 GETs, 884,836 bytes, median 8,362.3 ms.
48 full production paginated comparisons still match old SQLite/baseline.
Matrix also completed ten runs each at 4/32/64 KiB; 16 KiB is the smallest
passing unit. New DB is 8,830,976 bytes (25.35% growth versus original).
Actual Worker cache check confirms two initial comparison SQL statements and
26 GETs; canonicalization/repeat Apply/focus/online add neither SQL nor GETs.
60c0fad fixes the fixture's stale hardcoded request unit using shared constants
and adds bounded diagnostic summary timeout (gate budgets unchanged). Fixture
generation, lint and CI 37145196584 passed before integration.
Broad old team/player query needed 550 GETs / 4,423,780 bytes / 94.3 seconds,
so its first 90-second timeout was transport latency, not a UI loading error.
The rerun uses explicit five-minute diagnostic limits. Initial timeout evidence
is retained. All other required pairs completed three cold contexts per version,
with equal summaries and improved medians. Broad transfer increases and 19-27
second player-query medians remain documented limits, not default-budget claims.

Final runner-controlled median: 7,678.7 ms; 26 GETs / 884,836 bytes in each of
ten cold contexts. Actual hosted desktop/mobile: 2,204.3 / 1,524.3 ms with the
same reads; root reviewed both screenshots. Sharing/saving/player search,
historical names, visible PNG export and mobile bounds passed.
Full CI: 507 unit/workspace, 72 actual PostgreSQL 17 and six production E2E
tests. Independent full public SQLite checksum/logical digest and 48 complete
paginated comparisons passed on the deployed file. Facts: 1,066 series,
1,664 games, 16,640 game-player rows; 715 identity / 104 era route owners.
Checkpoint 3/its parent and logical snapshot remain unchanged. Recovery archive:
site-37144301983-1, with ordinary smoke and no new candidate performance budget.
Retired URL-key/refetch logic and duplicate membership index; retain archived
4 KiB support for recovery. All temporary preview servers are stopped;
original volumes/containers and unrelated .gitignore edits are preserved.
Confidence B: real-user percentiles/future datasets remain unmeasured.
