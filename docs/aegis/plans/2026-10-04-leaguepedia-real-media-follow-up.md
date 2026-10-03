# Leaguepedia Real Media Follow-Up

Date: 2026-10-04
Status: editorial-use policy explicitly approved by the user; implementing.
Branch: fix/leaguepedia-real-media

## Actual Failure

The live SQLite has 601 player variants and 203 team/entity-era variants, all
with a null retained_object_key. Real image discovery shipped, but actual real
image publication did not. This is not a browser-cache failure.

The current-import audit contains 66 candidates, all blocked because per-file
license and attribution metadata are absent. ADR-0001 and the approved
2026-10-03 public-identity/real-media spec keep unknown-rights images unpublished.
The user now confirms Leaguepedia portraits and logos as the preferred source.

Direct file-page API inspection independently confirms:

| Owner | Preferred file | Revision | Rights evidence |
| --- | --- | --- | --- |
| Faker | T1 Faker 2026 LCK Cup.png | 4362315 | PlayerImageMetadata identifies Faker/T1/LCK Cup 2026 and Headshot; Copyright game template asserts fair use, not a redistribution license. |
| T1 current era | T1logo profile.png | 3359842 | Team Logo Profiles category only; no per-file license or author. |

Source pages:
- https://lol.fandom.com/wiki/File:T1_Faker_2026_LCK_Cup.png
- https://lol.fandom.com/wiki/File:T1logo_profile.png
- https://lol.fandom.com/wiki/Template:Copyright_game

Both preferred PNGs were downloaded and visually reviewed. SHA-256:
- Faker: 9419ecd4ae50524f42e8bc113adee67c06cbd88e79388090305cce66f7f60ae5
- T1: 817cee2486186fa5f2880c4ba2343e85f7512ba00c6c47ea576c3a0998feaded

Do not claim CC BY/CC BY-SA for these files. Wiki text licensing is not proof of
image licensing. Do not apply the modern T1 logo to SK Telecom T1 historical eras.

## Authorized Repair

Fix exact file matching in both live discovery and retained replay: MediaWiki
normalizes underscores to spaces. Tests must cover both paths, preserve case
distinctions and keep missing license/attribution blocked. This repair alone
will not make the current blocked batch publishable.

## Concrete Publication Choices

1. Keep the existing verified-license rule. Supply independently verified
   rights/attribution through a reviewed asset manifest. Leaguepedia stays the
   preferred source, but a verified alternative may fill an unavailable asset.
   Neither preferred Faker nor T1 file currently qualifies under this rule.
2. Explicitly adopt a reviewed editorial-use policy for Leaguepedia images.
   Record an editorial-use basis separately from a license; never label fair
   use as permission from the copyright holder. Retain the exact file page,
   revision, source image checksum, owner/era and available rights statement.
   Restrict publication to reviewed portraits/logos used to identify subjects
   in this noncommercial esports reference site. Keep a visible source/credit
   link and a removal contact. Unknown owner, unrelated images and conflicting
   historical-era assignments remain blocked. This choice supersedes the
   current licensed-only boundary and needs an explicit user decision.

## Implementation And Release After Decision

Reuse the bounded image downloader, filesystem object store, media publication,
private immutable checkpoint and same-origin content-addressed Pages export.
Do not hotlink image bytes or patch the public SQLite outside publication.

The reviewed media policy/manifest checksum must participate in dataset version
and override provenance. A changing upstream file must invalidate the reviewed
checksum rather than silently acquire the old review. Players bind to exact
canonical identities; team logos bind to exact eras. Regions keep existing icons.

Audit both current and historical imported subjects; report actual retained
coverage rather than treating a current 66-image batch as all 601 players.
Preserve match facts, readable-ID owners, filters, PNG/ZIP exports and rollback.

