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
Unrelated .gitignore edit is preserved. The initial import request excluded Git closeout; the later explicit user
request to commit and push authorizes that closeout for this task.

2026-10-05 continuation: user explicitly requested researching related information,
independently judging it, and completing the blocked scopes. Apply exact reviewed
primary-source projections with immutable original evidence; preserve incomplete
details where no source-backed reconstruction is available. This grants source
research, correction implementation and isolated local import, not a Pages
production deployment or modification of unrelated edits.
