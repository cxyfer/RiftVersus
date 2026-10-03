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
| Default-branch push / `rebuild` | Restore latest verified checkpoint, export/verify SQLite and rebuild the site; no migration or data checkpoint update |
| Daily `17 19 * * *` UTC / `current` | Migrate staging, synchronize explicitly configured current UTC year, validate and archive a new checkpoint |
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
remains build/restore tooling and an archival acceptance/parity oracle, not an
online query server. Explicit local Compose profiles preserve named volumes;
production publication remains exclusively in GitHub Actions.

Final local gates passed: 475 unit tests, public-entry consumer checks,
workspace build/typecheck and lint; 70 fresh PostgreSQL 17 integration tests
passed after test relocation. Negative active-source/dependency checks confirm
the retired owners are absent. Independent read-only review found no new
evidenced blockers. The ADR amendment and new architecture baseline record
the root cutover decision and outstanding upstream history limitation.
Post-retirement remote CI and actual hosted verification remain the final gate.

Official workflow references inspected: GitHub's custom Pages workflow guide,
Actions concurrency guide and the pinned official Pages action definitions.
