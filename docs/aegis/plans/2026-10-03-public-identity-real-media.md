# Public Identity And Real Media Implementation

Goal: implement the approved readable URL and verified real-media spec.
Architecture: persistent exact public-ID mappings owned by ingestion; UUID
facts unchanged; normalized SQLite resolves public selectors before comparison.
Tech Stack: existing TypeScript, Kysely/PostgreSQL tooling, SQLite/httpvfs,
React, GitHub Actions/Pages and private immutable checkpoint Releases.
Baseline/Authority Refs: ../specs/2026-10-03-public-identity-real-media.md,
../baseline/2026-10-03-riftversus-github-sqlite.md and ../adr/ADR-0001-leaguepedia-facts-and-fail-closed-presentation.md.
Compatibility Boundary: old UUID routes, saved results, era scope, filters,
score/membership, checkpoint lineage and retained recovery resources survive.
Verification: focused unit/integration tests, full build/lint/tests, production
SQLite E2E and hosted comparison/export checks. Stage commits exclude .gitignore.

## Readiness And Scope

Intent Lock: user approved the written spec. Scope Fence: public routing and
real media only. Baseline Lock: GitHub-only deployment and verified media
eligibility remain authoritative. Unknown-rights assets remain unpublished.
Change Necessity: existing player slugs derive from real names, name collisions
exist, and Players.Image omits profile media; configuration cannot fix these.
Existence Check: reuse publication, snapshot/query and download owners; add only
persistent mapping and exact route resolution because existing search is fuzzy.
Complexity: keep allocation outside the mixed-purpose sync repository; keep
route resolution separate from the comparison SQL's scoring responsibility.
Review Gates: root reviews delegated media code and all data/schema decisions.
No additional user approval is needed for implementation or routine verification.

## Stage 1: Public IDs

1. Add normalization/assignment with deterministic readable disambiguation and
   verified hash extension. Add persistent migration/mapping and run allocation
   within publication, including initial backfill before later arrivals.
2. Export public entity and era IDs through snapshot contracts and SQLite;
   enforce exact kind/key uniqueness. Rebuild restores migrate before export;
   migration of an unchanged checkpoint deterministically reserves existing IDs
   before any source import. Current sync archives the new persistent state.
3. Add exact public/legacy UUID selector resolution. Browser validates route
   syntax independently, asynchronously resolves IDs, and compares canonical
   UUID subjects. Normalize successful URLs; report unknown selectors without
   silently replacing them with unrelated defaults. Saved UUID links survive.
4. Test same-name and cross-kind collisions, Unicode/case normalization, late
   arrivals, fixed ownership, exact eras, old URLs, saved results and filters.
   Commands: rtk proxy pnpm build; rtk proxy pnpm lint; rtk proxy pnpm test;
   rtk proxy pnpm test:e2e. Use GitHub CI where local Chromium is unsupported.
5. Commit the verified stage, publish and verify public URL reload, comparison,
   player search, decoded export content and checkpoint lineage.

## Stage 2: Real Media

1. Delegate only Leaguepedia PlayerImages client/parser/discovery and focused
   tests to the existing child agent. Raw evidence must reconstruct selections
   deterministically through redirects and tournament/effective dates.
2. Root reviews identity binding, source/rights eligibility and historical
   team-era bindings. Reuse bounded retained downloads and same-origin output;
   add clear inventory for missing/ambiguous/rights-blocked images. Do not invent
   permission metadata to obtain superficially successful publication.
3. Adjust logo/portrait sizing only where needed for actual eligible images.
   Commands: rtk proxy pnpm --filter @riftversus/sync test;
   rtk proxy pnpm --filter @riftversus/data test; rtk proxy pnpm test;
   rtk proxy pnpm lint; rtk proxy pnpm test:e2e.
4. Commit separately; verify production images/export on desktop/mobile and
   report eligible/missing/blocked counts. Document externally blocked assets
   honestly if no verified permission evidence is available.

## Retirement And Closeout

Remove UUID-only URL validation/serialization, not UUID factual keys. No new
server, provider, image hotlink or weaker acceptance path. Preserve generated
fallback for missing/ineligible assets and old immutable Releases for rollback.
Update ADR/baseline after actual verification, retain checkpoints in this plan's
execution record, and publish final tested commits without touching user edits.

## Execution Record

Stage 1 implementation: persistent migration 010, deterministic kind-scoped
entity IDs and team-scoped era IDs, SQLite schema 3 (archive reader retains
schema 2 support), exact resolution, legacy UUID/saved-result compatibility,
successful URL canonicalization and explicit unknown-ID recovery.

Local verification: build, lint and all workspace tests passed (485 tests);
PostgreSQL integration passed 70 tests with one checkpoint-client test skipped
because its separate restore databases were not configured locally. Actual
HTTPVFS Range-query E2E assertions passed locally; Chromium screenshot and
download actions timed out in this environment, so complete browser/export
verification remains assigned to GitHub CI and hosted publication smoke tests.
Migration 009 downgrade tests now explicitly target version 009 rather than
assuming it is the latest migration. No safety assertion was relaxed.
