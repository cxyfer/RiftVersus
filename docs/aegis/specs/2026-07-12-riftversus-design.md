# RiftVersus Design Spec

> Source architecture update: sections 3.3, 5, and the source-related delivery
> sequence are superseded by
> `docs/aegis/specs/2026-07-12-leaguepedia-primary-mvp-design.md`.

Date: `2026-07-12`  
Status: `approved by user on 2026-07-12`  
Architecture review required: `yes`

## 1. Goal

RiftVersus is a League of Legends esports head-to-head statistics website. A
visitor selects any two supported subjects—player, team, or region—and sees
their direct record under a selected time range, tournament category, and
series format.

The motivating example is “T1 at Worlds versus LPL teams in BO5 series,” but
the product must use one general comparison model rather than a hard-coded T1
page.

Success means:

- the same query model supports player, team, and region on either side;
- series record is the primary result and game record is secondary;
- filters are deterministic and represented in the URL;
- historical team lineage can be queried either continuously or by exact name
  era;
- results include subject portraits/logos and can be exported as PNG;
- the application runs locally from Docker Compose and remotely from the same
  application image with external PostgreSQL and S3-compatible storage;
- daily synchronization does not affect the online query path.

## 2. Confirmed Product Scope

### 2.1 Supported comparisons

Both sides may independently be one of:

- player;
- team;
- region.

Examples:

- T1 versus LPL;
- Faker versus LPL;
- Faker versus Xiaohu;
- LCK versus LPL;
- T1 versus Gen.G.

The two subjects must resolve to opposing competitive sides. A team is never
counted as playing against itself merely because it belongs to the selected
region.

### 2.2 Filters

The first release supports:

- date or year range;
- tournament category: domestic league, First Stand, MSI, Worlds, or other;
- series format: BO1, BO3, or BO5;
- tournament/league selection;
- team lineage mode: all known eras or one exact naming era.

Only completed series are included in the series record. Completed games from
an incomplete or abandoned series may be retained as source facts but are not
included in the public series total.

### 2.3 Coverage

- target history: 2011 to the latest synchronized date;
- target competitions: all tier-one regional leagues and international events;
- validation priority: LCK, LPL, LEC, LCS, First Stand, MSI, and Worlds;
- secondary and academy leagues are not part of the first release.

Coverage must be visible as data quality, not implied. The API returns the
current dataset version, last successful sync time, and coverage boundaries.

### 2.4 Result presentation

The result page contains:

- left and right portrait/logo;
- canonical display names and selected era labels;
- series wins, losses, total, and win rate as the primary summary;
- game wins, losses, total, and win rate as the secondary summary;
- chronological series list with date, event, format, score, opponent names,
  and winner;
- active filter summary and dataset freshness.

Filters are encoded in query parameters so a result can be shared without
storing user state in the database.

### 2.5 PNG export

“Save result” means exporting the rendered result, not creating a server-side
bookmark.

- PNG generation happens in the browser.
- A long result is split after at most 50 series rows per image.
- One image downloads directly; multiple images are packaged in one ZIP.
- Export includes the filters, subject images, dataset version, and generation
  time.
- The server image does not include Chromium solely for export.

## 3. Comparison Semantics

### 3.1 Canonical opposing-side model

Every game has two competitive side participations. Each selected subject is
compiled into a predicate over one participation:

- team: the participation's canonical team lineage matches the subject;
- exact team era: the participation's team era matches the selected era;
- region: the participation's represented league region at match time matches;
- player: the player appears for that participation in that game.

A direct game exists only when the left predicate matches one participation
and the right predicate matches the opposing participation. The assignment may
be reversed; it may never use the same participation for both subjects.

### 3.2 Series qualification

- Team/region comparisons qualify when the opposing-side predicates match the
  series participants.
- Any comparison containing a player qualifies a series only when at least one
  game in that series is a direct game under the rule above.
- Player-versus-player therefore requires both players to have actually played
  against one another in at least one game.
- A qualifying series contributes exactly once to the series record, using the
  final series winner and score.
- The game record contains only direct games, not every game in a series where
  a selected player sat on the bench.

### 3.3 Historical identity rules

- A team lineage is the canonical competitive identity across approved
  rebrands.
- A team era is a time-bounded public name/logo within that lineage.
- The default team query spans the lineage; the exact-era filter restricts to
  participations attached to that era.
- A region is the league region represented by the team at match time, not the
  player's nationality and not the organization's current region.
