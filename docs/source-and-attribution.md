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
repository is opened. Production uses the reviewed exact-key registry at
`data/leaguepedia/competition-map.json`, including historical LCK/Champions,
LPL and EWC main events; `domestic-ewc-audit.json` records source counts and
date spans. Missing or partial upstream scopes remain unpublishable as complete.
The reviewed canonical mappings are
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
Players with different Leaguepedia IDs/pages may share a real name. Those
source identities remain separate, and publication adds the canonical ID to a
colliding URL slug without changing an existing player's slug.

Leaguepedia `Players.ID` and `Players.Name` have separate owners in the
published identity model. `player_id` stores the public competitive ID (for
example, `Faker`), while `canonical_name` stores the real name (for example,
`Lee Sang-hyeok`). Search may match either value and presents
`ID (real name)` when both are available; comparison subjects and avatar labels
use the public ID. A legacy player published before migration `009` may retain a
null `player_id` and temporarily falls back to `canonical_name`, but every
referenced player in a new Leaguepedia publication requires both source fields.
A conflicting non-null public ID stops publication rather than silently
renaming an existing player.

`MatchSchedule` is the sole series identity/completion metadata owner. Every imported
`ScoreboardGames.MatchId` must join exactly one retained schedule row; the
schedule provides tournament identity, scheduled provenance, teams, `BestOf`,
final score, and winner. The game rows own actual timestamps, individual game
sequence, and winners. Every observed game must agree with the schedule teams
and stay within its final score; a source may omit some individual game rows.
Canonical series `playedAt` is the earliest available actual game timestamp
for the exact `MatchId`. Duplicate, orphan, or contradictory schedule/game
evidence stops the run. Team game totals use the schedule's final score, while
player comparisons use only observed game and roster rows. Comparison rows
mark series whose game detail is incomplete. The importer does not infer a
series score or `BestOf` from `ScoreboardGames` fields.
Completed BO2 series use exact 1:1 scores for a draw with no winner; the two
game winners remain required. Draws count toward series totals and win-rate
denominators, but not toward either side's wins or losses.

Comparison subjects describe what the user selected; historical series rows
describe the teams that actually participated. Each row's `leftName` and
`rightName` are resolved from its participating side's team era, preserving
historical names such as `SK Telecom T1`. If a source fact has no team-era ID,
the row falls back only to that participating team's canonical name. It never
substitutes a selected player, region, or current team affiliation.

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
same-origin deterministic
`/avatars/v2/{kind}/{canonical-entity-id}.svg` URL. The v2 algorithm identifier
is `canonical-avatar-v2`. It derives a safe two- or three-character ASCII
abbreviation from the database-owned canonical label: compact labels such as
`T1` and `LCK` remain intact, multi-word labels use up to three initials, and a
long single word uses its first three characters. A one-character result is
duplicated; labels without ASCII alphanumerics use `PL`, `TM`, or `RG`. Only
this validated abbreviation reaches the SVG, never the raw source label.

Known region labels `LCK`, `LPL`, `LEC`, and `LCS` use distinct reviewed
palette-and-pattern styles. Other regions use a deterministic digest-selected
style. Player and team styles are keyed by kind and canonical entity ID and do
not inherit a current region, because affiliations change over time.

Generated v2 responses use checksum ETags and
`Cache-Control: public, no-cache`, so clients revalidate when a typed player ID
changes the canonical label at the same URL. Licensed retained media still has
precedence. Generated avatars contain no upstream image bytes, logo, portrait,
license claim, or provider attribution and are not stored in PostgreSQL, S3, or
the media-evidence model. `/media-placeholder.svg` remains image-load error
recovery only.

An acceptance snapshot must link to the exact
`/wiki/Leaguepedia:Copyrights` legal page on the configured Leaguepedia source
origin and retain the API request URL, response checksum,
page/revision IDs when supplied, retrieval timestamp, attribution, coverage
status, exact series/game IDs, and publication source lineage. Each subject's
presentation evidence is either licensed retained media with its checksum and
content type, or `canonical-avatar-v2` with the exact entity kind, canonical
entity ID, v2 URL, SVG content type, and generated-byte checksum. Operators remain
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

## Reviewed source corrections

`sourceCorrections` in the existing checksummed identities override file records
exact source keys, reviewed Leaguepedia URLs/revisions, original expected values
and explanations. The Leaguepedia projection module is their sole implementation
owner; retained raw API envelopes are never rewritten. The same projection feeds
live query references and deterministic replay. Alias ID swaps use original rows;
unknown upstream field changes fail closed. Only reviewed missing format/team
labels and explicit missing rows are eligible; final scores are never replaced.

A reviewed game supplement requires an observed same-MatchId/Tournament series
anchor, validated slice/date, and declared bounded roster queries. Actual source
RPGIDs use a separate `scoreboard-rpgid:` key namespace. Native upstream game
rows with the same series/game number take precedence after repair. Roster
supplements apply only to imported game keys and explicit source players; no
lineup inference. Successful empty roster responses become partial coverage;
missing query scope or wrong-slice responses still fail closed. Optional profile
rows do not relax referenced identity or raw-source retention checks.

Source corrections are bounded review debt: remove exact workaround rules when
retained upstream evidence proves repair; re-review unexpected changes. Durable
historical identity/era mappings remain even after source field repair. Distinct
same-ID players such as the two Luo profiles never share canonical identity.
See [historical source closure](../data/leaguepedia/historical-source-closure.json)
for reviewed facts and the precise local verification boundary.

Awarded initial wins are not played games. Final team scores remain authoritative
while player comparisons contain only observed game/roster facts. The existing
incomplete-detail marker also covers awarded-score versus played-row differences;
it does not imply every such difference is a missing played game.

## Explicitly reviewed alternative game facts

The user's explicit request to search other sources and manually replace a missing
game authorizes a bounded exception to the Leaguepedia-only fact policy. Existing
source corrections may use sourceKind=reviewed-alternative only for absent game
and roster rows, with a reviewed official YouTube video and corroborating HTTPS
sources. No automatic alternate provider, API or scheduled fallback is added.

The existing projection keeps the native game/roster precedence and requires the
same observed-series anchor, date bounds, scores, exact player identities and
bounded roster queries. A separate review evidence action retains the manual
rules and URLs with content-derived identity inside the published raw object;
it never pretends the supplemental row was returned by Cargo/MediaWiki. Original
responses remain unchanged and the overrides checksum binds the exact facts.

For [the reviewed LCK 2026 Game 1](../data/leaguepedia/alternative-game-review.json),
only winner, sides, game number and explicit participants are imported. Time is
an inferred official-broadcast minute, not a precise game-server timestamp; this
limitation stays in the manual provenance. Current public comparisons expose the
verified calendar day. Complete game detail refers to observed game/roster
coverage, not a guarantee of precise server timestamps. Conflicting third-party
statistics are rejected. Video/images stay local evidence and are not reused as
presentation assets. Retire the supplement after verified native source repair.
