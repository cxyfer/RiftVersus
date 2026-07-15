# Data sources

Leaguepedia is the sole MVP upstream. The importer uses a reviewed MediaWiki
API endpoint, bounded Cargo/query traversal, a contactable user agent, immutable
raw object retention, and three reviewed canonical mapping files:
`data/overrides/identities.yaml`, `data/overrides/tournaments.yaml`, and
`data/overrides/regions.yaml`. The region map owns source-region mappings such
as LPL. HTTP handlers never call Leaguepedia.

Coverage is recorded per bounded competition/year slice as `complete`,
`partial`, or `missing`. Zero rows never establish completeness. Ambiguous
identities and unresolved series are excluded or surfaced as coverage warnings;
they are not replaced by guessed mappings.

Historical release acceptance requires a pinned snapshot containing page and
revision IDs, retrieval timestamps, raw SHA-256 checksums, dataset version,
attribution, coverage, resolved series/game IDs, source-object lineage,
discriminated retained-media or generated-avatar evidence for both subjects,
and independent review metadata. Generated presentation evidence identifies the
canonical subject and verifies `canonical-avatar-v1` SVG bytes; it does not
weaken the historical Leaguepedia source and publication-lineage checks.
Until that evidence exists, `pnpm acceptance:check` exits non-zero and no T1
versus LPL Worlds BO5 total is asserted.

See [source-and-attribution.md](source-and-attribution.md) for detailed source
policy and the evidence required before reconsidering another provider.
