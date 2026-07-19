# Comparison Identity and Canonical Avatar v2 Implementation Plan

Date: `2026-07-18`
Status: `approved spec; ready for execution`
TDD Route: `light` - focused RED/GREEN per owner, then full repository gates

## Goal

Implement the approved comparison-identity and avatar-v2 design so historical
series rows always show participating team names, player search displays
`ID (real name)`, and deterministic generated avatars use safe English
abbreviations at a versioned, ETag-revalidated URL.

## Architecture

```text
Leaguepedia Players.ID + Players.Name
  -> provider parser
  -> staged playerId + canonical real name
  -> PostgreSQL entities.player_id + entities.canonical_name
  -> shared repository presentation mapping
  -> API displayName + optional realName
  -> web search formats ID (real name)

series_facts team/era IDs
  -> comparison repository side assignment
  -> team-era/canonical team names
  -> SeriesRow leftName/rightName

licensed retained media
  -> /media/{object-key}

otherwise
  -> /avatars/v2/{kind}/{canonical-id}.svg
  -> database avatar identity resolution
  -> Fastify canonical-avatar-v2 SVG bytes
```

Existing owners remain authoritative: Leaguepedia owns source extraction,
PostgreSQL repositories own persisted/public presentation, and Fastify owns SVG
bytes. The web client formats typed fields but never re-infers identity or
generates avatars.

## Tech Stack

- TypeScript 5.9, Node.js, pnpm workspace
- Kysely and PostgreSQL migrations/repositories
- Zod public and acceptance contracts
- Fastify routes and Node crypto/Buffer
- React, TanStack Query, Vitest, Testing Library, Playwright
- PostgreSQL integration tests and production acceptance snapshot

## Baseline/Authority Refs

- `docs/aegis/specs/2026-07-18-comparison-identity-avatar-v2-design.md`
- `docs/aegis/baseline/2026-07-15-riftversus-release.md`
- `docs/aegis/adr/ADR-0001-leaguepedia-facts-and-fail-closed-presentation.md`
- `docs/aegis/specs/2026-07-12-riftversus-design.md`
- `docs/aegis/specs/2026-07-12-leaguepedia-primary-mvp-design.md`
- `docs/aegis/specs/2026-07-14-deterministic-avatar-fallback-design.md`
- current contracts, migration registry, repositories, Leaguepedia provider,
  server routes, web combobox/export, and acceptance verifier

BaselineUsageDraft:

- Required baseline refs: all references above.
- Acknowledged before plan: all references above.
- Cited in plan: all references above and task-local source owners.
- Missing refs: none known.
- Decision: `continue`.

## Compatibility Boundary

Preserve comparison query URLs, canonical entity IDs, saved comparisons,
match qualification, scores, filters, pagination, `SeriesRow` field names,
`mediaUrl` field names, retained-media precedence, `/media/*`, published facts,
S3 objects, and placeholder recovery.

Intentional contract changes are limited to:

- optional `ResolvedSubject.realName`;
- nullable persisted `entities.player_id`;
- player `displayName` using `player_id` when available;
- historical-team semantics for row `leftName/rightName`;
- generated URL `/avatars/v2/{kind}/{id}.svg` and algorithm
  `canonical-avatar-v2`;
- generated v2 responses use `Cache-Control: public, no-cache`, checksum ETags,
  and conditional `304` revalidation because the typed display label may
  change while the canonical URL remains stable. The retired v1 immutable
  policy is not reused for v2.

No task may add a client generator, label-bearing avatar URL, player-profile
subsystem, current-region styling for player/team, legacy avatar redirect,
second v1 generator, or destructive data migration.

## Verification

Each task follows focused RED/GREEN. Final completion requires:

```bash
rtk pnpm test
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm test:integration
rtk pnpm test:e2e
rtk pnpm acceptance:check
```

`pnpm test:integration` is not sufficient when PostgreSQL tests are skipped.
Execution must confirm `TEST_DATABASE_URL` is configured and report zero skipped
database integration tests for the touched repository/migration suites.
Production acceptance requires migrated state and a fresh Leaguepedia
publication containing the reviewed player ID/name pair.

## Planning Checks

### Requirement Ready Check

- Requirement source: approved design spec and user approval on `2026-07-18`.
- User scenarios: player/team/region comparisons, entity search, generated
  avatars, browser rendering, and export.
- Acceptance: exact requirements in the parent spec.
- Open blocker questions: none.
- Decision: `ready`.

### Change Necessity

- User-visible need: correct team row labels, player ID/real-name labels, and
  recognizable generated avatars.
