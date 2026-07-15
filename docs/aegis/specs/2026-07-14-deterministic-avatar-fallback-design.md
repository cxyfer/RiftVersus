# Deterministic Avatar Fallback Design Amendment

Date: `2026-07-14`
Status: `approved by user`
Amends: `2026-07-12-leaguepedia-primary-mvp-design.md`

## Goal

Every comparison subject must have a stable presentation avatar without
publishing upstream media whose redistribution rights are unknown. Licensed
Leaguepedia media remains preferred when its source metadata is complete;
otherwise RiftVersus generates a neutral local avatar.

This amendment does not authorize, reproduce, or imitate team, league, player,
Riot, or Fandom logos and portraits.

## Evidence and Design Defect

The reviewed Leaguepedia image evidence for T1 and LPL supplies HTTPS image
URLs, MIME types, checksums, and description-page URLs, but no per-file license,
artist, credit, or source. Their file-description revisions contain category
markup only. Fandom's licensing policy states that non-text media must not be
assumed to use the wiki text license.

The previous acceptance contract required two retained upstream media objects.
That requirement cannot be satisfied honestly for the reviewed T1/LPL source
evidence. The defect is in the acceptance requirement, not in the strict media
parser.

## Canonical Owners

- Leaguepedia media eligibility remains owned by the sync provider. A media
  item is eligible for download and publication only when its HTTPS URL,
  allow-listed image content type, non-empty license, and non-empty attribution
  all pass the existing strict validation.
- Presentation-image selection is owned once by the database repository layer:
  current licensed retained media takes precedence; otherwise it returns the
  canonical generated-avatar URL.
- Avatar bytes are owned once by the Fastify server's deterministic avatar
  generator. The web client, export path, database, and sync provider do not
  reimplement the algorithm.
- `/media-placeholder.svg` remains an image-load error recovery path only. It
  is not a normal canonical presentation image.

## Public Contract

Existing JSON field names remain unchanged:

- `ResolvedSubject.mediaUrl`
- `ComparisonResponse.mediaUrls.left`
- `ComparisonResponse.mediaUrls.right`

Their clarified meaning is "same-origin presentation image URL," not
"licensed upstream media URL."

The canonical generated URL is:

```text
/avatars/{kind}/{canonical-entity-id}.svg
```

`kind` is `player`, `team`, or `region`. A team-era query uses the canonical
team entity ID so renames do not create a second avatar identity owner. For an
exact team-era result, only current retained media attached to that exact era
is eligible; it does not fall back to entity-level retained media.

## Avatar Algorithm

Algorithm identifier: `canonical-avatar-v1`.

Inputs are only the validated entity kind and UUID. After validation, the UUID
is canonicalized to lowercase before the hash seed and UUID-byte geometry are
derived. The generator:

- derives a fixed color pair and abstract geometric pattern from the UUID;
- includes a non-logo kind marker for visual distinction;
- emits byte-identical SVG for the same input across processes;
- contains no script, animation, external resource, embedded upstream bytes,
  entity display name, team initials, portrait, or trademark-like artwork;
- escapes or rejects every value before SVG interpolation;
- produces `image/svg+xml` with a deterministic SHA-256 checksum.

The route accepts only the three known kinds and valid UUID syntax. It
returns immutable caching headers, `X-Content-Type-Options: nosniff`, and a
restrictive SVG-compatible Content Security Policy. Invalid input returns the
normal structured 404 response and never reaches the generator.

Generated avatars are presentation output. They are not inserted into
`media_objects` or `media_assets`, do not claim provider attribution or a
third-party license, and do not pass through S3.

## Resolution and Failure Rules

The single repository resolution rule is:

```text
current licensed retained media -> generated canonical avatar
```

For player, region, and non-era team results, retained media is selected from
the canonical entity. For an exact team-era result, retained media is selected
only by the exact era ID; when none exists, the generated URL still uses the
canonical team entity ID.

There is no raw upstream URL, redirect, hotlink, client-side generator,
license-null publication branch, or second fallback chain. If retained media
is absent, rejected, retired, or lacks a current database row, the generated
avatar is the expected main-path result.

An HTTP image-load failure may still fall back to `/media-placeholder.svg` in
the web and export clients. That recovery does not change the canonical API
URL or acceptance result.

## Acceptance Contract

The reviewed historical snapshot must prove that both T1 and LPL resolve to
non-placeholder presentation images. Each side records discriminated evidence:

- `retained-media`: existing S3 object key, database metadata, SHA-256 checksum,
  byte size, and allow-listed raster content type; or
- `generated-avatar`: exact kind, canonical entity ID,
  `canonical-avatar-v1`, `image/svg+xml`, and expected SHA-256 checksum.

For generated evidence, the acceptance verifier requests the same-origin avatar
route or calls the canonical generator dependency, hashes the returned bytes,
and verifies the route, algorithm, content type, subject identity, and checksum.
It must reject the generic placeholder, wrong side, wrong UUID, wrong kind,
wrong algorithm, mutable response headers, wrong content type, or checksum
mismatch.

Historical match acceptance remains separate and unchanged: the reviewed raw
Leaguepedia objects, page/revision IDs, source-object checksums, complete
2013-2025 Worlds coverage, canonical series/game provenance, and exact T1/LPL
BO5 totals must all pass before release.

Passing this acceptance proves that both subjects have deterministic avatars.
It does not claim that RiftVersus has obtained rights to T1 or LPL logos.

## Verification

- Generator unit tests prove determinism, input separation, safe SVG structure,
  absence of scripts/external references, and stable checksum fixtures.
- Route tests prove validation, headers, content type, immutable caching, and
  structured invalid-input behavior.
- Repository integration tests prove retained-media precedence and generated
  fallback for player, team, and region subjects through both entity search and
  comparison queries.
- Web and export tests prove canonical avatar rendering and retain the generic
  placeholder only for load failures.
- Acceptance tests prove both evidence variants and all fail-closed negative
  cases.
- Docker acceptance proves actual T1 and LPL API responses use non-placeholder
  same-origin avatars and that the reviewed historical snapshot passes.

## Compatibility and Non-Goals

- No database migration or new persisted media owner is required.
- No operator media directory, upload workflow, media override manifest, or
  alternate upstream provider is added in this MVP slice.
- Existing licensed Leaguepedia media caching, S3 objects, current-media
  retirement, and `/media/*` behavior remain unchanged.
- Existing comparison JSON shapes and saved comparison URLs remain compatible.
- Supplying real logos or portraits later requires a separately reviewed media
  rights and provenance design.

## Anti-Entropy Declaration

- Old path: acceptance required retained upstream media even when the only
  reviewed source omitted redistribution evidence.
- New canonical owners: strict sync media gate, repository presentation
  resolver, and one server avatar generator.
- Preserved behavior: licensed media precedence, same-origin delivery, visible
  avatars, deterministic export, and fail-closed historical acceptance.
- Retired behavior: treating retained upstream media as the only acceptable
  presentation image.
- Forbidden compatibility path: publishing unknown-license media with a null,
  inferred, site-wide, or fabricated license or attribution.
- Source-of-truth data risk: none; no persistent rows or S3 objects are deleted.
- Retirement decision: `delete-first` for the retained-media-only acceptance
  assumption; no runtime compatibility exception.

## ADR Signal

This amendment clarifies the public presentation-image contract and separates
licensed source media from locally generated presentation output. Completion
must record this distinction in the final architecture decision and synchronize
the source, attribution, operations, and acceptance documentation.