Verify manifest validation, deterministic raw replay, identity/era ownership,
checksum rejection, image decoding, visible source credits and PNG/ZIP content.
Run focused tests, build/lint, CI and cold-restore/publication gates. Create a new
authoritative data checkpoint and verify hosted desktop/mobile media. Commit
source matching and actual media publication as separate stages. Do not stage
the user's unrelated .gitignore changes.

## Matching Repair Evidence

The existing live-fetch test and two new retained-replay cases reproduced the
underscore/space mismatch before the fix (three failures). Both paths now use
the same file-title normalization. Case differences remain unmatched; missing
rights remain blocked. All 173 sync tests and the workspace TypeScript build
passed. This is a source-matching repair, not a claim of real-media deployment.

## Approved Execution - 2026-10-04

The user selected choice 2 (reviewed Leaguepedia editorial identification use).
No further policy confirmation is required. This supersedes the licensed-only
boundary for explicitly reviewed, checksum-pinned Leaguepedia portraits/logos.
Missing evidence still does not become a license. Existing licensed records and
archived sites remain readable; no persistent data is deleted.

Code is necessary: the current schema and acceptance gate require license text
and cannot represent approved editorial use honestly. Reuse the existing media
object, sync runner, dataset publication, SQLite exporter and checkpoint writer.
The minimum new state is a nullable structured rights-basis field, separately
from license; the minimum new operational path is a media-only publication of
reviewed assets, with no match/roster or coverage mutation.

1. contracts/media-rights.ts: strict editorial evidence (policy, source file
   page/revision, SHA-256, rights statement, review note). Migration 011 adds
   rights_basis without relabeling existing licenses. Thread evidence through
   sync retention, PostgreSQL publication, snapshot attribution and acceptance.
   Check checksum before storage; reject owner/metadata conflicts. Tests cover
   license-free editorial records and incomplete/tampered evidence.
2. data/overrides/media.json: reviewed exact canonical entity/era assignments and
   file evidence. apps/data/src/media-service.ts loads the reviewed file and
   uses runSync with empty facts/dimensions/publication scopes. Validate owners
   against published identities before any download. Add media-only CLI and
   Publish mode; reuse the same serialized writer and cold-restore gates.
   Existing normal sync cannot invent editorial metadata for unknown files.
3. Export a same-origin credits page under presentation/ and link it from the
   app. Show source file, rights basis and owner attribution; include removal
   contact through the maintainer's GitHub profile. Credits participate in the
   immutable site bundle. Add HTML escaping and actual media/export checks.
4. Audit current/historical source identity pages and preferred profile files;
   pin actual image bytes and source revisions in the reviewed manifest. Keep
   absent/ambiguous images as fallback with an explicit inventory. Update the
   reviewed T1 acceptance image only after verifying its exact bytes. Retain
   historical SKT's own logo. Commit verified code and reviewed asset stages.
5. Run focused tests, build/lint, database integration and GitHub CI. Merge the
   reviewed change through the protected PR path, dispatch media publication,
   verify checkpoint lineage, same-origin decoded pictures, mobile/desktop
   framing and PNG/ZIP content. Record actual coverage and release evidence.

Scope/retirement: UUID facts, public IDs, scoring and coverage remain unchanged;
replace only the exclusive licensed-only gate with a typed reviewed alternative.
Generated images remain for absent/unreviewed files; old checkpoints and Docker
recovery volumes remain intact. Reject arbitrary hotlinks, invented license or
artist values, automatic acceptance of changed file bytes, and modern-logo
  assignment to an unrelated historical era.

Stage 1 verification: build and lint passed; 182 sync tests, 29 focused media/
credits/publication tests and three PostgreSQL media/composition integration
tests passed. The 72-test integration run passed before the separate media-mode
addition. Later broad local reruns hit filesystem/query-plan timeouts under
parallel audit work; these are not recorded as a full pass. GitHub CI must run
the complete suite before merge. Migrations 011/012 preserve rights evidence and
media-run history by refusing lossy downgrades. Media mode does not check facts
mapping or mark current/history coverage as freshly observed.

