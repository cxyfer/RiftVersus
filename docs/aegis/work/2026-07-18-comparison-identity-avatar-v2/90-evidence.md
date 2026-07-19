# Comparison Identity and Canonical Avatar v2 - Evidence

## Task 1 - Typed Player Identity and Migration 009

- Contracts: `rtk pnpm --filter @riftversus/contracts test` - 12 passed.
- Migration safety unit tests: 3 passed.
- Typecheck: `rtk pnpm typecheck` - passed.
- Targeted ESLint: passed.
- Database integration suite: 5 passed, 37 skipped because
  `TEST_DATABASE_URL` is not configured.
- Specification review: passed after adding behavioral invalid-ID cases.
- Code-quality review: passed after adding an `ACCESS EXCLUSIVE` downgrade
  lock, successful downgrade/remigration coverage, deterministic concurrency
  coverage, and catalog-based index assertions.
- Live PostgreSQL 17 integration gate: migration, rollback, downgrade lock,
  and concurrency cases passed as part of the 61-test full suite.
- Git evidence: local repository metadata was restored from the externally
  managed `/tmp/RiftVersus.git`; `main` resolves to `d6d39dd` and all worktree
  changes remain present.

## Task 2 - Leaguepedia Player Identity Publication

- Sync tests: 177 passed.
- Typecheck and targeted ESLint: passed.
- Database publication integration: 24 passed against live PostgreSQL 17.
- Specification review: passed after adding normalizer and repository batch
  consistency checks plus exact alias fixtures.
- Code-quality review: passed after extending immutable batch invariants,
  adding a true existing-database conflict case, covering input-order
  permutations, improving diagnostics, and correcting preflight evidence
  naming.
- Runtime repair: the first live run exposed a discarded batch-merge result
  that caused duplicate canonical entity mutations and slug conflicts. The
  repository now mutates validated merged rows once per canonical ID; Task 2
  specification and quality re-reviews passed.

## Task 3 - Player Search and Presentation

- Web tests: 49 passed.
- Focused database tests and PostgreSQL-backed cases passed in the full live
  integration suite.
- Typecheck, targeted ESLint, and diff whitespace check: passed.
- Specification review: passed with no findings.
- Code-quality review: passed after fixing free-text versus selected-ID state,
  listbox semantics, literal LIKE escaping, false-positive assertions, and
  duplicate option subtitles.
- Residual evidence gap: one- and two-character substring queries have no guaranteed trigram
  selectivity without a separate search-contract and index decision.

## Task 4 - Historical Team Row Names

- Web tests: 52 passed.
- Sync tests: 177 passed.
- Full PostgreSQL 17 integration suite: 6 files, 61 tests passed, zero skipped.
- Typecheck, targeted ESLint, and diff whitespace check: passed.
- Specification review: passed after adding era/team publication invariants,
  team-owned era joins, exact nine-kind row assertions, and production-like
  pagination behavior.
- Code-quality review: passed after verifying 50/50/1 pagination, final-page
  cursor retirement, fail-closed mock identities, transaction atomicity, and
  live PostgreSQL query behavior.
- Drift decision: `continue`; summaries remain selected-subject presentation,
  rows are historical teams, and no UI row-name fallback remains.

## Task 5 - Canonical Avatar v2

- Focused server tests: 47 passed.
- Focused presentation and query-plan tests: 18 passed.
- Full PostgreSQL 17 integration suite: 6 files, 63 tests passed, zero skipped.
- Typecheck, lint, and diff whitespace check: passed.
- Specification and code-quality reviews: passed with no remaining findings.
- First-principles correction: v2 keeps the exact canonical route and current
  typed label, but uses `Cache-Control: public, no-cache` plus checksum ETag
  revalidation instead of the inconsistent immutable-cache assumption.
- Published visibility is now a shared repository predicate used by search,
  comparison, media, and avatar resolution.
- Retirement evidence: no v1 generator, redirect, adapter, or unversioned main
  route remains; the unversioned route is covered by a negative `404` test.
