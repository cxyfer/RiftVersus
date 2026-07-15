# RiftVersus MVP execution - Evidence

No evidence has been recorded yet.

## EvidenceBundleDraft

- Artifact key: task-01-foundation
- Type: verification
- Source: merge commit bca33db and task branch commits 229d382,7dcbab6
- Summary: Frozen install, lint, typecheck, build, unit, public consumer, integration config, and e2e discovery checks passed; spec and quality reviews approved after fixing two testing drifts.
- Verifier: controller commands plus independent subagent spec/quality reviews

## EvidenceBundleDraft

- Artifact key: task-02-contracts-config
- Type: verification
- Source: merge commit 295de3e; task commits 56581dc, ed88d14, 5ffc912
- Summary: Task 2 contracts and runtime configuration passed controller verification: contract tests 9, config tests 6, typecheck, lint, root consumer/unit tests, build, diff check; spec and independent quality reviews approved after validation fixes.
- Verifier: controller plus independent spec and quality reviewers

## EvidenceBundleDraft

- Artifact key: task-03-database-schema
- Type: verification
- Source: merge commit c84a7c3; task commits de6625d,c19a4bb,082c288,0f0e0af,774c4a2
- Summary: Task 3 schema/migrator passed controller static verification (consumer/unit test, typecheck, lint, build, CLI help, diff check) and spec/quality reviews after integrity hardening. PostgreSQL integration command ran twice but skipped because TEST_DATABASE_URL is unset; Docker CLI unavailable.
- Verifier: controller plus independent spec and quality reviewers

## EvidenceBundleDraft

- Artifact key: task-04-domain-semantics
- Type: verification
- Source: merge commit f37df06; task commits 53fca222,9b3ca445,1097aad,80dfa2b,8499584
- Summary: Task 4 pure comparison/classification/grouping oracle passed controller verification: domain 19 tests, root consumer/unit tests, typecheck, lint, build, diff check; spec and quality reviews approved after grouping and identity fixes.
- Verifier: controller plus independent spec and quality reviewers

## EvidenceBundleDraft

- Artifact key: task-05-repositories-publication
- Type: verification
- Source: merge eba4f0d; task commits e45eb8e,a404d93,03131ac,66ba5a9,0415fa4,3fb7f7a,1e20751,7a4c7f8,acc9ed3,94f82d6,a266d9a,bd0a963,21f1612,e90b3fb
- Summary: Task 5 repositories/publication passed static controller verification and dual reviews. Root consumer/unit, typecheck, lint, build and integration typecheck pass; 11 PostgreSQL runtime integration cases are skipped because TEST_DATABASE_URL is unset.
- Verifier: controller plus independent spec and quality reviewers

## EvidenceBundleDraft

- Artifact key: task-06-http-api
- Type: verification
- Source: merge f9daac9; task commits 3f42f7e,c3d728f,b190ac2,c97df4c
- Summary: Task 6 Fastify API passed controller verification: server tests 22, filtered server build, root consumer/unit tests, typecheck, lint, build, CLI help, spec and independent quality review.
- Verifier: controller plus independent spec and quality reviewers

## EvidenceBundleDraft

- Artifact key: task-10-web-comparison
- Type: verification
- Source: merge b7946c1; task commits 69c4a90,d8b4b9a,d3903cb,7e8f4b2,038185a,25ad9a9
- Summary: Task 10 comparison SPA, production HTTP client, URL query contract, local saved comparisons, controlled media delivery and S3-compatible ObjectStore passed controller and independent reviews. Controller verification: sync 4 tests, server 30 tests, web 18 tests, consumer/unit tests, typecheck, lint, build. Browser screenshots were inspected; Playwright runner produced no reliable final summary.
- Verifier: controller plus independent spec, quality, media-security, and S3-security reviewers

## EvidenceBundleDraft

- Artifact key: task-11-browser-export
- Type: verification
- Source: merge 77756f6; task commits e8848fb,8a0e55b,5b5de64
- Summary: Task 11 browser-only PNG/ZIP export passed spec and quality reviews. Controller verification: web 38 tests, web production build, typecheck, lint, root consumer/unit tests and build. Elevated local loopback Playwright 3/3 verified the comparison journey, PNG signature, and ZIP entries with PNG signatures.
- Verifier: controller plus independent spec and quality reviewers

## EvidenceBundleDraft

- Artifact key: leaguepedia-task-01-sync-runner
- Type: verification
- Source: merge 901f481; task commits 9b8254a,31dd9dc,428cafd,bd26fab
- Summary: Provider-neutral runSync, immutable S3-compatible retention, bounded media downloader, scheduler and PostgreSQL advisory-lock callback contract passed controller verification: sync 44/44, server 30/30, root consumer/unit tests, typecheck, lint, build and diff check. Spec and independent quality reviews approved after lock ownership, fail-closed metadata and response-body cleanup fixes. Real PostgreSQL, S3-compatible storage and undici integration remain unverified in this environment.
- Verifier: controller plus independent spec and quality reviewers

