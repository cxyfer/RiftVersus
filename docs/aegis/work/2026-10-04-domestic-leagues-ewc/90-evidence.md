# Domestic leagues and EWC evidence

## Source scope

- `data/leaguepedia/competition-map.json` contains reviewed exact tournament
  keys for LCK 2012-2026, LPL 2013-2026 and EWC 2024-2026.
- `data/leaguepedia/domestic-ewc-audit.json` records 152 mapped tournament
  keys and source game/date counts: LCK 6,391 games, LPL 8,822, EWC 103.
- These counts describe Leaguepedia source coverage, not successfully published
  application records.

## Historical local milestone (20/32)

- 32 year scopes were attempted; 20 passed publication after the LCK 2026 retry
  and the LPL 2014, 2018, and 2020 retries.
- Published: LCK 2015-2022 and 2024-2026; LPL 2014, 2018, 2020, and 2023-2026;
  EWC 2024 and 2026.
- Combined local preview SQLite: 5,051 series, 51,560,448 bytes,
  `sha256:464a2c4036b8fe47c889fea6c4ac77d42d22b2ccaecb2dbba1f32415b06f46df`.
- Export category counts: LCK 2,094, LPL 1,856, EWC 35, Worlds 686, MSI 380.
- T1-HLE LCK: 43 series, T1 23-20, games 63-60. The existing 2021 Worlds
  result remains available separately.
- BLG-TES LPL 2024: five series, BLG 5-0, games 13-6.
- T1-TES EWC final: 2024-07-07, T1 3:1 Top Esports.
- LCK 2026 contributed 188 series and 502 observed games to the combined
  preview; its standalone validation export includes the restored Worlds/MSI
  base. Snapshot ID:
  `sha256:cad09ffcc00cd1ff608600b607418bf4f7c32ca05a2d08f7f3070562263e8735`.
- LCK 2026 Gen.G-Dplus Kia: six series, 3-3; team game summary 8-8. The
  2026-08-01 Gen.G 0:2 Dplus Kia series is present with one observed Game row
  and `gameDetailsComplete=false`; the UI flags the missing individual detail.
- Browser DOM checks confirmed the LCK comparison, EWC final, and mobile width.
  Screenshot capture timed out during font waiting; no screenshot is claimed.

## Source closure verified 2026-10-05

All twelve previously blocked annual scopes passed strict local publication.
The durable audit is [historical-source-closure.json](../../../../data/leaguepedia/historical-source-closure.json).

| Scope | Series | Observed games |
| --- | ---: | ---: |
| EWC-2025 | 18 | 33 |
| LCK-2012 | 101 | 188 |
| LCK-2013 | 111 | 266 |
| LCK-2014 | 76 | 201 |
| LPL-2013 | 208 | 230 |
| LPL-2015 | 286 | 611 |
| LPL-2016 | 211 | 529 |
| LPL-2017 | 210 | 534 |
| LPL-2019 | 258 | 651 |
| LPL-2021 | 299 | 738 |
| LPL-2022 | 299 | 800 |
| LCK-2023 | 188 | 474 |

The exact correction owner is `source-corrections.ts`, loaded from the existing
checksummed `identities.yaml`. Its 196 rules contain 121 exact schedule aliases,
eight source-proven formats, one dated historical team label, three missing
profile/redirect rows, three actual Game 2 rows and 60 explicit roster rows.
Schedule aliases were matched by date, both redirected teams and unique series;
where source dates conflict, exact bracket position, score and winner are also
reviewed and schedule dates remain intact. Aliases select original rows, including
the swapped LPL 2013 pair. Scores are never inferred or replaced.

Twelve identity overrides cover five dated rename pairs and two distinct Luo
players. eStar→Ultra Prime, HYG→Saint, SinoDragon→Dominus, Snake→LNG and
Qiao Gu→Newbee use original historical labels and nonoverlapping team eras.
QG Reapers is a separate organization and is not merged with Qiao Gu Reapers.
The two Luo profiles have different full names and positions; no common-ID merge.
The two existing published successor UUID owners (LNG and Ultra Prime) survive.

Primary revision evidence includes:

- [Levi profile, revision 4336550](https://lol.fandom.com/wiki/Levi?oldid=4336550),
  [2012 Spring participants including DDoL](https://lol.fandom.com/wiki/Champions/2012_Season/Spring?oldid=4492838).
- [Luo Ci-Rui](https://lol.fandom.com/wiki/Luo_(Luo_Ci-Rui)?oldid=4101147),
  [Luo Yin Peng](https://lol.fandom.com/wiki/Luo_(Yin_Peng)?oldid=4101149).
- [LCK 2023 Week 5](https://lol.fandom.com/wiki/LCK/2023_Season/Spring_Season/Scoreboards/Week_5?oldid=4538200),
  [Week 6](https://lol.fandom.com/wiki/LCK/2023_Season/Spring_Season/Scoreboards/Week_6?oldid=4538201),
  [Week 9 part 2](https://lol.fandom.com/wiki/LCK/2023_Season/Spring_Season/Scoreboards/Week_9_(2)?oldid=4538199).
- [LPL 2013 playoffs format](https://lol.fandom.com/wiki/LPL/2013_Season/Spring_Playoffs?oldid=4339219).
  All format, alias and rename evidence URLs are indexed in the durable JSON/rules.

The three restored Game 2 records are KT/DRX on February 15, NS/Gen.G on February
22, and KDF/KT on March 17. Keys use `scoreboard-rpgid:` plus the official observed
RPGID, not a guessed Cargo GameId. Dates/timestamps, winner and ten explicit
player links are extracted from the primary scoreboard, verified against the
observed Game 1. Real empty bounded roster queries and primary wikitext envelopes
are retained. Supplements require the observed same-MatchId/Tournament anchor;
source-native rows for the same game number prevent duplicates after upstream
repair. Missing declared query scopes still fail; a successfully queried empty
roster is partial unless independently reviewed source rows resolve it.

## Final local snapshot and limits

- Snapshot: `sha256:5b108aa7772caa7384a6809f6362e9849f795393acd74f4b5202ee43a4d43f2b`.
- SQLite: `24dfa7c26851ee16c6620d37450f8d224ee323367baa4db263eef36f177bd474`, 73,867,264 bytes.
- All 32 requested mapped annual scopes complete; 7,316 series, 1,787 entity/era
  variants: LCK 2,570, LPL 3,627, EWC 53, Worlds 686, MSI 380.
- Merged with the complete old base, never a standalone domestic replacement.
- Ten real SQLite team comparisons pass, including T1/HLE 2023 (four results)
  and 2026 (eight), early LCK/LPL, canonical LNG with historical Snake rows,
  canonical Ultra Prime with historical eStar rows and EWC 2025 Gen.G/AL.
- Chovy/FIESTA February 22, 2023 now has one series and two played games,
  `gameDetailsComplete=true`, proving recovered Game 2 and player membership.
- Seven real browser comparisons pass; mobile 390px has no horizontal overflow.
  Browser preview reads the final snapshot at http://127.0.0.1:4187/RiftVersus/.
- A single actual detail gap remains: Gen.G 0:2 Dplus Kia, August 1, 2026;
  The [primary Week 10 scoreboard, revision 4501210](https://lol.fandom.com/wiki/LCK/2026_Season/Rounds_3-4/Scoreboards/Week_10_(2)?oldid=4501210)
  explicitly labels Game 1 `Game Data not available.`; it has no actual RPGID
  or roster, only a result placeholder. Game 2 has RPGID LOLTMNT02_444730.
  Rechecked live Cargo still contains only Game 2. The placeholder time is
  insufficient proof of actual game start, so Game 1 remains incomplete.
- Fourteen other `gameDetailsComplete=false` rows are source-confirmed awarded
  starts: China regional final 2013, LPL summer final 2014, and first playoff
  rounds in LPL 2016-2018. Awarded initial wins are not played game rows.
  Existing UI marks these score/game-count differences as incomplete detail;
  this work does not redesign weighted-score presentation or player semantics.
- Bounded mapped-source completeness does not establish exhaustive official
  historical coverage. No production data checkpoint or Pages deployment occurs.

Local artifacts: `/tmp/riftversus-source-closure/{retry-results.json,
query-evidence.json,browser-evidence.json,inputs/,export-v2/,combined-final/}`;
immutable source store `/tmp/riftversus-leagues-objects`. Retained previous
snapshots remain available. These /tmp artifacts are session-local evidence,
not a durable GitHub checkpoint. The committed corrections/audit carry source
URLs, revision IDs, checksum provenance and exact reviewed facts for repeat import.

## Verification and structural receipt

- `pnpm typecheck`, `pnpm lint`, `pnpm test:consumer` pass.
- Root unit: 68; contracts: 15; domain: 42; sync: 208; data: 161; web: 81 pass.
- PostgreSQL integration: 77 pass, one pre-existing skipped test.
- `verifyPublicSnapshot`, actual SQLite comparisons and browser checks pass.
- `git diff --check` passes. Workspace bundle/check validate structure only.
- Existing Leaguepedia publisher/normalizer remain owners. No alternate source,
  browser source fetch, duplicate writer or persistent data deletion.
- ADR-0001 is amended; SQLite baseline and source contract are updated.
- Complexity remains in one small projection module and reviewed data rules;
  retained source workarounds retire when exact upstream repair is verified.
- Git closeout is authorized by the user's later commit/push instruction.
  The unrelated `.gitignore` edit is excluded.

## EvidenceBundleDraft

- Artifact key: historical-source-closure
- Type: local-publication-and-query
- Source: data/leaguepedia/historical-source-closure.json
- Summary: 32 mapped annual scopes accepted; 7,316 merged series; reviewed primary sources; SQLite and browser verification recorded in 90-evidence.md.
- Verifier: Strict Leaguepedia publication, verifyPublicSnapshot, real SQLite comparisons, Playwright and repository tests
