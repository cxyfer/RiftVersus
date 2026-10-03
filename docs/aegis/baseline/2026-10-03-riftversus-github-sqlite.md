# RiftVersus GitHub / SQLite Baseline

Date: 2026-10-03
Status: deployed architecture verified; retirement source awaiting remote gates.
Decision: [ADR-0001 amendment](../adr/ADR-0001-leaguepedia-facts-and-fail-closed-presentation.md).
Operations and run evidence: [GitHub publishing](../../github-publishing.md).

## Canonical Owners

- Leaguepedia owns source facts. Reviewed exact tournament mappings and player
  redirects fail closed; presentation does not invent missing source identity.
- `cxyfer/RiftVersus-data` private immutable checkpoint Releases own durable
  PostgreSQL dumps, raw source objects and verified lineage. Failed attempts are
  separate immutable forensic archives, never authoritative restore bases.
- `apps/data` owns one-shot migration/import/acceptance/export and filesystem
  staging. PostgreSQL runs only as ephemeral ingestion/restore tooling. Its
  comparison helpers also support pinned archival acceptance and parity tests.
- Normalized, indexed SQLite owns public query execution. The browser uses real
  pinned `sql.js-httpvfs` Worker/WASM with manifest-sized, same-origin Range reads.
  A gzip HEAD length cannot override the verified logical database length.
- GitHub Actions `publish.yml` is the single scheduled publisher. It restores,
  syncs, validates, archives and deploys Pages under one writer lock. Website
  rollback selects an immutable site without rewinding data checkpoint lineage.
- GitHub Pages serves the public normalized site at
  https://cxyfer.github.io/RiftVersus/ from private `cxyfer/RiftVersus` source.
  Source evidence and checkpoint dumps are never public site assets.

## Preserved Contracts

Typed player ID versus real name, historical participating team/team-era labels,
per-game membership, licensed retained-media precedence and deterministic v2
avatar presentation remain enforced. Generated avatars remain presentation,
not provider evidence. URL sharing, saved comparisons and export remain client
features. No full database GET, JSON query engine or HTTP API fallback survives.

## Retirement And Recovery

Retire the Fastify server workspace, old application Docker image/entrypoint,
resident scheduler/Croner, S3 transport/AWS dependencies and their carrier-only
tests. Data acceptance, mapping, sync-health and sync-service tests move intact
to `apps/data`. Local Compose exposes explicitly selected PostgreSQL tooling and
legacy MinIO recovery profiles only; it starts no production writer.

Retained original containers, images, named PostgreSQL/MinIO volumes and independent
backup are recovery evidence. Physical deletion is out of scope. Old runbook
commands remain labelled historical records, not current operational entrypoints.
The user's unrelated `.gitignore` edit is excluded from migration commits.

## Verified Evidence And Limits

- CI 37110172738 and Publish 37110172714 passed actual Worker/WASM, screenshot
  and Range checks on desktop/mobile. Reads were 876,644 of 6,889,472 bytes,
  166 identity 206 GETs plus gzip HEAD; no API calls or page errors occurred.
- Current sync 37110413823 published sequence-2
  `checkpoint-2-37110413823-1`, preserving 1,066 series. Rollback 37110806436
  served the older website while keeping sequence 2 authoritative.
- History 37111081562 failed both reviewed batches because PlayerRedirects
  targets Levi but Players lacks OverviewPage=Levi. Downloaded/cold-restored
  `attempt-37111081562-1` and independent no-cache source queries confirmed the
  blocker. No checkpoint 3 was promoted. Full fresh history remains blocked.
- Root retirement decision accepts successful current/restore/hosted/rollback
  and verified history failure isolation: the old carriers use the same provider
  and cannot repair its missing fact. Provider and publication gates stay strict.
- Current reviewed imports are 2026/MSI; wider domestic mapping audit gaps remain.
  Pinned generation-4 archival acceptance requires its matching checkpoint.
- Local blank-page Chromium screenshots also time out; GitHub runner screenshots
  passed unchanged. Retirement requires fresh remote CI and hosted verification.
