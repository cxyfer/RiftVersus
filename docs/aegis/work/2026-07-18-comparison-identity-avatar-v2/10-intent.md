# Comparison Identity and Canonical Avatar v2 - Intent

## TaskIntentDraft

- Requested outcome: Implement team-only historical row labels, player ID plus real-name search presentation, and text-based canonical avatar v2.
- Goal: Implement team-only historical row labels, player ID plus real-name search presentation, and text-based canonical avatar v2.
- Success evidence:
- Focused tests pass for contracts, sync publication, search UI, comparison rows, avatar v2, acceptance, and workspace governance.
- Stop condition: All seven plan tasks pass implementation and review; otherwise record the exact external blocker.
- Non-goals:
- Deleting entities or historical records.
- Inferring player or team avatar styling from current region membership.
- Scope: Execute docs/aegis/plans/2026-07-18-comparison-identity-avatar-v2.md without persistent deletions or unsupported compatibility fallbacks.
- Change kinds:
- cross-layer feature
- Risk hints:
- Schema migration, identity semantics, historical attribution, and public avatar route contract.

## BaselineReadSetHint

- docs/aegis/specs/2026-07-18-comparison-identity-avatar-v2-design.md
- docs/aegis/plans/2026-07-18-comparison-identity-avatar-v2.md

## BaselineUsageDraft

- Required baseline refs:
- docs/aegis/specs/2026-07-18-comparison-identity-avatar-v2-design.md
- docs/aegis/plans/2026-07-18-comparison-identity-avatar-v2.md
- Acknowledged before plan:
- none
- Cited in plan:
- none
- Missing refs:
- docs/aegis/specs/2026-07-18-comparison-identity-avatar-v2-design.md
- docs/aegis/plans/2026-07-18-comparison-identity-avatar-v2.md
- Advisory decision: needs-baseline-readback

## ImpactStatementDraft

- Compatibility boundary: Retire active avatar v1 path unless evidence proves an external compatibility dependency.
- Affected layers:
- contracts
- database
- sync
- server
- web
- Owners:
- entities.player_id and shared presentation semantics
- Invariants:
- Player canonical_name remains the real name while player_id is the public competitive ID.
- Comparison history rows always name participating teams regardless of compared subject kinds.
- Avatar v2 is deterministic from kind, id, and English label.
- Non-goals:
- Deleting entities or historical records.
- Inferring player or team avatar styling from current region membership.

These records are Method Pack drafts / hints, not authoritative runtime decisions.

## BaselineUsageDraft

- Required baseline refs:
- docs/aegis/baseline/2026-07-18-riftversus-comparison-identity-avatar-v2.md
- Delivered context refs:
- docs/aegis/baseline/2026-07-18-riftversus-comparison-identity-avatar-v2.md
- Acknowledged before plan:
- docs/aegis/baseline/2026-07-18-riftversus-comparison-identity-avatar-v2.md
- Cited in plan:
- docs/aegis/baseline/2026-07-18-riftversus-comparison-identity-avatar-v2.md
- Missing refs:
- none
- Advisory decision: continue
