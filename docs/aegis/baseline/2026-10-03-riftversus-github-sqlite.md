# RiftVersus GitHub / SQLite Baseline

Date: 2026-10-03
Status: deployed architecture and runtime retirement verified.
Decision: [ADR-0001 amendment](../adr/ADR-0001-leaguepedia-facts-and-fail-closed-presentation.md).
Operations and run evidence: [GitHub publishing](../../github-publishing.md).

## Canonical Owners

- Leaguepedia owns source facts. Reviewed exact tournament mappings and player
  redirects fail closed; presentation does not invent missing source identity.
- `data/leaguepedia/competition-map.json` owns reviewed exact competition/year
  source keys. LCK/Champions, LPL and EWC main events share the existing
  one-shot publisher. BO2 draws are completed 1:1 series with no winner; missing
  source rows, redirects or format evidence keep a scope partial/failed.
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

Readable entity/era URL keys now have persistent scoped ownership in migration
010 and SQLite schema 3; UUID facts and legacy URLs/saved results remain valid.
Exact route resolution does not use fuzzy search. Same-name identities remain
separate, later arrivals cannot steal published IDs, and successful links retain
filters when canonicalized. Schema 2 immutable sites remain readable for rollback.

## Retirement And Recovery

Retire the Fastify server workspace, old application Docker image/entrypoint,
resident scheduler/Croner, S3 transport/AWS dependencies and their carrier-only
tests. Data acceptance, mapping, sync-health and sync-service tests move intact
to `apps/data`. Local Compose exposes explicitly selected PostgreSQL tooling and
legacy MinIO recovery profiles only; it starts no production writer.

Retained original containers, images, named PostgreSQL/MinIO volumes and independent
backup are recovery evidence. Physical deletion is out of scope. Old runbook
commands remain labelled historical records, not current operational entrypoints.
Original app/sync containers are stopped with restart=no after hosted verification.
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
  passed unchanged.
- Retirement commits a27ddbf / 3214e59 passed remote CI 37113562693: 475 unit,
  70 integration and six production E2E tests. Publish 37113562724 served
  immutable site-37113562724-1 with current SQLite acceptance ready/no blockers
  and hosted desktop/mobile screenshots. Independent archive resolution and
  public identity confirmed sequence 2 and its unchanged parent; local desktop/
  mobile DOM/identity-206/gzip-HEAD verification also passed. Old carriers cannot
  auto-restart, and named volume inspection confirms both retained data volumes.
- Final export fix 4b5e5f9 passed CI 37116693345 (474 unit, 70 integration,
  six production SQLite E2E tests) and Publish 37116693339. Actual PNG and
  every ZIP page must contain decoded visible pixels. Root directly reviewed
  the repaired historical PNG; all hosted sharing/saving/player/date/mobile
  workflows passed. Independent archive/public identity still resolves sequence 2
  with its unchanged parent; no source gates or history failures were bypassed.

### Historical Domestic and EWC Import Extension

2026-10-04 code adds reviewed first-division LCK/Champions, LPL and EWC-main
event keys with a separate upstream count/date audit. Exact league scope sets
the persistent LCK/LPL slug. Contracts, PostgreSQL migration 013, PostgreSQL
queries, export schema and the browser recognize BO2 draws and the EWC category.
The publish workflow reads this repository map and keeps domestic/EWC history
requests to one year each.

Isolated PostgreSQL 17 restored verified checkpoint 4 before import. Thirty-two
year scopes were audited; 16 passed and were retried after repairing evidenced
same-name player, stable-slug and KSV-to-Gen.G identity handling. Local SQLite
now contains 1,906 LCK, 1,153 LPL and 35 EWC series, alongside the unchanged
686 Worlds and 380 MSI. T1-HLE returns 35 LCK series; the original Worlds result
remains present. BLG-TES returns five LPL 2024 meetings; the 2024 T1-TES EWC
final returns 3:1. The clean 42,344,448-byte SQLite export has ID
`sha256:a209f805a9ce9d6720800df177ef5ef16123c6a206a0bbefde808621e5c57c16`.
Live raw evidence, queries and browser checks are staged under
`/tmp/riftversus-leagues-live-evidence/`. Sixteen scopes still fail closed on
source row/score/schedule/format gaps, a missing Levi player dimension, partial
coverage, or an unreviewed EStar/Ultra Prime lineage. Local data was not
promoted to a private checkpoint or GitHub Pages. No production state changed.

- Public-ID commit 7060422 passed CI 37134704204 (484 unit, 71 integration,
  six production E2E tests) and Publish 37134704354. Root independently verified
  the public SQLite checksum, schema 3, 715 entity mappings, 104 era mappings,
  legacy/readable Faker equivalence and rejection of partial/wrong-kind keys.
  Hosted sharing/saving/player/date/PNG/mobile checks passed; cold default reads
  were 913,508 of 7,045,120 bytes. Checkpoint 2 was preserved by this rebuild.

- Final routing/media code f1c0efb passed CI 37136572917 (488 unit, 72
  integration, six E2E tests) and current Publish 37136621705. Checkpoint 3
  extends checkpoint 2 and independently cold-restores the unchanged 715 entity
  and 104 era public-ID owners. PlayerImages is scoped to imported pages; exact
  era-only logo owners keep historical media independent. Current raw replay
  found 66 candidate images, all rights-blocked, and no retained media. Real
  media discovery is implemented; publishing these assets awaits source rights
  metadata. Hosted selector/summary image consistency, PNG and mobile passed.

## Source closure update — 2026-10-05

The existing Leaguepedia projection owns exact reviewed source corrections,
loaded from checksummed identities overrides. Immutable raw responses remain
unchanged; live reference queries and replay use the same corrections. Missing
formats and exact ID aliases are primary-source backed; source game/roster rows
require bounded observed-series anchors. Native rows retain precedence and
unexpected changes fail closed. See the 2026-10-05 ADR-0001 amendment and
[closure evidence](../work/2026-10-04-domestic-leagues-ewc/90-evidence.md).

Local verified coverage now includes all 32 mapped domestic/EWC annual scopes,
7,316 merged series: LCK 2,570, LPL 3,627, EWC 53, Worlds 686, MSI 380. One LCK
2026 game detail remains missing; fourteen LPL score differences are awarded
starts, not missing played games. This is local mapped-source publication, not a
claim of complete official archives or a new deployed Pages/checkpoint baseline.
Existing Actions, SQLite, checkpoint and source/media ownership remain intact.
