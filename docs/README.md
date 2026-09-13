# RiftVersus operator documentation

- [Operations](operations.md): local Compose, sync, recovery, backup, and the
  release evidence gate.
- [Deployment](deployment.md): one-image local/remote templates and release
  checklist.
- [Data sources](data-sources.md): Leaguepedia retrieval, coverage, provenance,
  and known evidence gaps.
- [Attribution](attribution.md): retained media/source attribution obligations.
- [GitHub Pages + Actions proposal](github-pages-actions-proposal.md): research
  target for GitHub-only hosting and build-time data processing; not deployed yet.
- [SQLite / HTTPVFS migration plan](aegis/plans/2026-09-14-sqlite-httpvfs-migration.md):
  active implementation batches and cutover gates.
- [SQLite development](sqlite-development.md): production static builds,
  synthetic browser tests, retained-data verification and recovery behavior.
- [SQLite site archives](site-archives.md): immutable website bundles and
  current/previous asset retention; archive commands do not deploy Pages.
- [GitHub publishing](github-publishing.md): opt-in single-writer workflow,
  failed-attempt evidence, deployment/retry/rollback and activation prerequisites.
- [Original migration plan](aegis/plans/2026-09-14-github-only-migration.md):
  retained recovery/retirement requirements; JSON query design is superseded.

The `leaguepedia-small` fixture is synthetic plumbing evidence. It cannot prove
historical coverage, query latency, image size, memory use, or the motivating T1
record.
