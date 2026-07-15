# Deterministic Avatar Fallback Implementation Plan

Date: `2026-07-14`
Status: `approved spec; ready for Subagent-Driven execution`
Parent task: Leaguepedia-primary Task 5 Docker and historical acceptance

## Goal

Implement `canonical-avatar-v1` so every canonical player, team, and region has
a stable same-origin presentation image without publishing Leaguepedia media
whose license or attribution is missing. Preserve licensed retained-media
precedence, then resume the existing official T1-versus-LPL snapshot and Docker
acceptance gates.

## Architecture

```text
Leaguepedia imageinfo
  -> strict sync media eligibility gate
  -> licensed retained raster media in S3/PostgreSQL (when complete)

PostgreSQL entity repository
  -> retained media exists: /media/{object-key}
  -> otherwise: /avatars/{kind}/{canonical-entity-id}.svg

Fastify avatar route
  -> canonical-avatar-v1 generator
  -> deterministic safe SVG bytes, checksum, immutable headers
```

There are three canonical owners: the existing sync media gate owns upstream
eligibility, a repository helper owns presentation URL precedence, and one
server generator owns SVG bytes. The web and export clients only render the
returned same-origin URL.

## Tech Stack

- TypeScript, Node.js crypto and Buffer
- Fastify route registration and inject tests
- Kysely/PostgreSQL repository integration tests
- Zod public and acceptance schemas
- Vitest, Playwright, Docker Compose, PostgreSQL 17, MinIO

## Baseline and Authority References

- `docs/aegis/specs/2026-07-14-deterministic-avatar-fallback-design.md`
- `docs/aegis/specs/2026-07-12-leaguepedia-primary-mvp-design.md`
- `docs/aegis/plans/2026-07-12-leaguepedia-primary-mvp.md`, Task 5
- `docs/source-and-attribution.md`
- `docs/attribution.md`
- `packages/sync/src/providers/leaguepedia/media.ts`
- `packages/database/src/repositories/entities.ts`
- `packages/database/src/repositories/comparison.ts`
- `apps/server/src/acceptance.ts`

## Requirement Ready Check

- Requirement source: user-approved deterministic avatar design amendment.
- Scenario: T1-versus-LPL comparison when reviewed upstream images have no
  redistribution license or attribution.
- Acceptance: both subjects resolve to non-placeholder deterministic avatars;
  licensed retained media remains preferred and independently verifiable.
- Open blocker questions: none for avatar implementation. The historical
  snapshot and live Docker publication remain parent Task 5B runtime work.
- Decision: `ready`.

## Compatibility Boundary

- Keep the existing comparison and entity JSON field names and URL shapes.
- `ResolvedSubject.mediaUrl` remains schema-compatible; repositories now always
  populate it for known canonical subjects.
- Do not change PostgreSQL schema, media rows, S3 object semantics, `/media/*`,
  saved comparison URLs, comparison facts, or sync publication ownership.
- Do not publish `license = null`, infer a site-wide license, hotlink, redirect
  to upstream media, or store generated avatars in PostgreSQL/S3.
- Team-era queries use the canonical team entity ID in avatar URLs.

## Change Necessity

- User-visible need: every comparison subject needs an avatar.
- No-change option: the current generic placeholder is rejected by acceptance
  and does not provide stable subject-specific presentation.
- Docs-only option: cannot create a safe same-origin image or make API responses
  satisfy the approved contract.
- Minimum code boundary: one server generator/route, one repository precedence
  helper used by both repository paths, and the acceptance evidence union.
- Decision: `code-change`.

## Existence and Architecture Integrity

- Proposed surface: `/avatars/{kind}/{uuid}.svg` and `canonical-avatar-v1`.
- Existing reuse candidate: `/media/*` and `/media-placeholder.svg`.
- Why reuse is insufficient: `/media/*` is intentionally backed only by
  persisted raster objects; the generic placeholder is error recovery and has
  no canonical subject identity.
- Creation proof: a local generated image is the only path that meets avatar,
  same-origin, determinism, and unknown-license constraints simultaneously.
