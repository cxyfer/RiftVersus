import type { Kysely } from "kysely";

import type { Database } from "../types.js";
import type { EntitySearchQuery, EntitySearchResponse } from "./types.js";
import { sql } from "kysely";
import { publishedEntityVisibility } from "./publication.js";
import { entityPresentation, presentationImageUrl } from "./presentation.js";

export async function searchEntities(query: EntitySearchQuery, db: Kysely<Database>): Promise<EntitySearchResponse> {
  const rows = await buildEntitySearchQuery(query, db).execute();
  const seen = new Set<string>();
  return { entities: rows.flatMap((row) => {
    const key = `${row.id}:${row.era_id ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const presentation = entityPresentation({ kind: row.kind, canonicalName: row.canonical_name, playerId: row.player_id });
    return [{
      kind: row.kind, id: row.id, ...presentation, displayName: row.era_label ?? presentation.displayName,
      ...(row.era_id === null ? {} : { teamEraId: row.era_id, ...(row.era_label === null ? {} : { eraLabel: row.era_label }) }),
      mediaUrl: presentationImageUrl({ kind: row.kind, entityId: row.id, retainedObjectKey: row.media_key }),
    }];
  }) };
}

export function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/** Internal SQL owner shared by repository execution and integration plan checks. */
export function buildEntitySearchQuery(query: EntitySearchQuery, db: Kysely<Database>) {
  const term = `%${escapeLikePattern(query.query.trim().toLowerCase())}%`;
  const limit = query.limit ?? 20;
  let statement = db
    .with((cte) => cte("matched_entities").materialized(), (builder) => builder
      .selectFrom("entities as name_candidate")
      .select("name_candidate.id")
      .where("name_candidate.canonical_name", "ilike", term)
      .union(builder.selectFrom("entities as slug_candidate").select("slug_candidate.id").where("slug_candidate.slug", "ilike", term))
      .union(builder.selectFrom("entities as player_id_candidate").select("player_id_candidate.id").where("player_id_candidate.kind", "=", "player").where("player_id_candidate.player_id", "ilike", term))
      .union(builder.selectFrom("entity_aliases as alias_candidate").select("alias_candidate.entity_id as id").where("alias_candidate.searchable", "=", true).where("alias_candidate.display_name", "ilike", term)))
    .selectFrom("entities as entity")
    .innerJoin("matched_entities as matched", "matched.id", "entity.id")
    .leftJoin("team_eras as era", "era.team_entity_id", "entity.id")
    .leftJoin("media_assets as media", (join) => join
      .on("media.is_current", "=", true)
      .on(sql<boolean>`(
        (era.id is not null and media.team_era_id = era.id)
        or (era.id is null and media.entity_id = entity.id)
      )`))
    .select(["entity.id", "entity.kind", "entity.canonical_name", "entity.player_id", "era.id as era_id", "era.display_name as era_label", "media.object_key as media_key"]);
  statement = statement.where(publishedEntityVisibility(sql.ref("entity.id")));
  if (query.kinds?.length) statement = statement.where("entity.kind", "in", query.kinds);
  return statement.orderBy("entity.canonical_name").limit(limit);
}