## EvidenceBundleDraft

- Artifact key: leaguepedia-task-02-provider-adapter
- Type: verification
- Source: merge b442e4b; task commits 1cce867,ffdd239,5344b8d,eeb9f0b,4220a19,d4ba40b,93b017b,3085b1a
- Summary: Hardened Leaguepedia provider passed controller verification: sync 99/99, server 30/30, root consumer/unit, typecheck, lint, build and diff check. Final spec regression and independent quality review approved after raw-only replay, staged dimensions, strict roster authority, rate-limit retry, resource budgets, era/region selection and per-logical coverage aggregation fixes. Bounded official siteinfo and T1 page probes succeeded after approved network retry; no bulk Cargo assertion was used.
- Verifier: controller plus independent spec and quality reviewers; bounded official Leaguepedia API probe

## EvidenceBundleDraft

- Artifact key: leaguepedia-task-03-publication-cli
- Type: verification
- Source: merge 6e93837; task commits f42af05,377b489,0ab7a56,1f2eb02,4e824e8,7c8373e,81b033e
- Summary: Leaguepedia database publication and CLI composition passed controller verification: sync 103/103, server 46/46, root unit 3/3, consumer, typecheck, lint, build, CLI help and diff check. Spec and independent quality reviews approved after year-aware mapping, per-run override provenance, scope retirement, shared media objects, provider binding, migration downgrade guards and honest synthetic fixture provenance fixes. PostgreSQL integration suite loads 4 files/24 tests but all skip because TEST_DATABASE_URL is unset; Docker/S3 runtime acceptance remains open.
- Verifier: controller plus independent spec and quality reviewers

## EvidenceBundleDraft

- Artifact key: leaguepedia-task-04-oracle-retirement
- Type: verification
- Source: merge af9b823; task commits 4a3e0c4,0ece7e4,dd21265,c218d60
- Summary: Oracle MVP source retirement and Leaguepedia operator documentation passed controller verification: server 99/99, sync 103/103, root/guard 35/35, consumer, typecheck, lint, build, CLI help, Aegis workspace check and diff check. Spec and independent quality reviews approved after tracked-file scan authority, policy-line hardening, endpoint/User-Agent/media-host validation and placeholder rejection. Active runtime/config/package paths contain no retired provider/fallback; historical docs/aegis evidence remains preserved.
- Verifier: controller plus independent spec and quality reviewers

## EvidenceBundleDraft

- Artifact key: deterministic-avatar-task-01
- Type: test-and-review
- Source: apps/server/src/avatar.ts; apps/server/src/routes/avatar.ts; apps/server/test/avatar.test.ts; apps/server/test/app.test.ts
- Summary: Strict TDD RED/GREEN complete; targeted 30/30, server 128/128, typecheck/scoped lint/diff pass; UUID collision and case identity regressions closed; encoded namespace bypass closed; spec COMPLIANT and quality APPROVED.
- Verifier: avatar_route_spec_reviewer and avatar_route_quality_reviewer

## EvidenceBundleDraft

- Artifact key: task5b-lint-cleanup
- Type: verification
- Source: packages/sync/src/providers/leaguepedia/fetch.ts; packages/sync/test/leaguepedia.test.ts
- Summary: Delete-first cleanup removed three dead bindings from prior Task5B refactor; sync 166/166, root lint/typecheck, targeted eslint, and diff check pass.
- Verifier: task5b_snapshot_implementer

## EvidenceBundleDraft

- Artifact key: deterministic-avatar-task-02
- Type: test-and-review
- Source: packages/database/src/repositories/presentation.ts; packages/database/src/repositories/entities.ts; packages/database/src/repositories/comparison.ts; packages/database/test/presentation.integration.test.ts; packages/database/test/comparison.integration.test.ts
- Summary: Strict TDD repository resolver complete; real PG17 RED and GREEN; DB integration 34/34 zero skip; consumer/typecheck/lint/diff pass; exact-era inconsistency fixed; spec COMPLIANT and quality APPROVED.
- Verifier: presentation_resolver_spec_reviewer and presentation_resolver_quality_reviewer

## EvidenceBundleDraft

- Artifact key: deterministic-avatar-task-03
- Type: verification
- Source: Task3 strict TDD and fresh independent reviews
- Summary: Schema v2 retained/generated acceptance union. RED 19 of 21, GREEN targeted 23 of 23, server 135 of 135, root test build typecheck lint and diff passed. Spec COMPLIANT and quality APPROVED. Version 1 reviewed path retired.
- Verifier: root, acceptance_union_spec_reviewer, acceptance_union_quality_reviewer

