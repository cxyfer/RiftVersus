# RiftVersus MVP execution - Checkpoint

- Task ID: 2026-07-12-riftversus-mvp
- Current todo: bootstrap Git baseline and create isolated worktree
- Active slice: pre-task bootstrap
- Blocked on: none
- Next step: commit baseline then create task-1 worktree

## Checkpoint Update

- Current todo: 選定 worktree 位置並建立 Task 1 隔離工作樹
- Active slice: pre-task bootstrap complete
- Completed todos:
- Git metadata 初始化於 /tmp/RiftVersus.git；加入 .gitignore；建立 Aegis work records；commit 79eabe6
- Evidence refs:
- git commit 79eabe6: 🎉 init: establish project baseline
- Blocked on: 需要依 using-git-worktrees 選擇 worktree 位置
- Next step: 使用者選擇 project-local .worktrees 或 /tmp isolated worktree

## DriftCheckDraft

- Scope status: Task 1 only; no runtime database, API, provider, UI, or Docker behavior added.
- Compatibility status: Workspace dependency direction and public package-entry boundary preserved.
- Retirement status: No retired D1, Rust, SQLite, Redis, runtime-scraping, or server-Chromium path introduced.
- New risk signals:
- Docker remains environment-unverified; Task 2 introduces contracts/config only.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Execute Task 2 contracts and runtime configuration in a new isolated worktree
- Active slice: Task 2 preparation
- Completed todos:
- Task 1 workspace foundation merged to main after spec compliance and code-quality reviews
- Evidence refs:
- main merge commit for feat/task-01-foundation; Task 1 all checks passed and reviews approved
- Blocked on: none
- Next step: Create feat/task-02-contracts worktree and dispatch Task 2 implementer

## DriftCheckDraft

- Scope status: Task 2 only: shared contracts, server config, tests, and env template; no DB, route, provider, UI, or Docker work.
- Compatibility status: Public contract ownership remains solely @riftversus/contracts; config ownership remains server; invalid dates and unsafe/non-HTTP S3 endpoints now fail before runtime.
- Retirement status: No legacy owner, compatibility fallback, or retired path added.
- New risk signals:
- Docker integration remains environment-unverified until Docker Desktop/daemon is available.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Execute Task 3 canonical PostgreSQL schema and migrator
- Active slice: Task 2 complete; Task 3 preparation
- Completed todos:
- Task 2 shared Zod contracts and server runtime configuration merged after review
- Evidence refs:
- Task 2 merge 295de3e; evidence artifact task-02-contracts-config
- Blocked on: none
- Next step: Create an isolated Task 3 worktree and dispatch the canonical schema/migrator slice.

## DriftCheckDraft

- Scope status: Task 3 canonical PostgreSQL persistence only; added internal audit table as required provenance integrity, no repositories/domain/API/provider/UI/Docker.
- Compatibility status: Database remains sole schema owner; contracts vocabulary aligned; fact rows retain no dataset_version_id; canonical facts require durable source/override audit authorization.
- Retirement status: No legacy owner or fallback introduced.
- New risk signals:
- Real PostgreSQL migration, PL/pgSQL trigger, security-definer and rollback behavior remain unverified until TEST_DATABASE_URL is supplied; Docker CLI unavailable. Quality review also suggests optional assertions for public metadata invariance and writer-owned decoy schema.
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: Execute Task 4 comparison and classification domain rules
- Active slice: Task 3 complete with runtime verification gap; Task 4 preparation
- Completed todos:
- Task 3 canonical PostgreSQL schema, migrator, safe test harness, and integrity constraints merged after reviews
- Evidence refs:
- Task 3 merge c84a7c3; evidence artifact task-03-database-schema
- Blocked on: No TEST_DATABASE_URL for real PostgreSQL acceptance evidence; does not block pure Task 4 domain implementation.
- Next step: Create Task 4 isolated worktree and dispatch pure domain-rule implementation.

## DriftCheckDraft

