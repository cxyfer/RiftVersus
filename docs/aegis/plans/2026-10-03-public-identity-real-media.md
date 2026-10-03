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

Stage 1 commit: `7060422`. Remote CI `37134704204` passed 484 tests, 71
integration tests and six production E2E tests. Publish `37134704354` passed
candidate acceptance with no blockers and hosted sharing/saving/player/date/
PNG/mobile workflows. Live site `site-37134704354-1` independently returned
SQLite schema 3, 715 entity route owners and 104 era route owners. Benny and
Doran both retain separate readable qualified IDs. Desktop/mobile cold reads
were 913,508 of 7,045,120 SQLite bytes, with real Worker/WASM/identity 206 reads.

Stage 2 implementation: bounded PlayerImages queries through PlayerRedirects
and Tournaments, deterministic latest-profile selection and retained raw replay;
parser version `leaguepedia-v3`; exact team-era logo ownership; deduplicated
eligible media and fail-closed conflicts; import-scope media inventory in
coverage details. Missing includes referenced source entities without image
candidates. Rights-blocked counts are candidate rows, not all historical entities.
Same-origin retained media and bounded download owners remain unchanged. Team
and region logos use contain sizing on screen and in export; portraits use cover.

Root review: production queries run only after referenced player pages are
resolved, 50 pages per request, with existing request/row/byte limits. Optional
client support retains old raw/test-client replay only; production implements
the new method. Source binding never merges Benny or Doran identities. T1 logo
and Faker 2026 LCK Cup portrait imageinfo currently lacks license/attribution;
those assets remain blocked, not fabricated as licensed. No rights override or
third-party hotlink was introduced.

Stage 2 local verification: all workspace tests passed (487 tests), then the
changed parser/ownership and UI/export suites were rerun (169 sync + 67 web
tests passed), build and lint passed. Actual current-import inventory and hosted
browser results remain pending remote verification.

Stage 2 commit: `e248c48`. CI `37135000649` and rebuild Publish `37135000642`
passed. Root follow-up found that assigning both entity and era owner would
invalidate other eras through the entity-current index. Media inspection now
emits only the era owner for team logos. A provider-to-PostgreSQL integration
test publishes two eras for the same team and verifies both remain current,
with no entity-wide owner. The focused integration, 169 sync tests, build and
lint passed. Queued current import `37135017721` was cancelled for this repair.
Current import must archive the registry in the next durable checkpoint;
rebuild alone deliberately does not promote a new data checkpoint.

Follow-up era-owner repair commit `fc11112` passed CI `37135730505` and Publish
`37135730541`. Root visual review of the hosted mobile screenshot found a
public-key cache regression after selecting a player: a matching UUID entry
caused an early return before its readable alias was inserted, so the selector
lost the name/media while the comparison remained correct. The regression was
reproduced with an actual select/apply/focus/blur sequence and repaired by always
registering both UUID and kind/public-key owners. Hosted verification now checks
Faker's full selector label and that its image matches the comparison image.
The current-import run was cancelled before checkpoint promotion for this repair;
stale-code attempt `37135609939` failed at the initial guard before restoring data.

QueryClient ownership is now per mounted App, preserving cache within the page
without sharing data across unrelated API instances/remounts. The new regression
uses a distinct filter scope, and the existing blur test now explicitly waits for
initial data rather than depending on a previous test's warm global cache. All
68 web tests, build and lint passed; E2E adds public-route player focus/blur label
validation. Selector-cache repair commit `dd89e30` is followed by this cache-scope
verification repair before either is published.

## Verified Closeout - 2026-10-04

App code `f1c0efb` passed CI `37136572917`: 488 unit/workspace tests, 72
PostgreSQL integration tests, six production SQLite E2E tests, build/typecheck/
lint. Publish `37136572901` passed the strengthened hosted selector/image checks;
root directly reviewed the repaired mobile screenshot. Actual current import
and Publish `37136621705` also passed all candidate/restore/hosted gates.

Durable checkpoint `checkpoint-3-37136621705-1` has sequence 3, parent
`checkpoint-2-37110413823-1`, and code SHA f1c0efb765c06934e87346b64324d8a5290e4f9e.
Root independently verified the index, current raw-object and database dump
checksums, cold-restored the dump into isolated PostgreSQL 17, and compared all
715 entity mappings and 104 era mappings against the first published registry:
every owner is unchanged. The temporary test/audit container is stopped;
original recovery resources and the user's .gitignore remain preserved.

Current raw replay contains 66 referenced entities and three bounded PlayerImages
pages. Inventory: candidates 66, eligible 0, missing 0, rights-blocked 66, invalid
0, unbound 0, ambiguous 0. Cold-restored media_assets count is zero. Software
discovery, era isolation and verified-media precedence are implemented; actual
replacement of this batch remains blocked by per-file rights/attribution evidence.
This is a scoped current-import count, not a global historical-media completeness
claim. Generated fallback remains the approved behavior for these blocked assets.

Live current site `site-37136621705-1` uses SQLite schema 3 and snapshot
`sha256:10a925e2f30a3d79a5026d481f5239db4e3e26b57a941372a014aa45b66e1d6c`;
database checksum `72ec05b414f33a14fddb26c71f5cd639b0eb8a81398ef268e49a4af9f660ea44`.
Independent live download verified this checksum and all public entity/era mapping
rows against the first published registry; retained media count remains zero.
It preserves 1,066 series. Hosted sharing/saving/player/date/decoded PNG/mobile
checks passed. Confidence A for routing/persistence, B for real-media availability
because source rights metadata is unresolved. Final evidence documentation is
committed on the implementation branch after the verified main deployment.
