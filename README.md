# RiftVersus

RiftVersus compares League of Legends players, teams, and regions across
years, competitions, and best-of formats. The MVP imports Leaguepedia into a
published PostgreSQL generation. HTTP requests use retained PostgreSQL facts
and same-origin presentation, while immutable source evidence remains in S3.
Eligible retained media is preferred; otherwise the application serves
deterministic local avatars. HTTP requests never call the upstream wiki.

## Operator guide

- [Documentation index](docs/README.md)
- [Source, coverage, and attribution](docs/source-and-attribution.md)
- [Sync operations](docs/operations.md)
- [Deployment](docs/deployment.md)

Copy `.env.example` to `.env`, replace every placeholder, and verify the
configured Leaguepedia endpoint before running a live sync. The repository
does not guess or pin an unreviewed wiki host. Reserved example domains are
intentionally rejected, so an unchanged example file cannot start a sync.

```bash
pnpm install --frozen-lockfile
pnpm build
node apps/server/dist/cli.js --help
```

Oracle is not part of the MVP.
PostgreSQL provenance remains provider-neutral, but adding another upstream requires a new reviewed source
and architecture decision.

## Automatic updates

The Compose `sync` container owns its own daily/current and optional
weekly/historical schedules. Once the stack is running with reviewed source
settings, updates require no host cron, external command runner, or LLM agent.
`SYNC_RUN_ON_START=true` also refreshes current data when the container starts;
Docker restarts the process after failures. PostgreSQL and S3/MinIO remain
required services, and Docker must be running for scheduled work to execute.

See [automatic refresh and freshness checks](docs/operations.md#automatic-refresh-and-freshness-checks)
for configuration, health monitoring, and the explicit competition/year scope.
League additions use the exact-key workflow in
[League mapping workflow](docs/operations.md#league-mapping-workflow); split and
playoff seasons can be represented by multiple keys in one year.
