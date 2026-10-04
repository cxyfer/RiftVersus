# Historical domestic leagues and EWC

User request: add LPL, LCK and EWC; user selected all historical years.
Plan: ../../plans/2026-10-04-domestic-leagues-ewc.md.
Baseline read: README, source-and-attribution, GitHub publishing, 2026-10-03
SQLite baseline. Existing architecture preserved; extended format/outcome
contracts are necessary for source-observed BO2 1:1 series.
Owners: contracts/sync/database/domain/web, existing one-shot publisher.
Scope fence: first-division official seasons and qualifying regional finals,
EWC main tournaments; no academy/exhibition/promotion or alternate providers.
Evidence required: exact Cargo keys/date spans, parser regression, actual
publication and SQLite queries, integration constraints and web draw display.
Unrelated .gitignore edit is preserved. Git commit/push is outside this request.
