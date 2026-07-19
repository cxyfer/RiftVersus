# Comparison Identity and Canonical Avatar v2 Design

Date: `2026-07-18`
Status: `approved direction; pending written spec review`
Amends:

- `2026-07-12-riftversus-design.md`
- `2026-07-14-deterministic-avatar-fallback-design.md`

## Goal

Improve comparison presentation without changing comparison membership or
scoring semantics:

1. Every historical series row displays the two teams that played the series,
   even when the selected subjects are players or regions.
2. Generated avatars use a stable two- or three-character English abbreviation
   derived from the canonical player ID, team name, or region name.
3. Player search presents `ID (real name)`, for example
   `Faker (Lee Sang-hyeok)`, while the public comparison subject label remains
   the player ID.

Licensed retained media remains preferred. Generated avatars remain
same-origin, deterministic presentation output and are not persisted as source
or media evidence.

## Requirement Source and Readiness

The user confirmed all three requirements on `2026-07-18` and approved the
identity-first avatar-v2 direction. The approved interpretation is:

- region-specific styling applies to region avatars;
- team and player avatars do not inherit a current region style because their
  affiliations can change over time;
- `ID (real name)` is a search and selection presentation format;
- comparison summaries use the player ID, while historical rows use team names;
- the existing immutable v1 avatar URL is retired instead of changing bytes in
  place; name-based v2 responses use ETag revalidation because the typed player
  ID may be populated after an entity is first published.

Open blocker questions: none.

Requirement Ready Check: `ready`.

## Current-State Evidence

- `packages/database/src/repositories/comparison.ts` currently writes the
  selected subjects' `displayName` values into every `SeriesRow.leftName` and
  `SeriesRow.rightName`. This makes player and region names leak into historical
  team-vs-team rows.
- `packages/sync/src/providers/leaguepedia/client.ts` requests both `Players.ID`
  and `Players.Name`, but `parseEntity` retains only `Name`. The public player ID
  is therefore lost before normalization and publication.
- `apps/server/src/avatar.ts` accepts only entity kind and UUID, so it cannot
  derive a name abbreviation.
- `canonical-avatar-v1` explicitly forbids text and is served with a one-year
  immutable cache. Replacing its bytes at the same URL would violate the
  existing cache contract.

The current tests pass because they encode the old contract. New regression
tests must establish the amended behavior before implementation.

## Baseline Usage

Required and reviewed references:

- `docs/aegis/baseline/2026-07-15-riftversus-release.md`
- `docs/aegis/adr/ADR-0001-leaguepedia-facts-and-fail-closed-presentation.md`
- `docs/aegis/specs/2026-07-12-riftversus-design.md`
- `docs/aegis/specs/2026-07-12-leaguepedia-primary-mvp-design.md`
- `docs/aegis/specs/2026-07-14-deterministic-avatar-fallback-design.md`
- the current contracts, database repositories, Leaguepedia provider, server
  avatar route, web combobox, export path, and acceptance verifier

Baseline Role Alignment:

- Product baseline: amended by the confirmed requirements in this spec.
- Architecture baseline: presentation precedence and server-only avatar byte
  ownership remain correct.
- Result: `Design Defect`, scope `requirements`, for the old text-free avatar
  requirement; `Implementation Drift`, scope `requirements`, for series rows
  that present selected subjects rather than participating teams.
- Required follow-up: implement this spec, then amend ADR-0001 and synchronize
  the release baseline after verification.

## Design Principles

First principle: a comparison view must preserve the distinction between the
selected subject and the actual competitive side represented in each series.

Non-negotiable constraints:

- match membership, side assignment, scores, winners, filters, and pagination
  remain unchanged;
- Leaguepedia remains the sole facts provider;
- retained licensed media remains preferred;
- generated avatars remain server-owned, same-origin, deterministic, safe SVG,
  and non-persistent;
- immutable v1 URLs never change representation bytes in place, while v2
  name-based URLs revalidate before reuse;
- player public ID and real name remain separate typed data, not a string that
  downstream consumers must parse.

Historical assumptions retired by this design:

- `SeriesRow.leftName/rightName` are aliases for selected-subject names;
- a player real name is sufficient as the public player label;
- a UUID-only avatar is the only safe deterministic representation;
- the v1 URL can be reused after a visual algorithm change.

Architecture Integrity Lens verdict: `needs ADR/baseline sync after verified
implementation`. The existing repository, server generator, and web renderer
remain the canonical owners; no client-side generator or second presentation
resolver is introduced.

## Product Behavior

### Historical Series Rows

`ComparisonResponse.subjects` describes the selected comparison subjects.
`ComparisonResponse.rows` describes the teams that played each series.

For every row:

- determine left and right competitive sides with the existing comparison
  assignment logic;