- No-change/docs-only option: cannot change SQL projection, retain missing
  Leaguepedia fields, populate the database, or generate new SVG bytes.
- Minimum boundary: one additive migration, existing provider/repository/server
  owners, optional public field, affected clients/tests/docs.
- Decision: `code-change`.

### Existence and Architecture Integrity

- Proposed surfaces: `entities.player_id`, optional `realName`, and versioned
  `/avatars/v2/*`.
- Reuse candidates: `entity_aliases`, unversioned v1 route, and client-side
  formatting/generation.
- Why insufficient: aliases do not type ID vs real name; v1 immutable bytes
  cannot change in place; client generation duplicates authority.
- Creation proof: all three additions directly encode approved contracts while
  reusing existing owners.
- Entropy: v1 main path is deleted; no adapter or second owner remains.
- Decision: `add-with-proof` for the additive field/contract/versioned route;
  `reuse-existing` for all owner modules.

Architecture Integrity Lens:

- Invariant: selected subjects and historical competitive teams remain distinct.
- Canonical owners: provider extraction, repository presentation, server bytes.
- Responsibility overlap: none permitted; web only formats typed output.
- Higher-level path: fix data at provider/persistence and rows at repository,
  not with caller-side string patches.
- Retirement: remove v1 route/generator evidence from the main path.
- Verdict: `proceed`; ADR and baseline sync required after verification.

### Ripple Signal Triage

Signals fire for schema, producer/consumer contract, generated URL, acceptance
evidence, and export consumption. The affected path is:

```text
Leaguepedia -> staged types -> publication -> DB types/migration
  -> search/comparison repositories -> contracts -> server/web/export
  -> acceptance snapshot/verifier -> release E2E/docs
```

Every producer and consumer appears in a task below. Narrow unit tests alone do
not close this plan.

### Plan-Time Complexity Check

- `packages/sync/src/providers/leaguepedia/fetch.ts` is large but receives only
  a local typed-field correction; no new responsibility is added.
- `packages/database/src/repositories/comparison.ts` is already dense; keep
  row-name projection local and do not add fallback branches outside SQL
  presentation.
- Extend the small `presentation.ts` as the shared presentation helper instead
  of duplicating player label logic.
- Keep `app.ts` and CLI changes wiring-only.
- Budget result: `within-budget`, with `edit-in-place` for existing owners and
  one new migration file.

### Plan Pressure Test

- Owner/contract/retirement: explicit and single-owner.
- Higher-level path: producer and repository fixes selected over UI patches.
- Verification: focused, integration, E2E, acceptance, and lingering-reference
  checks included.
- Executability: file paths, target types, commands, and expected failures are
  specified below.
- Pressure result: `proceed`.

## File Map

Create:

- `packages/database/src/migrations/009_player_public_id.ts`

Modify:

- `packages/contracts/src/entities.ts`
- `packages/contracts/test/contracts.test.ts`
- `packages/database/src/types.ts`
- `packages/database/src/migrator.ts`
- `packages/database/src/repositories/types.ts`
- `packages/database/src/repositories/sync.ts`
- `packages/database/src/repositories/presentation.ts`
- `packages/database/src/repositories/entities.ts`
- `packages/database/src/repositories/comparison.ts`
- `packages/database/src/repositories/index.ts`
- `packages/database/test/migrations.integration.test.ts`
- `packages/database/test/sync-publication.integration.test.ts`
- `packages/database/test/presentation.integration.test.ts`
- `packages/database/test/comparison.integration.test.ts`
- `packages/database/test/query-plan.integration.test.ts`
- `packages/database/test/fixtures/seed.ts`
- `packages/sync/src/types.ts`
- `packages/sync/src/providers/leaguepedia/types.ts`
- `packages/sync/src/providers/leaguepedia/fetch.ts`
- `packages/sync/src/providers/leaguepedia/normalize.ts`
- `packages/sync/test/leaguepedia.test.ts`
- `data/fixtures/leaguepedia-small.json`
- `apps/server/src/types.ts`
- `apps/server/src/app.ts`
- `apps/server/src/cli.ts`
- `apps/server/src/avatar.ts`
- `apps/server/src/routes/avatar.ts`
- `apps/server/src/acceptance-media.ts`
- `apps/server/src/acceptance.ts`
- `apps/server/src/acceptance-cli.ts`
- `apps/server/test/avatar.test.ts`
- `apps/server/test/app.test.ts`
- `apps/server/test/acceptance.test.ts`
- `apps/web/src/app.tsx`
- `apps/web/src/api/mock-runtime.ts`
- `apps/web/src/app.test.tsx`
- `apps/web/src/features/export/export-result.test.ts`
- `apps/web/e2e/comparison.spec.ts`
- `apps/web/e2e-release/comparison.release.spec.ts`
- `data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json`
- `test/migrations.test.ts`
- `test/runtime-artifact.test.ts` only if its explicit artifact assertions
  require the versioned route/module shape
