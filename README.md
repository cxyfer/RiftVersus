# RiftVersus

RiftVersus compares League of Legends players, teams, and regions across
years, competitions, and best-of formats. The MVP imports Leaguepedia into a
published PostgreSQL generation and serves only retained database and media
objects; HTTP requests never call the upstream wiki.

## Operator guide

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
