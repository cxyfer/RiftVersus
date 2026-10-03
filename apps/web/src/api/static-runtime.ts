import { compareSqlite, searchSqlite, resolvePublicSubject } from "@riftversus/domain";
import type { ComparisonQuery, EntityKind } from "@riftversus/contracts";

import { createSnapshotClient, type SqliteSnapshotClient } from "./snapshot-client.js";
import type { ComparisonApi, EntityOption } from "./types.js";

const kindSubtitle = { player: "選手", team: "戰隊", region: "賽區" } as const;

export function createStaticApi(snapshotClient: SqliteSnapshotClient = createSnapshotClient()): ComparisonApi {
  return {
    async resolveSubject(subject) {
      const { executor } = await snapshotClient.open();
      return resolvePublicSubject(executor, subject);
    },
    async searchEntities(query: string, kinds: EntityKind[]): Promise<EntityOption[]> {
      const { executor } = await snapshotClient.open();
      return (await searchSqlite(executor, query, kinds)).map((entity) => ({ ...entity, subtitle: kindSubtitle[entity.kind] }));
    },
    async compare(query: ComparisonQuery) {
      const { executor, manifest } = await snapshotClient.open();
      return compareSqlite(executor, query, manifest.snapshotId);
    },
  };
}

export const staticApi = createStaticApi();
export { staticApi as api };
