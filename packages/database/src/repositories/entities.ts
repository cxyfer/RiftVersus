import type { Kysely } from "kysely";

import type { Database } from "../types.js";
import type { EntitySearchQuery, EntitySearchResponse } from "./types.js";
import { sql } from "kysely";
import { latestPublicationGeneration } from "./publication.js";

export async function searchEntities(query: EntitySearchQuery, db: Kysely<Database>): Promise<EntitySearchResponse> {
  const term = `%${query.query.trim().toLowerCase()}%`;
  const limit = query.limit ?? 20;
  let statement = db.selectFrom("entities as entity")
    .leftJoin("team_eras as era", "era.team_entity_id", "entity.id")
    .leftJoin("media_assets as media", (join) => join.onRef("media.entity_id", "=", "entity.id").on("media.is_current", "=", true))
    .leftJoin("entity_aliases as alias", (join) => join.onRef("alias.entity_id", "=", "entity.id").on("alias.searchable", "=", true))
    .select(["entity.id", "entity.kind", "entity.canonical_name", "era.id as era_id", "era.display_name as era_label", "media.object_key as media_key"])
    .where((eb) => eb.or([eb("entity.canonical_name", "ilike", term), eb("entity.slug", "ilike", term), eb("alias.display_name", "ilike", term)]));
  statement = statement.where(sql<boolean>`(
    exists (select 1 from series_facts series where series.publication_generation <= ${latestPublicationGeneration} and entity.id in (series.side_a_team_id, series.side_b_team_id, series.side_a_region_id, series.side_b_region_id))
    or exists (select 1 from game_players player join game_facts game on game.id = player.game_id where game.publication_generation <= ${latestPublicationGeneration} and player.player_entity_id = entity.id)
  )`);
  if (query.kinds?.length) statement = statement.where("entity.kind", "in", query.kinds);
  const rows = await statement.orderBy("entity.canonical_name").limit(limit).execute();
  const seen = new Set<string>();
  return { entities: rows.flatMap((row) => {
    const key = `${row.id}:${row.era_id ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      kind: row.kind, id: row.id, displayName: row.era_label ?? row.canonical_name,
      ...(row.era_id === null ? {} : { teamEraId: row.era_id, ...(row.era_label === null ? {} : { eraLabel: row.era_label }) }),
      ...(row.media_key === null ? {} : { mediaUrl: `/media/${row.media_key}` }),
    }];
  }) };
}
