# Domestic leagues and EWC reflection

The all-history request is now satisfied at the reviewed Leaguepedia mapped-source
boundary: all 32 annual scopes imported locally, with 2,265 additional series and
7,316 merged series. This supersedes the historical 20/32 checkpoint.

Source review established missing profile data, precise schedule ID joins,
missing format metadata, dated team rename relationships, and distinct same-name
players. Three missing LCK 2023 Game 2 records and 60 reviewed roster rows came
from exact scoreboard wikitext, including official RPGIDs, timestamps, teams,
winners and explicit players. Existing native rows always take precedence.

Preserving immutable responses and checksumming corrections costs maintained
review rules but avoids rewriting evidence or weakening publication. The repair
uses one projection owner in the Leaguepedia provider. Retirement: remove exact
source workarounds after retained upstream evidence proves those fields/rows are
fixed; native game rows already prevent duplicate supplemental games. Unexpected
upstream changes fail closed and require review. Identity lineage is durable
historical mapping, not a temporary fetch fallback.

ADR action: amend existing ADR-0001. Reversing published source keys and identity
lineage would require coordinated re-publication; the evidence projection is
surprising without context; strict permanent rejection versus reviewed primary
source projection is a real trade-off. The current SQLite baseline is updated.
No duplicate publication owner, alternate provider, raw rewrite or schema change
was introduced by source closure. Tests exercise scope isolation, conflicts,
swapped IDs, successful empty rosters, native source recovery and live fetching.

The remaining actual missing LCK 2026 Game 1 stays explicit under prior user
approval. Fourteen weighted-score LPL results are not absent played games, though
the current comparison marker also flags them; team totals retain schedule
scores and player totals retain played roster facts. No broader scoring UI
redesign or production deployment occurred. The user's unrelated .gitignore edit
is preserved. Existing checkpoints and Worlds/MSI records were not deleted.

## Authorized alternative review — 2026-10-06

The remaining LCK 2026 Game 1 winner and ten-player roster are now recovered from
official video and first-hand reporting. This supersedes the prior unresolved
statement at the observed-game/roster boundary. Exact server start remains unknown;
only inferred broadcast-minute precision is recorded. Official video is preferred
over conflicting third-party labels or mixed Game 2 summaries. This is an explicit
user-approved, exact-key manual exception, not a scheduled alternate provider.
One retained review envelope documents provenance without forging upstream API
responses. Existing publication, scope, identity and native-source recovery owners
remain intact. Remove the temporary manual supplement after proven native repair.
No global name alias, unverified stat, production deployment or data deletion.
