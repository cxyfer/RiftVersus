# Attribution

RiftVersus retains Leaguepedia source provenance and media attribution supplied
by the reviewed upstream response. Only media with a validated non-empty
license and attribution is cached in the configured private S3-compatible
store and served through the same-origin application route; public responses
do not expose upstream image URLs.

When those redistribution fields are absent, RiftVersus uses a neutral local
`canonical-avatar-v2` SVG at
`/avatars/v2/{kind}/{canonical-entity-id}.svg`. Licensed retained media remains
preferred. The generated response is deterministic, is revalidated with a
checksum ETag and `Cache-Control: public, no-cache`, and is not persisted in
PostgreSQL, S3, or the media-evidence model.

The generator inserts only a validated two- or three-character ASCII
abbreviation, never the raw player ID, real name, team name, or region name.
Known `LCK`, `LPL`, `LEC`, and `LCS` regions have reviewed distinct styles;
other regions use deterministic styles. Players and teams do not inherit a
current-region style. Generated avatars do not reproduce or claim attribution
for Leaguepedia, Riot, team, region, or player artwork, so the existing source
provenance and attribution requirements are unchanged.

Before redistribution, operators must review Leaguepedia's official
`/wiki/Leaguepedia:Copyrights` legal page on the configured source origin. The
historical acceptance snapshot must record
the source URL, Leaguepedia page/revision IDs, retrieval time, raw checksum,
coverage state, and discriminated presentation evidence for both subjects:
retained media checksum/content type, or generated avatar identity, algorithm,
exact v2 URL, SVG content type, and checksum. Missing license or credit makes upstream media
ineligible for retention; it is never inferred or filled from a synthetic
fixture. Missing historical revision, raw checksum, coverage, or source-lineage
evidence remains a release blocker.
