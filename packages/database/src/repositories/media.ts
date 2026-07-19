import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "../types.js";
import type { MediaAsset } from "./types.js";
import { publishedMediaVisibility } from "./publication.js";

export async function getMediaByKey(key: string, db: Kysely<Database>): Promise<MediaAsset | null> {
  const row = await db.selectFrom("media_assets as media").innerJoin("media_objects as object", "object.object_key", "media.object_key").select(["media.object_key", "media.source_url", "object.content_type", "media.entity_id", "media.team_era_id"])
    .where("media.object_key", "=", key)
    .where(publishedMediaVisibility(sql.ref("media.entity_id"), sql.ref("media.team_era_id")))
    .executeTakeFirst();
  return row === undefined ? null : { objectKey: row.object_key, sourceUrl: row.source_url, contentType: row.content_type, entityId: row.entity_id, teamEraId: row.team_era_id };
}
