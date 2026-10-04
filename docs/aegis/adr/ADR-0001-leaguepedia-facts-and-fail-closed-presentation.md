# ADR-0001 - Leaguepedia facts and fail-closed presentation ownership

Status: `recorded-from-work`
Date: `2026-07-15`

## Source Evidence

- Implemented Leaguepedia-primary publication and deterministic-avatar work, verified by the official 2013-2025 T1-versus-LPL acceptance snapshot and release evidence.
## Context

The MVP needs one auditable provider for esports facts and an avatar for every canonical subject, while reviewed Leaguepedia non-text media can lack redistribution license and attribution. Treating unknown rights as publishable or persisting locally generated presentation as provider evidence would create false provenance and duplicate owners.

## Decision

Leaguepedia is the only MVP facts provider. Unknown or unlicensed non-text upstream media fails closed. Presentation URLs may use canonical-avatar-v1 deterministic local avatars after retained licensed media precedence. Generated avatars are presentation output only: they are neither media provenance nor persisted source/media objects. Any future real-logo override requires a new reviewed rights and provenance design.

## Alternatives Considered

- Retained-only upstream media: rejected because reviewed T1 and LPL images lack per-file redistribution evidence and would leave valid subjects without presentation.
- Generic placeholder or data URI: rejected because it is not canonical subject identity, weakens share/export behavior, and either duplicates bytes or obscures a stable same-origin URL.
- Persist generated media in PostgreSQL or S3: rejected because deterministic presentation is recomputable and persistence would create a false media-provenance owner plus lifecycle burden.
## Consequences

- HTTP comparison requests are upstream-free and use only published PostgreSQL facts plus same-origin retained or deterministic presentation.
- Licensed retained raster media remains eligible and preferred, while current unknown-license Leaguepedia media produces no media_objects row.
- A future source replacement or real-logo path must be separately reviewed instead of entering through a compatibility fallback.
## Compatibility Boundary

Canonical owners are Leaguepedia for facts, the sync eligibility gate for upstream media, the database repository for presentation precedence, and the Fastify generator for avatar bytes. Existing comparison JSON fields and /media behavior are preserved. Retained compatibility is limited to licensed media precedence and load-error placeholder recovery. Forbidden compatibility includes Oracle facts, hotlinks, inferred/null licenses, alternate generators, and persisted generated avatars.

## Retirement Impact

Retired: Oracle as an MVP provider and retained-upstream-media-only acceptance. Preserved: provider-neutral PostgreSQL schema, immutable raw evidence, licensed-media precedence, saved URL/JSON contracts, and error placeholder recovery. Internal retirement uses delete-first with no compatibility exception. Persistent source/database/S3 objects are not deleted; any future deletion is confirmation-first.

## Baseline Sync

- Needed: needed
- Target: docs/aegis/baseline/2026-07-15-riftversus-release.md
- Action: create snapshot
- Reason: The decision fixes canonical source, media, presentation, compatibility, persistence, and release artifact boundaries that future contributors need as current-state architecture.

## Evidence References

- docs/aegis/plans/2026-07-12-leaguepedia-primary-mvp.md
- docs/aegis/specs/2026-07-14-deterministic-avatar-fallback-design.md
- docs/aegis/work/2026-07-12-riftversus-mvp/evidence-bundle-draft-task5-official-leaguepedia-acceptance.json
## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.

## Amendment - 2026-07-18 - Amend typed player identity, historical team-row presentation, and canonical-avatar-v2 runtime boundaries after gen4 publication verification.

- Status: amended

### Source Evidence

- Fresh Leaguepedia gen4 backfill run 34265be3-d0a3-48b5-aeeb-c160b573672e published leaguepedia-a9277cebd9d2be1006b8e35d41d41af06d599507741c0770615a76489d33c7a with 13/13 complete Worlds coverage, 686 series, 1005 games, source object b3578141b05bd9faa8a0083e1322dfe5d608e5ecca2906a01bab18c3b89fdbba, Faker player_id Faker and canonical_name Lee Sang-hyeok; strict production acceptance returned ready and release E2E passed 4/4.
### Change Summary

