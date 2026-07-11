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