- Scope status: Task 4 only: pure domain comparison, classification, grouping and fixtures; no database, provider, API, UI, or Docker changes.
- Compatibility status: Domain is the single semantic oracle without database imports; API contracts remain @riftversus/contracts and persistence remains @riftversus/database.
- Retirement status: No legacy logic, fallback, or second semantic owner added.
- New risk signals:
- Task 3 real PostgreSQL integration remains unverified until TEST_DATABASE_URL is supplied.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Execute Task 5 canonical repositories, comparison SQL, and sync publication
- Active slice: Task 4 complete; Task 5 preparation
- Completed todos:
- Task 4 pure domain comparison/classification/grouping oracle merged after reviews
- Evidence refs:
- Task 4 merge f37df06; evidence artifact task-04-domain-semantics
- Blocked on: No TEST_DATABASE_URL for Task 3 PostgreSQL runtime evidence; Task 5 integration tests will require the same safe connection.
- Next step: Create Task 5 isolated worktree and implement repositories plus comparison/publication integration tests.

## DriftCheckDraft

- Scope status: Task 5 canonical database repositories, migrations, and tests only; no API/provider/UI/Docker changes.
- Compatibility status: Facts remain current canonical rows without dataset_version_id; publication_generation is an atomic visibility fence, versions append-only; Task4 domain stays semantic oracle.
- Retirement status: No legacy repository owner or fallback introduced.
- New risk signals:
- 11 PostgreSQL integration tests, migrations, triggers, publication locks and EXPLAIN plans remain runtime-unverified until TEST_DATABASE_URL is provided.
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: Execute Task 6 Fastify application, routes, caching and health checks
- Active slice: Task 5 complete with PostgreSQL runtime verification gap; Task 6 preparation
- Completed todos:
- Task 5 canonical repositories, comparison SQL, publication visibility and integration test harness merged after reviews
- Evidence refs:
- Task 5 merge eba4f0d; evidence artifact task-05-repositories-publication
- Blocked on: No TEST_DATABASE_URL for real PostgreSQL runtime evidence; does not block API unit/inject tests.
- Next step: Create Task 6 isolated worktree and implement Fastify app/routes with dependency injection.

## DriftCheckDraft

- Scope status: Task 6 HTTP API, CLI, static fallback and tests only; no provider, sync, database schema, UI or Docker changes.
- Compatibility status: Routes consume contracts/repositories through DI; no provider imports; API errors remain structured and media is reserved without proxying.
- Retirement status: No legacy route owner or fallback introduced.
- New risk signals:
- Task 3/5 PostgreSQL runtime integration remains unverified until TEST_DATABASE_URL is supplied.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Execute Task 7 sync orchestration, object storage, and source-access proof
- Active slice: Task 6 complete; Task 7 preparation
- Completed todos:
- Task 6 Fastify API, caching, health checks, static boundary and CLI serve merged after reviews
- Evidence refs:
- Task 6 merge f9daac9; evidence artifact task-06-http-api
- Blocked on: No TEST_DATABASE_URL for PostgreSQL runtime evidence; does not block sync unit tests and source manifest proof.
- Next step: Create Task 7 isolated worktree and implement sync runner, S3 boundary and reviewed source manifest.

## DriftCheckDraft

- Scope status: Task 10 delivered the comparison SPA plus the minimal cross-owner league filter and media storage boundary required for truthful filters and same-origin subject media; no provider adapter or export behavior was added.
- Compatibility status: Public comparison URL remains canonical; leagues are now validated through contracts, HTTP normalization and PostgreSQL query planning. Server routes use injected ObjectStore, with sync as storage owner; no raw upstream media URL is served.
- Retirement status: No D1, SQLite, Rust, runtime scraper, alternate API model, provider fallback, or direct upstream media proxy was introduced.
- New risk signals:
- PostgreSQL integration tests remain unavailable without TEST_DATABASE_URL; Docker unavailable; Playwright runner created a journey but did not return a reliable final result.
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: Resolve Oracle public direct-download source access, then execute Task 7 sync orchestration and source manifest
- Active slice: Task 10 complete; Task 7 source-access checkpoint
- Completed todos:
- Task 10 comparison web experience and controlled media delivery merged after spec and security reviews
- Evidence refs:
- Task 10 merge b7946c1; evidence artifact task-10-web-comparison
- Blocked on: A publicly verifiable Oracle CSV direct URL/header proof is unavailable; the plan forbids guessing file identifiers or parsing the downloads-page HTML.
- Next step: Obtain an approved public direct Oracle CSV URL or choose a different reviewed provider/source, then create the Task 7 worktree.

