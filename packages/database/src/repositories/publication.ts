import { sql, type Expression, type RawBuilder } from "kysely";

/** Latest committed visibility generation; -1 deliberately exposes no staged facts. */
export const latestPublicationGeneration = sql<string>`coalesce((select max(generation) from dataset_versions), -1)`;

export function publishedEntityVisibility(entityId: Expression<unknown>): RawBuilder<boolean> {
  return sql<boolean>`(
    exists (select 1 from series_facts series where series.publication_generation <= ${latestPublicationGeneration} and (series.retired_generation is null or series.retired_generation > ${latestPublicationGeneration}) and ${entityId} in (series.side_a_team_id, series.side_b_team_id, series.side_a_region_id, series.side_b_region_id))
    or exists (select 1 from game_players player join game_facts game on game.id = player.game_id where game.publication_generation <= ${latestPublicationGeneration} and (game.retired_generation is null or game.retired_generation > ${latestPublicationGeneration}) and player.player_entity_id = ${entityId})
  )`;
}

export function publishedMediaVisibility(
  entityId: Expression<unknown>,
  teamEraId: Expression<unknown>,
): RawBuilder<boolean> {
  return sql<boolean>`(
    ${publishedEntityVisibility(entityId)}
    or exists (select 1 from series_facts series where series.publication_generation <= ${latestPublicationGeneration} and (series.retired_generation is null or series.retired_generation > ${latestPublicationGeneration}) and ${teamEraId} in (series.side_a_era_id, series.side_b_era_id))
  )`;
}
