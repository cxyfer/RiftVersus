# GitHub Publishing Operations

`publish.yml` is the only scheduled data/site writer. It is disabled unless the
website repository variable `PUBLISH_ENABLED` is exactly `true`, and only runs
on the repository's default branch. Local tests do not enable or deploy Pages.

## Activation Prerequisites

1. Choose the website repository and a separate **private** archive repository.
   Configure Pages to use GitHub Actions and protect the `github-pages`
   environment/default branch. Enable immutable Releases in the archive repo.
2. Set `DATA_REPOSITORY` and `ARCHIVE_TARGET_COMMITISH` repository variables.
   The latter is a revision in the archive repo, not the website code SHA.
3. Store the archive-scoped Contents read/write credential as the
   `RIFTVERSUS_DATA_TOKEN` secret. Do not put it in Vite variables or public files.
4. Configure the reviewed source variables below. The current-year mode rejects
   implicit old fixture years. Requested scopes must have complete coverage;
   missing mappings or partial responses stop the candidate publication.
5. Bootstrap and cold-restore a verified private checkpoint using
   [checkpoint operations](checkpoints.md). Never bootstrap by silently refetching
   source data or by treating an `attempt-*` archive as a valid checkpoint.
6. Before final cutover, independently back up the old state, stop its scheduler,
   and export/verify the final consistent checkpoint. Preserve existing volumes.
   Only after this handoff, set `PUBLISH_ENABLED=true` and manually run `rebuild`
   with `initial_site=true`. Verify actual Pages Range behavior and recovery.

Required source variables for builds/sync: `LEAGUEPEDIA_ENDPOINT`,
`LEAGUEPEDIA_USER_AGENT`, `LEAGUEPEDIA_MEDIA_HOSTS`, `LEAGUEPEDIA_SYNC_YEARS`,
`LEAGUEPEDIA_SYNC_COMPETITIONS`, `LEAGUEPEDIA_COMPETITION_MAP`,
`LEAGUEPEDIA_MAPPING_YEARS`, `LEAGUEPEDIA_MAPPING_COMPETITIONS`.
The competition map is reviewed JSON configuration, not shell code. See the
existing source documentation for endpoint/contact/mapping restrictions.

## Modes

| Trigger/mode | Behavior |
| --- | --- |
| Default-branch push / `rebuild` | Restore latest verified checkpoint, migrate disposable staging, export/verify SQLite and rebuild the site; no source sync or data checkpoint update |
| Daily `17 19 * * *` UTC / `current` | Migrate staging, synchronize explicitly configured current UTC year, validate and archive a new checkpoint |
| Manual `media` | Restore the verified checkpoint, migrate staging and publish `data/overrides/media.json`; preserve match/roster/public-ID/coverage records, validate a new checkpoint and deploy same-origin images with credits |
| Weekly `47 20 * * 6` UTC / `history` | Migrate staging and run reviewed historical scopes, then archive a new checkpoint |
| `backfill` | One explicit year and competition; no arbitrary command arguments |
| `reexport` | Migrate staging and re-export/validate without fetching source data |
| `rollback` | Download one explicit `site-*` archive, test it and deploy it; no database restore, migration or sync |

The UTC schedules correspond to 03:17 daily and 04:47 Sunday in Asia/Taipei.
`initial_site=true` only permits a missing deployed `site-manifest.json`; it does
not permit a missing checkpoint or auto-enable Pages.

### Manual Operations

Run from an authenticated GitHub CLI session with access to the private website
repository. The workflow uses the stored archive-scoped secret; these commands
do not require exporting or printing its token locally.

```sh
gh run list --repo cxyfer/RiftVersus --workflow publish.yml
gh workflow run publish.yml --repo cxyfer/RiftVersus --ref main -f mode=rebuild
gh workflow run publish.yml --repo cxyfer/RiftVersus --ref main -f mode=current
gh workflow run publish.yml --repo cxyfer/RiftVersus --ref main -f mode=media
gh workflow run publish.yml --repo cxyfer/RiftVersus --ref main -f mode=history
```

