# Execution checkpoint

Updated 2026-10-05: the original 20/32 milestone is retained in 90-evidence.md.
The remaining twelve scopes now pass strict local publication after independently
reviewed Leaguepedia source corrections. All 32 mapped annual scopes are accepted:
LCK/Champions 2012-2026, LPL 2013-2026, EWC 2024-2026.

The complete merged SQLite preview contains 7,316 series: LCK 2,570, LPL 3,627,
EWC 53, Worlds 686, MSI 380. The original Worlds/MSI and twenty accepted scopes
are preserved. Reviewed Snake/LNG and eStar/Ultra Prime lineage corrections
retain original historical team-era labels and existing successor UUID owners.
The two Luo player pages remain distinct.

One LCK 2026 Gen.G-Dplus Kia result still lacks Game 1 and remains explicitly
incomplete. Fourteen LPL rows have awarded initial wins; no fictitious games were
created. Coverage complete means the bounded mapped source rows were resolved,
not proof that the upstream archive includes every official match ever played.

Verification: sync 208, data 161, domain 42, contracts 15, web 81, root unit 68;
PostgreSQL integration 77 passed, 1 skipped; typecheck, lint, consumer build;
real SQLite verification, ten team comparisons, recovered Chovy/FIESTA roster
query, seven browser comparisons and mobile width. See 90-evidence.md and
data/leaguepedia/historical-source-closure.json for exact evidence.

Preview: http://127.0.0.1:4187/RiftVersus/.
Raw source responses and immutable snapshots are retained locally. No production
checkpoint or Pages deployment is claimed. The same one-shot publisher and
normalizer remain owners; no alternate provider or HTTP source fetch was added.
Git closeout follows the user's later commit/push instruction; .gitignore stays
outside the task commit.
