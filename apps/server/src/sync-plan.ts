import type { SyncRequest } from "@riftversus/sync";
import type { Config } from "./config.js";

export function historyRequests(config: Config): Extract<SyncRequest, { mode: "backfill" }>[] {
  const cutoff = Math.min(...config.leaguepedia.syncYears);
  return Object.entries(config.leaguepedia.competitionMap).flatMap(([competition, mapping]) => {
    const years = Object.keys(mapping).map(Number).filter((year) => year < cutoff).sort((a, b) => a - b);
    const requests: Extract<SyncRequest, { mode: "backfill" }>[] = [];
    for (let offset = 0; offset < years.length; offset += 20) {
      requests.push({ mode: "backfill", competitions: [competition], years: years.slice(offset, offset + 20) });
    }
    return requests;
  });
}