Dispatch one operation at a time and wait for its complete result, including
the deploy job, before choosing the next. Inspect a specific run with
`gh run view RUN_ID --repo cxyfer/RiftVersus` or wait using
`gh run watch RUN_ID --repo cxyfer/RiftVersus --exit-status`.

An explicit known-good website recovery uses its immutable site archive:

```sh
gh workflow run publish.yml --repo cxyfer/RiftVersus --ref main \
  -f mode=rollback -f site_id=site-37110172714-1
```

That archive passed hosted desktop/mobile smoke on 2026-10-03. Recovery restores
that website, without modifying the authoritative data checkpoint. Do not use
the first `site-37108280050-1`, whose hosted client failed. After recovery, run
`rebuild` to return the site to the latest verified checkpoint when appropriate.

All modes share a workflow-level concurrency group with running-run cancellation
disabled. GitHub's default single pending slot can replace an older pending run;
this is not a durable FIFO job queue. Check cancelled runs and manually rerun a
required historical/backfill operation. SHA guards reject stale queued code
before data/site promotion and immediately before Pages deployment.

## Publication Boundary

The preparation job restores to disposable PostgreSQL 17 plus filesystem
objects. Updated data passes mapping/complete-scope checks, SQLite export and
current provenance/historical acceptance before checkpoint promotion. Remote
checkpoint publication includes a separate empty PostgreSQL restore validation.
Unchanged synchronization still creates a checkpoint for persisted check times.

The browser build subprocess receives a non-secret environment allowlist. The
site is tested using real Worker/WASM and Range requests, archived, downloaded
again and verified. Only this downloaded public directory is uploaded as the
Pages artifact. Private staging directories never enter the Pages artifact.
Current/previous immutable files are preserved by the site archive contract.

Every newly built site also runs ten cold contexts against a loopback preview
with 150 ms response delay and shared 10 Mbit/s bandwidth for assets and Worker
XHR. Before site archive/publication, the default comparison must stay within
30 Range GETs, 1 MiB database transfer and a ten-second median. Rejected rebuilds
archive their attempt without publishing a site or advancing the checkpoint.
Current/history modes may already have promoted an accepted data checkpoint;
a later website gate failure does not undo that promotion.

Explicit rollback keeps the ordinary screenshot/identity/206 transport smoke
but does not apply new performance budgets to an older archived site. Prepare
always retains only its public browser-evidence subdirectory as
candidate-browser-evidence-RUN_ID-ATTEMPT for 14 days, including partial
measurements/failure.json when available. Raw objects and private dumps stay
outside the uploaded evidence. Hosted timings remain unshaped observations,
not comparisons to the controlled threshold.

The deployment job requires Pages/OIDC permissions, rechecks the current code
SHA, deploys the prepared artifact, then verifies site identity and HTTPVFS
transport against the real Pages URL. A failed smoke test marks the run failed;
rollback is explicit rather than automatic.

## Failures And Retry

After a successful staging restore, a failure attempts to package its forensic
checkpoint as an immutable `attempt-<run-id>-<run-attempt>` Release. It includes
staging DB and indexed source objects, including retained failed sync evidence.
It never becomes a baseline. The small index contains code/baseline/stage IDs,
not raw exception messages, environment values or credentials.

Pages upload/deployment/smoke failures archive structured failure metadata with
the latest durable checkpoint, without restoring or modifying that database.
This distinguishes deployment failures from failed data candidates. A site
failure never deletes an already verified new checkpoint.

Attempt indexes are capped at 2 MiB; ZIP and uncompressed contents at 256 MiB.
Metadata limits are checked before downloading/reading payloads. ZIP entries are
streamed against the indexed size and total budget; oversized output is rejected
without accumulating the entire inflated payload. JSZip may finish its current
inflater input chunk after pause, so these are content limits, not strict process
RSS limits. Guarded callbacks discard that bounded in-flight output.
Capacity excess or token/
GitHub failure is explicitly reported as unavailable evidence, not success.
Hard cancellation or failure before tools/staging exist may prevent archiving;
that attempt's evidence remains unknown. Existing published state is preserved.

Verified indexes count data failures since the resolved successful checkpoint,
without repeatedly downloading forensic ZIPs. Three failures flag attention in
the job summary but do not disable recovery. A successful data checkpoint starts
a new baseline. This is not a claim that unavailable/cancelled attempts are known.