## DriftCheckDraft

- Scope status: Task 11 added browser-only export using the existing web API adapter; no server rendering, provider access, database schema, or Docker behavior was added.
- Compatibility status: Export validates immutable dataset/query across cursor pages before rendering and uses same-origin or data-image media with placeholder fallback. It does not change comparison meaning or API ownership.
- Retirement status: No Chromium runtime, server render endpoint, raw provider media URL, D1, SQLite, Rust, runtime scraper, or second export path was introduced.
- New risk signals:
- PostgreSQL integration, Docker stack and source access remain unverified; Task 11 e2e passed only under elevated local loopback because the sandbox cannot bind 127.0.0.1.
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: Resolve Oracle public direct-download source access, then execute Task 7 sync orchestration and source manifest
- Active slice: Task 11 complete; Task 7 source-access checkpoint
- Completed todos:
- Task 11 browser PNG/ZIP export merged after spec and quality reviews
- Evidence refs:
- Task 11 merge 77756f6; evidence artifact task-11-browser-export
- Blocked on: A publicly verifiable Oracle CSV direct URL/header proof is unavailable; the plan forbids guessing file identifiers or parsing the downloads-page HTML.
- Next step: Obtain an approved public direct Oracle CSV URL or choose a different reviewed provider/source, then create or resume the Task 7 worktree.

## Checkpoint Update

- Current todo: Await a verified Oracle direct CSV source decision before Task 7; do not merge incomplete Task 9 branch
- Active slice: Task 7/9 integration source-access gate
- Completed todos:
- Task 9 pure adapter branch was reviewed and intentionally withheld because it cannot safely integrate media cache/coverage without Task 7 runner
- Evidence refs:
- Task 9 branch d95c3a2 spec review found blocking runner/integration and client allowlist gaps; no merge
- Blocked on: No official publicly verifiable Oracle CSV direct URL/header exists in available evidence. Task 7 plan prohibits guessing identifiers or parsing download-page HTML. Task 9 depends on Task 7 single runner for media caching, coverage persistence and atomic publication.
- Next step: User must provide an official public Oracle CSV direct URL with header evidence, or explicitly approve a reviewed alternative source/provider; then finish Task 7 before reworking Task 9.

## DriftCheckDraft

- Scope status: No mainline code changes in this slice. Task 9 branch is deliberately unmerged because the plan requires Task 7 runner-owned media caching and coverage publication.
- Compatibility status: Keeping Task9 unmerged preserves the single publication/visibility owner. It avoids an alternate direct provider-to-database/media path.
- Retirement status: No live Oracle source, second sync runner, raw media proxy, D1, SQLite, Rust or provider fallback was introduced.
- New risk signals:
- Task9 review found public client parameters could override the action allowlist; branch remains unmerged and must be fixed after Task7 source decision.
- Advisory decision: pause-for-user

## Checkpoint Update

- Current todo: Execute Leaguepedia-primary replacement Task 1: provider-neutral sync runner and immutable storage
- Active slice: Leaguepedia source redesign approved; planning complete; Task 1 preparation
- Completed todos:
- User approved Leaguepedia as MVP source; source design amendment and replacement implementation plan created
- Evidence refs:
- docs/aegis/specs/2026-07-12-leaguepedia-primary-mvp-design.md; docs/aegis/plans/2026-07-12-leaguepedia-primary-mvp.md
- Blocked on: Real PostgreSQL/Docker integration remains unavailable in the current environment; unit implementation can proceed.
- Next step: Commit the approved source amendment, create a fresh Task 1 worktree from main, and dispatch the sync-runner implementer.