- Entropy boundary: one generator, one repository resolver, no client-side
  implementation, no persisted generated-media owner.
- Decision: `add-with-proof`.
- Architecture integrity verdict: aligned; no higher-level owner can safely
  infer missing third-party rights.

## Plan-Time Complexity Check

- `apps/server/src/app.ts` is small and receives wiring only.
- `apps/server/src/acceptance.ts` is already 250 lines and mixed validation;
  keep avatar generation outside it and add only discriminated verification
  dispatch. Extract acceptance media verification to a focused file if the
  implementation would push it beyond a clear single responsibility.
- `packages/database/src/repositories/comparison.ts` is 210 lines and already
  complex; add no new inline fallback branches. Create
  `packages/database/src/repositories/presentation.ts` and call it from both
  repositories.
- `apps/web/src/features/export/export-result.ts` is 290 lines; change tests and
  shared URL expectations only. Do not add a generator there.
- Recommendation: add owner files; wiring-only edits in existing large files.

## Execution Readiness View

- Intent Lock: licensed media when proven; otherwise neutral deterministic
  presentation avatar.
- Scope Fence: generator, route, repository resolver, contracts, acceptance
  evidence, affected tests/docs; no operator override or alternate provider.
- Baseline Lock: the three approved specs/plans listed above.
- Owner Constraints: sync eligibility, repository precedence, server bytes.
- Compatibility: JSON field names, comparison semantics, DB/S3 schema and
  `/media/*` remain stable.
- Retirement: remove retained-media-only acceptance assumption; keep generic
  placeholder solely as load-error recovery.
- Task Batches: generator/route -> repositories/contracts/clients -> acceptance
  verifier/docs -> parent Task 5B runtime acceptance.
- Test Obligations: RED before production edits, targeted GREEN, package gates,
  integration gates, then Docker acceptance.
- Review Gates: fresh spec-compliance reviewer, then fresh code-quality reviewer;
  all findings return to the same task implementer and are re-reviewed.
- Drift Rule: stop if implementation adds persisted generated media, a second
  generator, upstream hotlink, inferred license, database migration, or public
  JSON field rename.
- Evidence Required: deterministic checksum fixtures, route security headers,
  repository precedence, both acceptance evidence variants, root gates, and
  final T1/LPL Docker evidence.
- Advisory Boundary: method-pack execution guidance only; not completion
  authority.

## Task 1: Canonical avatar generator and Fastify route

**Files**

- Create `apps/server/src/avatar.ts`
- Create `apps/server/src/routes/avatar.ts`
- Create `apps/server/test/avatar.test.ts`
- Modify `apps/server/src/app.ts`
- Modify `apps/server/test/app.test.ts`
- Modify `test/runtime-artifact.test.ts` if the production artifact allow-list
  explicitly enumerates server modules or routes

**Why**

Create one safe, testable owner for deterministic SVG bytes and a same-origin
route that cannot fall through to the SPA.

**Change Necessity and Impact**

The existing media route cannot generate bytes and must remain restricted to
persisted raster objects. The minimum addition is one pure generator plus one
route; `app.ts` receives registration and namespace wiring only.

**Target interface**

```ts
export const CANONICAL_AVATAR_ALGORITHM = "canonical-avatar-v1" as const;
export const CANONICAL_AVATAR_CONTENT_TYPE = "image/svg+xml" as const;

export interface CanonicalAvatar {
  algorithm: typeof CANONICAL_AVATAR_ALGORITHM;
  contentType: typeof CANONICAL_AVATAR_CONTENT_TYPE;
  body: Buffer;
  checksum: string;
}

export function generateCanonicalAvatar(kind: EntityKind, id: string): CanonicalAvatar;
export function registerAvatarRoute(app: FastifyInstance): void;
```

The generator validates with `UuidSchema`, canonicalizes the result to lowercase,
and hashes exactly `${kind}:${canonicalId}`. Use digest bytes only to select a
fixed audited palette and primary geometry; use all canonical UUID bytes
injectively in fixed numeric primitives. Emit a canonical one-line SVG with
numeric attributes only; no `<text>`, `<style>`, `<script>`, animation, `href`,
URL, entity name, initials, or external reference.

