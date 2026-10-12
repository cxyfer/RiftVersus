import type { SyncRequest } from "@riftversus/sync";
import type { SyncConfig as Config } from "@riftversus/sync";

export function historyRequests(config: Config): Extract<SyncRequest, { mode: "backfill" }>[] {
  const cutoff = Math.min(...config.leaguepedia.syncYears);
  const enabled = new Set(config.leaguepedia.mappingCompetitions);
  return Object.entries(config.leaguepedia.competitionMap).filter(([competition]) => enabled.has(competition)).flatMap(([competition, mapping]) => {
    const years = Object.keys(mapping).map(Number).filter((year) => year < cutoff).sort((a, b) => a - b);
    const requests: Extract<SyncRequest, { mode: "backfill" }>[] = [];
    // Domestic/EWC scopes stay small enough for two calendar years while halving
    // repeated provider dimensions and publication setup on the weekly run.
    const batchSize = /^(LCK|LPL|EWC)$/i.test(competition) ? 2 : 20;
    for (let offset = 0; offset < years.length; offset += batchSize) {
      requests.push({ mode: "backfill", competitions: [competition], years: years.slice(offset, offset + batchSize) });
    }
    return requests;
  });
}
