import type { Kysely } from "kysely";

import type { Database } from "../types.js";
import type { MediaAsset } from "./types.js";
import { sql } from "kysely";
import { latestPublicationGeneration } from "./publication.js";

export async function getMediaByKey(key: string, db: Kysely<Database>): Promise<MediaAsset | null> {
  const row = await db.selectFrom("media_assets as media").innerJoin("media_objects as object", "object.object_key", "media.object_key").select(["media.object_key", "media.source_url", "object.content_type", "media.entity_id", "media.team_era_id"])
    .where("media.object_key", "=", key)
    .where(sql<boolean>`(
      exists (select 1 from series_facts series where series.publication_generation <= ${latestPublicationGeneration} and (series.retired_generation is null or series.retired_generation > ${latestPublicationGeneration}) and (media.entity_id in (series.side_a_team_id, series.side_b_team_id, series.side_a_region_id, series.side_b_region_id) or media.team_era_id in (series.side_a_era_id, series.side_b_era_id)))
      or exists (select 1 from game_players player join game_facts game on game.id = player.game_id where game.publication_generation <= ${latestPublicationGeneration} and (game.retired_generation is null or game.retired_generation > ${latestPublicationGeneration}) and media.entity_id = player.player_entity_id)
    )`)
    .executeTakeFirst();
  return row === undefined ? null : { objectKey: row.object_key, sourceUrl: row.source_url, contentType: row.content_type, entityId: row.entity_id, teamEraId: row.team_era_id };
}