The route schema accepts `kind` from `EntityKindSchema` and `id` from
`UuidSchema`, then returns:

```text
Content-Type: image/svg+xml
Cache-Control: public, max-age=31536000, immutable
ETag: "sha256-{checksum}"
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
```

Register `/avatars` as a reserved namespace alongside `/api` and `/media`.

**TDD steps**

- [ ] Write generator tests asserting byte identity, different kind/UUID output,
  fixed checksum fixtures, absence of forbidden SVG tokens, and successful
  `UuidSchema` validation. Write route inject tests for headers/body/ETag and
  invalid kind, malformed UUID, encoded traversal, query-string stability, and
  SPA fallthrough rejection.
- [ ] Run
  `rtk pnpm --dir apps/server exec vitest run test/avatar.test.ts test/app.test.ts --config ../../vitest.unit.config.ts`
  and record RED failures caused by missing generator/route.
- [ ] Implement only `avatar.ts`, `routes/avatar.ts`, and the two wiring edits.
  Do not touch media persistence or web rendering.
- [ ] Re-run the targeted command, then
  `rtk pnpm --filter @riftversus/server test`,
  `rtk pnpm typecheck`, and `rtk pnpm lint`; all must pass.
- [ ] Do not commit yet. Record the changed files and fresh evidence in the
  parent Task 5 checkpoint because its approved gate forbids commits before
  Docker, source attribution, query budgets, and reviewed snapshot evidence.

## Task 2: Single repository presentation resolver

**Files**

- Create `packages/database/src/repositories/presentation.ts`
- Create `packages/database/test/presentation.test.ts` or place pure tests in
  the existing repository unit-test location
- Modify `packages/database/src/repositories/entities.ts`
- Modify `packages/database/src/repositories/comparison.ts`
- Modify `packages/database/src/repositories/index.ts` only if tests or callers
  need the helper as an internal package export
- Modify `packages/database/test/comparison.integration.test.ts`
- Modify the entity-search integration test that currently asserts optional
  media behavior
- Modify `packages/contracts/src/entities.ts`
- Modify `packages/contracts/src/comparison.ts`
- Modify affected API/server/web fixtures that omit `mediaUrl`

**Why**

Make licensed retained-media precedence and generated-avatar fallback identical
for search results and comparison subjects without duplicating URL rules.

**Change Necessity and Impact**

Both repositories currently independently omit `mediaUrl` when no media row
exists, and comparison then inserts a generic placeholder at the caller. That is
the obsolete retained-media-only assumption. Replace it at the canonical
repository presentation boundary and remove the comparison placeholder branch.

**Target interface**

```ts
export function presentationImageUrl(input: {
  kind: EntityKind;
  entityId: string;
  retainedObjectKey: string | null;
}): string {
  return input.retainedObjectKey === null
    ? `/avatars/${input.kind}/${UuidSchema.parse(input.entityId)}.svg`
    : `/media/${input.retainedObjectKey}`;
}
```

Use the canonical entity ID for team-era rows. Before calling the helper,
`searchEntities` and `resolveSubject` select retained media for an exact team
era only when its current `team_era_id` matches that era; they do not fall back
to entity-level retained media. Player, region, and non-era team rows retain
entity-level media selection. Both repositories must call this helper.
`compareHeadToHead.mediaUrls` must use the two resolved subject URLs directly
and contain no placeholder fallback.

**TDD steps**

- [ ] Write pure tests for player/team/region URLs, retained-media precedence,
  team-era canonical identity, and invalid UUID rejection. Update PostgreSQL
  integration expectations so exact T1-era search and comparison retain the
  exact era `/media/*`, exact SKT-era search and comparison use the canonical
  team avatar when that era has no media, and other subjects without licensed
  media resolve to `/avatars/{kind}/{entity-id}.svg` through both repository
  paths.