## DriftCheckDraft

- Scope status: Source architecture now uses Leaguepedia as the only MVP upstream; completed API/web/export work remains unchanged.
- Compatibility status: One PostgreSQL generation and one runSync publication owner remain mandatory. Oracle is retired from MVP runtime rather than retained as a fallback.
- Retirement status: Oracle planned manifest/CSV adapter/acceptance paths are delete-first code-retirement targets; no persistent Oracle state exists.
- New risk signals:
- Leaguepedia Cargo schema drift and rate limits require fixtures, bounded live probes, and honest partial/missing coverage. PostgreSQL/Docker gates remain environment-unverified.
- Advisory decision: continue

## DriftCheckDraft

- Scope status: Leaguepedia replacement Task 1 only: provider-neutral orchestration, immutable object retention, downloader, scheduler and lock ownership; no provider adapter, CLI wiring or Oracle retirement yet.
- Compatibility status: runSync is the single publication owner; adapters remain staging-only. PostgreSQL advisory locks retain pinned-connection ownership and publication generation remains canonical.
- Retirement status: No Oracle runtime fallback was added; planned Oracle source surfaces remain pending delete-first retirement in replacement Task 4.
- New risk signals:
- Real PostgreSQL advisory-lock execution, S3-compatible conditional writes and undici socket behavior remain environment-unverified; Task 2 must also defend against Leaguepedia schema drift and ambiguity.
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: Execute Leaguepedia-primary replacement Task 2: hardened Leaguepedia adapter and identity overrides
- Active slice: Leaguepedia Task 1 complete; Task 2 adapter preparation
- Completed todos:
- Replacement Task 1 provider-neutral sync runner, immutable storage, downloader, scheduler and pinned advisory-lock contract merged after spec and quality approval
- Evidence refs:
- merge 901f481; evidence artifact leaguepedia-task-01-sync-runner
- Blocked on: No TEST_DATABASE_URL or Docker/S3 integration environment; does not block fixture-driven Leaguepedia adapter implementation.
- Next step: Create a fresh Task 2 worktree from main and implement the strict Leaguepedia client, normalization, reviewed overrides, fixtures and bounded live probe.

## DriftCheckDraft

- Scope status: Leaguepedia replacement Task 2: strict source client, raw-only deterministic replay, reviewed overrides, staged dimensions/facts/media requests and honest logical coverage; no SQL persistence or CLI composition.
- Compatibility status: Adapter remains staging-only and runSync remains the single publication owner. Dataset versions include raw source, parser and override provenance; unchanged runs use the provider-neutral repository contract.
- Retirement status: No Oracle fallback or alternate provider path was added. Oracle planned surfaces remain pending delete-first cleanup in replacement Task 4.
- New risk signals:
- Default 100 MB snapshot budget requires historical backfill tuning; shared traversal counts may repeat in human-readable coverage detail. PostgreSQL publication, successful Cargo live envelope, CLI composition and Docker remain unverified.
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: Execute Leaguepedia-primary replacement Task 3: persist dimensions/media/coverage and compose CLI sync paths
- Active slice: Leaguepedia Task 2 complete; Task 3 integration preparation
- Completed todos:
- Replacement Task 2 hardened Leaguepedia client, raw replay adapter, reviewed overrides, canonical staged dimensions/facts/media and coverage merged after final spec and quality approval
- Evidence refs:
- merge b442e4b; evidence artifact leaguepedia-task-02-provider-adapter; bounded official siteinfo/T1 probes
- Blocked on: No TEST_DATABASE_URL or Docker/S3 integration environment; Task 3 code and unit composition can proceed, but publication acceptance remains environment-gated.
- Next step: Create a fresh Task 3 worktree from main; implement repository persistence for staged dimensions/media/unchanged runs and compose sync/backfill/fixture CLI through the single runner.

