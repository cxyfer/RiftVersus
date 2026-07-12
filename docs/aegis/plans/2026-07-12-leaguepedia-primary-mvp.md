# Leaguepedia-Primary MVP Implementation Plan

## Goal

Replace the unexecutable Oracle-dependent source Tasks 7-9 with a single
Leaguepedia ingestion and publication path that supplies identities, series,
games, player participation, media, and honest coverage to the existing API.

## Architecture

`packages/sync` owns one provider-neutral runner and one Leaguepedia adapter.
The adapter emits staged normalized data; the runner owns advisory locking,
immutable source/media storage, repository writes, validation, and atomic
publication. Server CLI commands compose these owners and never contain
provider parsing. API handlers remain read-only consumers of PostgreSQL.

## Tech Stack

- TypeScript ESM and pnpm workspace;
- MediaWiki `query` and allow-listed Cargo API requests through `fetch`;
- Zod and `yaml` for provider/config/override validation;
- Kysely/PostgreSQL repositories for staged publication;
- AWS SDK S3-compatible ObjectStore for immutable JSON and media;
- `croner` for the daily non-overlapping scheduler;
- Vitest, PostgreSQL integration tests, and bounded live probes.

## Baseline / Authority Refs

- `docs/aegis/specs/2026-07-12-leaguepedia-primary-mvp-design.md`;
- `docs/aegis/plans/2026-07-12-riftversus-mvp.md` for completed Tasks 1-6,
  10-11 and remaining Docker/acceptance work;
- `docs/aegis/BASELINE-GOVERNANCE.md`;
- current main commit and existing contracts/domain/database/media boundaries;
- user decision: Leaguepedia is the MVP primary source.

## Compatibility Boundary

- One PostgreSQL published generation remains the only API truth.
- `runSync` is the only provider-to-publication owner.
- Existing comparison contracts, routes, URL filters, and browser export remain
  compatible.
- Media is same-origin and served only from validated cached objects.
- Oracle is absent from the MVP runtime and is not retained as a fallback.

## Verification

```bash
rtk pnpm --filter @riftversus/sync test
rtk pnpm --filter @riftversus/server test
rtk pnpm test:integration
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm test
rtk pnpm build
rtk node apps/server/dist/cli.js sync --once --fixture leaguepedia-small
```

The PostgreSQL and CLI fixture gates require `TEST_DATABASE_URL` or the later
Docker Compose stack. A skipped integration test is not completion evidence.

## Plan Basis

- Fact: the Leaguepedia public MediaWiki API siteinfo and a known T1 page
  returned JSON without authentication during the bounded probe.
- Fact: the Oracle programmatic endpoint currently returns 401 and no stable
  official direct CSV URL was verified.
- Fact: main already has schema/repository publication boundaries, an S3
  ObjectStore read/sign implementation, and safe same-origin media delivery.
- Fact: `feat/task-09-leaguepedia` is unmerged because review found missing
  runner integration and a public action/format override vulnerability.
- Assumption to verify: Cargo schemas used by fixtures still match the bounded
  live fields required by the adapter.
- Unknown to measure: exact competition/year completeness and final retained
  database/media size.

## Requirement Ready Check

- Requirement source: approved Leaguepedia-primary design amendment and user
  source decision.
- Acceptance: fixture normalization, atomic publication, media caching,
  coverage truth, bounded live probe, and T1/LPL reviewed fixture.
- Open blocker: real PostgreSQL/Docker evidence is environment-dependent but
  does not prevent unit implementation.
- Decision: ready.

## Change Necessity

The current main has no sync runner or published Leaguepedia facts. Docs-only
or a UI fallback cannot produce canonical comparisons or cached media. The
minimum code boundary is `packages/sync`, server CLI composition, repository
media support where missing, reviewed overrides, and tests. Decision:
`code-change`.

## Architecture Integrity and Retirement

- Invariant: one runner stages and publishes all provider output atomically.
- Canonical owners: Leaguepedia adapter for upstream parsing; runner for
  orchestration; database repositories for persistence; domain for semantics.
- The failed Task 9 branch is evidence, not a merge base. Reuse reviewed pieces
  only after fixing allow-list and quarantine behavior against current main.
- Oracle manifest/adapter/test/config surfaces are deleted if encountered.
- No compatibility exception exists because no external runtime depends on an
  Oracle MVP interface.

## Execution Readiness View

- Intent lock: deliver a queryable Leaguepedia-backed MVP, not a provider demo.
- Scope fence: source client, normalization, runner, persistence, media,
  coverage, CLI, tests, and source docs; no new API or UI feature.
