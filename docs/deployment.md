# Deployment

## Services

RiftVersus requires PostgreSQL and an S3-compatible object store. Build one
application image, then run separate commands from it:

- migration job: `node apps/server/dist/cli.js migrate`;
- web/API process: `node apps/server/dist/cli.js serve`;
- scheduler process: `node apps/server/dist/cli.js sync`;
- one-off import job: `node apps/server/dist/cli.js sync --once` or `backfill`.

The scheduler and one-off jobs require complete S3 settings because retained
source envelopes and media must exist before publication. `MEDIA_DELIVERY` may
be `proxy`, or `redirect` only with complete S3 configuration.

## Configuration checklist

1. Use a dedicated PostgreSQL database/user and back it up before migrations.
2. Configure a private object bucket, scoped credentials, region, endpoint,
   and path-style mode together.
3. Select and probe the current official Leaguepedia endpoint as described in
   [operations.md](operations.md); set a descriptive contactable user agent.
4. Review every competition/year source key and both override files.
5. Keep sync limits conservative until measured backfill evidence justifies a
   change.
6. Run migrations, then a synthetic fixture import, then a bounded live slice.
7. Confirm source/media objects, attribution, publication generation, and
   `complete`/`partial`/`missing` coverage before enabling the schedule.

The synthetic fixture is a deterministic plumbing check only: it remains
partial and cannot establish live completeness or retire prior facts. A
deployment is not accepted from skipped PostgreSQL tests, an unverified wiki
host, or an estimated dataset size.

## Source changes

There is one MVP upstream and one publication owner. Oracle is excluded from the MVP deployment.
Adding or replacing a source requires a reviewed decision and
a publicly verifiable direct-access evidence set; do not add a hidden alternate
path to an existing image.
