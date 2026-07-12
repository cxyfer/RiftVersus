# Source, coverage, and attribution

## MVP source

Leaguepedia is the sole required upstream for the MVP. Configure the current
official MediaWiki API URL in `LEAGUEPEDIA_ENDPOINT`; there is deliberately no
runtime default. Before approving a deployment, the operator must run the
bounded `siteinfo` and known-page probes in [operations.md](operations.md),
confirm JSON responses, record the reviewed host and retrieval time, and copy
only observed image hosts into `LEAGUEPEDIA_MEDIA_HOSTS`.

`LEAGUEPEDIA_USER_AGENT` must identify the deployment and include a working
contact URL or email. Generic browser user agents and placeholder contacts are
not acceptable for a live deployment.

Logical competition names are not fuzzy matched. Every requested
competition/year pair must have an exact Leaguepedia tournament key in
`LEAGUEPEDIA_COMPETITION_MAP`; an absent year mapping stops the run before the
repository is opened. Identity and tournament exceptions live in the reviewed
`data/overrides/*.yaml` files. Their checksums are retained with each sync run,
and ambiguous identities stay quarantined until an explicit reviewed rule
exists.

## Coverage meaning

- `complete`: every bounded page was visited, rows were observed, and no
  included row or identity remains unresolved.
- `partial`: the bounded traversal stopped early or some included evidence is
  unresolved. Existing facts are not retired from a partial scope.
- `missing`: the requested slice returned no usable rows. Zero rows never
  prove completeness and do not retire facts.

`leaguepedia-small` is synthetic acceptance data. It is always published as
`partial`, is never evidence of upstream coverage, and its publication scopes
cannot retire previously published facts.

## Media and attribution

The importer reads Leaguepedia image metadata, including source URL, license,
and artist or credit where available. It downloads only allow-listed HTTPS
hosts, validates size and content type, stores immutable bytes in the
configured S3-compatible object store, and records checksum and attribution
before publication. Public API responses expose same-origin cached media, not
the upstream image URL.

An acceptance snapshot must retain the API request URL, response checksum,
page/revision IDs when supplied, retrieval timestamp, license, attribution,
and coverage status. Operators remain responsible for reviewing the source
page's current license and attribution requirements before redistribution.

## Reconsidering another source

Oracle is not an MVP source and no alternate source is kept as a dormant
provider. Reconsideration requires a new reviewed architecture/source
decision plus, at minimum:

1. a publicly verifiable direct source and stable access contract;
2. documented schema, license, attribution, update cadence, and failure mode;
3. bounded retrieval evidence and measured retained database/media size;
4. identity, coverage, and publication semantics compatible with the single
   `runSync` owner; and
5. retirement and rollback rules that do not create a second active truth.