- resolve each side's historical team-era display name from the row's
  `side_*_era_id`;
- fall back to the side's canonical team name only when the fact has no team
  era;
- orient names, scores, and winner using the same left-side assignment;
- never substitute player or region names into row names.

Examples:

- player vs region summary: `Faker` vs `LPL`; row: `T1 3:1 Weibo Gaming`;
- region vs region summary: `LCK` vs `LPL`; row: `T1 3:2 Bilibili Gaming`;
- lineage history: a 2013 row may show `SK Telecom T1`, while a later row shows
  `T1`.

The `SeriesRow` JSON shape is unchanged. Only the documented meaning of
`leftName` and `rightName` is tightened to historical participating team names.

### Player Identity and Search

Leaguepedia player identity retains two separate source values:

- `ID`: public competitive player ID, such as `Faker`;
- `Name`: real name, such as `Lee Sang-hyeok`.

The persistence model adds nullable `entities.player_id text` with a constraint
that non-player entities cannot populate it. It remains nullable during rollout
so existing published rows stay readable before the next Leaguepedia
publication.

Publication rules:

- referenced player rows require a non-empty Leaguepedia `ID` and `Name`;
- `canonical_name` continues to hold the real name, preserving existing
  canonical identity invariants;
- `player_id` may transition from `null` to the first published value;
- a later conflicting non-null ID fails publication instead of silently
  renaming the player;
- ID, real name, source key, and reviewed aliases remain searchable;
- no existing entity ID, fact, alias, or media row is deleted.

`ResolvedSubject` adds optional `realName`. Repository presentation rules are:

- player with `player_id`: `displayName = player_id`,
  `realName = canonical_name`;
- legacy player with no `player_id`: `displayName = canonical_name`, omit
  `realName`;
- team and region: preserve current `displayName` behavior and omit `realName`.

The web client owns only formatting, not identity inference:

- player search result and selected combobox value:
  `displayName (realName)` when `realName` exists and differs;
- player comparison summary: `displayName` only;
- team and region search: unchanged;
- no parsing of parentheses is used for search, comparison, URLs, or export.

### Canonical Avatar v2

Algorithm identifier: `canonical-avatar-v2`.

Generated URL:

```text
/avatars/v2/{kind}/{canonical-entity-id}.svg
```

The database presentation repository continues to own retained-media
precedence and generated-avatar URL selection. It also exposes one avatar
identity resolver for the server route:

```ts
interface AvatarIdentity {
  kind: EntityKind;
  id: string;
  label: string;
}
```

Label selection is canonical and database-backed:

- player: `player_id`, falling back to `canonical_name` only for a legacy row;
- team: canonical team name, not a time-varying selected team era;
- region: canonical region name.

The Fastify route validates the kind and UUID, resolves the matching entity,
and returns structured `404` when the identity is absent or the kind does not
match. The generator remains a pure function over the resolved identity.

#### Abbreviation Rules

The abbreviation function:

1. normalizes the label with Unicode NFKD;
2. uppercases with a fixed locale-independent rule;
3. retains only ASCII `A-Z` and `0-9`, treating other characters as separators;
4. keeps an already compact two- or three-character label (`T1`, `LCK`);
5. for two or more words, uses up to three word initials (`Bilibili Gaming` to
   `BG`);
6. for one word longer than three characters, uses its first three characters
   (`Faker` to `FAK`);
7. duplicates a single remaining character to produce two characters;
8. uses the fixed kind marker `PL`, `TM`, or `RG` only when the canonical label
   contains no ASCII alphanumeric character.

Only the derived two- or three-character abbreviation is interpolated into
SVG. Raw entity labels are never inserted.

#### Visual Rules

- Use a fixed audited set of contrasting palettes and geometric patterns.
- Player and team geometry seeds use kind plus canonical UUID, so affiliation
  changes do not alter their visual pattern; a label change produces a new
  ETag and is revalidated at the same v2 route.
- Known region labels `LCK`, `LPL`, `LEC`, and `LCS` have distinct reviewed
  palette-and-pattern combinations.
- Other region labels use a deterministic digest-selected palette and pattern.
- The abbreviation remains legible at the rendered sizes used by the combobox,
  summary, and export.
- The SVG uses a fixed generic sans-serif font stack, centered text, and no
  external font resource.

#### SVG Safety and HTTP Contract

Allowed SVG elements are limited to the root `svg`, audited passive geometric
primitives, and one `text` element containing the validated abbreviation.

Forbidden content remains:

- `script`, animation, links, images, `foreignObject`, external resources,
  embedded data URLs, CSS URLs, event attributes, or raw user/source markup;
- upstream logos, portraits, trademark imitation, or persisted generated bytes.

The route preserves:

```text
Content-Type: image/svg+xml
Cache-Control: public, no-cache
ETag: "sha256-{checksum}"
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
```

The checksum covers the exact v2 SVG bytes.

## Data and Request Flow

```text
Leaguepedia Players.ID + Players.Name
  -> provider parser and normalized staged entity
  -> PostgreSQL entities.player_id + entities.canonical_name
  -> entity search / comparison subject resolution
  -> web formats ID (real name)

series_facts side team + era IDs
  -> comparison repository side assignment
  -> historical team-era names
  -> SeriesRow leftName/rightName

licensed retained media exists
  -> /media/{object-key}

otherwise
  -> /avatars/v2/{kind}/{canonical-id}.svg
  -> database avatar identity resolver
  -> canonical-avatar-v2 generator
```

## Canonical Owners

- Leaguepedia provider: extraction and validation of player ID and real name.
- Sync publication: additive `player_id` population and conflict rejection.
- PostgreSQL entities: persisted player ID and canonical real name.
- Entity repository: public subject identity shape used by search and
  comparison.
- Comparison repository: series-side assignment and historical team row names.
- Presentation repository: retained-media precedence, v2 URL generation, and
  avatar identity lookup.
- Fastify generator: abbreviation algorithm and SVG bytes.
- Web client: rendering `ID (real name)` without re-inferring identity.

No responsibility is duplicated between these owners.

## Error and Legacy Behavior

- Missing or malformed `Players.ID` for a referenced player fails staging before
  publication.
- A conflicting published non-null `player_id` fails publication.
- Existing rows with `player_id = null` remain readable and temporarily use
  their canonical name until the next successful publication.
- Missing avatar identity or kind mismatch returns structured `404` and never
  reaches the generator.
- Web image-load failure may still use `/media-placeholder.svg`; it remains
  recovery-only and never becomes the canonical API URL.
- Team-era absence falls back to canonical team name in historical rows; it
  does not fall back to a selected player or region name.

## Compatibility Boundary

Preserved:

- comparison query URLs, subject IDs, scoring, filtering, pagination, summary
  semantics, `SeriesRow` field names, `mediaUrl` field names, retained-media
  precedence, `/media/*`, S3 objects, and database facts;
- same-origin presentation and browser/export image-load recovery;
- canonical team lineage and historical team-era identity.

Changed intentionally:

- `ResolvedSubject` gains optional `realName`;
- generated avatar URLs move from `/avatars/{kind}/{id}.svg` to
  `/avatars/v2/{kind}/{id}.svg`;
- generated avatar evidence changes from `canonical-avatar-v1` to
  `canonical-avatar-v2`;
- player `displayName` becomes the public ID when `player_id` is available;
- series-row names are defined as historical team names.

## Retirement and Migration

Anti-Entropy Declaration:

- Deletion class: contract-carrying code and derived generated output.
- Old path: `canonical-avatar-v1`, its unversioned route, checksum fixtures,
  acceptance evidence, tests, and documentation.
- New canonical owner: the same Fastify generator boundary implementing
  `canonical-avatar-v2` at the versioned URL.
- Preserved behavior: deterministic same-origin fallback, HTTP cache
  revalidation, retained-media precedence, SVG safety, and export rendering.
- Retired behavior: UUID-only abstract avatars and the unversioned generated
  route.
- External boundary touched: yes, generated avatar URL.
- Source-of-truth data risk: none; no rows or objects are deleted.
- User confirmation required for destructive data action: no destructive data
  action is part of this design.

Retirement Decision: `delete-first`.

There is no current active external-dependency evidence justifying a second v1
generator, legacy redirect, or compatibility carrier. APIs return v2 URLs after
deployment. Browser-cached v1 bytes may remain in a client's cache but are no
longer referenced by the main path.

The additive database migration runs before the updated application. A
subsequent successful Leaguepedia publication populates player IDs. Release
acceptance must not claim the player-search requirement is complete until the
published dataset includes the expected ID and real-name pair.

## Alternatives Considered

### Put the label in the avatar URL

Rejected. Query/path labels create user-tamperable identity, larger cache keys,
encoding complexity, and a second source of truth outside PostgreSQL.

### Generate avatars in the web client

Rejected. It duplicates the generator across normal rendering and export,
breaks server acceptance evidence, and violates the existing presentation
ownership decision.

### Change v1 bytes at the existing URL

Rejected. The v1 route promises one-year immutable caching; changing bytes in
place would leave clients with stale v1 output under a v2 semantic contract.
The versioned v2 route instead uses ETag revalidation because its display label
is intentionally sourced from current typed identity data.

### Make team/player colors follow current region

Rejected. Team and player affiliations change, while their geometry is keyed
only by canonical identity. Region-specific style is therefore limited to
region avatars.

## Verification and Acceptance

### Historical Row Tests