- Player aliases map to one canonical player identity; ambiguous aliases
  require an explicit curated mapping.

## 4. Architecture

```text
Browser
  React SPA
    |-- /api/* ----------------------+
    |-- /media/* ----------------+   |
    |-- PNG/ZIP export (local)    |   |
                                 |   |
Application image                |   |
  Fastify `serve`  <-------------+---+
    |-- comparison/query service |
    |-- static SPA               |
    |-- media proxy/redirect ----+
    +-- PostgreSQL

Application image
  `sync` / `sync --once` / `backfill` / `migrate`
    |-- Oracle's Elixir adapter
    |-- Leaguepedia adapter
    |-- normalization + validation
    |-- raw source snapshots ----------> S3-compatible storage
    |-- normalized facts --------------> PostgreSQL
    +-- media cache -------------------> S3-compatible storage
```

There is one application image and one TypeScript codebase. API and sync are
separate processes so a failed or expensive import cannot consume the web
server's request budget.

### 4.1 Technology stack

- language: TypeScript;
- workspace/package manager: pnpm workspace;
- web: React, Vite, React Router, TanStack Query;
- API and CLI: Fastify;
- contracts and runtime validation: Zod;
- database: PostgreSQL, Kysely, `pg`;
- object storage: AWS SDK for JavaScript S3 client against MinIO, R2, or S3;
- unit/integration tests: Vitest;
- browser tests: Playwright;
- frontend export: `html-to-image` plus JSZip, subject to a proof-of-render
  spike before the full export UI is implemented;
- containers: multi-stage Docker build with a Node.js slim runtime.

Dependency versions are pinned during implementation after checking the
current supported releases. No framework-specific Cloudflare binding is part
of the application contract.

### 4.2 Repository ownership boundaries

```text
apps/web/                 React pages, filters, result rendering, PNG export
apps/server/              Fastify entry point, CLI commands, HTTP composition
packages/contracts/       Zod API schemas and shared public types
packages/domain/          comparison rules and tournament classification
packages/database/        Kysely schema, migrations, repositories, SQL queries
packages/sync/            source adapters, normalization, validation, imports
data/overrides/           reviewed identity, lineage, and classification fixes
docker/                   container entry point and deployment support
docs/                     product, operations, and Aegis records
```

The domain package owns comparison meaning. Database queries implement that
meaning but may not redefine it. Source adapters only emit normalized import
records and may not be called by HTTP request handlers.

## 5. Data Source and Provenance Design

### 5.1 Source responsibilities

Oracle's Elixir is the preferred bulk source for supported detailed game and
player facts. Its public download page states that CSV files cover many major
leagues and are updated once per day, so RiftVersus must not poll it more
frequently than daily.

Leaguepedia's MediaWiki API is used for:

- canonical entity and alias metadata;
- team naming eras and historical lineage evidence;
- tournament/series metadata needed to close Oracle coverage gaps;
- player portraits, team logos, and their source attribution;
- historical backfill where the bulk dataset does not cover 2011 onward.

The exact 2011–2013 import coverage is verified during the backfill slice. A
missing year or competition is reported in coverage metadata; it is never
silently represented as zero matches.

### 5.2 Precedence

Canonical precedence is:

1. reviewed repository overrides for known identity/classification conflicts;
2. Leaguepedia for identity, eras, media metadata, and explicit series fields;
3. Oracle's Elixir for detailed game and player participation facts.

This is sync-time precedence, not a runtime fallback chain. Online requests
read only canonical PostgreSQL facts.

### 5.3 Reproducibility and compliance

- Every imported fact carries source provider and stable source key.
- Each sync run records URL, retrieval time, checksum, parser version, counts,
  warnings, and outcome.
- Downloaded source files are retained in object storage under immutable keys.
- Media records retain original URL, license/attribution text, checksum, and
  cached object key.
- The UI exposes a data/image attribution view.
- Import behavior must comply with Riot Games policies and the source site's
  applicable terms and license.
- Rate limits, retries, and a descriptive User-Agent are configured per
  provider.

Source references verified while drafting:

- <https://oracleselixir.com/tools/downloads>
- <https://lol.fandom.com/api.php?action=query&meta=siteinfo&format=json>
- <https://developer.riotgames.com/policies/general>
- <https://creativecommons.org/licenses/by-sa/3.0/>

## 6. Persistence Model

The migration set owns these conceptual tables. Names may be refined in the
implementation plan, but responsibilities may not be merged across boundaries.