- [ ] Run the pure targeted test and, with the isolated PostgreSQL URL, run
  `rtk pnpm exec vitest run packages/database/test/comparison.integration.test.ts --config vitest.integration.config.ts`;
  record the expected RED assertions.
- [ ] Implement `presentation.ts`, replace both repository mappings, remove the
  comparison-level placeholder branch, and add contract descriptions clarifying
  same-origin presentation-image semantics without renaming JSON fields.
- [ ] Re-run targeted tests, then
  `rtk pnpm --filter @riftversus/database test:integration`,
  `rtk pnpm test:consumer`, `rtk pnpm typecheck`, and `rtk pnpm lint`; all
  runnable tests must pass and integration tests must not be silently skipped
  when the isolated PostgreSQL environment is available.
- [ ] Do not commit yet. Record Task 2 evidence and confirm via `rtk rg` that
  production database code has no `/media-placeholder.svg` fallback and only
  one `presentationImageUrl` implementation.

**Repair track**

- Root cause: repository output treated absent retained media as absent
  presentation data.
- Canonical repair: repository presentation helper returns exactly one URL.
- Compatibility: retained media wins unchanged; generated fallback adds no DB
  row and changes no comparison facts.

**Retirement track**

- Retire the comparison caller's generic main-path placeholder branch.
- Keep `/media-placeholder.svg` only in the browser/export image-error handlers.
- No compatibility copy of repository URL logic is retained.

## Task 3: Discriminated acceptance media evidence

**Files**

- Modify `apps/server/src/acceptance.ts`; extract
  `apps/server/src/acceptance-media.ts` if needed to preserve owner clarity
- Modify `apps/server/src/acceptance-cli.ts`
- Modify `apps/server/test/acceptance.test.ts`
- Modify `data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json`
- Modify `docs/source-and-attribution.md`
- Modify `docs/attribution.md`
- Modify `docs/data-sources.md`, `docs/operations.md`, and
  `docs/deployment.md` where retained media is described as mandatory

**Why**

Allow acceptance to prove either licensed retained bytes or canonical generated
bytes without weakening historical source, provenance, coverage, or match-total
gates.

**Change Necessity and Impact**

The current `ExpectedMediaSchema` only models raster S3 objects and rejects the
approved generated-avatar main path. Bump the internal snapshot schema to
version 2 and replace the media object with a discriminated union; do not retain
a version-1 reviewed compatibility branch because the fixture is internal and
not yet published.

**Target schema**

```ts
const ExpectedPresentationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("retained-media"),
    checksum: ChecksumSchema,
    contentType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  }).strict(),
  z.object({
    kind: z.literal("generated-avatar"),
    entityKind: z.enum(["player", "team", "region"]),
    entityId: UuidSchema,
    algorithm: z.literal("canonical-avatar-v1"),
    checksum: ChecksumSchema,
    contentType: z.literal("image/svg+xml"),
  }).strict(),
]);
```

`AcceptanceVerificationDependencies` gains a pure
`generateAvatar(kind, id): CanonicalAvatar` dependency. The production CLI binds
it to `generateCanonicalAvatar`. Generated verification must prove the exact
canonical URL, response subject kind/ID, algorithm/content type/checksum, and
byte hash. Retained verification keeps the existing PostgreSQL/S3 checks.

**TDD steps**

- [ ] Convert the acceptance test fixture to schema version 2 and add focused
  tests for a generated left/right ready result, mixed retained/generated
  result, wrong UUID/kind/algorithm/checksum/content type/URL, placeholder, and
  oversized retained media. Preserve all raw-object/page-revision, dataset fact,
  chronological-row, coverage, and source provenance negative tests.
- [ ] Run
  `rtk pnpm --dir apps/server exec vitest run test/acceptance.test.ts --config ../../vitest.unit.config.ts`
  and record RED evidence for the missing discriminated schema/dependency.
- [ ] Implement version 2 only, generated/retained dispatch, CLI binding, and
  documentation wording. Do not relax the Leaguepedia media parser or its
  license/attribution requirements.