## EvidenceBundleDraft

- Artifact key: task5-integration-harness
- Type: verification
- Source: Isolated PostgreSQL 17 flake investigation and independent reviews
- Summary: Root cause was Kysely database-global migration advisory lock across schema-isolated file workers. Native Vitest file serialization repaired teardown race. Strict RED and GREEN passed. Four fresh full runs each passed 35 of 35 with zero skips, isolated migrations 9 of 9, unit 46 of 46, lint typecheck and diff passed. Spec COMPLIANT and quality APPROVED.
- Verifier: root, migration_parallel_debugger, migration_harness_spec_reviewer, migration_harness_quality_reviewer

## EvidenceBundleDraft

- Artifact key: task5-postgresql-date-boundary
- Type: test-and-review
- Source: packages/database/src/db.ts; packages/database/src/repositories/dataset.ts; test/database-date-parser.test.ts; packages/database/test/sync-publication.integration.test.ts
- Summary: Per-pool PostgreSQL OID 1082 parsing now preserves exact ISO calendar dates without global parser state while timestamp types remain Date objects. Invalid, infinity, BC and five-digit dates fail closed. Fresh PostgreSQL 17 integration passed 38 of 38 with zero skips; query-plan budgets passed; prior focused Apia runs and independent spec and quality reviews approved.
- Verifier: root, database date boundary spec reviewer, database date boundary quality reviewer

## EvidenceBundleDraft

- Artifact key: task5-official-leaguepedia-acceptance
- Type: reviewed-live-evidence
- Source: Leaguepedia Cargo live snapshot; data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json; apps/server/src/acceptance.ts; final PostgreSQL and object storage publication
- Summary: Official Leaguepedia backfill published dataset leaguepedia-bbb75c5f7cab4b7693536c3f002feaff09a5f11c894063d6dd151d20f1edb100 generation 1 with complete Worlds coverage for 2013 through 2025. Reviewed T1 versus LPL Worlds BO5 snapshot proves 12-0 series and 36-9 games across 12 rows and 45 game IDs, with 57 of 57 facts linked to retained raw source checksum 0f5b3a..., exact page and revision provenance, deterministic T1 and LPL avatars, strict legal attribution gate, and independent reviewer metadata. Packaged no-argument acceptance CLI returned ready with no blockers.
- Verifier: root, codex-independent-runtime-review, final_snapshot_packager

## EvidenceBundleDraft

- Artifact key: task5-docker-release-gates
- Type: release-verification
- Source: Docker image sha256:03bf367a2357eec67d5df48c2bd29cb2ff3f391182f6a43f932d126cdcb1dd48; PostgreSQL 17 integration; Playwright production and mock suites
- Summary: Final docs-inclusive image is 178705613 bytes, runs as node UID 1000, contains no first-party source or tests, and preserves host-image acceptance and operations hashes. App is healthy; comparison and avatars return HTTP 200; Node VmRSS measured 122680 kB idle and 122792 kB after one reviewed request. Fresh root tests passed 59 unit, 9 contracts, 19 domain, 166 sync, 150 server and 38 web; PostgreSQL integration passed 38 of 38 zero skip; production Playwright passed 4 of 4 and mock PNG/ZIP passed 3 of 3 zero skip. Release E2E also covers avatar 404 fallback with PNG export, API 503 and 390 by 844 layout.
- Verifier: root, final_snapshot_packager, task4_e2e_verifier, release_e2e_spec_reviewer, release_e2e_quality_reviewer

## EvidenceBundleDraft

- Artifact key: task5-signed-release-final
- Type: release-verification
- Source: Signed acceptance snapshot sha256:9a0fa96fc48323a7572af0e5ed41c3e295d1ba7b1d38e8d159639c7140c283a9; Docker image sha256:888634625239f48d1271a3c4aa6fc686ec038ed34d608498616ea3703c0b6cc9
- Summary: Fresh independent review approved the exact 2013 through 2025 coverage snapshot; metadata-only reconstruction equals approved pending hash 1289e819463b11881df3be8d5a9451f88433c6508c9815e25667d6e75ac3d609. Final image is 178714360 bytes and runs as node UID 1000. Packaged no-argument acceptance is ready with no blockers, exact 13 complete coverage rows, 12-0 series and 36-9 games. Release Playwright passed 4 of 4 and mock PNG and ZIP passed 3 of 3 with zero skips. Node VmRSS was 127040 kB idle and after one request. PostgreSQL, MinIO and named volumes were preserved.
- Verifier: root, codex-independent-coverage-snapshot-review, final_snapshot_packager, task4_e2e_verifier, task5_final_quality_reviewer

## EvidenceBundleDraft

