# Leaguepedia Real Media Follow-Up

Date: 2026-10-04
Status: source audit complete; publication policy decision pending.
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