### 6.1 Identity

- `entities`: canonical player, team-lineage, and region identities;
- `entity_aliases`: source keys, search aliases, and validity windows;
- `team_eras`: lineage name/logo periods and validity windows;
- `media_assets`: current and historical source/cached media metadata;
- `override_applications`: which reviewed override version changed a canonical
  mapping.

### 6.2 Competition facts

- `tournaments`: tournament identity, league, category, tier, start/end dates;
- `series_facts`: participants, time, best-of, score, completion, winner;
- `game_facts`: series, game number, participants, time, winner;
- `game_players`: player participation and competitive side;
- `team_region_history`: represented region over time when source facts require
  explicit history outside the game participation.

The stored participation must preserve both canonical team lineage and exact
team era. Region-at-match is materialized on the participation so later
organization changes cannot rewrite history.

### 6.3 Synchronization

- `sync_runs`: run state, parser version, counts, warnings, and failure detail;
- `source_objects`: immutable source URL/object/checksum metadata;
- `source_cursors`: provider-specific incremental cursor;
- `dataset_versions`: version published only after an atomic successful import;
- `coverage_status`: earliest/latest date and completeness by provider,
  competition, and year.

No Redis or precomputed all-pairs matrix is introduced initially. PostgreSQL
facts, targeted indexes, and HTTP caching are sufficient until measurement
shows otherwise.

## 7. API Contract

Initial public routes:

- `GET /api/entities?q=&kinds=` — search selectable subjects and eras;
- `GET /api/filters` — supported tournament categories, leagues, years, and
  formats derived from available facts;
- `GET /api/comparisons` — execute one normalized head-to-head query;
- `GET /api/dataset` — dataset version, last successful sync, and coverage;
- `GET /media/:key` — serve or redirect an allow-listed cached media object;
- `GET /health/live` and `GET /health/ready` — process and dependency health.

The comparison response contains:

- resolved subjects and image URLs;
- normalized filters;
- series summary;
- direct-game summary;
- chronological qualifying series rows;
- dataset version and coverage warnings;
- an ETag derived from normalized query plus dataset version.

Invalid combinations return a structured 400 response. Unknown entities return
404. Database or unexpected failures return a correlation ID without exposing
credentials, SQL, or upstream responses.

## 8. Query and Cache Strategy

- Normalize and validate every query before SQL execution.
- Resolve each subject to an opposing-side predicate.
- Select candidate series from indexed team/region participations, then apply
  player-presence rules through `game_players` where required.
- Page the series list; the export flow explicitly requests successive pages up
  to a documented safety limit.
- Add indexes around dates, tournament category, best-of, participants,
  region-at-match, series membership, and player/game membership.
- Return `Cache-Control` and ETag headers keyed by dataset version.
- Do not add an application cache until measured PostgreSQL query latency or
  load crosses the agreed budget.

Initial performance budgets for representative seeded data:

- entity search p95 below 150 ms at the API process;
- comparison summary p95 below 500 ms;
- first page of series rows p95 below 750 ms;
- no unbounded table scan for a supported public filter combination.

These are acceptance budgets, not claims about the unimplemented system.

## 9. Synchronization and Failure Handling

Commands exposed by the application image:

- `serve`;
- `sync`;
- `sync --once`;
- `backfill`;
- `migrate`.

Rules:

- daily `sync` is a separate container/process;
- a PostgreSQL advisory lock prevents overlapping import ownership;
- download and parse happen before canonical publication;
- normalization writes to staging scope and publishes one dataset version in a
  transaction after validation;
- a failed run leaves the previous dataset version queryable;
- media failures use the existing cached object or a local neutral placeholder,
  while recording a warning;
- retries are bounded and exponential; permanent validation failures stop the
  run rather than publishing partial truth;
- backfill is resumable by source object/year and uses the same normalization
  path as daily sync.

## 10. Docker and Deployment

### 10.1 Local template

Docker Compose provides:

- `app`: `serve`;
- `sync`: daily synchronization process;
- `migrate`: one-shot profile/service;
- `postgres`: local database with a named volume;
- `minio`: local S3-compatible storage with a named volume.

### 10.2 External connection mode

The same image runs with:

- one `DATABASE_URL` contract for PostgreSQL;
- S3 endpoint, region, bucket, access key, secret key, path-style toggle, and
  public/media delivery configuration;
- no local Postgres or MinIO requirement.

