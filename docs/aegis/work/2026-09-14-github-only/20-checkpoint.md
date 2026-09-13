# GitHub-only execution checkpoint

## Intent and authority

User authorized implementation of P0-P7 and one verified commit per stage.
Root owns design and Git mutations. User requested root gpt-6-astra and child
gpt-5.6-luna; root model switching is not exposed. The fixed gpt-5.6-luna triage
role is used only for read-only inventories; no alternate model is selected.
Execution uses executing-plans, long-task-continuation and commit skills.
TDD mode off: meaningful regression and restore checks, no prescribed strict TDD.

## Start

- Branch: design/github-pages-actions; HEAD 53095f2.
- No remote; single checkout; no active Git operation.
- Preexisting .gitignore change belongs to user and remains untouched.
- Prior-turn proposal/docs belong to this migration and are included in P0.
- Baseline: ADR-0001, identity/avatar v2, scheduled refresh, GitHub-only plan.

## Stages

- P0 verified: isolated database restore and all referenced objects exported.
- P1 active: filesystem object store and build-time data CLI.
- P2-P7 pending.

## P0 evidence

- Captured 2026-09-13T18:12:15.926Z (September 14 Asia/Taipei).
- Private local bundle: /tmp/riftversus-github-migration-p0/.
- database.dump: 1,261,399 bytes; SHA-256
  5344d92ce228c39afdb6b3dffeb680a9ff6aa12b78ac9cfd205d10d18ea33904.
- Restored into a task-created PostgreSQL 17 container; container removed after
  successful verification. Production containers/volumes were not changed.
- 714 entities, 1,066 series, 1,664 games, 16,640 game_players, 7 generations.
- 7 source objects / 68,981,907 bytes; every object's streamed SHA-256, size,
  content type and remote metadata matched the restored database references.
- 0 retained media objects. Historical coverage rows remain in the database;
  they are not flattened or confused with unique active scopes.
- Bundle contains the full manifest and raw bytes outside Git. It is a local
  migration staging copy, not a durable remote checkpoint or live acceptance.

## Boundaries and next step

P0 supports beginning implementation. Live source access is not needed for P1.
Remote repository and archive credentials remain prerequisites for P6, not P1.
Next: implement immutable filesystem storage, relocate CLI-owned logic without
duplicating it, validate fixture and retained-data reads, then commit P1.
Strict historical acceptance and SQL/static parity belong to P3, before any
HTTP/SQL retirement. No claimed data or presentation semantics have changed.
