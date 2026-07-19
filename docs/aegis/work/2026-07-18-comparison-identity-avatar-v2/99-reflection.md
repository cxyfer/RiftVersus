# Comparison Identity and Canonical Avatar v2 - Reflection

## Outcome

The three requested behaviors are implemented and verified across typed
publication, repository/API contracts, browser/export flows, and a fresh live
Leaguepedia generation. Historical comparison rows now use participating team
names, search presents `ID (real name)`, and canonical v2 avatars use safe
name-derived abbreviations with region-specific styles and revalidation-safe
ETags.

## Drift and recovery

The original reviewed 7/14 publication was absent from every retained local DB,
MinIO volume, dump, and safe cold-copy inspection. The release was therefore
re-published from current Leaguepedia evidence and independently reviewed as a
new gen4 snapshot. Migration and publication were non-destructive; the old
visible generations and a pre-migration dump remain available for rollback.

## Residual risk

The 86 legacy players with null `player_id` are an intentional compatibility
state for identities not returned by this publication scope. New Leaguepedia
publications require typed IDs for referenced players, and the documented
canonical-name fallback remains fail-closed until those identities are
published.

Method Pack output does not grant completion authority.