Secrets are supplied at runtime and never baked into an image. Production runs
migrations as an explicit one-shot step before replacing the application
container.

### 10.3 Image boundary

The multi-stage build:

1. installs locked workspace dependencies;
2. builds the React SPA and TypeScript server;
3. prunes development dependencies;
4. copies only runtime JavaScript, production dependencies, static assets, and
   migration files into a Node.js slim runtime.

Target final image size is below 200 MB, measured and reported in CI or release
verification. This target is a budget; exceeding it triggers dependency/layer
inspection rather than an automatic language change.

## 11. Security and Operational Boundaries

- API input is schema validated and SQL is parameterized through Kysely.
- Media keys are database-backed/allow-listed; arbitrary URL proxying is not
  supported.
- Upstream files have size and content-type limits before parsing.
- CSV parsing is streaming or bounded; import memory does not scale with the
  whole historical dataset.
- CORS is same-origin by default.
- Logs are structured and redact credentials and signed URLs.
- Readiness checks verify PostgreSQL; S3 degradation is reported separately so
  cached statistics remain queryable.
- Public endpoints receive configurable request-rate protection at the reverse
  proxy or application boundary without adding Redis in the first release.

## 12. Verification Strategy

### 12.1 Domain fixtures

Small explicit fixtures prove:

- team versus region excludes the selected team from matching itself;
- player versus player counts only games where both played on opposing sides;
- a player-qualified series counts once even if both players meet repeatedly;
- a benched player does not gain game wins/losses;
- lineage mode includes all approved eras while exact-era mode does not;
- region attribution follows match-time team representation;
- incomplete series do not affect series totals.

### 12.2 Integration evidence

- migrations apply to an empty PostgreSQL database;
- importing the same source object twice is idempotent;
- a failed sync does not advance `dataset_versions`;
- advisory locking prevents two publishers;
- comparison SQL matches the domain fixture oracle;
- MinIO and an external-style S3 configuration use the same storage contract.

### 12.3 User journey evidence

Playwright verifies:

- selecting T1 versus LPL, Worlds, BO5 renders a result with both logos;
- changing filters updates the URL and response;
- loading that URL restores the query;
- one-page PNG export succeeds;
- a fixture with more than 50 rows produces multiple PNGs in a ZIP;
- missing media renders the neutral placeholder without breaking export.

The known T1-versus-LPL scenario is a regression fixture after the imported
source snapshot and expected record are reviewed. The product does not encode
the slogan “undefeated” as business logic.

## 13. Delivery Slices

The implementation plan should preserve these independently verifiable slices:

1. workspace, contracts, container, and PostgreSQL foundation;
2. canonical identity and competition schema with fixtures;
3. comparison domain semantics and SQL query path;
4. Oracle's Elixir import and dataset publication;
5. Leaguepedia identity/media adapter and historical coverage backfill;
6. React selection/filter/result experience;
7. browser PNG/ZIP export;
8. Docker Compose, external-service mode, observability, and documentation;
9. historical backfill and T1-versus-LPL acceptance verification.

## 14. Compatibility and Retirement

### Compatibility boundary

- local and remote PostgreSQL use the same migration set and `DATABASE_URL`;
- MinIO, R2, and AWS S3 use the same storage interface;
- API and sync use one canonical domain/database model;
- URLs containing valid comparison filters remain restorable across compatible
  releases;
- source-provider changes must not alter public comparison semantics silently.

### Retired alternatives

- Cloudflare Worker + D1 is retired from the target architecture;
- Cloudflare-specific R2 bindings are retired; R2 remains supported only via
  the generic S3-compatible contract;
- Rust backend and mixed Rust/TypeScript services are retired;
- SQLite as an application database is retired;
- server-side Chromium export is rejected for the first release;
- runtime scraping/fallback from API handlers is rejected;
- Redis and a precomputed all-pairs result matrix are deferred until supported
  by measurements.

There is no deployed system or persisted project database to migrate, so these
retirements require no compatibility adapter.

## 15. Non-goals

- live in-game statistics;
- Riot account login or user accounts;
- server-side saved comparisons/bookmarks;
- predictions, betting, or fantasy scoring;
- champion-level analytics;
- secondary/academy league completeness in the first release;
- a public data-ingestion API;
- an administrative CMS; reviewed YAML overrides are sufficient initially;
- automatic inference of ambiguous team lineage without review.

## 16. Risks and Mitigations

- **Source schema drift:** version parsers, retain raw objects, validate required
  columns, and do not publish failed runs.