## DriftCheckDraft

- Scope status: Leaguepedia replacement Task 3 integrated staged dimensions, facts, media, coverage, retirement and provenance into canonical PostgreSQL publication plus serve/migrate/sync/backfill CLI composition.
- Compatibility status: runSync remains the sole publication caller; PostgreSQL commit is the visibility fence; unchanged runs reuse a dataset version without new generation. HTTP serve never schedules sync and media delivery remains controlled.
- Retirement status: No Oracle runtime fallback was introduced. Oracle source-facing docs/config references remain pending delete-first cleanup in Task 4; historical Aegis evidence will be preserved.
- New risk signals:
- All 24 PostgreSQL integration tests are environment-skipped; migrations 004-007, retirement visibility, shared media objects and fixture import twice still require real PostgreSQL/S3/Docker runtime evidence. Synthetic fixture is intentionally partial and cannot retire facts.
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: Execute Leaguepedia-primary replacement Task 4: retire Oracle MVP source surfaces and refresh operator documentation
- Active slice: Leaguepedia Task 3 complete with PostgreSQL runtime gap; Task 4 source retirement preparation
- Completed todos:
- Replacement Task 3 PostgreSQL publication, shared media ownership, scope retirement, provenance, fixture and five-path CLI merged after final spec and quality approval
- Evidence refs:
- merge 6e93837; evidence artifact leaguepedia-task-03-publication-cli
- Blocked on: No TEST_DATABASE_URL or Docker/S3 runtime environment; does not block Oracle source-facing cleanup and documentation.
- Next step: Create a fresh Task 4 worktree, delete Oracle runtime/config/manifest/fixture references, update Leaguepedia source and operations documentation, and add lingering-reference verification.

## DriftCheckDraft

- Scope status: Leaguepedia replacement Task 4 retired all active Oracle source surfaces and added operator-facing Leaguepedia source, attribution, operations and deployment documentation plus tracked-file guards.
- Compatibility status: Runtime remains Leaguepedia-only with operator-supplied reviewed endpoint, User-Agent and media hosts. Existing API/UI contracts are unchanged; synthetic fixture remains explicitly partial and non-retiring.
- Retirement status: Oracle is absent from active runtime/config/package/test/deployment paths. Only historical docs/aegis records and explicit operator policy about exclusion/reconsideration remain.
- New risk signals:
- Guard scans Git tracked files and binary paths, not unstaged untracked content or binary payloads. Host validation cannot prove official ownership/connectivity; bounded live probes and operator review remain mandatory. PostgreSQL/Docker acceptance is still open.
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: Execute Task 5 Docker/PostgreSQL historical acceptance and close environment-backed evidence gaps
- Active slice: Leaguepedia Tasks 1-4 complete; Docker/PostgreSQL acceptance preparation
- Completed todos:
- Replacement Task 4 retired active Oracle source surfaces, hardened source guards/config validation, and documented Leaguepedia operations/deployment after final reviews
- Evidence refs:
- merge af9b823; evidence artifact leaguepedia-task-04-oracle-retirement
- Blocked on: Docker CLI/daemon and TEST_DATABASE_URL are unavailable in the current environment; code/static Docker work can proceed but runtime acceptance cannot be claimed yet.
- Next step: Inspect existing Docker stack and Task 5 plan, implement any missing container/health/fixture acceptance surfaces, then run all possible static gates and request or use a real Docker/PostgreSQL environment for final acceptance.

## Checkpoint Update