- Artifact key: task5-slice-coverage-fail-closed
- Type: test-and-review
- Source: packages/sync/src/providers/leaguepedia/fetch.ts; packages/sync/test/leaguepedia.test.ts
- Summary: Executable cross-slice mutation proofs showed that declared scope alone could misclassify schedule and player traversals as complete. The canonical replay parser now requires both declared scope ID union and actual selected response row ID union to cover every required match and game while allowing legitimate shared envelopes. Original and widened declaration swaps fail closed; shared evidence remains valid. Sync passed 171 of 171 and independent quality re-review approved with no findings.
- Verifier: root, slice_scope_completeness_fix, task5_final_quality_reviewer

## EvidenceBundleDraft

- Artifact key: task5-exact-coverage-contract
- Type: test-and-review
- Source: apps/server/src/acceptance.ts; packages/database/src/repositories/sync.ts; data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json
- Summary: Acceptance version 2 now records and validates exactly 13 Leaguepedia Worlds complete coverage rows for 2013 through 2025. Repository evidence is selected from the same dataset version and compared by all coverage fields; missing, extra, duplicate, partial and date drift fail closed. Empty series ID lookup and unknown dataset evidence are explicit. Server passed 152 of 152 and isolated PostgreSQL passed 39 of 39 with zero skips. Independent source and runtime review approved.
- Verifier: root, acceptance_coverage_contract_fix, codex-independent-coverage-snapshot-review

## EvidenceBundleDraft

- Artifact key: task5-docker-release-gates
- Type: benchmark-and-release-precursor
- Source: Pre-signing benchmark image sha256:03bf367a2357eec67d5df48c2bd29cb2ff3f391182f6a43f932d126cdcb1dd48; PostgreSQL 17.10; MinIO; host-to-container HTTP sampling
- Summary: This artifact preserves the read-only retained-data and API benchmark environment, not the final signed image. PostgreSQL occupied 17069747 bytes; source_objects and MinIO each held 6 objects totalling 52966661 bytes; persisted media was 0 objects and 0 bytes. Sequential warmup-5 sample-50 nearest-rank p95 was 9.533 ms for entity search and 18.215 ms for the reviewed comparison. The former image, RSS and test counts are superseded as release authority by task5-signed-release-final; packaged operations documentation explicitly prevents self-referential final digest claims.
- Verifier: root, release_evidence_adr_fix, task5_final_spec_reviewer

## EvidenceBundleDraft

- Artifact key: task5-official-leaguepedia-acceptance
- Type: reviewed-live-evidence
- Source: Signed snapshot sha256:9a0fa96fc48323a7572af0e5ed41c3e295d1ba7b1d38e8d159639c7140c283a9; official Leaguepedia raw evidence; PostgreSQL generation 1; MinIO immutable object
- Summary: Fresh reviewer codex-independent-coverage-snapshot-review approved the exact pending candidate at 2026-07-15T11:18:03Z; mechanical review metadata replacement reconstructs the approved hash. The signed snapshot pins dataset leaguepedia-bbb75c5f7cab4b7693536c3f002feaff09a5f11c894063d6dd151d20f1edb100, exact 13 complete Worlds coverage rows for 2013 through 2025, 12-0 series, 36-9 games, 12 series and 45 games. All 57 facts use latest reviewed raw lineage; page, revision, legal attribution and deterministic avatar hashes were independently checked. This supersedes the earlier runtime-review-only snapshot record.
- Verifier: root, codex-independent-coverage-snapshot-review, final_snapshot_packager

## EvidenceBundleDraft

- Artifact key: task5-signed-release-final
- Type: release-verification
- Source: Signed snapshot sha256:9a0fa96fc48323a7572af0e5ed41c3e295d1ba7b1d38e8d159639c7140c283a9; convergence Docker image sha256:9c5ac7e7bd8d51dcd3fe063175c4da1a03a2e42aaadf41089a78eb6785577751
- Summary: Authoritative convergence artifact after evidence wording synchronization. Final image is 178714861 bytes, runs as node UID 1000, contains no first-party source or tests, and exactly packages the signed snapshot plus six operator documents. Packaged acceptance is ready with no blockers, exact 13 complete Worlds coverage rows for 2013 through 2025, 12-0 series and 36-9 games. Release Playwright passed 4 of 4 and mock PNG and ZIP passed 3 of 3 with zero skips. Node VmRSS was 98040 kB idle and 98416 kB after one reviewed request. PostgreSQL, MinIO and named volumes were preserved. The earlier 888634 artifact is superseded by this docs-only convergence build.
- Verifier: root, codex-independent-coverage-snapshot-review, final_snapshot_packager, task4_e2e_verifier, task5_final_spec_reviewer, task5_final_quality_reviewer
