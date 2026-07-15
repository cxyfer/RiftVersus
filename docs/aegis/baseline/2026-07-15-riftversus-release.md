# RiftVersus release architecture baseline

Date: `2026-07-15`
Decision record: [ADR-0001](../adr/ADR-0001-leaguepedia-facts-and-fail-closed-presentation.md)

This snapshot records the current release architecture after the
Leaguepedia-primary historical acceptance and deterministic-avatar work. It is
evidence of current state, not completion authority.

## Owners and contracts

- Leaguepedia is the sole MVP facts provider. `runSync` owns normalized
  publication into one visible PostgreSQL generation, with immutable raw source
  envelopes retained in S3-compatible storage.
- The sync provider owns upstream media eligibility and fails closed unless the
  HTTPS host, raster content type, license, and attribution all validate.
- The database repository owns presentation precedence: current licensed
  retained media, otherwise `/avatars/{kind}/{canonical-entity-id}.svg`.
- Fastify's `canonical-avatar-v1` generator exclusively owns deterministic SVG
  bytes. Generated avatars are presentation output, not media provenance,
  `media_objects`, or persisted source objects.
- Public comparison/entity JSON shapes and saved comparison URLs remain
  compatible. HTTP serving reads published PostgreSQL/S3 state and local avatar
  output; it does not call Leaguepedia.
- Reviewed canonical mappings are `data/overrides/identities.yaml`,
  `data/overrides/tournaments.yaml`, and `data/overrides/regions.yaml`.

## Deployment boundary

- One immutable non-root Node image runs separate `serve`, `sync`,
  `sync --once`, `backfill`, and `migrate` commands.
- PostgreSQL and an S3-compatible private bucket are required. Compose provides
  the local PostgreSQL/MinIO template; the same image accepts remote services
  through runtime configuration.
- Migrations are explicit and sync never shares process ownership with the HTTP
  server. HTTP requests remain upstream-free.

## Release evidence snapshot

- Official acceptance covers Worlds 2013-2025 and the reviewed T1-versus-LPL
  BO5 result: 12-0 series and 36-9 games, with exact source lineage and
  deterministic T1/LPL avatars.
- Environment-specific retained-state measurement: PostgreSQL `17,069,747`
  bytes; `source_objects` `6` rows / `52,966,661` bytes; `media_objects` `0`
  rows / `0` bytes; MinIO `6` objects / `52,966,661` bytes.
- Environment-specific warmed API measurement (5 warm-ups, 50 sequential
  full-body samples, nearest-rank p95): entity search `9.533 ms` against
  `150 ms`; the single comparison summary/first-page response `18.215 ms`
  against `500 ms` and `750 ms` respectively; all measured responses HTTP 200.
- Detailed image, memory, test, Playwright, query-plan, and acceptance evidence
  remains in `docs/operations.md` and
  `docs/aegis/work/2026-07-12-riftversus-mvp/`.

## Preserved, retired, and forbidden compatibility

- Preserved: provider-neutral PostgreSQL schema, licensed retained-media
  precedence, immutable source evidence, public JSON/URL contracts, and the
  generic placeholder only for image-load recovery.
- Retired with delete-first: Oracle as an MVP provider and the assumption that
  only retained upstream media can satisfy presentation acceptance. No internal
  compatibility exception remains.
- Forbidden: alternate facts providers, upstream hotlinks, inferred/null media
  rights, client-side or duplicate avatar generators, and persisted generated
  avatars.
- No persistent database rows or S3 source objects were deleted. Any future
  source-of-truth deletion is confirmation-first and requires scoped approval,
  backup/rollback planning, and fresh evidence.

## Known limits and next decisions

- Current official T1/LPL images lack sufficient redistribution evidence, so
  the accepted dataset has no persisted media objects and uses neutral local
  avatars. This is not a claim to logo or portrait rights.
- Counts, bytes, latency, RSS, and image size are environment-specific release
  observations, not universal capacity guarantees.
- Historical completeness is limited to the accepted bounded slices and is
  expressed as `complete`, `partial`, or `missing`; zero rows never prove
  completeness.
- Supplying real logos or portraits, changing the facts provider, or adding a
  media override requires a new reviewed rights/provenance and architecture
  decision rather than a compatibility fallback.
