# Sync operations

## Preflight

Set all required PostgreSQL, S3, and Leaguepedia variables from
`.env.example`. Verify that the selected endpoint is the currently reviewed
official MediaWiki API. These probes are deliberately limited to metadata and
one known page; they are not a bulk import:

```bash
curl --fail --silent --show-error --max-time 15 \
  --user-agent "$LEAGUEPEDIA_USER_AGENT" \
  "$LEAGUEPEDIA_ENDPOINT?action=query&meta=siteinfo&format=json&formatversion=2"

curl --fail --silent --show-error --max-time 15 \
  --user-agent "$LEAGUEPEDIA_USER_AGENT" \
  "$LEAGUEPEDIA_ENDPOINT?action=query&prop=info%7Crevisions&rvprop=ids%7Ctimestamp&titles=T1&format=json&formatversion=2"
```

Do not approve the endpoint when either response is non-JSON, requires
authentication unexpectedly, redirects to an unrelated host, or omits the
expected site/page fields. Review observed media hosts separately before
adding them to `LEAGUEPEDIA_MEDIA_HOSTS`.

## Commands

Build before invoking the CLI:

```bash
pnpm build
node apps/server/dist/cli.js migrate
node apps/server/dist/cli.js serve
node apps/server/dist/cli.js sync
node apps/server/dist/cli.js sync --once
node apps/server/dist/cli.js backfill --year 2024 --competition Worlds
node apps/server/dist/cli.js sync --once --fixture leaguepedia-small
node apps/server/dist/cli.js backfill --year 2024 --competition Worlds --fixture leaguepedia-small
```

`serve` starts only the HTTP server. It never schedules or performs an import.
`sync` is the long-running scheduled process using `SYNC_CRON` and
`SYNC_TIMEZONE`; it prevents overlapping ticks and reports rejected runs.
`sync --once` and `backfill` execute the same provider-neutral runner once.
Run scheduled sync and HTTP serving as separate processes/containers.

## Retry and resource budgets

Each API request has a 10-second timeout and at most two retries (three total
attempts). Only transient network errors, retryable HTTP statuses, rate-limit,
and max-lag responses retry. `Retry-After` is honored with a 30-second cap;
other retries use bounded exponential backoff. A single API response is capped
at 5 MB.

The snapshot is also bounded by `LEAGUEPEDIA_MAX_BYTES`,
`LEAGUEPEDIA_MAX_PAGES`, and `LEAGUEPEDIA_MAX_ROWS`. Cargo traversal uses
500-row pages and bounded concurrency. Media downloads allow only configured
hosts and image content types, with a 20-second timeout and 10 MB maximum per
object. Raising any limit requires review of upstream policy, memory use,
object storage growth, and the acceptance evidence.

On any fetch, validation, storage, or publication failure, the run records a
failure and does not advance the published dataset. Coverage must be inspected
after every backfill; `partial` and `missing` are operator-visible outcomes,
not successful completeness claims.