- [ ] Re-run the targeted suite, then
  `rtk pnpm --filter @riftversus/server test`, `rtk pnpm test`,
  `rtk pnpm build`, `rtk pnpm typecheck`, `rtk pnpm lint`, and
  `rtk git diff --check`; all must pass.
- [ ] Do not commit yet. Update the parent checkpoint and proceed to fresh spec
  review, then fresh code-quality review. Any finding returns to the responsible
  implementer and must be re-reviewed.

**Repair track**

- Root cause: acceptance equated valid presentation with retained third-party
  raster media.
- Canonical repair: a discriminated evidence owner verifies the actual
  presentation mechanism without weakening source facts.

**Retirement track**

- Delete the version-1 reviewed media shape and retained-media-only validation.
- Do not retain a version adapter because no reviewed production snapshot uses
  it.
- Keep the `awaiting-reviewed-source` state only after updating it to the same
  current schema version.

## Task 4: Rejoin parent Task 5B runtime acceptance

**Files**

- Use the existing dirty Task 5 worktree and the parent plan's files; do not
  create another media provider, fixture owner, or fallback.
- Complete `data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json` from the actual
  successful publication and retained raw evidence.

**Why**

Avatar implementation only removes the media-rights blocker. The overall MVP
still requires an actual successful Leaguepedia publication and reviewed
historical comparison evidence.

**Steps**

- [ ] Rebuild the production Docker image after Tasks 1-3 and verify non-root
  runtime, production-only dependencies, migrations 001-008, health checks, and
  image size.
- [ ] Run the full official 2013-2025 Worlds backfill through the single
  `runSync` owner into the isolated PostgreSQL/MinIO stack; confirm one successful
  published dataset and no failed run advancing visibility.
- [ ] Generate the reviewed snapshot from exact raw request IDs/URLs,
  page/revision IDs, object checksums, source metadata, 13/13 complete coverage,
  exact series/game IDs and totals, plus generated T1/LPL avatar checksums.
- [ ] Run `rtk pnpm acceptance:check`, the exact T1/LPL API query, Playwright,
  PostgreSQL query-plan budgets, resource measurements, root tests/build/lint,
  and Docker Compose smoke tests. Record fresh outputs; do not reuse pre-avatar
  image evidence.
- [ ] Only after Task 5 spec review, quality review, final reviewer, and all
  runtime evidence pass, create the planned Task 5 commit(s) matching repository
  history. Then merge to main and run the completion audit.

## Verification Summary

```bash
rtk pnpm exec vitest run apps/server/test/avatar.test.ts apps/server/test/app.test.ts --config vitest.unit.config.ts
rtk pnpm exec vitest run apps/server/test/acceptance.test.ts --config vitest.unit.config.ts
rtk pnpm --filter @riftversus/server test
rtk pnpm --filter @riftversus/database test:integration
rtk pnpm test
rtk pnpm build
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm acceptance:check
rtk pnpm test:e2e
rtk git diff --check
```

PostgreSQL integration, acceptance, and e2e commands must run against the
isolated Task 5 Docker stack. A skip or synthetic fixture is not release
evidence.

## Risks and Rollback

- SVG active-content risk: fixed generator grammar, no text/URL/script/style,
  restrictive CSP, `nosniff`, and exact unit fixtures.
- Duplicate fallback risk: repository is the only presentation resolver;
  production clients may keep only their image-load error recovery.
- Contract drift: version-2 acceptance is internal and delete-first; public JSON
  names remain unchanged.
- Historical evidence drift: final acceptance uses only the newly published
  dataset and exact retained raw object metadata.
- Rollback before publication is code-only. No schema migration or persistent
  generated-media state exists to undo.

## ADR and Baseline Sync

At final Task 5 completion, the architecture decision must record:

- Leaguepedia remains the only upstream facts provider;
- unlicensed non-text media remains fail-closed;
- presentation URL semantics permit deterministic local avatars;
- generated avatars are not media provenance or persisted source objects;
- a future real-logo override requires a new reviewed rights/provenance design.
