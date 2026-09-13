# SQLite / HTTPVFS Development

The migration branch uses the same SQL.js-HTTPVFS runtime in all Vite modes.
There is no automatic mock, JSON-facts or HTTP API fallback. Node 24 is required
for the build-time SQLite exporter; browsers use the bundled WASM engine.

## Synthetic Browser Verification

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test:e2e
```

Playwright builds production assets with `/RiftVersus/`, creates an explicitly
synthetic SQLite database, and starts an isolated Range-capable preview server.
It verifies actual worker/WASM requests, HTTP 206, comparison/search, PNG/ZIP and
mobile layout. This is not a production-data or live Pages acceptance result.

## Retained Data Build

Use a restored staging PostgreSQL database and filesystem object store, not a
live production database for migration experiments. See `checkpoints.md` for
verified checkpoint restoration. Set `DATABASE_URL` and `OBJECT_STORE_DIR` to
that staging state before running:

```sh
pnpm build
VITE_BASE_PATH=/RiftVersus/ pnpm --filter @riftversus/web build
PUBLIC_BASE_PATH=/RiftVersus/ pnpm data snapshot export apps/web/dist
pnpm data snapshot verify apps/web/dist
PUBLIC_SNAPSHOT_DIR=apps/web/dist pnpm data acceptance
VITE_BASE_PATH=/RiftVersus/ pnpm --filter @riftversus/web exec vite preview --host 127.0.0.1 --port 4188 --strictPort
```

Build frontend assets before exporting data: Vite clears its output directory.
Do not run the synthetic fixture generator over a retained-data build.
The public output contains only website assets, hashed presentation files, a
small manifest and `data/<sha256>/database.sqlite`. Keep raw objects and private
PostgreSQL dumps outside this directory.

Measure actual database response bytes and capture cold desktop/mobile evidence:

```sh
node scripts/measure-static-sqlite.mjs http://127.0.0.1:4188/RiftVersus/
```

The script counts every ranged response (including repeated ranges), separately
counts bodyless HEAD requests, and fails on full database GETs or page errors.
It records a single-run startup observation, not a performance percentile.

## Failure And Version Boundaries

- The first database request probes `bytes=0-99`. A full HTTP 200 response,
  incorrect Content-Range, compression, SQLite header or page size fails closed.
- Successful sessions pin one immutable database and snapshot-bound cursors.
  Offline publication verifies the entire SHA; the browser does not fetch the
  whole database merely to compute its checksum.
- Manifest/preflight failures can retry before Worker creation. Upstream hides
  the native Worker termination handle. Once Worker initialization fails, the
  client retains the failure and closes the database where available; reloading
  the page releases the Worker. Repeated retries do not create more Workers.
- The per-page HTTPVFS read budget is 128 MiB. The pinned upstream implementation
  has no cache eviction. A long-running tab can require a reload.
- `pnpm acceptance:archival` remains the separate pinned historical checkpoint
  gate. A passing current SQLite acceptance does not claim that archival gate
  passed against a different dataset generation.
- Local HTTP 206 tests do not prove deployed Pages behavior. Actual GitHub-only
  cold restore, Pages Range requests and rollback remain cutover gates.
