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
