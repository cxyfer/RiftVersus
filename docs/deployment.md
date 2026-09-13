# Deployment

## One image, separate commands

Build the immutable image once:

```bash
docker build --target production -t riftversus:local .
```

The same image runs `serve`, `sync`, `sync --once`, `backfill`, and `migrate`.
Do not combine the HTTP server and scheduler in one container.

For the exact local Worlds 2013-2025 and MSI 2015-2026 build, backfill,
verification, recovery, and preview sequence recorded on 2026-07-16, see the
[local historical stack deployment record](operations.md#2026-07-16-local-historical-stack-deployment-record).

## Services

RiftVersus requires PostgreSQL and an S3-compatible object store. Build one
application image, then run separate commands from it:

- migration job: `node apps/server/dist/cli.js migrate`;
- web/API process: `node apps/server/dist/cli.js serve`;
- scheduler process: `node apps/server/dist/cli.js sync`;
- one-off import job: `node apps/server/dist/cli.js sync --once` or `backfill`.

The scheduler also supports optional weekly historical refresh, startup current
refresh, and database-backed freshness checks. See
[automatic refresh](operations.md#automatic-refresh-and-freshness-checks) for
variables, first-run validation, health semantics, and failure handling.
`node apps/server/dist/cli.js sync --history-once` validates the historical plan;
`node apps/server/dist/cli.js sync-health` exits nonzero for stale, incomplete,
or repeatedly failing sync. Compose runs this healthcheck on the sync container.
`node apps/server/dist/cli.js sync-map-check` audits the required league/year
mapping scope before a new competition is enabled.

The scheduler and one-off jobs require complete S3 settings because immutable
Leaguepedia raw source envelopes must exist before publication. Eligible
licensed retained media is preferred and also uses S3; when no image passes the
strict license and attribution gate, the generated avatar does not use S3.
`MEDIA_DELIVERY` may be `proxy`, or `redirect` only with complete S3
configuration.

## Remote PostgreSQL and S3

Provision the database and private bucket before starting containers. The
database role that runs migration 008 must be allowed to install the trusted
`pg_trgm` extension, or the DBA must provision `pg_trgm` in the `public` schema
first. Set `DATABASE_URL`, all six S3 variables, and
`S3_AUTO_CREATE_BUCKET=false` in a runtime env file, then run:

```bash
docker run --rm --env-file .env riftversus:local migrate
docker run --rm --env-file .env riftversus:local sync --once --fixture leaguepedia-small
docker run -d --name riftversus-app --env-file .env -p 3000:3000 riftversus:local serve
docker run -d --name riftversus-sync --env-file .env riftversus:local sync
```

Credentials are runtime environment values only. They are not Docker build
arguments, image environment defaults, or safe configuration-summary fields.

## Configuration checklist

1. Use a dedicated PostgreSQL database/user, provision `pg_trgm`, and back it
   up before migrations.
2. Configure a private object bucket, scoped credentials, region, endpoint,
   and path-style mode together.
3. Select and probe the current official Leaguepedia endpoint as described in
   [operations.md](operations.md); set a descriptive contactable user agent.
4. Review every competition/year source key and all three canonical mapping
   files: `data/overrides/identities.yaml`,
   `data/overrides/tournaments.yaml`, and `data/overrides/regions.yaml`.
5. Keep sync limits conservative until measured backfill evidence justifies a
   change.
6. Run migrations, then a synthetic fixture import, then a bounded live slice.
7. Confirm source objects, eligible retained media and attribution, publication
   generation, generated-avatar fallback, and `complete`/`partial`/`missing`
   coverage before enabling the schedule.

The synthetic fixture is a deterministic plumbing check only: it remains
partial and cannot establish live completeness or retire prior facts. A
deployment is not accepted from skipped PostgreSQL tests, an unverified wiki
host, or an estimated dataset size.

## Release checklist

- migrations pass against a fresh PostgreSQL instance and an upgrade copy;
- fixture import is idempotent and a bounded reviewed live slice publishes;
- the acceptance snapshot passes `pnpm acceptance:check` without unresolved
  series, placeholder presentation images, or unsupported completeness claims;
- query-plan, API latency, Playwright, PNG/ZIP, missing-media, and mobile paths
  have fresh evidence;
- final image bytes and idle/request RSS are measured in the target runtime;
- PostgreSQL and object-storage backup/restore procedures are exercised;
- app, sync, and migrate resolve to the same image ID and run as non-root.

The local `pnpm test:runtime-artifact` command is only a static deployment
preflight. Do not report its temporary directory size as Docker image evidence.
Docker/Compose startup, PostgreSQL query plans, the official reviewed snapshot,
final image size, and idle/request RSS remain mandatory release measurements.

## Source changes

There is one MVP upstream and one publication owner.
Oracle is excluded from the MVP deployment.
Adding or replacing a source requires a reviewed decision and
a publicly verifiable direct-access evidence set; do not add a hidden alternate
path to an existing image.
