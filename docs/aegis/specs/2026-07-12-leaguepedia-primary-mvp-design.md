# Leaguepedia-Primary MVP Design Amendment

Date: `2026-07-12`
Status: `approved by user`
Supersedes: source architecture in `2026-07-12-riftversus-design.md`

## Goal

Use Leaguepedia's public MediaWiki API as the only upstream source required by
the RiftVersus MVP. Preserve one canonical PostgreSQL publication path, cache
all public media in S3-compatible storage, and make incomplete source coverage
visible instead of blocking the MVP on an unavailable Oracle CSV URL.

## Approved Source Boundary

- Leaguepedia owns MVP entity aliases, team eras, tournaments, explicit series,
  game/player participation, media metadata, and historical coverage evidence.
- Reviewed repository overrides have precedence over ambiguous Leaguepedia
  identity, lineage, and classification fields.
- Oracle's Elixir is retired from the MVP runtime, manifest, dependencies,
  fixtures, CLI behavior, acceptance criteria, and production documentation.
- A future Oracle adapter requires a new reviewed decision and verifiable public
  source; it is not a dormant runtime fallback.
- HTTP API handlers never call Leaguepedia. They read only the currently
  published PostgreSQL generation and cached media metadata.

## Runtime Flow

```text
Leaguepedia MediaWiki API
  -> allow-listed query/cargoquery client
  -> immutable raw JSON/media objects in S3-compatible storage
  -> provider normalizer + reviewed overrides
  -> one runSync staging/publication transaction
  -> PostgreSQL canonical facts and coverage status
  -> Fastify API and same-origin /media/*
```

`sync`, `sync --once`, and `backfill` all call the same `runSync`. Scheduled
runs never overlap. Provider failure records a failed run and cannot advance
the published generation.

## Media Rules

- Image URLs must come from Leaguepedia `imageinfo`, use HTTPS, and have a
  validated image content type and bounded byte size.
- Bytes are downloaded before publication and stored under an immutable
  checksum-derived key.
- Database media rows retain original URL, cached object key, checksum,
  content type, license, and attribution.
- Updating current media and retiring the prior `is_current` row occurs in the
  same database transaction as publication.
- Public media delivery reads only the cached object key. It never redirects to
  the original wiki URL.

## Identity and Fact Rules

- Stable provider identifiers and reviewed aliases resolve canonical entities;
  display names alone never establish identity.
- Ambiguous aliases or lineage are quarantined as unresolved issues unless an
  explicit reviewed override resolves them.
- Explicit Leaguepedia series identifiers are preferred. Derived grouping is
  allowed only when the existing domain oracle proves an unambiguous series.
- A game or player participation with inconsistent sides, winner, roster, or
  source key fails the staged run before publication.
- Re-importing an unchanged source page is idempotent.

## Coverage Rules

- Backfill is bounded by year and competition and uses Cargo offset pagination.
- `complete` requires verified expected-page traversal and consistent rows for
  the requested slice.
- Missing or incomplete evidence becomes `partial` or `missing` with detail.
- Zero returned rows never imply `complete`.

## Compliance and Access

- The client sends a descriptive User-Agent and JSON-only requests.
- Public methods cannot override `action`, `format`, allowed Cargo tables, or
  the configured endpoint.
- Requests have a timeout, bounded retries, and honor bounded `Retry-After`.
- One bounded live probe covers siteinfo and a known page; fixtures remain the
  deterministic normalization authority.
- Attribution and source URL are recorded with every retained source object.

## Compatibility and Retirement

Existing contracts, comparison semantics, schema ownership, API URLs, browser
export, Docker target, and local/remote PostgreSQL/S3 configuration remain
unchanged. Oracle source-planning files are internal code-retirement targets;
there is no live Oracle state to migrate or delete.

Anti-Entropy Declaration:

- Deletion class: code-retirement and contract-carrying plan text.
- Old path: Oracle manifest, CSV adapter, fixtures, dependencies, CLI source
  behavior, and Oracle acceptance requirements.
- New canonical owner: Leaguepedia adapter through the single sync runner.
- Preserved behavior: historical comparison, provenance, atomic publication,
  cached media, coverage warnings, and portable deployment.
- Retired behavior: Oracle CSV discovery and dual-provider precedence.
- Source-of-truth data risk: none; no Oracle data is published in main.
- Retirement decision: `delete-first`.

## Acceptance Evidence

- Fixture tests prove allow-lists, pagination, retry, normalization,
  unresolved-conflict quarantine, media caching, coverage, idempotency, and
  publication failure safety.
- PostgreSQL integration tests prove one atomic published generation and
  transactional current-media/coverage updates.
- A bounded live probe proves current public Leaguepedia access without using
  live data as expected-result authority.
- A reviewed acceptance fixture proves the T1-versus-LPL Worlds BO5 result and
  records source page identifiers, retrieval time, and checksums.

## ADR Signal

This amendment changes the upstream source-of-truth boundary and retires a
planned provider. At completion, record an ADR that references this amendment,
the unavailable Oracle direct-source evidence, the Leaguepedia live probe, the
single-runner invariant, and the condition for reconsidering Oracle.