GitHub reruns increment `run_attempt`, giving new immutable checkpoint/site/
attempt tags. Retries always resolve authoritative checkpoint lineage again;
they do not overwrite a half-uploaded draft or rewind a published checkpoint.
To redeploy a known good website, choose `rollback` and its explicit site tag.

## Verification Status

The migration has local contract/order/failure tests and real static browser
evidence. Remote CI, repository setup, private archive bootstrap/cold restore
and hosted desktop/mobile browser verification are verified. Current source
synchronization and explicit site rollback also passed. Full reviewed historical
source synchronization is blocked by a missing upstream player dimension.
Its failure archive and baseline isolation are verified. See the remote
evidence below; local legacy retirement regressions are recorded separately.

### Remote preparation on 2026-10-03

- Website: private `cxyfer/RiftVersus`, default branch `main`, remote `origin`.
- Archive: private `cxyfer/RiftVersus-data`, archive target `main`, immutable
  Releases enabled. Contents read/write PAT configured as `RIFTVERSUS_DATA_TOKEN`.
- Pages: Actions build, HTTPS enforced, `https://cxyfer.github.io/RiftVersus/`.
  The `github-pages` environment accepts only `main`. Main requires the CI check
  and rejects force pushes/deletion; administrators can bypass required checks.
- Remote CI [37106630815](https://github.com/cxyfer/RiftVersus/actions/runs/37106630815)
  passed build/typecheck/lint, unit suites, PostgreSQL integration and production
  SQLite E2E. Publishing was skipped until explicit activation.
- Source variables were copied from reviewed local configuration. Current sync
  scope and its mapping preflight are explicitly `2026 / MSI`; the competition
  map retains reviewed historical MSI/Worlds entries. Unmapped domestic leagues
  are not configured as current imports. This does not resolve the wider mapping
  audit gaps recorded in the old deployment.
- Fresh production generation 8 was backed up to
  `/tmp/riftversus-s4-20261003/production-backup.dump` and cold-restored separately.
  SQLite current acceptance returned ready with no blockers: 714 entities,
  1,066 series, 1,664 games, 16,640 players-in-games, 8 source objects.
  Original app/sync remained stopped. PostgreSQL/MinIO were temporarily started
  for export and returned to their stopped state; volumes were preserved.
- Bootstrap draft `checkpoint-1-bootstrap-20261003` uploaded all assets but
  timed out during download verification. It is not a published baseline.
  The draft remains unpromoted; a new immutable retry succeeded below.
- Live diagnosis reproduced a 9,700,869-byte download taking 42.4 seconds while
  passing its SHA-256 check. Asset transfers now have a separate bounded deadline
  from metadata calls: 30-second API requests and 10 minutes for upload/download,
  with one deadline spanning download redirects and body. Data tests (83), full
  build and lint passed after the fix.
- Fix/setup commit `b289fdd` passed remote CI
  [37108024213](https://github.com/cxyfer/RiftVersus/actions/runs/37108024213).
  Initial checkpoint `checkpoint-1-bootstrap-20261003-retry-2` is published and
  immutable after the actual download/cold-restore gate. The failed first draft
  remains forensic evidence and is ignored by baseline resolution.
- Publishing is activated; initial `rebuild` run
  [37108280050](https://github.com/cxyfer/RiftVersus/actions/runs/37108280050)
  restored generation 8 on a clean runner, passed local browser smoke, archived
  `site-37108280050-1` and deployed Pages. Hosted browser smoke failed; its
  `attempt-37108280050-1` forensic archive is published without changing the
  data baseline. A second independent GitHub download/cold restore also matched
  all generation-8 counts and passed current SQLite acceptance.
- Hosted diagnosis found identity Range GETs returning 206 and the correct
  6,889,472-byte total, while HEAD returned gzip and a compressed Content-Length.
  The HTTPVFS client now supplies the validated manifest length through the
  upstream single-server-chunk configuration. Both preflight and Worker use
  the same immutable SQLite URL with `?chunk=0`. HEAD still occurs but does not
  determine the database length; the binary, SQL engine and Range offsets are
  unchanged. A hosted success claim requires a new deployment and browser smoke.
- Client fix `917acf9` passed full remote CI
  [37110172738](https://github.com/cxyfer/RiftVersus/actions/runs/37110172738),
  including the real gzip-HEAD Worker regression and PostgreSQL integration.
  Publish [37110172714](https://github.com/cxyfer/RiftVersus/actions/runs/37110172714)
  passed preparation, Pages deployment, deployed identity and hosted browser
  smoke. Its immutable archive is `site-37110172714-1`.
  Both desktop and mobile read 876,644 / 6,889,472 bytes (12.72%) through
  166 identity Range GETs and one HEAD. Real Worker/WASM, no API calls, no page
  errors, viewport bounds and screenshot capture passed on GitHub runners.
  Hosted comparison readiness was 2.76 seconds desktop / 2.11 seconds mobile.
  Rebuild preserved the sequence-1 data baseline and generation 8.
- Local Chromium screenshot capture also times out on a blank page, independent
  of this project. No screenshot workaround or skipped remote check was added;
  the successful hosted smoke above includes the original screenshot step.
- Real `current` run
  [37110413823](https://github.com/cxyfer/RiftVersus/actions/runs/37110413823)
  synchronized reviewed 2026/MSI, passed current acceptance with no blockers,
  published immutable `checkpoint-2-37110413823-1` and `site-37110413823-1`, and
  passed hosted desktop/mobile smoke. Snapshot ID:
  `sha256:42139d40b506d4486a82a43aca08fefaf7950cfa5ed8938454bee5fc76b12401`.
  The export retained 1,066 series; wider unmapped leagues were not imported.
- Explicit rollback run
  [37110806436](https://github.com/cxyfer/RiftVersus/actions/runs/37110806436)
  passed private site download, local smoke, Pages deployment and hosted smoke.
  Independent checks confirmed `site-37110172714-1` was served while
  `checkpoint-2-37110413823-1` remained the latest sequence-2 baseline.
  Full reviewed historical sync
  [37111081562](https://github.com/cxyfer/RiftVersus/actions/runs/37111081562)
  failed at the provider identity gate in both Worlds and MSI batches. Its
  immutable `attempt-37111081562-1` archive was downloaded and cold-restored
  locally for diagnosis: PlayerRedirects targets `Levi`, but Players contains
  no corresponding OverviewPage. A direct no-cache lookup returned `[]`; the
  same query for Faker returned its expected row. No missing identity was
  inferred from current team, similarly named players or retained old facts.
  The failed candidate never became checkpoint 3; sequence 2 stayed latest.
  Resolve the upstream record and rerun `history` before claiming fresh full
  historical synchronization. Legacy carriers use the same provider and do
  not address this data issue.

### Legacy retirement verification

The retirement slice deletes the Fastify server workspace, application Docker
carrier, S3/AWS transport and resident Croner scheduler. Data-owned acceptance,
mapping, sync-health and sync-service tests move to `apps/data`. PostgreSQL
remains build/restore tooling and an archival acceptance/parity reference, not an
online query server. Explicit local Compose profiles preserve named volumes;
production publication remains exclusively in GitHub Actions.

Final local gates passed: 475 unit tests, public-entry consumer checks,
workspace build/typecheck and lint; 70 fresh PostgreSQL 17 integration tests
passed after test relocation. Negative active-source/dependency checks confirm
the retired owners are absent. Independent read-only review found no new
evidenced blockers. The ADR amendment and new architecture baseline record
the root cutover decision and outstanding upstream history limitation.
Post-retirement remote CI and actual hosted verification passed below.
Initial retirement commit `a27ddbf` runs 37113352542 / 37113352536 stopped
before archive access or deployment: the newly added parity-reference wording
matched the retired-provider text guard. The documentation wording is corrected;
the existing source guard and all publication gates remain unchanged.

Documentation fix `3214e59` passed remote
[CI 37113562693](https://github.com/cxyfer/RiftVersus/actions/runs/37113562693):
475 unit, 70 PostgreSQL integration and six production SQLite E2E tests.
[Publish 37113562724](https://github.com/cxyfer/RiftVersus/actions/runs/37113562724)
passed clean checkpoint restore, current SQLite acceptance (ready/no blockers),
private immutable `site-37113562724-1`, deployment and hosted desktop/mobile
screenshots/Worker/WASM/Range checks. Both viewports read 876,644 / 6,889,472
bytes through 166 GETs and one HEAD; readiness was 2.70 s / 1.48 s.
Independent archive resolution/public identity confirmed sequence 2, its original
bootstrap parent and the current snapshot; local DOM/identity-206/gzip-HEAD
checks passed too. Rebuild restored the current website after rollback without
promoting another data checkpoint. Full fresh history remains source-blocked.

After hosted success, the retained original app/sync were kept stopped and their
automatic restart policies disabled. The PostgreSQL/MinIO volumes, old images,
containers and independent dump remain recovery evidence. Re-run the narrow
policy/verification commands without deleting any retained resources:

```bash
docker update --restart=no riftversus-complete-2013-2026-app-1 riftversus-complete-2013-2026-sync-1
docker inspect riftversus-complete-2013-2026-app-1 riftversus-complete-2013-2026-sync-1 --format '{{.Name}} state={{.State.Status}} restart={{.HostConfig.RestartPolicy.Name}}'
docker volume inspect riftversus-complete-2013-2026_postgres-data riftversus-complete-2013-2026_minio-data --format '{{.Name}} driver={{.Driver}}'
```

Observed: both writers `exited`, restart=`no`; both named data volumes exist.
Successful hosted checks also retain `pages-browser-evidence-<run>-<attempt>`
as an Actions artifact for 14 days. It contains public desktop/mobile screenshots,
`measurement.json`, `workflows.json` and a historical player PNG export, not
checkpoint dumps, raw objects or credentials. Hosted workflow verification
exercises share URL reload, saving, real player ID/name search, the reviewed 2017
Worlds result and historical team labels, PNG export and the mobile player view.
Download it for direct visual review:

```bash
gh run download RUN_ID --repo cxyfer/RiftVersus --name pages-browser-evidence-RUN_ID-ATTEMPT --dir /tmp/riftversus-pages-evidence
```

Do not start an old writer alongside Actions. Use the explicit archived-site
rollback flow for website recovery; investigate source failures in immutable
attempt archives before retrying history. Historical Compose/image commands in
the older runbooks are retained records, not an alternate production schedule.

Final user-workflow verification exposed a real blank PNG export even though its
signature and dimensions were valid. `html-to-image` cloned the offscreen source
position; commit `4b5e5f9` resets only the cloned root's position. The shared
`scripts/assert-export-image.mjs` decodes actual PNG pixels and rejects background
only output. CI checks both the single PNG and every page of the three-page ZIP;
the hosted verifier checks the real historical PNG and retains `export-image.json`.
Its conservative threshold is tied to the current export background/style and
must be revalidated when that style changes; reported color count is capped at 64.

[CI 37116693345](https://github.com/cxyfer/RiftVersus/actions/runs/37116693345)
and [Publish 37116693339](https://github.com/cxyfer/RiftVersus/actions/runs/37116693339)
passed. Root downloaded and directly reviewed the repaired 2400 x 1436 image:
Faker versus LPL, series 1-0, games 3-2, and the 2017 SK Telecom T1 versus Royal
Never Give Up row are visible. Non-background detail ratio was 2.8369%, above
the 0.5% gate; the original blank export fails the same check. Hosted sharing,
saving, player search, date filtering and mobile results all passed. Independent
private archive resolution and public identity confirmed site-37116693339-1,
unchanged authoritative checkpoint-2-37110413823-1 and its bootstrap parent.
Full fresh history remains blocked by the independently verified missing Levi
source identity; existing public history and current sync remain available.

Official workflow references inspected: GitHub's custom Pages workflow guide,
Actions concurrency guide and the pinned official Pages action definitions.

## Readable Routes And Real Media

`entity_public_ids` owns exact player/team/region route keys;
`team_era_public_ids` owns era keys scoped by team. UUIDs remain fact keys.
NFKC/trim/lowercase/whitespace-to-hyphen normalization preserves other Unicode
and punctuation. Initial same-name players use readable real-name suffixes;
remaining collisions extend stable identity prefixes. Published ownership is
immutable, and later arrivals cannot take existing keys. UUID-shaped labels
receive a suffix so legacy UUID routes remain unambiguous. Never merge by name.

SQLite schema 3 resolves exact kind/key mappings before UUID comparison. Legacy
UUID links and saved results remain loadable; successful URLs canonicalize with
filters/era intact. Unknown keys show recovery errors, never fuzzy search results.
Archive readers retain schema 2 rollback support. Rebuild migrates restored data
before export; the next successful `current` sync archives the persistent registry.

PlayerImages discovery is scoped to imported player pages in batches of 50,
joined through PlayerRedirects/Tournaments with deterministic profile/date/filename
selection and retained raw replay. Team source logos bind to exact normalized eras.
Existing bounded downloads, license/attribution eligibility and same-origin media
publication remain authoritative. Conflicting owners fail closed. Coverage details
record import-scope media inventory: missing includes entities without candidates;
blocked counts refer to candidate rows, not all historical entities.

Reviewed T1 and Faker files lack per-file license/attribution metadata and retain
generated fallback. Publish only after reviewable source rights evidence is
available and an approved import passes; do not patch image URLs into SQLite or
fabricate an approved license. Logos use contain sizing; portraits use cover.

Commit `7060422` passed
[CI 37134704204](https://github.com/cxyfer/RiftVersus/actions/runs/37134704204)
and [Publish 37134704354](https://github.com/cxyfer/RiftVersus/actions/runs/37134704354).
Independent live SQLite checksum verification found 715 entity route owners and
104 era route owners, including distinct Benny/Doran keys. Hosted sharing,
saving, player/date filtering, decoded PNG and mobile checks passed. Cold
desktop/mobile reads were 913,508 of 7,045,120 SQLite bytes.

Final app code `f1c0efb` passed
[CI 37136572917](https://github.com/cxyfer/RiftVersus/actions/runs/37136572917)
(488 unit, 72 integration, six production E2E tests) and
[current Publish 37136621705](https://github.com/cxyfer/RiftVersus/actions/runs/37136621705).
Checkpoint `checkpoint-3-37136621705-1` extends checkpoint 2. Independent dump
checksum verification and PostgreSQL 17 cold restore confirmed all 715 entity
and 104 era route owners match the initial public registry. Current raw replay
found 66 image candidates, all rights-blocked, with zero retained media owners.
This is current-import scope; historical media completeness is not inferred.
The selector now retains resolved names/images after UUID canonicalization and
App query caches have instance ownership. Hosted verification checks that the
selected Faker image equals the comparison image after applying date filters.

### Reviewed Image Inputs

The user-approved [editorial image policy](media-policy.md) replaces the earlier
licensed-only limitation for explicitly reviewed Leaguepedia subject images.
Publication requires the exact reviewed bytes in a private immutable media
Release, with archive and per-file checksums/sizes in `data/overrides/media.json`.
The Leaguepedia file page/revision remains the rights/attribution source; the CDN
is used during source audit, not to replace an already-reviewed deployment input.

After auditing sources and reviewing the exact owner/era assignments and bytes,
pack the reviewed cache with:

```bash
node scripts/pack-reviewed-media.mjs /tmp/media-audit /tmp/reviewed-media data/overrides/media.json
```

Upload the emitted ZIP as a draft `media-reviewed-<sha256>` Release in
`cxyfer/RiftVersus-data`. Download it and verify its SHA-256 before publishing the
draft; GitHub must report `immutable: true`. Commit the generated manifest through
normal PR/CI, then dispatch `mode=media`. The input ZIP must contain only the
reviewed image files. No token belongs in a manifest, source file, or command log.

First media publication [37157431438](https://github.com/cxyfer/RiftVersus/actions/runs/37157431438)
failed closed on a retained-image checksum; `attempt-37157431438-1` preserves
private diagnostics, while checkpoint 3 and the website remained unchanged.
The verified media input archive is
`media-reviewed-1b9a558de546b58a9448bc9ddca3162cbf13fe43eae185a6ba8a065724795407`:
683 image files, 112,268,780 image bytes, and 112,413,604 ZIP bytes. Hosted release
verification is pending the retry after the immutable-input transport fix.
