# Execution checkpoint

Implemented: reviewed map/audit; BO2, EWC and league contracts; migration 013;
sync/query/UI/export changes; 161 data tests, 42 domain, 192 sync, 15 contracts,
81 web, 77 PostgreSQL integration tests; typecheck; isolated checkpoint
restore; real imports, SQLite queries and local browser checks.
Thirty-two year scopes were audited; twenty published locally after retries.
This is partial data coverage, not completion of the all-years request. The
initial strict import and retry results are in
/tmp/riftversus-leagues-live-evidence/results.json and `retries.json`.
Published scopes: LCK 2015-2022 and 2024-2026; LPL 2014, 2018, 2020, and
2023-2026; EWC 2024 and 2026. T1-HLE LCK has 43 results; original Worlds row is
retained. Combined preview counts: LCK 2,094, LPL 1,856, EWC 35; Worlds/MSI
unchanged at 686/380.
SQLite query evidence: /tmp/riftversus-leagues-live-evidence/query-evidence.json;
browser DOM evidence: /tmp/riftversus-leagues-live-evidence/browser/evidence.json.
Browser checks verified T1-HLE LCK, the EWC final, LPL 2014/2018/2020, and mobile width; screenshots
timed out while waiting for fonts. Twelve scopes remain blocked: LCK 2012-2014,
2023; LPL 2013, 2015-2017, 2019, and 2021-2022; EWC 2025. LCK 2026 had a
Leaguepedia case where
MatchSchedule reports Gen.G 0:2 Dplus Kia but ScoreboardGames only contains
Game 2. Import now preserves the series result, labels partial game detail, and
derives team game totals from MatchSchedule. Failures in the other scopes
include missing or contradictory source rows, unresolved player/team identities,
and incomplete historical dimensions. Do not mark those scopes complete or
publish a checkpoint.
Typecheck/lint, full unit tests and PostgreSQL integration pass; map-indexed
files validate. The Aegis index now includes the pre-existing media follow-up.
The final preview remains at http://127.0.0.1:4187/RiftVersus/.
Drift: one shared Leaguepedia publisher remains owner; no alternate source or
data truth. No production archive, Pages deployment, commit or push occurred.
