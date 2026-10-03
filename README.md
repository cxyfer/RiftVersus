# RiftVersus

RiftVersus compares League of Legends players, teams, and regions across
years, competitions, and best-of formats. [Open RiftVersus](https://cxyfer.github.io/RiftVersus/).
The website queries SQLite through SQL.js-HTTPVFS Worker/WASM and Range requests
on GitHub Pages. GitHub Actions imports Leaguepedia into disposable PostgreSQL,
validates the data and exports SQLite. Verified database/source checkpoints and
website archives are stored in private GitHub Releases.
Eligible retained media is preferred; otherwise the build generates
deterministic avatars. Browser queries never call the upstream wiki.

## Operator guide

- [Documentation index](docs/README.md)
- [Source, coverage, and attribution](docs/source-and-attribution.md)
- [Sync operations](docs/operations.md)
- [Deployment](docs/deployment.md)
- [GitHub publishing, schedules and recovery](docs/github-publishing.md)
- [Private checkpoint operations](docs/checkpoints.md)

Copy `.env.example` to `.env`, replace every placeholder, and verify the
configured Leaguepedia endpoint before running a live sync. The repository
does not guess or pin an unreviewed wiki host. Reserved example domains are
intentionally rejected, so an unchanged example file cannot start a sync.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm data --help
```

Oracle is not part of the MVP.
PostgreSQL provenance remains provider-neutral, but adding another upstream requires a new reviewed source
and architecture decision.

## Automatic updates

The default branch's `publish.yml` owns daily current-year synchronization,
weekly reviewed historical synchronization, website builds and explicit
rollback. All publication modes share one Actions concurrency group. The
workflow restores the latest verified private checkpoint on each fresh runner;
PostgreSQL is temporary and no permanent database or object-store server is
required for the deployed website.

See [GitHub publishing operations](docs/github-publishing.md)
for configuration, health monitoring, and the explicit competition/year scope.
League additions use the exact-key workflow in
[League mapping workflow](docs/operations.md#league-mapping-workflow); split and
playoff seasons can be represented by multiple keys in one year.
