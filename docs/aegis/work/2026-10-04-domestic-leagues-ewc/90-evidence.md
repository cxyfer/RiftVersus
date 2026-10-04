# Domestic leagues and EWC evidence

## Source scope

- `data/leaguepedia/competition-map.json` contains reviewed exact tournament
  keys for LCK 2012-2026, LPL 2013-2026 and EWC 2024-2026.
- `data/leaguepedia/domestic-ewc-audit.json` records 152 mapped tournament
  keys and source game/date counts: LCK 6,391 games, LPL 8,822, EWC 103.
- These counts describe Leaguepedia source coverage, not successfully published
  application records.

## Local publication

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

## Remaining source closure

Twelve scopes remain unpublished: LCK 2012-2014 and 2023; LPL 2013, 2015-2017,
2019, and 2021-2022; EWC 2025. The strict publisher still rejects unresolved
Levi or DDoL redirects, the EStar to Ultra Prime lineage conflict, missing
MatchSchedule rows, missing ScoreboardPlayers coverage, null MatchSchedule
BestOf values, or absent retained raw sources. LPL 2020 was importable after
normalizing a case-only `ScoreboardGames.Tournament` key difference; this did
not relax score, date, identity, or completeness checks. Exact failure evidence
is in `/tmp/riftversus-leagues-live-evidence/results.json` and `retries.json`.
The remaining scopes must stay incomplete until source-backed mappings or
upstream facts are available.

## Verification

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:unit`
- Contracts, sync, domain, data, and web package test suites
- PostgreSQL integration suite: 77 passed, 1 skipped
- `git diff --check`

No production archive, Pages deployment, commit, or push occurred.