- `docs/source-and-attribution.md`
- `docs/attribution.md`
- `docs/data-sources.md`
- `docs/operations.md`
- ADR/baseline artifacts created through their owner workflow after verified
  implementation

## Task 1: Add the typed player identity contract and additive schema

**Files**

- Create `packages/database/src/migrations/009_player_public_id.ts`
- Modify `packages/database/src/migrator.ts`
- Modify `packages/database/src/types.ts`
- Modify `packages/database/src/repositories/types.ts`
- Modify `packages/contracts/src/entities.ts`
- Modify `packages/contracts/test/contracts.test.ts`
- Modify `packages/database/test/migrations.integration.test.ts`
- Modify `test/migrations.test.ts`

**Why**

The system cannot render or verify `ID (real name)` while ID and real name are
collapsed into one string. The additive field preserves existing canonical
identity and allows a safe null-to-value rollout.

**Change Necessity and Impact**

Minimum source boundary is the migration, database types, staged entity type,
and public subject contract. Existing rows remain valid with `player_id = null`.
No rows are rewritten or deleted by the migration.

**Target contract**

```ts
export const ResolvedSubjectSchema = SubjectRefSchema.extend({
  displayName: z.string().min(1),
  realName: z.string().min(1).optional(),
  eraLabel: z.string().min(1).optional(),
  mediaUrl: PresentationImageUrlSchema.optional(),
});

export interface StagedEntityInput {
  id: string;
  provider: string;
  sourceKeys: readonly string[];
  kind: "team" | "player";
  canonicalName: string;
  playerId?: string | null;
  aliases: readonly string[];
}
```

Migration behavior:

```sql
alter table entities add column player_id text;
alter table entities add constraint entities_player_id_owner
  check (player_id is null or (kind = 'player' and btrim(player_id) = player_id and player_id <> ''));
create index entities_player_id_trgm on entities
  using gin (player_id public.gin_trgm_ops)
  where kind = 'player' and player_id is not null;
```

The `down` migration must first raise when any `player_id` is non-null, then
drop the index, constraint, and column. This prevents lossy live downgrade.

**Repair Track**

- Root cause: player ID has no typed persistence/public field.
- Canonical owner: `entities` plus `ResolvedSubject`.
- Stable repair: nullable additive field and optional contract property.
- Compatibility: legacy null rows remain readable.

**Retirement Track**

- Retire downstream plans to parse `ID (name)` strings.
- No old column is removed.
- Lossy downgrade remains blocked once IDs are populated.

**Verification**

```bash
rtk pnpm --filter @riftversus/contracts test
rtk pnpm test:integration
rtk pnpm typecheck
```

**Steps**

- [ ] Write contract tests accepting `{ displayName: "Faker", realName: "Lee Sang-hyeok" }`, rejecting empty `realName`, and preserving team subjects without it. Add migration integration assertions for the column, constraint, index, valid player value, rejected team value, and guarded downgrade.
- [ ] Run the commands above. Expected RED: `realName` is stripped/rejected by the schema, migration `009_player_public_id` is absent, and `player_id` is not in `Database`.
- [ ] Implement the exact optional field, migration, registry entry, `EntitiesTable.player_id: string | null`, and optional staged `playerId`. Do not modify existing canonical IDs or names.
- [ ] Re-run focused contracts and PostgreSQL migration tests, then typecheck. Expected GREEN: new cases pass and all prior migrations still apply in order.
- [ ] Checkpoint with `rtk git diff --check`. If Git metadata is available, commit with the repository's detected history style; if `git rev-parse --show-toplevel` still fails in this workspace, record the commit blocker and continue without claiming a commit.

## Task 2: Preserve Leaguepedia player ID and publish it safely

**Files**

- Modify `packages/sync/src/types.ts`
- Modify `packages/sync/src/providers/leaguepedia/types.ts`
- Modify `packages/sync/src/providers/leaguepedia/fetch.ts`
- Modify `packages/sync/src/providers/leaguepedia/normalize.ts`
- Modify `packages/sync/test/leaguepedia.test.ts`
- Modify `data/fixtures/leaguepedia-small.json`
- Modify `packages/database/src/repositories/sync.ts`
- Modify `packages/database/test/sync-publication.integration.test.ts`