- Baseline lock: existing contracts/domain/database/API/media/export behavior.
- Owner constraints: no DB writes in HTTP routes or raw client; no provider
  parsing in CLI; no second runner.
- Retirement boundary: Oracle is absent from runtime and acceptance.
- Test obligations: fixture, unit, repository integration, CLI fixture, live
  probe, and lingering-reference scan.
- Review gates: per task spec review then quality review; fix and re-review.
- Drift rule: any direct adapter-to-publication shortcut rewinds to runner
  ownership review.
- Evidence required: commits, command output, live probe summary, integration
  result or explicit environment gap.

## Task 1: Implement the provider-neutral sync runner and immutable storage

**Files:** create `packages/sync/src/types.ts`, `runner.ts`, `publication.ts`,
`scheduler.ts`, `download.ts`, `test/runner.test.ts`, and extend
`storage.ts`, `storage/s3.ts`, `test/storage.test.ts`; update sync exports and
dependencies.

**Why:** Leaguepedia pages and media need one bounded provenance and publication
workflow; direct adapter writes would duplicate locking and failure behavior.

**Change Necessity:** no current owner coordinates advisory locking, retained
source objects, validation, failed-run recording, and publication. Minimum
boundary is one runner plus existing ObjectStore/repository interfaces.

**Impact/Compatibility:** existing ObjectStore `get` and `signedGetUrl` remain;
add `putImmutable` and `head` without changing media route semantics.

**Verification:** sync runner/storage unit tests and root static gates.

- [ ] **Write test:** cover SHA-256 source/media keys, idempotent put, bounded
  bytes/redirects/hosts/timeouts, advisory lock release, failed-run recording,
  no publication on provider failure, publication after retained provenance,
  non-overlapping scheduler ticks, and backfill request validation.
- [ ] **Verify RED:** run `rtk pnpm --filter @riftversus/sync test`; new tests
  fail because runner and write-capable storage are absent.
- [ ] **Minimal code:** implement typed `SyncProvider`, `SyncRequest`,
  `SyncDependencies`, `runSync`, `scheduleSync`, safe downloader, source/media
  immutable keys, and publication composition. The runner accepts normalized
  staged output and is the only caller of repository publication methods.
- [ ] **Verify GREEN:** run sync tests, root typecheck/lint/test/build, and scan
  for direct provider imports outside sync composition.
- [ ] **Commit:** `✨ feat(sync): add safe publication pipeline`.

## Task 2: Implement and harden the Leaguepedia provider adapter

**Files:** create `packages/sync/src/providers/leaguepedia/{client,types,fetch,
normalize,media,index}.ts`, `src/overrides.ts`, fixtures and tests; create
`data/overrides/{identities,tournaments}.yaml`; add exact `yaml` dependency.

**Why:** the MVP requires identities, team eras, series/game/player facts,
licensed media, and coverage from its approved source.

**Change Necessity:** raw MediaWiki/Cargo rows do not satisfy canonical types
or resolve ambiguous lineage. Minimum boundary is one provider adapter plus
reviewed overrides.

**Impact/Compatibility:** adapter emits normalized staged output only. It cannot
write repositories, choose publication generations, or expose original image
URLs publicly.

**Verification:** deterministic fixtures plus a bounded siteinfo/known-page
probe; no bulk live assertion.

- [ ] **Write test:** cover immutable action/format/endpoint, five Cargo table
  allow-list, continuation and offset pagination, timeout, Retry-After and
  bounded retries, aliases, duplicate names, SKT-to-T1 era, explicit series,
  games/players, missing media, media attribution, ambiguous conflict
  quarantine, override checksum/precedence, and honest coverage.
- [ ] **Verify RED:** run Leaguepedia-focused tests; they fail on current main.
- [ ] **Minimal code:** implement the client with reserved parameter rejection;
  normalize stable source keys and staged facts; require an override before an
  ambiguous identity enters staged output; validate media metadata and return
  download requests to the runner; derive coverage only from bounded traversal
  evidence.
- [ ] **Verify GREEN:** run sync tests/root gates and a bounded official API
  probe for siteinfo plus T1 page JSON fields.
- [ ] **Commit:** `✨ feat(sync): add leaguepedia provider`.

## Task 3: Integrate media, coverage, publication, and server CLI

**Files:** update database sync/media repository interfaces and tests where
required; create Leaguepedia provider composition; extend server config, CLI,
CLI tests, and `.env.example`; add `leaguepedia-small` fixture command.

