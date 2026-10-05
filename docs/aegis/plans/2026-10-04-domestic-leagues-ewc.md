# LCK, LPL and EWC historical coverage

## Goal

User approved all available historical LCK/Champions, LPL and EWC records.
Preserve actual series, including historical BO2 draws, and make imported
domestic series searchable under the correct league. EWC has its own event
filter. Existing Worlds/MSI facts and immutable checkpoints remain preserved.

## Architecture and authority

Reuse Leaguepedia CargoExport, exact-key configuration, apps/data one-shot
imports, PostgreSQL publication, SQLite export and existing Pages publishing.
References: README.md, docs/source-and-attribution.md,
docs/github-publishing.md, docs/aegis/baseline/2026-10-03-riftversus-github-sqlite.md.
The explicit user request and all-history answer approve the scope. No alternate
source, guessed mapping, browser fetch of source data or permanent service.

## Tech stack and compatibility

TypeScript, Zod, Kysely/PostgreSQL 17, Node SQLite and React.
Add EWC and BO2 to shared contracts. A finished 1:1 BO2 has no winning team;
completion must therefore be independent from winner presence. Series draws
count in total and win-rate denominator, never as losses. Expose draws only
when nonzero to preserve existing no-draw response shapes. Every game still
requires a winning side. Migration retains all previous facts and metadata.

## Change necessity and owners

Decision: code-change. Configuration alone cannot represent historical BO2
draws, EWC filters, or persist league ownership. Reuse existing owners:
contracts own enums/outcomes, sync owns source normalization, database owns
constraints/publication, domain owns comparisons, web owns filters/display.
No new publication or source owner. TDD Route: light; source-evidenced BO2 draw
and league-filter tests precede repair. Existing regression suites remain.

## Tasks and verification

1. Audit ScoreboardGames exact Tournament keys, counts and actual date spans.
   Retain reviewed map/evidence under data/leaguepedia. Include major-league
   regular seasons, playoffs, placements, Cups, MSI qualifiers, regional finals
   and EWC main events; exclude academy/showmatch/all-star/scrim/promotion.
   Cross-year winter events must retain both calendar-year portions.
2. Add shared EWC/BO2/draw contracts and tests. Repair existing parser,
   normalized winner, summary queries, snapshot completion and web display.
   Add a PostgreSQL migration for category/format/finished-draw constraints.
   Persist explicit normalized league slugs including historical Champions and
   China/Korea Regional Finals. Verify contract, sync, domain and data tests.
3. Validate mappings and run live imports in isolated local PostgreSQL,
   using immutable source storage and complete-coverage gates. Keep per-year
   batches bounded and record any upstream blockers without bypassing gates.
4. Export and query SQLite: domestic T1/HLE, representative LPL, EWC finals,
   BO2 1:1, and unchanged Worlds comparison. Run typecheck/lint/unit and
   PostgreSQL integration, plus browser verification where available.
5. Update runbook with exact mappings, import commands, coverage evidence,
   recovery and outstanding limitations. Prepare deployment changes for review;
   no unrelated .gitignore edits, Git commit or push without user instruction.

## Risks, rollback and stop condition

Historical upstream player/redirect/schedule gaps may block publication.
Incomplete data must remain explicit and cannot be promoted as complete.
Global history must not be one oversized import; year batches keep budgets
bounded. Current published state stays recoverable from its immutable site and
checkpoint. Success requires actual imported/queryable records, not a map alone;
external blockers must be evidenced and reported. Shared contract extension
requires ADR/baseline synchronization after verified implementation.

## Source closure continuation — 2026-10-05

User requested independent primary-source research and completion of blocked
scopes. Implemented exact reviewed corrections in the existing Leaguepedia
projection and checksummed overrides, with immutable Cargo/wikitext responses.
Primary-source IDs, team eras, formats, explicit game winners/times and rosters
resolve twelve additional scopes. Strict actual query coverage remains required.
All 32 mapped years now publish locally and the complete merged preview retains
Worlds/MSI: 7,316 series. This does not imply exhaustive upstream archive coverage.
No production deployment is claimed. One LCK 2026 Game 1 still lacks evidence;
fourteen awarded-score LPL rows must not acquire fabricated games.

One projection owner, no alternate writer/provider. Remove source workaround
rules after verified upstream repair, preserving durable identity mappings.
ADR-0001 and SQLite baseline sync record the executed boundary. Exact counts,
primary revision evidence and verification are in the work record and
`data/leaguepedia/historical-source-closure.json`. Later commit/push authorization
supersedes the initial Git scope fence; unrelated .gitignore stays excluded.

## User-authorized alternative review — 2026-10-05

The user explicitly requests other sources and manual replacement of the remaining
Game 1. This supersedes the sole-Leaguepedia restriction for an exact reviewed
missing game/roster supplement, not for an automatic alternate provider. Official
LCK Global video and first-hand Inven reporting establish the game winner and
explicit participants. Keep the existing provider projection/publisher; permit
reviewed official-video URLs only for game/roster rows with corroborating sources.
Retain manual evidence with its own review action and override checksum, never
as a fabricated Cargo response. Native upstream rows continue to take precedence.

Change Necessity: code-change; the source URL gate currently rejects authorized
alternative facts. Minimality: sufficient repair at the existing correction owner,
no alternate fetcher/provider or schema. TDD Route: off; focused regression tests
cover restricted tables/URLs, immutable manual review retention, scope isolation,
replay idempotence, native repair and actual strict import. Broadcast time is
reconstructed at minute precision and declared as inferred, not server timestamp.

## Authorized deployment performance gate — 2026-10-06

User requests push and deployment. PR 8 passes complete remote CI and merges as
00377ee5545920bbae491305f9de2bf9b236f8b5. History publication 37346563673 runs
under the existing Actions writer; current-year publication follows it.

The complete 7,316-series local snapshot fails the unchanged controlled gate:
ten cold defaults read 2,293,860 bytes in 32 GETs with 10.754 s median. dbstat
maps the excess to wide game-count probes and team/date candidate index reads.
Public-ID lookups also perform table reads through a noncovering primary index.
Isolated physical-layout experiments preserve the exact logical snapshot digest.

Change Necessity: code-change at packages/domain/src/sqlite-schema.ts. Put the
opponent-region equality before the date range in existing covering team indexes,
use a narrow series-ID game-count index, cluster public IDs in their existing
primary key (WITHOUT ROWID), and select the already-supported 16 KiB request unit.
No query branch, fallback, facts, source authority, column or logical schema
version changes. Existing old archives remain queryable and rollbackable.
Minimality: sufficient repair in the existing derived snapshot schema owner.
Anti-entropy class: derived-state / contract-carrying schema; existing definitions
are replaced for new exports, no persistent state or immutable archive deletion.
TDD Route: off; existing domain/data tests, snapshot digest and target comparisons,
ten controlled cold runs, full remote CI and real hosted verification establish
the physical-layout repair. The generation/restore/Pages gates stay unchanged.