**Why**

Leaguepedia already supplies both values, but the parser discards `ID`. The fix
must preserve it at the producer and reject later conflicts at publication.

**Change Necessity and Impact**

The minimum boundary crosses provider types, normalized staging, and the
publication upsert. The public search layer must not fabricate IDs from aliases
or page names.

**Target source shape**

```ts
export interface LeaguepediaEntity {
  kind: "team" | "player";
  sourceKey: string;
  displayName: string;
  playerId?: string;
  aliases: readonly string[];
  // existing team-only and validity fields stay unchanged
}
```

For player rows, `parseEntity` must require `row.ID` as `playerId`, keep
`row.Name` as `displayName`, and include ID/name/source aliases in normalization.
Team parsing is unchanged. The staged entity uses:

```ts
playerId: entity.kind === "player" ? entity.playerId : undefined;
```

Publication rules:

```text
existing null + incoming value -> populate
existing same value + replay -> unchanged
existing different non-null value -> fail publication
team/region incoming playerId -> reject by types/constraint
```

**Repair Track**

- Root cause: `parseEntity` keeps `Name` but drops `ID`.
- Canonical owner: Leaguepedia provider and sync publication.
- Stable repair: typed field across the producer/consumer boundary.
- Compatibility: team parsing and canonical real names remain unchanged.

**Retirement Track**

- Retire inference from `OverviewPage`, `source_key`, or arbitrary alias rows.
- Do not add a compatibility parser for missing ID on referenced players.

**Verification**

```bash
rtk pnpm --filter @riftversus/sync test
rtk pnpm test:integration
rtk pnpm typecheck
```

**Steps**

- [ ] Add provider tests using `ID: "Faker", Name: "Lee Sang-hyeok"`; assert separate normalized fields, search aliases containing both, fail-closed missing ID, idempotent publication, null-to-value population, and conflicting-ID rejection.
- [ ] Run the focused sync and publication integration suites. Expected RED: normalized entities have no `playerId`, missing ID is accepted, and publication cannot populate the new column.
- [ ] Implement typed extraction, normalization, fixture updates, staged propagation, and conflict-checked publication. Keep `canonicalName` equal to real name and use `coalesce(existing.player_id, incoming.playerId)` only after conflict validation.
- [ ] Re-run focused suites and typecheck. Expected GREEN: provider and publication cases pass without changing team-era or fact results.
- [ ] Run `rtk git diff --check`; commit only when repository metadata is usable, using detected history style and a scope covering Leaguepedia player identity publication.

## Task 3: Present and search player ID plus real name

**Files**

- Modify `packages/database/src/repositories/presentation.ts`
- Modify `packages/database/src/repositories/entities.ts`
- Modify `packages/database/src/repositories/comparison.ts`
- Modify `packages/database/src/repositories/index.ts`
- Modify `packages/database/test/presentation.integration.test.ts`
- Modify `packages/database/test/comparison.integration.test.ts`
- Modify `packages/database/test/query-plan.integration.test.ts`
- Modify `packages/database/test/fixtures/seed.ts`
- Modify `apps/web/src/app.tsx`
- Modify `apps/web/src/api/mock-runtime.ts`
- Modify `apps/web/src/app.test.tsx`

**Why**

Typed persistence is not user-visible until both repository paths return a
consistent subject shape and the combobox formats that shape without parsing.

**Change Necessity and Impact**

The repository must remain the public identity owner. The web change is one
pure formatting helper; it must not infer ID/name from punctuation or aliases.

**Target helpers**

```ts
export function entityPresentation(input: {
  kind: EntityKind;
  canonicalName: string;
  playerId: string | null;
}): { displayName: string; realName?: string } {
  if (input.kind !== "player" || input.playerId === null) {
    return { displayName: input.canonicalName };
  }
  return input.playerId === input.canonicalName
    ? { displayName: input.playerId }
    : { displayName: input.playerId, realName: input.canonicalName };
}

function optionLabel(
  subject: Pick<ResolvedSubject, "kind" | "displayName" | "realName">,
): string {
  return subject.kind === "player" &&
    subject.realName !== undefined &&
    subject.realName !== subject.displayName
    ? `${subject.displayName} (${subject.realName})`
    : subject.displayName;
}
```

Search SQL must match `player_id` in addition to canonical name, slug, and
searchable aliases, select `player_id`, and preserve the existing result limit
and order. Both search and comparison subject resolution call the same
`entityPresentation` helper.

**Repair Track**

