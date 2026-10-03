# SQLite Performance Execution Checkpoint

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
3. Compatible reader / Release A: reader verified; CI/deployment active.
4. Canonical comparison reuse: pending.
5. Unit selection / predeploy gate / Release B: pending.
6. Final evidence/runbook: pending.

Evidence: prior diagnosis and proposal commits 7a1b05b / af917cf.
Blockers: none currently. Local screenshots previously time out; remote runner
screenshots remain mandatory. Local diagnostic contexts may use explicit DOM
measurements without claiming screenshot verification.
Next: commit selective SQL and compatible reader, then CI and Release A.
Baseline: 10 runs, median 31,972.8 ms, 173 GETs and
913,508 bytes each. Profile tests (2), lint, build and typecheck passed. Candidate
SQL passed 13 tests and 48 complete production-data paginated comparisons.
Final SQL with unchanged 4 KiB request size: 77 GETs / 757,860 bytes / 16,474.9 ms.
Actual WASM EXPLAIN confirms covering subject-index candidates followed by
primary-key series lookups and series-index game lookups. All 504 unit/workspace
tests passed. Request-unit selection and final performance targets remain pending.
Drift check: continue; no source/fact/checkpoint authority changes proposed.
