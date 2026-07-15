# Source, coverage, and attribution

## MVP source

Leaguepedia is the sole required upstream for the MVP. Configure the current
official MediaWiki API URL in `LEAGUEPEDIA_ENDPOINT`; there is deliberately no
runtime default. Before approving a deployment, the operator must run the
bounded `siteinfo` and known-page probes in [operations.md](operations.md),
confirm JSON responses, record the reviewed host and retrieval time, and copy
only observed image hosts into `LEAGUEPEDIA_MEDIA_HOSTS`.

`LEAGUEPEDIA_USER_AGENT` must identify the deployment and include a working
contact URL or email. Generic browser user agents and placeholder contacts are
not acceptable for a live deployment.

All Leaguepedia API request starts are serialized and paced by
`LEAGUEPEDIA_REQUEST_INTERVAL_MS` (default `1000`). Operators may raise this
interval for shared-IP or upstream pressure, but cannot configure it below one
second.

Logical competition names are not fuzzy matched. Every requested
competition/year pair must have an exact Leaguepedia tournament key in
`LEAGUEPEDIA_COMPETITION_MAP`; an absent year mapping stops the run before the
repository is opened. The reviewed canonical mappings are
`data/overrides/identities.yaml`, `data/overrides/tournaments.yaml`, and
`data/overrides/regions.yaml`; the third maps source-region values such as LPL
to canonical regions. Their checksums are retained with each sync run, and
ambiguous identities stay quarantined until an explicit reviewed rule exists.

Official Cargo redirect tables own fact-name resolution. Team facts map
`TeamRedirects.AllName` to the exact `_pageName` used by `Teams.OverviewPage`;
player facts map `PlayerRedirects.AllName` to the exact `OverviewPage` used by
`Players`. Matching is whitespace-trimmed and case-insensitive, but does not
infer aliases from names, short names, current teams, or other dimension
fields. A player redirect collision is accepted only when structural parsing
leaves exactly one valid Players row; zero or multiple valid targets fail
closed and all source rows remain in immutable evidence.

`MatchSchedule` is the sole series identity/completion metadata owner. Every imported
`ScoreboardGames.MatchId` must join exactly one retained schedule row; the
schedule provides tournament identity, scheduled provenance, teams, `BestOf`,
final score, and winner. The game rows own actual timestamps, individual game
sequence, and winners and must exactly explain that final. Canonical series
`playedAt` is the earliest actual game timestamp for the exact `MatchId`.
Missing, duplicate, orphan, or conflicting schedule evidence stops the run. The
importer does not infer a series score or `BestOf` from `ScoreboardGames` fields.

## Coverage meaning

- `complete`: every bounded page was visited, rows were observed, and no
  included row or identity remains unresolved.
- `partial`: the bounded traversal stopped early or some included evidence is
  unresolved. Existing facts are not retired from a partial scope.
- `missing`: the requested slice returned no usable rows. Zero rows never
  prove completeness and do not retire facts.

Site-wide optional dimension rows that are malformed but unreferenced by the
configured tournament/date games are isolated without changing the slice
status. Their count and sample source keys are appended to coverage detail and
their original CargoExport response remains in immutable raw evidence. If a
bounded game, player fact, tournament mapping, or lineage closure references
the malformed row, the run fails closed instead.

The published entity/tournament dimensions are limited to rows referenced by
the configured games and player facts, together with forward team-rename paths
that connect two directly referenced teams. A successor with no imported facts
remains outside the canonical identity graph. Such forward edges and other
valid site-wide dimension rows remain in retained raw evidence and are
summarized by separate count/sample audits in coverage detail; they do not enter
PostgreSQL dimensions or trigger media downloads.

`leaguepedia-small` is synthetic acceptance data. It is always published as
`partial`, is never evidence of upstream coverage, and its publication scopes
cannot retire previously published facts.

## Media and attribution

The importer reads Leaguepedia image metadata, including source URL, license,
and artist or credit. It downloads an image only when the HTTPS host, content
type, non-empty license, and non-empty attribution all pass strict validation.
Eligible bytes are stored immutably in the configured S3-compatible object
store with their checksum and attribution before publication. Public API
responses never expose the upstream image URL.

Licensed retained media is the preferred presentation image. When the reviewed
upstream response does not supply redistribution evidence, the API returns the
same-origin deterministic `/avatars/{kind}/{canonical-entity-id}.svg` URL. The
generated avatar contains no upstream image bytes, logo, portrait, display
name, license claim, or provider attribution and is not stored in PostgreSQL or
S3. `/media-placeholder.svg` remains image-load error recovery only.

An acceptance snapshot must link to the exact
`/wiki/Leaguepedia:Copyrights` legal page on the configured Leaguepedia source
origin and retain the API request URL, response checksum,
page/revision IDs when supplied, retrieval timestamp, attribution, coverage
status, exact series/game IDs, and publication source lineage. Each subject's
presentation evidence is either licensed retained media with its checksum and
content type, or `canonical-avatar-v1` with the exact entity kind, canonical
entity ID, SVG content type, and generated-byte checksum. Operators remain
responsible for reviewing the source page's current license and attribution
requirements before redistributing retained media.

## Reconsidering another source

Oracle is not an MVP source.
No alternate source is kept as a dormant provider. Reconsideration requires a new reviewed architecture/source
decision plus, at minimum:

1. a publicly verifiable direct source and stable access contract;
2. documented schema, license, attribution, update cadence, and failure mode;
3. bounded retrieval evidence and measured retained database/media size;
4. identity, coverage, and publication semantics compatible with the single
   `runSync` owner; and
5. retirement and rollback rules that do not create a second active truth.
