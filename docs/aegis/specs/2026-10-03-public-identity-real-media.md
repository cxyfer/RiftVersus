# Public Identity And Real Media

Date: 2026-10-03
Status: proposed design; awaiting review before implementation.

## Intent And Boundaries

Replace UUIDs in shared comparison URLs with readable player/team/region IDs.
Prefer real team logos and player portraits wherever verified assets can be
published. Preserve historical team identity, existing comparisons, saved results,
export, immutable checkpoint lineage and the GitHub-only deployment boundary.
The user request supersedes the earlier preference for generated player/team
icons. It does not establish redistribution permission for upstream images.

TaskIntentDraft: readable and stable sharing; accurate real images; verified
collision handling and actual hosted image/export evidence. Do not merge player
identities, change match membership, or replace the SQLite query engine.

BaselineUsageDraft: reviewed BASELINE-GOVERNANCE.md, ADR-0001, the 2026-10-03
GitHub/SQLite baseline, the 2026-07-18 identity/avatar spec, and current contracts,
route parser, entity publication, snapshot exporter and Leaguepedia media owner.
No new hosting service, runtime API or facts provider is proposed.

Requirement Ready Check: intent confirmed by the user; URL compatibility and
collision policy proposed below. Rights policy remains an explicit decision:
preserve verified-media eligibility, or review a new policy with real evidence.
The existing ADR explicitly requires reviewed rights/provenance design for
future real-logo overrides. Unknown permission is not a publishable license.

ImpactStatementDraft: public route representation, entity contracts, persistent
identity assignment, SQLite schema/export/query, provider image discovery,
media provenance and acceptance tests. UUID-based facts remain unchanged.

## Evidence

Current hosted SQLite was downloaded and checksum verified against the live
manifest c3c60095307c42ac7e6d8f9e6830329be984cf7c5a9f456a46d5126f3d4e3abc.
It contains 601 player entities, 99 team entities and 15 regions. Retained media
count is zero for every kind. Player display IDs Benny and Doran each identify
two currently published UUIDs. This establishes ambiguity, not proof that the
two Doran records should be merged. Such a merge needs a separate source review.
Existing slugs are based on canonical names, so Faker's slug is lee-sang-hyeok;
reusing slug alone would not meet the requested player-ID behavior.

Live Leaguepedia checks confirm Players.Image is null for Faker; its infobox
instead joins PlayerRedirects, PlayerImages and Tournaments to select eligible
profile photos by effective date. The same query finds T1 Faker 2026 LCK Cup.png.
T1's Teams.Image identifies T1logo profile.png. Both files resolve to HTTPS PNGs,
but their imageinfo extmetadata lacks LicenseShortName/UsageTerms and Artist/Credit.
The current parser therefore correctly excludes them. Failed-history raw
evidence corroborates image discovery inputs; its pre-media failure is not
evidence of a completed image synchronization.

Primary source references:
- https://lol.fandom.com/wiki/Module:Infobox/Player
- https://lol.fandom.com/wiki/Module:CargoDeclare/PlayerImages
- https://lol.fandom.com/wiki/File:T1logo_profile.png
- https://lol.fandom.com/wiki/File:T1_Faker_2026_LCK_Cup.png

## Alternatives

1. Resolve display names directly on every page load. Small initially, but
   names collide and future additions can silently change shared links. Reject.
2. Add persistent public IDs mapped to canonical UUIDs; recommend. They isolate
   readable sharing from factual identity and allow tested migration semantics.
3. Replace all internal UUIDs with names. Large fact/key migration, no benefit
   over option 2, and still requires collision handling. Reject.

For images, reuse retained-media publication rather than external hotlinks.
Automatic copying of every discoverable image would bypass current eligibility.
A reviewed media manifest may supply independently verified rights/attribution
where upstream metadata is absent; it must record evidence, not invented values.

## Public IDs

- Player base keys derive from typed player IDs, for example faker. Team keys
  derive from canonical team identifiers/names, for example t1; short names may
  be aliases only after uniqueness review. Region keys include lpl and lck.