- **Historical ambiguity:** retain provenance and reviewed overrides; expose
  coverage warnings instead of inventing zero records.
- **Incorrect series grouping:** prefer explicit Leaguepedia series metadata,
  require deterministic grouping validation when deriving from game rows, and
  keep regression fixtures.
- **Image licensing/hotlinking:** cache only with source metadata, expose
  attribution, and support removal/replacement without changing entity IDs.
- **Analytical query cost:** index direct participation paths, paginate rows,
  measure plans, and add derived aggregates only after evidence.
- **Client export memory:** cap rows per image at 50, render sequentially, and
  stop with a clear error at the documented export safety limit.
- **All-in-one host pressure:** publish resource guidance; API language choice
  cannot compensate for undersized PostgreSQL and MinIO hosts.

## 17. Aegis Planning Readback

### TaskIntentDraft

- Outcome: a portable LoL esports comparison website with trustworthy direct
  series/game records and exportable visual results.
- Success evidence: domain fixtures, import publication tests, API integration
  tests, browser journeys, Docker deployment verification, and reviewed
  historical acceptance data.
- Stop condition: the approved first-release scope is implemented and verified;
  deferred analytics, accounts, and secondary leagues remain absent.
- Main risks: historical identity ambiguity, source drift, series grouping, and
  accidental runtime dependency on upstream sites.

### BaselineReadSetHint

- Project instructions: user-provided `AGENTS.md` instructions.
- Governance: `docs/aegis/BASELINE-GOVERNANCE.md`.
- Product/architecture authority: this approved Design Spec.
- Existing code baseline: none; the repository is greenfield.

### BaselineUsageDraft

- Required baseline refs: `docs/aegis/BASELINE-GOVERNANCE.md`, approved Design
  Spec, and later accepted ADRs/migrations.
- Acknowledged before planning refs: `docs/aegis/BASELINE-GOVERNANCE.md`.
- Cited in design refs: external source references in section 5.3.
- Missing refs: no existing code or ADR baseline exists.
- Decision: continue to implementation planning.

### Requirement Ready Check

- Requirement source: confirmed decisions from the product-design conversation,
  preserved by this written review artifact.
- Goals and scope: sections 1–2.
- User scenarios: sections 2–3 and 12.3.
- Requirement items: sections 2–11.
- Acceptance and verification: section 12.
- Open blocker questions: none for design review; actual source coverage is an
  evidence task, not permission to fabricate coverage.
- Decision: ready for written-spec review.

### ImpactStatementDraft

- Affected layers: web UX, API contract, domain semantics, persistence, data
  import, media storage, Docker deployment, and operations.
- Canonical owners: domain comparison rules, canonical PostgreSQL facts, and
  sync-time source adapters.
- Invariants: opposing-side matching, match-time region attribution, atomic
  dataset publication, one database/storage contract, no runtime scraping.
- Compatibility: section 14.
- Non-goals: section 15.

### Existence Check

- Source adapters are necessary because the sources have different schemas and
  coverage, but only two concrete adapters are approved.
- Repository overrides are necessary for reviewable lineage/alias corrections;
  an admin service and database-edit UI are rejected.
- Separate API and sync processes reuse one image/codebase and prevent workload
  ownership overlap; separate language services are rejected.
- Dataset versioning is necessary for atomic publication and cache validity;
  Redis and all-pairs caches are deferred.
- Decision: add the minimum approved surfaces with the owners defined above.

### Architecture Integrity Lens

- Invariant: public results are computed from one canonical normalized dataset.
- Canonical owner/contract: PostgreSQL facts plus domain comparison semantics.
- Responsibility overlap: source adapters normalize; they do not answer public
  queries. API queries; it does not scrape or reinterpret identity.
- Higher-level simplification: one TypeScript workspace and application image
  replace Cloudflare, Rust, and mixed-service variants.
- Retirement/falsifier: a new cache, provider, or service requires measured
  evidence that the current owner cannot meet an acceptance budget.
- Verdict: coherent for implementation planning after user approval.

### ADR signals

After implementation proves the boundaries, completion review should evaluate
ADRs for:

- TypeScript/Fastify as the single application runtime;
- PostgreSQL as canonical fact storage;
- S3-compatible media/source-object storage;
- sync-time provider precedence and atomic dataset publication;
- browser-side PNG/ZIP export.

Unimplemented design intent is not yet recorded as an accepted ADR.