Amend typed player identity, historical team-row presentation, and canonical-avatar-v2 runtime boundaries after gen4 publication verification.

### Compatibility Boundary

Leaguepedia remains facts owner; publication owns typed player_id versus canonical_name; comparison summaries use selected canonical labels while historical rows use participating team/team-era labels; v2 generated presentation is served only at /avatars/v2/{kind}/{id}.svg with safe ASCII abbreviations, reviewed region styles, checksum ETag revalidation, and Cache-Control public, no-cache. Generated bytes remain non-persistent and licensed retained media precedence is unchanged.

### Retirement Impact

Retire canonical-avatar-v1 and unversioned avatar routes from the active main path delete-first; retain only negative 404 tests and historical Aegis records. Do not add redirects, adapters, alternate generators, or persisted generated media. No PostgreSQL rows, named volumes, or MinIO objects were deleted during migration/publication.

### Baseline Sync

- Needed: needed
- Target: docs/aegis/baseline/2026-07-18-riftversus-comparison-identity-avatar-v2.md
- Action: create snapshot
- Reason: The amended typed identity, historical row, v2 avatar, cache revalidation, and gen4 runtime publication boundaries are current architecture and require a verified release baseline.

### Evidence References

- docs/aegis/work/2026-07-18-comparison-identity-avatar-v2/90-evidence.md
- data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json
### Boundary

This amendment is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.

## Amendment - 2026-10-03 - Move publication and browser ownership to GitHub Actions, private immutable Releases and Pages SQLite HTTPVFS; retire legacy runtime carriers.

- Status: amended

### Source Evidence

- Remote current synchronization 37110413823, clean GitHub checkpoint restore, hosted Worker/WASM/Range validation and explicit site rollback 37110806436 passed. Historical run 37111081562 failed closed on missing upstream Levi dimension; its immutable forensic archive and unchanged sequence-2 baseline were independently verified.
### Change Summary

Move publication and browser ownership to GitHub Actions, private immutable Releases and Pages SQLite HTTPVFS; retire legacy runtime carriers.

### Compatibility Boundary

Leaguepedia remains the only facts provider. PostgreSQL is ephemeral ingestion and restore tooling; private immutable checkpoints own durable data. Browser queries execute normalized SQLite using real sql.js-httpvfs workers on Pages. Typed player identity, historical team-era rows, licensed-media precedence and generated v2 presentation remain enforced. No HTTP API or alternate browser engine survives.

### Retirement Impact

Delete Fastify/server workspace, application Docker carriers, resident cron scheduler and S3 transport/dependencies. Retain filesystem staging, one-shot data CLI, PostgreSQL migrations, archival acceptance and differential test oracle. Preserve named volumes, retained containers, images, source evidence and all Releases; no physical data deletion. Historical refresh remains blocked without weakening provider or publication gates.

### Baseline Sync

- Needed: needed
- Target: docs/aegis/baseline/2026-10-03-riftversus-github-sqlite.md
- Action: create snapshot
- Reason: The migration changes persistence, query, deployment and scheduled-writer ownership and needs a verified current baseline distinct from old runtime records.

### Evidence References

- docs/github-publishing.md
- docs/aegis/work/2026-09-14-github-only/20-checkpoint.md
### Boundary

This amendment is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.

## Amendment - 2026-10-04 - Persistent readable routes and source-reviewed real media

Status: amended after user approval, hosted verification and checkpoint cold restore.

Public route keys have immutable entity-kind and team-era scopes; UUIDs remain
canonical fact owners. SQLite resolves exact public/legacy keys before comparison
and canonicalizes URLs with filters intact. Same-name identities remain separate,
and later arrivals cannot steal published IDs. Migration 010 backfills existing
owners before new imports; current sync archives the registry in checkpoint 3.
Schema 2 sites remain valid rollback artifacts; new exports use schema 3.

