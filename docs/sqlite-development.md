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

For repeatable latency measurements, use a loopback preview with the controlled
profile (150 ms per response and a shared 10 Mbit/s body limit for all assets,
including Worker XHR). Each repetition creates a cold browser context:

```sh
node scripts/measure-static-sqlite.mjs http://127.0.0.1:4188/RiftVersus/ /tmp/riftversus-perf --profile=controlled --runs=10
node --test scripts/static-network-profile.test.mjs
```

Controlled timing runs omit screenshots. The existing ordinary measurement
still captures desktop/mobile screenshots. Raw Range headers, bytes, snapshot
identity, request size and each ready time are saved in measurement.json.
Performance enforcement additionally requires --enforce-performance and at least
ten controlled repetitions; it checks 30 Range GETs, 1 MiB reads and a ten-second
median for the default comparison.

New exports use 16 KiB requests with unchanged 4 KiB SQLite pages. The reader
accepts only 4/16/32/64 KiB request units, preserving archived 4 KiB manifests.
Identity, team candidate and game-series indexes cover their queried columns;
the game_players primary key already covers game/side/player membership, so its
identical secondary index is removed from new exports. No query requires a new
index name, and old database layouts remain queryable.

Comparisons use resolved UUIDs/eras and normalized filters as cache keys within
one pinned API session. UUID URL canonicalization, focus/reconnect and repeated
Apply reuse the comparison; replacing the API session resets its QueryClient.

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
