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