PlayerImages/PlayerRedirects/Tournaments discovery is bounded to imported pages,
with deterministic selection and raw replay. Source team logos have only exact
era owners, keeping unrelated eras independent. Existing rights eligibility,
bounded downloads and same-origin retained precedence remain authoritative.
Missing, conflicting or unknown-rights assets retain generated presentation.

Evidence: approved spec/plan, final app f1c0efb, CI 37136572917, current Publish
37136621705, and independent checkpoint-3 cold restore with all 715 entity and
104 era owners unchanged. Current replay found 66 candidates, all rights-blocked;
no permission was inferred. Hosted selector/summary image consistency and export
checks passed. Retired only UUID-only URL syntax; UUID facts, saved links and
generated fallback remain. Baseline/runbook record these evidence and limits.

## Amendment - 2026-10-04 - Approved reviewed Leaguepedia editorial images

Status: user-approved design; deployed and independently verified.

The user explicitly approved the reviewed noncommercial esports identification
policy in docs/media-policy.md. For these reviewed assets only, a structured
editorial rights basis is an alternative to licensed media. It is stored
separately from license, which remains null when no license is established.
File page/revision, reviewed checksum, available rights statement, attribution
and exact canonical player/team-era binding are required. A changed image does
not inherit the previous review. Regions remain generated; arbitrary upstream
media still fails closed. The site provides visible source/rights credits.

Media-only publication reuses the sync runner, retained object store, dataset
transaction, private checkpoint and Pages assets, with no fact/roster/coverage
replacement. A distinct media run mode preserves current/history freshness
and failure semantics. Existing licensed records and immutable archived sites
remain readable. No persistent source, media or historical data is deleted.

This scoped alternative supersedes the licensed-only restriction for reviewed
Leaguepedia subject images; it does not assert permission from rights holders.
Evidence: explicit user approval and the 2026-10-04 real-media follow-up plan.

Release transport refinement: reviewed image bytes are pinned in a private
immutable GitHub media Release, separately from data checkpoints and site
archives. Publication verifies the archive and each bounded file; Leaguepedia
file pages/revisions remain attribution and rights sources. Re-fetching mutable
CDN derivatives cannot replace reviewed bytes or relax the image checksum gate.

Release verification: PR 6 CI 37163237620 passed and Publish 37163518698 deployed
immutable site-37163518698-1 from verified checkpoint 4. Independent hosted
browser checks confirmed real same-origin T1/Faker images, historical SKT,
source/rights credits, mobile layout, PNG export and unchanged match facts.
579 players, 99 canonical teams and 104 historical eras use reviewed retained
images; 22 players without an exact binding and all regions retain generated
presentation. Images are static files outside SQLite. The existing export
request-unit owner now uses 32 KiB following ten passing controlled cold runs;
SQL schema, logical snapshot and performance gates remain unchanged.

## Amendment - 2026-10-04 - Add source-reviewed historical LCK/LPL ownership, EWC category and BO2 draw semantics while preserving fail-closed imports.

- Status: amended

### Source Evidence

- data/leaguepedia/competition-map.json; data/leaguepedia/domestic-ewc-audit.json; /tmp/riftversus-leagues-live-evidence/query-evidence.json; isolated PostgreSQL and SQLite verification.
### Change Summary

Add source-reviewed historical LCK/LPL ownership, EWC category and BO2 draw semantics while preserving fail-closed imports.

### Compatibility Boundary

Leaguepedia remains the sole facts owner; exact reviewed tournament mappings assign lck/lpl, EWC is a separate category, and valid BO2 1:1 draws have no winner and count in totals. Existing Worlds/MSI facts and schema 2 rollback sites remain readable.

### Retirement Impact

No legacy provider or runtime writer retained. Old BO1/3/5 constraints remain for existing formats; downgrade is guarded when BO2 or EWC facts exist.

### Baseline Sync

- Needed: needed
- Target: docs/aegis/baseline/2026-10-03-riftversus-github-sqlite.md
- Action: update baseline
- Reason: Current architecture now includes the historical domestic/EWC schema, mapping and publication contract.

### Evidence References

- docs/aegis/plans/2026-10-04-domestic-leagues-ewc.md
### Boundary

This amendment is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
