# Domestic leagues and EWC reflection

The implementation now understands LCK, LPL, EWC, BO2 results, and draws across
the reviewed import, storage, query, export, and UI paths. Real Leaguepedia
imports verified T1-HLE LCK, T1-TES EWC, and the LCK 2026 schedule.

The user's all-historical-years preference is not fully satisfied: 20 of 32 year
scopes passed publication. The user approved publishing the LCK 2026 series with
an explicit incomplete-game-detail marker. LCK 2026 contains one source result with incomplete
individual-game detail. The series result remains authoritative, team game
totals use that final score, and comparison rows identify incomplete game
detail; player-level comparisons remain limited to observed roster rows.
LPL 2014, 2018, and 2020 were subsequently imported after source-backed
validation (the 2020 retry only normalized a case-only tournament key). Twelve
scopes still need their source gaps and identity conflicts resolved before
claiming full historical coverage.

No production data was changed. The unrelated `.gitignore` modification was
preserved. Future import work should keep the all-scope completeness gate and
add source-specific normalization or reviewed identity mappings only where the
underlying Leaguepedia evidence supports them.
