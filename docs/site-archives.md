# SQLite Site Archives

These commands archive or restore verified static websites in the private data
repository. They do not deploy Pages, synchronize data, or modify checkpoint
lineage. The [single-writer publishing workflow](github-publishing.md) composes
these commands and remains opt-in until repository bootstrap/cutover is verified.

## Publish A Site Archive

First build and verify retained-data output as described in
[SQLite development](sqlite-development.md). Configure:

| Variable | Meaning |
| --- | --- |
| `DATA_REPOSITORY` | Explicit private `owner/repository` |
| `RIFTVERSUS_DATA_TOKEN` | Archive-only credential; never pass to Vite |
| `SITE_ID` | New immutable `site-*` release tag |
| `CODE_SHA` | Website source revision |
| `CHECKPOINT_ID` | Verified data checkpoint used by this build |
| `ARCHIVE_TARGET_COMMITISH` | Existing revision in the data repository |
| `PREVIOUS_SITE_DIR` | Optional previously downloaded verified site directory |

```sh
pnpm data site publish apps/web/dist
```

The archive allows HTML, JS/CSS/fonts, worker/WASM, SQLite, the small manifest
and hashed presentation files. Raw sources, DB dumps, JSON fact shards, unsafe
paths and linked files are rejected. SQLite, media, ZIP and file-index checksums
are checked before publication, including download verification of the draft.
An existing release is not overwritten.

`PREVIOUS_SITE_DIR` carries forward only the preceding build's own immutable
files. Its ownership/checksum inventory excludes files it inherited from its
predecessor, limiting retention to current plus previous rather than all history.
Always start with fresh build output; do not republish a previously modified
output directory as a new build.

## Restore A Site Archive

Configure `DATA_REPOSITORY`, `RIFTVERSUS_DATA_TOKEN` and an explicit `SITE_ID`:

```sh
pnpm data site download /tmp/riftversus-restored-site
```

The destination must not exist. Drafts, corrupt archives, unsafe paths and
inconsistent manifests fail before the restored site becomes available.
The restored directory includes `site-manifest.json` with code, checkpoint and
snapshot identity. Rollback uses this verified website artifact; it must not
rewind the latest data checkpoint.

## Verification Boundary

Local tests exercise publication/download through a fake Release transport and
real SQLite files, including three-deployment retention. They do not verify
GitHub permissions or a live Release/Pages deployment. No repository has been
selected and no archive has been uploaded by this migration work.

PR CI is read-only and uses a disposable PostgreSQL 17 service, matching client
tools, and explicit synthetic SQLite Playwright fixtures. It has no production
archive credentials, Release creation, Pages deployment or scheduled data sync.