- Keep kind as the namespace: player/faker and team/faker are distinct.
- Normalize keys with NFKC, trimmed lowercase and whitespace converted to hyphens;
  preserve other Unicode characters and encode through URLSearchParams. Avoid
  lossy ASCII transliteration that could collapse distinct source identifiers.
  Store the canonical key in the ingestion database, export it to SQLite and
  enforce a unique (kind, key) mapping. Repeated exports never reassign it.
- Resolve route IDs through exact indexed mappings before constructing the
  existing UUID-based ComparisonQuery. Never use fuzzy entity search as a URL
  resolver, and never select the first match.
- Initially ambiguous keys get explicit readable disambiguation, such as
  benny--benny-hung and benny--lien-hsiu-chi. If readable suffixes also collide,
  use a deterministic identity-derived hash suffix with checked extension.
  Do not use current team/region or insertion-order numeric suffixes.
- Once assigned, keep a public key's owner immutable. Later colliding arrivals
  receive distinct keys; no new arrival can take over an existing link. Changed
  preferred IDs require explicit reserved aliases to the same canonical owner.
- Unassigned ambiguous names are errors with explicit choices, not guesses.
  Unknown IDs must produce a clear recovery state, not silently load T1/LPL.
- Continue resolving old UUID URLs and saved comparisons. Canonicalize successful
  old URLs to readable keys without losing dates, filters, orientation or eras.
- Exact team-era selectors also need stable readable keys scoped to their team;
  retain old era UUID input so historical selections remain reproducible.

Example: ?leftKind=player&leftId=faker&rightKind=region&rightId=lpl.
Internal UUID identities, score computation and source evidence remain intact.

## Real Media

- Team discovery uses reviewed Teams.Image/source-page identity. Historical
  team-era rows use that era's logo; never apply a current T1 logo indiscriminately
  to SK Telecom T1 eras or an unrelated organization.
- Player discovery queries PlayerImages through reviewed PlayerRedirects with
  IsProfileImage=1, ordering by effective SortDate/tournament date and a stable
  filename tie-break. Do not assume Players.Image contains the profile portrait.
- A current portrait is presentation, not evidence of the player's historical
  roster. No historical portrait reconstruction is part of this change.
- Retain source URL, file identity, image/version checksum, retrieval evidence,
  rights basis and attribution. A reviewed asset manifest can supply evidence
  missing from upstream metadata; no generic invented license or credit string.
- Existing bounded HTTPS downloads, private checkpoint object ownership and
  same-origin content-addressed Pages assets remain the transport owners.
  Browser rendering and PNG/ZIP export consume the same verified local assets.
- Render logos with contain sizing and portraits with crop sizing. Preserve
  fixed control geometry, accessible labels, and the existing missing-image
  presentation when no eligible real asset exists. Regions retain their existing
  icons; replacing region icons is not requested.
- Report eligible, missing, ambiguous and rights-blocked counts. Never describe
  fallback-only output as successful migration to real images.

Existence Check: reuse entity publication, media downloader/provenance, export
and query owners. Persistent public-ID mappings are required because current
slug/display fields lack uniqueness and immutability for public routing. A
reviewed asset manifest is needed only for externally verified media metadata.

## Acceptance And Delivery

1. Tests prove exact ID resolution, case/encoding behavior, same-kind collisions,
   cross-kind namespaces, late arrivals, immutability, old UUID/era links, saved
   comparisons and share/reload/filter preservation.
2. Audit the actual snapshot's ID assignments, especially Benny/Doran. Do not
   merge or relabel facts merely to eliminate a routing collision.
3. Media tests prove PlayerImages discovery, identity binding, historical logo
   binding, deterministic image selection, checksum and rights failures.
4. Production E2E and hosted checks prove actual image decoding, nonzero natural
   dimensions, stable mobile/desktop layout, same-origin image requests and
   visible real media in PNG/ZIP export. Retain review screenshots.
5. Commit the readable-ID stage and media stage separately. Run existing CI,
   cold restore, acceptance and Pages checks; amend the ADR/baseline only after
   the respective behavior is verified. Preserve old data volumes and archives.

## Decision Needed

Approve the persistent readable-ID design and a real-media preference that keeps
unknown-rights assets unpublished. Real images without upstream metadata require
independently verified permissions/attribution supplied through reviewed assets;
T1/Faker discovery alone does not satisfy the current media publication gate.