- Root cause: public identity currently has one untyped display string.
- Canonical owner: repository presentation mapping.
- Stable repair: optional `realName` plus deterministic UI formatting.
- Compatibility: legacy player rows and all team/region shapes remain valid.

**Retirement Track**

- No string parser or alternate display owner is introduced.
- Mock runtime uses the same typed shape and no data-URI generator changes in
  this task.

**Verification**

```bash
rtk pnpm --filter @riftversus/web test
rtk pnpm test:integration
rtk pnpm typecheck
```

**Steps**

- [ ] Seed Faker as `canonical_name = "Lee Sang-hyeok", player_id = "Faker"`. Add integration tests for ID/name/alias search, legacy null fallback, comparison subject shape, and query-plan selectivity. Add web tests asserting search and selected input show `Faker (Lee Sang-hyeok)` while summary shows `Faker`.
- [ ] Run focused web and database tests. Expected RED: `realName` is absent, Faker resolves to the canonical real name, and `player_id` is not searched.
- [ ] Implement `entityPresentation`, select/map `player_id` in both repositories, add the player-ID search branch/index expectation, and use `optionLabel` only in combobox presentation.
- [ ] Re-run focused tests and typecheck. Expected GREEN: both source values search correctly, comparison summary uses ID, and legacy/team/region behavior is unchanged.
- [ ] Run `rtk git diff --check`; commit only when Git metadata is usable, with a repository-history-matched message for player search presentation.

## Task 4: Make every historical row display participating teams

**Files**

- Modify `packages/database/src/repositories/comparison.ts`
- Modify `packages/database/test/comparison.integration.test.ts`
- Modify `packages/database/test/fixtures/seed.ts`
- Modify `apps/web/src/api/mock-runtime.ts`
- Modify `apps/web/src/app.test.tsx`
- Modify `apps/web/src/features/export/export-result.test.ts`

**Why**

Series rows describe played matches, not selected abstract subjects. Player and
region labels in those rows misrepresent the actual competitive sides.

**Change Necessity and Impact**

Fix the producer at the comparison repository. The web and export paths already
render row fields and should receive only fixture/assertion changes.

**Target row projection**

Candidate-page SQL must join both team entities and optional team eras and
select:

```sql
coalesce(side_a_era.display_name, side_a_team.canonical_name) as side_a_team_name,
coalesce(side_b_era.display_name, side_b_team.canonical_name) as side_b_team_name
```

Map the selected left side once:

```ts
const leftName =
  leftSide === "a" ? candidate.side_a_team_name : candidate.side_b_team_name;
const rightName =
  leftSide === "a" ? candidate.side_b_team_name : candidate.side_a_team_name;
```

Summary SQL does not need presentation-name joins. Keep a separate page-row
type if necessary instead of expanding summary responsibilities.

**Repair Track**

- Root cause: row mapping copies `left.displayName/right.displayName`.
- Canonical owner: comparison repository page projection.
- Stable repair: historical side team/team-era names oriented with the existing
  side assignment.
- Compatibility: scores, winner, pagination, and subject summaries unchanged.

**Retirement Track**

- Delete the selected-subject row-name mapping.
- No UI fallback to player/region names is retained.

**Verification**

```bash
rtk pnpm test:integration
rtk pnpm --filter @riftversus/web test
rtk pnpm typecheck
```

**Steps**

- [ ] Extend the existing nine-kind-combination integration matrix to assert team names for every returned row. Add reversed-side, `SK Telecom T1` historical era, missing-era canonical fallback, pagination, web table, and export assertions.
- [ ] Run focused database/web tests. Expected RED: player and region comparisons expose selected-subject names in row fields.
- [ ] Add page-only team/entity joins and orient both names from `leftSide`. Update mock rows to model teams independently of selected subjects; do not change summary aggregation.
- [ ] Re-run focused suites and typecheck. Expected GREEN: every row is team-vs-team and all score/winner/pagination assertions remain unchanged.
- [ ] Run `rtk git diff --check`; commit only when Git metadata is usable, with a history-matched comparison-row scope.

## Task 5: Replace canonical-avatar-v1 with versioned name-based v2

**Files**