- Cover all nine player/team/region comparison-kind combinations.
- Assert that every row name is a team or team-era name.
- Cover reversed side orientation, player participation, region matching,
  lineage-era changes, missing era fallback, keyset pagination, scores, and
  winner alignment.
- Prove summaries still show selected subjects.
- Prove browser rendering and PNG/ZIP export consume row names unchanged.

### Player Identity Tests

- Parser tests prove `ID` and `Name` are retained separately.
- Referenced rows with missing ID fail closed.
- Publication tests prove `null -> value`, idempotent replay, and conflicting
  ID rejection.
- Search tests prove lookup by ID, real name, and alias.
- Contract and web tests prove `Faker (Lee Sang-hyeok)` formatting and legacy
  rows without `realName`.

### Avatar v2 Tests

- Unit tests cover abbreviation examples, one-character duplication,
  no-ASCII kind marker, deterministic bytes, kind/UUID separation, uppercase
  UUID canonicalization, fixed checksum fixtures, and safe SVG structure.
- Region tests prove distinct styles for LCK, LPL, LEC, and LCS.
- Route tests cover database identity resolution, kind mismatch, missing ID,
  malformed UUID, traversal encodings, revalidation headers, conditional ETag
  responses, and query-string stability.
- Repository tests prove retained-media precedence and exact v2 fallback URLs
  for player, team, region, and exact team-era subjects.
- Acceptance tests prove algorithm, route, label identity, content type,
  checksum, subject identity, and rejection of v1/unversioned URLs.
- E2E and export tests prove visible abbreviations and placeholder recovery.

### Required Gates

- focused sync, database, server, contracts, and web tests;
- `pnpm test`;
- `pnpm typecheck`;
- `pnpm lint`;
- full PostgreSQL integration tests with `TEST_DATABASE_URL` configured;
- web E2E tests;
- production acceptance against a freshly published dataset;
- lingering-reference search proving no main-path `canonical-avatar-v1` or
  unversioned generated URL remains.

## Complexity and File Boundaries

- Keep SQL side-name projection inside the existing comparison repository; it
  changes representation, not comparison ownership.
- Keep player source parsing in the existing Leaguepedia provider despite its
  size; the edit is a local typed-field correction, not a new responsibility.
- Extend the small presentation repository for v2 URL and identity resolution.
- Keep abbreviation and SVG construction in `apps/server/src/avatar.ts`.
- Keep `apps/server/src/app.ts` and CLI composition wiring-only.
- Do not add a generic identity service, avatar cache, compatibility adapter,
  client generator, or player-profile subsystem.

Projected complexity result: `within-budget` with focused owner edits and one
additive migration.

## Non-Goals

- real team logos or player portraits;
- media uploads, overrides, or new rights/provenance rules;
- region-derived styling for team or player avatars;
- player nationality, role, current team, or roster profile data;
- changing match qualification, record aggregation, scores, filters, saved
  comparison URLs, or export pagination;
- deleting live PostgreSQL rows, S3 objects, or cached client files;
- retaining a second v1 generator without active external dependency evidence.

## ADR and Baseline Signal

Completion requires amending or superseding ADR-0001 to record:

- typed player ID/real-name presentation;
- series-row team-name semantics;
- versioned avatar algorithm and URL;
- safe abbreviation text as an allowed generated-presentation primitive;
- delete-first retirement of v1;
- unchanged media provenance and persistence boundaries.

After verified implementation, synchronize
`docs/aegis/baseline/2026-07-15-riftversus-release.md` through a new release
baseline snapshot rather than editing historical evidence in place.

## Working Artifacts

TaskIntentDraft:

- Outcome: accurate historical team rows, recognizable generated avatars, and
  unambiguous player search labels.
- Success evidence: all acceptance cases above pass on a freshly published
  dataset.
- Stop condition: v2 is the only generated main path, player ID/name are typed,
  and row labels are historical teams for every subject combination.
- Non-goals: the explicit list above.

BaselineReadSetHint:

- latest release baseline, ADR-0001, the two amended design specs, contracts,
  repositories, provider parser, server generator, web UI, export, and
  acceptance verifier.

BaselineUsageDraft:

- Required refs: all references listed in `Baseline Usage`.
- Acknowledged before planning: yes.
- Cited in design: yes.
- Missing refs: none known.
- Decision: `continue` after written spec approval.

ImpactStatementDraft:

- Layers: provider, sync staging, additive schema, repositories, public
  contract, server presentation, web formatting, export evidence, acceptance,
  ADR, and baseline.
- Owners: unchanged; one optional field and one versioned route are added.
- Invariants: comparison facts and media provenance remain unchanged.
- Compatibility: explicit intentional changes and preserved boundaries are
  listed above.
- ArchitectureReviewRequired: `yes`.