**Why:** a tested adapter is not a usable MVP until one CLI path atomically
stores source/media provenance, canonical facts, coverage, and publication.

**Change Necessity:** current CLI exposes only serve/migrate and current media
storage cannot ingest bytes. Minimum boundary is runner composition plus
repository methods needed for transactional media/coverage ownership.

**Impact/Compatibility:** `serve` never schedules sync. `sync`, `sync --once`,
and `backfill` share the same runner. Existing API/media routes stay unchanged.

**Verification:** server CLI tests, sync fixture tests, PostgreSQL integration,
root gates, and failure atomicity.

- [ ] **Write test:** assert all five CLI commands, no overlapping schedule,
  fixture import idempotency, source/media rows, transactional `is_current`,
  coverage writes, publication generation advancement only on success, and no
  source URL in public media responses.
- [ ] **Verify RED:** run server/sync/integration tests; integration fails until
  composition and repository support exist.
- [ ] **Minimal code:** compose Leaguepedia configuration/client/adapter,
  runner, repositories, and ObjectStore. Implement fixture mode with retained
  fixture checksum. Add bounded year/competition backfill arguments and
  graceful scheduled shutdown.
- [ ] **Verify GREEN:** run server/sync/root gates and, with PostgreSQL, import
  `leaguepedia-small` twice and prove stable canonical counts plus one published
  generation per successful run.
- [ ] **Commit:** `✨ feat(sync): publish leaguepedia dataset`.

## Task 4: Retire Oracle MVP surfaces and refresh source documentation

**Files:** remove any Oracle manifest/adapter/fixture/dependency/config/runtime
references; update `.env.example`, source/attribution/operations docs and the
original plan's source supersession notes; add lingering-reference tests or
scans.

**Why:** retaining an unverified inactive provider would preserve two apparent
owners and make deployment/operator expectations ambiguous.

**Change Necessity:** documentation and config currently describe Oracle as the
bulk source. Minimum boundary is source-facing docs/config/tests; historical
Aegis evidence remains unchanged.

**Impact/Compatibility:** database provenance remains provider-neutral. No live
data or migration is deleted.

**Verification:** source scans, docs checks, CLI help, root gates.

- [ ] **Write test:** assert runtime/config/package paths contain no Oracle
  manifest, endpoint, CSV parser, fixture command, or source fallback; allow
  only historical supersession records under `docs/aegis`.
- [ ] **Verify RED:** the scan finds current original-plan references.
- [ ] **Minimal code:** retire runtime and operator-facing Oracle surfaces;
  document Leaguepedia endpoint, attribution, coverage semantics, retry policy,
  and the evidence needed to reconsider Oracle later.
- [ ] **Verify GREEN:** run lingering-reference scan, CLI help, root gates, and
  Aegis workspace check.
- [ ] **Commit:** `♻️ refactor(sync): retire oracle mvp source`.

## Task 5: Rejoin Docker and historical acceptance work

After Tasks 1-4 pass both review gates, resume original Tasks 12-13 with these
changes:

- Compose `sync` and fixture import use Leaguepedia-only configuration.
- The reviewed acceptance snapshot records Leaguepedia page/revision IDs,
  retrieval timestamps, raw object checksums, attribution, and coverage status.
- T1 versus LPL Worlds BO5 is asserted only when the reviewed snapshot resolves
  every included series; unresolved evidence produces a warning, not a hard-
  coded undefeated claim.
- Database and media size are measured from the imported Leaguepedia fixture and
  the final backfill, replacing the earlier approximate Oracle sizing.

Task 5 does not commit until Docker, PostgreSQL, Playwright, source attribution,
query-plan budgets, and the reviewed comparison fixture have actual evidence.

## Risks

- Cargo field/schema drift: isolate mapping in provider fixtures and fail on
  missing required fields.
- Rate limits: bounded retry, descriptive UA, scheduled daily import, and no
  API-time upstream calls.
- Historical incompleteness: persist partial/missing coverage and surface it.
- Identity ambiguity: quarantine until reviewed override exists.
- Media license/availability: retain attribution and immutable cached bytes.
- Resource growth: measure actual rows/media after backfill; no estimate is an
  acceptance substitute.

## Completion Boundary

This plan is complete only when Leaguepedia data can be imported through the
single runner into PostgreSQL/S3, queried through the existing UI, exported,
deployed through the portable Docker stack, and verified against a reviewed
T1/LPL snapshot. Unit-only adapter success is partial evidence.