- Create `apps/server/src/http-cache.ts`
- Modify `packages/database/src/repositories/presentation.ts`
- Modify `packages/database/src/repositories/publication.ts`
- Modify `packages/database/src/repositories/entities.ts`
- Modify `packages/database/src/repositories/media.ts`
- Modify `packages/database/src/repositories/comparison.ts`
- Modify `packages/database/test/presentation.integration.test.ts`
- Modify `packages/database/test/comparison.integration.test.ts`
- Modify `apps/server/src/types.ts`
- Modify `apps/server/src/app.ts`
- Modify `apps/server/src/cli.ts`
- Modify `apps/server/src/avatar.ts`
- Modify `apps/server/src/routes/avatar.ts`
- Modify `apps/server/src/routes/comparisons.ts`
- Modify `apps/server/test/avatar.test.ts`
- Modify `apps/server/test/app.test.ts`
- Modify `test/runtime-artifact.test.ts` only when required by explicit checks

**Why**

The UUID-only v1 generator cannot produce recognizable name abbreviations, and
its immutable URL cannot safely change bytes in place. V2 labels may change
when a typed player ID is populated, so v2 must revalidate instead of claiming
immutable bytes.

**Change Necessity and Impact**

The minimum stable repair is a versioned URL, one database-backed identity
resolver, and one pure server generator. Retained media and placeholder recovery
remain outside this change.

**Target interfaces**

```ts
export const CANONICAL_AVATAR_ALGORITHM = "canonical-avatar-v2" as const;

export interface AvatarIdentity {
  kind: EntityKind;
  id: string;
  label: string;
}

export interface CanonicalAvatar {
  algorithm: typeof CANONICAL_AVATAR_ALGORITHM;
  contentType: typeof CANONICAL_AVATAR_CONTENT_TYPE;
  abbreviation: string;
  body: Buffer;
  checksum: string;
}

export function avatarAbbreviation(kind: EntityKind, label: string): string;
export function generateCanonicalAvatar(
  identity: AvatarIdentity,
): CanonicalAvatar;
```

`presentationImageUrl` returns:

```ts
`/avatars/v2/${kind}/${canonicalId}.svg`;
```

The repository resolver selects kind, UUID, canonical name, and `player_id`,
uses the shared presentation mapping for player label selection, and returns
`null` on missing/kind mismatch.

The route is exactly:

```text
GET /avatars/v2/:kind/:id.svg
```

It awaits `dependencies.getAvatarIdentity(kind, id)`, returns structured `404`
for null, generates v2 bytes, sends `Cache-Control: public, no-cache` plus a
checksum ETag, honors matching `If-None-Match` with `304`, and preserves the
existing SVG security headers.

Abbreviation cases are exact:

```text
T1 -> T1
LCK -> LCK
Bilibili Gaming -> BG
Faker -> FAK
G -> GG
no ASCII alphanumeric player label -> PL
no ASCII alphanumeric team label -> TM
no ASCII alphanumeric region label -> RG
```

Known LCK/LPL/LEC/LCS labels must map to four distinct reviewed palette/pattern
combinations. Player/team seeds remain kind plus canonical UUID.

**Repair Track**

- Root cause: generator has no label and v1 URL is immutable.
- Canonical owner: repository identity resolution plus Fastify byte generator.
- Stable repair: versioned v2 route and safe derived abbreviation.
- Compatibility: retained media and image-load recovery unchanged.

**Retirement Track**

- Deletion class: contract-carrying code and derived output.
- Delete v1 algorithm behavior, unversioned route registration, old URL
  expectations, and old checksum fixtures from the main path.
- Do not retain redirect, legacy generator, or compatibility adapter without
  new active external-dependency evidence.
- Lingering-reference verification is mandatory in Task 7.

**Verification**

```bash
rtk pnpm --filter @riftversus/server test
rtk pnpm test:integration
rtk pnpm typecheck
rtk pnpm lint
```

**Steps**

- [ ] Replace avatar tests first: abbreviation table, stable v2 checksum, exact distinct region style tokens, legible text contrast, safe single `<text>` content, no raw label, identity resolver calls, published-visibility behavior, v2 URL, invalid/missing/mismatched identities, ETag revalidation, query stability, and unversioned-route 404.
- [ ] Run focused server/presentation tests. Expected RED: v1 signature/URL lacks label resolution and all v2 expectations fail.
- [ ] Implement the shared resolver, v2 URL, dependency wiring, audited abbreviation function, region styles, SVG generator, and route. Remove the unversioned v1 route rather than keeping both.
- [ ] Re-run server/database tests, typecheck, and lint. Expected GREEN: deterministic v2 bytes and all negative route/security tests pass while retained media still wins.
- [ ] Run `rtk git diff --check`; commit only when Git metadata is usable, with a history-matched avatar-v2 scope.

## Task 6: Update acceptance, browser/export evidence, and reviewed snapshot

**Files**