- Current todo: Restore root lint gate, then execute deterministic avatar Task 2 repository presentation resolver
- Active slice: Task 1 complete; Task5B lint cleanup before Task 2
- Completed todos:
- Deterministic avatar Task 1 generator and Fastify route passed strict TDD, spec review, and quality review
- Evidence refs:
- deterministic-avatar-task-01: targeted 30/30; server 128/128; spec COMPLIANT; quality APPROVED
- Blocked on: Root lint has three unused-symbol failures in prior Task5B sync changes
- Next step: Return the three Task5B lint findings to their original owner, verify root lint, then dispatch a fresh Task 2 implementer

## DriftCheckDraft

- Scope status: Task1 stayed within generator, avatar route, namespace classification, tests, and approved design/plan wording.
- Compatibility status: Media persistence, DB schema, sync owner, public JSON names, and /media behavior unchanged; canonical UUID case and encoded namespace behavior strengthened.
- Retirement status: Generic placeholder remains browser error recovery only; retained-media-only acceptance retirement is pending Task3.
- New risk signals:
- Minor If-None-Match 304 efficiency debt deferred; root lint blocked by three prior Task5B unused symbols.
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: Execute deterministic avatar Task 2 repository presentation resolver
- Active slice: Task 2 repository/contracts integration preparation
- Completed todos:
- Task1 generator/route dual-reviewed; Task5B dead lint bindings retired and root lint gate restored
- Evidence refs:
- Task1 spec COMPLIANT and quality APPROVED; Task5B sync 166/166; root lint/typecheck pass
- Blocked on: none
- Next step: Dispatch fresh Task2 implementer with strict TDD and real PostgreSQL integration evidence

## DriftCheckDraft

- Scope status: Task1 complete and cleanup limited to proven dead Task5B symbols; Task2 scope ready.
- Compatibility status: No runtime behavior or evidence shape changed in lint cleanup; root gates restored.
- Retirement status: Dead helper/bindings removed with no compat path; avatar placeholder main-path retirement moves to Task2.
- New risk signals:
- Task2 must use real PostgreSQL integration and avoid adding fallback branches inside comparison.ts.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Repair Task5B regions override root integration fixture drift, then execute acceptance Task3
- Active slice: Task2 complete; root integration restoration before Task3
- Completed todos:
- Deterministic avatar Task2 repository resolver passed strict TDD, real PG17 integration, spec review, and quality review
- Evidence refs:
- deterministic-avatar-task-02: DB 34/34 zero skip; spec COMPLIANT; quality APPROVED
- Blocked on: Root integration expects 2 override application runs but regions.yaml makes the correct observed count 3
- Next step: Return override-count drift to Task5B owner, verify full root integration, then dispatch Task3 implementer

## DriftCheckDraft

- Scope status: Task2 stayed within repository resolver, exact-era SQL, compatible contracts, tests, and approved docs.
- Compatibility status: Retained media precedence, data-URI schema acceptance, public JSON names, DB schema, and comparison facts unchanged.
- Retirement status: Production DB placeholder main path removed; web/export placeholder remains error recovery; no duplicate resolver.
- New risk signals:
- Root integration fixture is stale after adding reviewed regions override; transient migration test isolation flake remains observed but not reproducible in consecutive full DB runs.
- Advisory decision: needs-verification

## DriftCheckDraft

- Scope status: Deterministic avatar Tasks 1 through 3 and the integration harness repair stayed within approved Task5 acceptance scope.
- Compatibility status: Public comparison contracts remain string-compatible. Acceptance snapshot is internal version 2 only. Production Kysely migration semantics are unchanged.
- Retirement status: Version 1 retained-only reviewed acceptance path and parallel schema migration harness path are retired without adapters or fallbacks.
- New risk signals:
- Task4 still requires official live publication, reviewed snapshot, Docker resource evidence, query plans, Playwright, and final reviews before any completion claim.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Execute deterministic avatar Task4 and parent Task5 runtime acceptance
- Active slice: Tasks 1 through 3 complete; Task4 official publication and Docker acceptance
- Completed todos:
- Avatar generator and route passed strict TDD, spec and quality review
- Repository presentation resolver passed real PostgreSQL integration, spec and quality review
- Acceptance schema version 2 retained/generated union passed strict TDD, spec and quality review
- Override audit fixture drift and Kysely database-global migration harness race were repaired with zero-skip PostgreSQL evidence
- Evidence refs:
- deterministic-avatar-task-01
- deterministic-avatar-task-02
- deterministic-avatar-task-03
- task5-integration-harness
- Blocked on: No code blocker. Official Leaguepedia network publication and Docker runtime evidence are still pending.
- Next step: Rebuild production image, run the 2013 through 2025 Worlds backfill through runSync, generate the exact reviewed snapshot, and execute acceptance, API, Playwright, query-plan, resource, root and Compose gates.

