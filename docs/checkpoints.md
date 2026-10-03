# GitHub checkpoint commands

These commands operate on PostgreSQL 17 staging databases and a filesystem
ObjectStore. They do not start an HTTP server, update Pages, or delete old data.
GitHub publication is opt-in; local verification does not contact GitHub.

```text
PostgreSQL consistent snapshot + immutable objects
                 |
          checkpoint pack
                 |
      local manifest + database.dump + objects/<sha256>
                 |
          archive publish
                 |
      draft Release + content-addressed chunks + hashed index
                 |
      download, checksum verification, empty-database restore
                 |
          published checkpoint
```

## Local Pack And Restore

Run `pnpm build` first. Both `pg_dump` and `pg_restore` must be available.

```sh
pnpm data checkpoint pack ./candidate
pnpm data checkpoint verify ./candidate
pnpm data checkpoint restore ./candidate
```

Pack requires `DATABASE_URL`, `OBJECT_STORE_DIR`, `CHECKPOINT_ID`,
`CHECKPOINT_SEQUENCE`, and `CODE_SHA`. `CHECKPOINT_PARENT_ID` is absent for the
initial checkpoint. The ID must begin with `checkpoint-` before publishing.
The dump and referenced source/media metadata are read from the same exported
PostgreSQL snapshot. Every referenced object must exist and match its metadata.

Restore requires `DATABASE_URL` pointing to an **empty disposable database**
and `OBJECT_STORE_DIR`. It validates the entire bundle before writing. It refuses
a database containing application relations and never drops existing tables.
Restore into a fresh object directory as well; immutable conflicts are errors.
Database and filesystem writes are not one transaction: after any restore
failure, discard only those disposable targets and retry with fresh targets.

## GitHub Archive

```sh
pnpm data archive publish ./candidate
pnpm data archive resolve ./downloaded-checkpoint
pnpm data checkpoint restore ./downloaded-checkpoint
```

Both archive commands require `DATA_REPOSITORY=OWNER/PRIVATE_DATA_REPO` and
`RIFTVERSUS_DATA_TOKEN` with access to that repository's Releases. Keep the token
in the environment or Actions secrets, never in command arguments or files.
Publish also requires:

- `ARCHIVE_TARGET_COMMITISH`: a commit or branch **in the data repository**.
  This is not the website's `CODE_SHA`.
- `CHECKPOINT_RESTORE_DATABASE_URL`: a separate empty PostgreSQL 17 database
  used for the download-and-restore publication gate.

The initial checkpoint has sequence 1 and no parent. Later checkpoints must
increment the latest published sequence by one and name that checkpoint as
their parent. Resolver ignores drafts and rejects ambiguous/broken lineage.
There is no mutable `latest` tag, implicit bootstrap, or delete operation.

Files are split into chunks of at most 256 MiB. Each index maps complete local
files to ordered asset IDs, sizes, and SHA-256 checksums. Unchanged raw chunks
reference existing verified assets without uploading duplicate copies. Each
checkpoint's database dump is uploaded independently. The index itself has a
content-hashed filename and is downloaded and validated before publication.

Failure before promotion leaves a draft, not a valid sync baseline. Use a new
unique checkpoint ID when retrying a failed draft. Never remove old Releases:
newer checkpoints can reference their raw chunks. All production writers must
eventually run inside the same Actions concurrency group; the CLI's lineage
check is not a cross-runner lock.

## Verification Boundary

Local checkpoint tests, mocked Release protocol tests and PostgreSQL 17 cold
restore tests are available. On 2026-10-03, private `cxyfer/RiftVersus-data`
published immutable `checkpoint-1-bootstrap-20261003-retry-2` after the actual
GitHub download/empty-database restore gate. A separate local GitHub cold restore
and a clean Actions runner restored generation 8 successfully. The earlier
`checkpoint-1-bootstrap-20261003` draft failed transfer verification and is not
a baseline. See [publishing evidence](github-publishing.md#verification-status)
for configuration, counts and the separate Pages verification boundary.