- Modify `apps/server/src/acceptance-media.ts`
- Modify `apps/server/src/acceptance.ts`
- Modify `apps/server/src/acceptance-cli.ts`
- Modify `apps/server/test/acceptance.test.ts`
- Modify `apps/web/e2e/comparison.spec.ts`
- Modify `apps/web/e2e-release/comparison.release.spec.ts`
- Modify `apps/web/src/features/export/export-result.test.ts`
- Modify `data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json`

**Why**

Acceptance is the release contract. Updating runtime code without exact v2,
typed identity, and historical team-row evidence would leave the release gate
protecting old behavior.

**Change Necessity and Impact**

The expected generated-avatar evidence must include exact `label` and
`abbreviation`, call the new generator signature, expect the v2 URL, and reject
v1/unversioned evidence. Reviewed historical rows must include expected team
names so acceptance checks more than score totals.

**Target expected shape**

```ts
z.object({
  kind: z.literal("generated-avatar"),
  entityKind: EntityKindSchema,
  entityId: UuidSchema,
  label: z.string().min(1),
  abbreviation: z.string().regex(/^[A-Z0-9]{2,3}$/u),
  algorithm: z.literal("canonical-avatar-v2"),
  checksum: ChecksumSchema,
  contentType: z.literal("image/svg+xml"),
}).strict();
```

Extend each reviewed row with non-empty `leftName` and `rightName`. Acceptance
maps and compares names alongside ID/date/score/winner.

**Repair Track**

- Root cause: current release evidence proves v1 URLs/checksums and omits row
  team names.
- Canonical owner: acceptance schema/verifier and reviewed snapshot.
- Stable repair: exact v2 identity plus row-name evidence.
- Compatibility: retained-media evidence variant stays unchanged.

**Retirement Track**

- Old v1 checksums and URL expectations are removed.
- Negative tests explicitly reject `canonical-avatar-v1` and unversioned URLs.

**Verification**

```bash
rtk pnpm --filter @riftversus/server test
rtk pnpm --filter @riftversus/web test
rtk pnpm test:e2e
```

**Steps**

- [ ] Write acceptance RED cases for label/abbreviation mismatch, wrong v2 route, v1 algorithm, wrong team row names, and correct T1/LPL evidence. Update E2E assertions to v2 URLs and visible team rows; keep export placeholder recovery.
- [ ] Run focused server/web/E2E tests. Expected RED: current schemas reject new fields or still accept incomplete v1 evidence, and release E2E expects old URLs.
- [ ] Update acceptance types, generator dependency, exact row comparison, reviewed snapshot fields/checksums, E2E paths, and export fixtures. Do not weaken retained-source or coverage verification.
- [ ] Re-run focused tests and E2E. Expected GREEN: correct v2 evidence passes; every mismatch and v1 path blocks release.
- [ ] Run `rtk git diff --check`; commit only when Git metadata is usable, with a history-matched acceptance/e2e scope.

## Task 7: Documentation, full gates, runtime publication, and governance closeout

**Files**

- Modify `docs/source-and-attribution.md`
- Modify `docs/attribution.md`
- Modify `docs/data-sources.md`
- Modify `docs/operations.md`
- Amend/supersede `docs/aegis/adr/ADR-0001-leaguepedia-facts-and-fail-closed-presentation.md` through the ADR owner workflow
- Create a new release baseline snapshot under `docs/aegis/baseline/` after
  runtime verification
- Update `docs/aegis/INDEX.md` for new ADR/baseline artifacts

**Why**

The public presentation algorithm, player identity contract, and historical row
semantics are durable decisions. Release completion requires code, runtime data,
acceptance, and architecture records to agree.

**Change Necessity and Impact**

Docs must name v2 and the typed identity boundary. Runtime acceptance must run
against migrated and freshly published data; static green tests cannot prove the
production player ID exists.

**Repair Track**

- Align operator/source docs with implemented verified behavior.
- Run migration, publication, API, avatar, E2E, and acceptance evidence.

**Retirement Track**

- Search and remove main-path v1 references.
- Historical spec/plan/ADR records may retain v1 as history and must not be
  rewritten solely to erase evidence.
- Any active source/test/runtime reference outside historical records blocks
  clean retirement.

**Verification**

```bash
rtk pnpm test
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm test:integration
rtk pnpm test:e2e
rtk pnpm acceptance:check
rtk rg -n "canonical-avatar-v1|/avatars/(player|team|region)/" apps packages test data docs --glob '!docs/aegis/specs/2026-07-14-deterministic-avatar-fallback-design.md' --glob '!docs/aegis/plans/2026-07-14-deterministic-avatar-fallback.md' --glob '!docs/aegis/baseline/2026-07-15-riftversus-release.md' --glob '!docs/aegis/adr/ADR-0001-leaguepedia-facts-and-fail-closed-presentation.md' --glob '!docs/aegis/specs/2026-07-18-comparison-identity-avatar-v2-design.md' --glob '!docs/aegis/plans/2026-07-18-comparison-identity-avatar-v2.md'
```

