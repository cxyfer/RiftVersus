import type { Kysely } from "kysely";

import type { Database } from "../types.js";
import type { MediaAsset } from "./types.js";

export async function getMediaByKey(key: string, db: Kysely<Database>): Promise<MediaAsset | null> {
  const row = await db.selectFrom("media_assets").select(["object_key", "source_url", "content_type", "entity_id", "team_era_id"])
    .where("object_key", "=", key).executeTakeFirst();
  return row === undefined ? null : { objectKey: row.object_key, sourceUrl: row.source_url, contentType: row.content_type, entityId: row.entity_id, teamEraId: row.team_era_id };
}