- Residual boundary: Task 6 acceptance and E2E artifacts still carry the old
  generator signature and v1 evidence, so the aggregate server suite is not
  yet green by design.

## Task 6 - Acceptance, Browser, Export, and Snapshot

- Server tests: 172 passed.
- Web tests: 52 passed.
- Acceptance-focused tests: 43 passed.
- Direct Playwright using the repository config: 3 passed.
- Full PostgreSQL 17 integration suite: 63 passed, zero skipped.
- Typecheck, lint, and diff whitespace check: passed.
- Snapshot evidence: 12 unique reviewed series, 45 unique game IDs, historical
  team/team-era names verified against PostgreSQL, and both v2 avatar checksums
  recomputed from current generator bytes.
- Independent snapshot review metadata: `codex-task6-independent-snapshot-review`
  at `2026-07-18T09:05:46Z`.
- Specification and code-quality reviews: passed with no remaining findings.
- Residual runtime drift: the existing `:3001` deployment still serves an old
  app and a different dataset publication; Task 7 must rebuild/migrate/publish
  the current runtime before release E2E and acceptance can close.

## Task 7 - Runtime publication and governance closeout

- Fresh clean gates passed: `pnpm test` (60 unit, 12 contracts, 19 domain, 177
  sync, 172 server, 52 web), typecheck, lint, and `git diff --check`.
- Live PostgreSQL integration passed 63/63 with zero skipped; direct Playwright
  passed 3/3; release E2E against `http://127.0.0.1:3001` passed 4/4.
- Pre-009 backup:
  `/tmp/riftversus-task7-pre-009-20260718.dump`, SHA-256
  `24bf0ea9e49e46083a4837a1cd1cf8d8a5905b4de0d2aa4a38d3400d417e4c7d`.
- Migration `009_player_public_id` applied additively; no PostgreSQL/MinIO
  persistent data, named volumes, or source objects were deleted.
- Fresh full Worlds publication succeeded as run
  `34265be3-d0a3-48b5-aeeb-c160b573672e`, generation `4`, dataset
  `leaguepedia-a9277cebd9d2be1006b8e35d41d41af06d599507741c0770615a76489d33c7a`.
  Coverage is 13/13 complete for 2013-2025, with 686 active series and 1005
  active games; warnings/errors were zero.
- New raw source object is
  `sources/leaguepedia/b3578141b05bd9faa8a0083e1322dfe5d608e5ecca2906a01bab18c3b89fdbba`
  (10,803,603 bytes); T1 revision `4486594`, SK Telecom T1 revision `4436217`,
  retrieved `2026-07-18T09:37:59.560Z`.
- Player publication populated 514/600 IDs; Faker resolves to
  `Faker (Lee Sang-hyeok)` in search and database evidence.
- Strict production acceptance inside the rebuilt app returned `ready` with no
  blockers: 12/0 series, 36/9 games, 12 unique series, and 45 unique games.
- Runtime smoke confirmed historical team row names, v2 avatar response and
  checksum ETag revalidation (`304`), and v1 route `404`.
- The exact new snapshot was independently reviewed by
  `codex-task7-gen4-independent-spec-review` at `2026-07-18T09:54:06Z`; quality
  review also found no candidate findings. ADR-0001 was amended and the
  2026-07-18 release baseline was created/indexed.
- Final independent code-quality review found no Critical, Important, or Minor
  findings; the Aegis workspace check and proof bundle both passed.

## EvidenceBundleDraft

- Artifact key: task7-runtime-gen4-release
- Type: release-verification
- Source: gen4 Leaguepedia backfill, Docker app runtime, data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json, production acceptance CLI, Playwright release E2E
- Summary: Fresh gen4 publication leaguepedia-a9277cebd9d2be1006b8e35d41d41af06d599507741c0770615a76489d33c7a passed 13/13 Worlds coverage, strict acceptance ready, release E2E 4/4, integration 63/63, and v2/v1 runtime probes.
- Verifier: root; codex-task7-gen4-independent-spec-review; codex-task7-independent-snapshot-review