The final `rg` must return no unexpected main-path matches. Historical records
are excluded because they are immutable decision evidence until the ADR owner
creates a successor/amendment.

**Steps**

- [ ] Update docs only after implementation behavior is fixed. State player ID/name ownership, historical team-row meaning, v2 URL/algorithm, safe abbreviation, region styling, and unchanged provenance/non-persistence.
- [ ] Run all static and test gates. Expected GREEN: no failures, and touched PostgreSQL integration tests execute rather than skip. If `TEST_DATABASE_URL` is missing, stop and report `needs-verification`.
- [ ] In the target runtime, apply migration 009, execute a fresh Leaguepedia publication, verify API search returns `Faker` plus `Lee Sang-hyeok`, verify row names are teams, fetch v2 SVGs, and run production acceptance. Do not delete or reset persistent data.
- [ ] Run the lingering-reference command, then invoke the ADR recording workflow to amend/supersede ADR-0001 and create a new verified release baseline snapshot. Run Aegis workspace structural checks when available.
- [ ] Run `rtk git diff --check`. If Git metadata is available, inspect repository history, commit the final docs/governance slice, and verify the complete commit series; otherwise report the existing Git metadata blocker without claiming commits.

## Execution Readiness View

- Intent Lock: historical rows are team-vs-team; player identity is typed;
  generated avatars are name-based v2.
- Scope Fence: only files and behaviors listed in this plan; no media rights,
  current-team profile, alternate provider, or comparison semantic expansion.
- Baseline Lock: approved 2026-07-18 design spec plus listed release baseline and
  ADR.
- Approved Behavior: exact product behavior and acceptance cases in the parent
  spec.
- Owner/Contract Constraints: provider -> persistence -> repositories -> server
  -> typed web formatting; no duplicate owner.
- Compatibility Boundary: preserved and intentional changes listed above.
- Retirement Boundary: v1 leaves the main path delete-first; historical records
  remain as evidence; no persistent data deletion.
- Task Batches: schema/contract -> provider/publication -> presentation/search ->
  row names -> avatar v2 -> acceptance/E2E -> runtime/governance.
- Test Obligations: focused RED/GREEN, full static gates, executed PostgreSQL
  integration, E2E, fresh publication, production acceptance, lingering search.
- Review Gates: review migration safety after Task 1, producer/consumer identity
  after Task 3, row semantics after Task 4, security/retirement after Task 5,
  acceptance completeness after Task 6, architecture baseline after Task 7.
- Drift/Rewind Rules: return to the spec if implementation needs a second
  generator, label URL, destructive migration, player/team region inheritance,
  contract rename, or comparison logic change.
- Evidence Required Before Completion: commands and runtime observations in
  Task 7, plus exact changed-file review and no unexpected v1 references.
- Advisory Boundary: method-pack execution guidance only; not `GateDecision`,
  `PolicySnapshot`, or completion authority.

## Risks and Rollback Surface

- Migration rollout gap: before the first new publication, legacy players have
  null `player_id`; defined fallback is canonical name, and release acceptance
  remains incomplete until publication.
- Query performance: the new player ID search path must retain selective index
  evidence; query-plan tests own this risk.
- Cache revalidation: v2 uses checksum ETags and `public, no-cache` because the
  typed player label may change at the same canonical URL; v1 immutable bytes
  remain retired and are never served under v2 semantics.
- SVG safety: only validated abbreviation reaches `<text>`; tests reject raw
  label and active content.
- Historical team names: row projection must use series era IDs, not current
  team names or selected subjects.
- Git state: local repository metadata was restored from the externally managed
  `/tmp/RiftVersus.git`; `main` resolves to `d6d39dd` and the complete working
  diff is visible. Commit creation remains a separate explicit handoff action.

## Completion and Retirement Criteria

The plan is complete only when:

- all three user-visible behaviors pass focused, integration, E2E, and runtime
  acceptance;
- `player_id` is populated from a successful Leaguepedia publication;
- no active main-path v1 generator/URL/evidence remains;
- retained media and facts remain untouched;
- ADR and new release baseline record the verified architecture;
- skipped database tests, missing runtime publication, or unusable Git metadata
  are reported explicitly rather than hidden by broad success claims.