## Checkpoint Update

- Current todo: Complete final Task5 independent reviews, commit the approved release, merge to main, and run post-merge audit
- Active slice: Task5 implementation and runtime gates complete; final whole-diff review and integration handoff
- Completed todos:
- Published and independently reviewed the official 2013-2025 Leaguepedia snapshot with exact T1 versus LPL Worlds BO5 acceptance
- Verified PostgreSQL 17 migrations, exact DATE handling, query plans, deterministic avatars, Docker packaging, production Playwright, mock PNG and ZIP export, attribution, and resource measurements
- Evidence refs:
- task5-postgresql-date-boundary
- task5-official-leaguepedia-acceptance
- task5-docker-release-gates
- Blocked on: none
- Next step: Resolve any final whole-diff review findings, then create the planned Docker and historical acceptance commits and merge the worktree branch

## DriftCheckDraft

- Scope status: Task5 stayed within approved Docker, PostgreSQL, Leaguepedia publication, deterministic presentation, reviewed historical acceptance, release browser coverage and operator documentation boundaries.
- Compatibility status: The same image supports local Compose and externally supplied PostgreSQL and S3. Public comparison contracts remain compatible; generated avatar URLs extend presentation without changing fact semantics. Per-pool DATE parsing repairs exact calendar behavior without global parser state.
- Retirement status: Oracle MVP and retained-media-only acceptance remain deleted. No alternate provider, hard-coded undefeated business rule, duplicate publication owner, DATE fallback, or development mock was introduced into the release path.
- New risk signals:
- Implementation and runtime gates are green, but final whole-diff spec and quality reviews plus commit, merge and post-merge verification remain open.
- Advisory decision: needs-verification

## Checkpoint Update

- Current todo: Create the planned Task5 commits, merge the approved worktree branch to main, and run post-merge verification
- Active slice: Implementation, independent reviews and runtime acceptance complete; commit and merge handoff
- Completed todos:
- Closed whole-diff review findings with fail-closed actual response scope coverage, exact 13-year acceptance coverage, ADR and release baseline, resource and latency evidence, and synchronized signed-release evidence
- Fresh independent snapshot, spec, quality, Docker, PostgreSQL and Playwright gates approved the convergence artifact
- Evidence refs:
- task5-slice-coverage-fail-closed
- task5-exact-coverage-contract
- task5-signed-release-final
- Blocked on: none
- Next step: Inspect final status and diff, create repository-style Docker and historical release commits, merge feat/docker-acceptance to main, then run post-merge root and Aegis checks

## DriftCheckDraft

- Scope status: Task5 implementation, review remediation, official source publication, signed historical acceptance and Docker convergence stayed within the approved Leaguepedia-primary and deterministic-avatar completion boundaries.
- Compatibility status: Local Compose and external PostgreSQL/S3 still use one image. Public comparison semantics remain compatible. Exact acceptance coverage and slice replay checks only strengthen internal fail-closed evidence; generated avatar URLs remain deterministic presentation.
- Retirement status: Oracle MVP, retained-media-only acceptance, aggregate-only release coverage and declared-scope-only completeness are retired without fallback or compatibility paths. No persistent rows or objects were deleted.
- New risk signals:
- No implementation or evidence blocker remains; only repository commit, merge and post-merge verification are open.
- Advisory decision: continue