Audit transport refinement: prefer the MediaWiki-provided 512px thumbnail URL,
fixed to original file format. Store the upstream original SHA-1 separately
from the delivered image SHA-256 and explicitly label the thumbnail variant.
Do not compare a derivative's bytes to the original checksum or claim they are
the same file. This keeps published pictures bounded without losing provenance.

Stage 2 source review completed on 2026-10-04: 683 checksum-pinned files bind
to 579 players, all 99 canonical teams and all 104 historical eras. Total
delivered image bytes: 112,268,780. `media-inventory.json` records the 22 players
without an exact profile binding. Cargo numeric IDs 369/957 are normalized only
for profile matching. Team display-name/source-page differences require an exact
recorded alias; no broad fuzzy matching or player-identity merge is introduced.
Faker, current T1 and historical SKT were visually reviewed separately. The T1
acceptance preference pins PNG checksum
`fa41e6a553710ceece948001a8cb691f4b2b17357ac93e301630821564828585` while preserving
the archived generated-avatar expectation.

Local media-only composition restored checkpoint 3 and used the audited cache
as transport input; it published all 782 owner assignments and exported public
SQLite. Before/after hashes were identical for 1,066 series, 1,664 games, 16,640
game-player rows, entities/aliases, public IDs, eras, and coverage. Fact sync
health and scope checked-at times were identical. Evidence:
`/tmp/riftversus-media-local/verification.json`. This is cache-transport evidence;
the normal GitHub publication must independently download and verify the pins.

Fresh verification after the matching corrections: build/lint and the full
unit/workspace suite passed, including 183 sync tests. The PostgreSQL integration
suite passed 72 tests with one checkpoint test skipped because its dedicated
database environment variables were absent locally. The final PR CI enables
those databases and must pass before merge. Final hosted release remains pending.

Final provenance refinement: small image thumbnail URLs can equal the original
URL, and the CDN can re-encode images even with `format=original`. Classify a
scaled API URL as `thumbnail`; classify matching source SHA-1 bytes as `original`;
otherwise explicitly use `cdn-render`. All variants retain the exact reviewed
delivered SHA-256 and separate upstream original SHA-1. This does not weaken the
publication pin or invent an original-file verification claim.

Remote publication 37157431438 failed closed at media retention: the third
reviewed image (100 Thieves logo) did not pass its checksum. Checkpoint 3 and
the deployed site remained unchanged. The private attempt archive was downloaded
and its ZIP checksum verified; a separate restored failure database recorded
`Reviewed media rights or image checksum is invalid.` Only the first two image
objects had been retained. No checksum expectation was relaxed.

The release input is now the exact already-reviewed bytes in an immutable private
GitHub `media-reviewed-<bundle-sha256>` Release. The existing authenticated
ReleaseStore verifies the bounded archive, and media-archive.ts verifies exact
file inventory, individual size/SHA-256 and capacity. media-service.ts requires
this archive; its CDN deployment downloader is removed. The audit downloader
still discovers/obtains upstream assets for review. Source URLs, revisions and
rights evidence remain Leaguepedia provenance. scripts/pack-reviewed-media.mjs
mechanically packs existing reviewed cache bytes and emits the pinned manifest.
Add altered-file, mutable/draft-release, unexpected-entry and size/capacity tests,
then pass full CI before a new normal media publication and hosted verification.

The 112,413,604-byte media ZIP was uploaded as a draft, downloaded back and
verified against SHA-256
`1b9a558de546b58a9448bc9ddca3162cbf13fe43eae185a6ba8a065724795407`, then published;
GitHub API confirmed `draft: false, immutable: true`. The archive-based local
composition independently verified all 683 files from those downloaded bytes,
published 782 owners and exported SQLite, with zero CDN fetches. All preserved
table hashes and fact health again matched checkpoint 3. Evidence:
`/tmp/riftversus-media-local/archive-verification.json`. Build/lint and all 158
data tests passed before the immutable-transport commit; remote CI and hosted
release gates remain required.
