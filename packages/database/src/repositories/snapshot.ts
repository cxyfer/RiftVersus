import { sql, type Kysely } from "kysely";
import { MediaRightsBasisSchema, validMediaRights } from "@riftversus/contracts";
import type { PublicSnapshot, SnapshotEntity, SnapshotGame, SnapshotSeries, SnapshotSide } from "@riftversus/contracts";
import type { Database } from "../types.js";
import { getDatasetStatus } from "./dataset.js";
import { getSyncStatus } from "./sync-status.js";
import { latestPublicationGeneration, publishedEntityVisibility } from "./publication.js";
import { entityPresentation, presentationImageUrl } from "./presentation.js";
import { ensurePublicIds } from "./public-ids.js";

export type SnapshotProjection = Omit<PublicSnapshot, "snapshotId">;

export async function exportSnapshotFacts(database: Kysely<Database>): Promise<SnapshotProjection> {
  return database.transaction().setIsolationLevel("repeatable read").execute(async db => {
    await ensurePublicIds(db);
    const publicIds = await db.selectFrom("entity_public_ids").selectAll().execute();
    const publicEras = await db.selectFrom("team_era_public_ids").selectAll().execute();
    const publicByEntity = new Map(publicIds.map(item => [item.entity_id, item.public_id]));
    const publicByEra = new Map(publicEras.map(item => [item.team_era_id, item.public_id]));
    const dataset = await getDatasetStatus(db);
    if (dataset === null) throw new Error("Cannot export an unpublished dataset.");
    const entities = await db.selectFrom("entities as e").selectAll("e").where(publishedEntityVisibility(sql.ref("e.id"))).orderBy("e.id").execute();
    const [eras, aliases, media, series, games, players, tournaments, health] = await Promise.all([
      db.selectFrom("team_eras").selectAll().orderBy("id").execute(),
      db.selectFrom("entity_aliases").selectAll().where("searchable", "=", true).orderBy("id").execute(),
      db.selectFrom("media_assets").selectAll().where("is_current", "=", true).orderBy("id").execute(),
      db.selectFrom("series_facts").selectAll().where("publication_generation", "<=", latestPublicationGeneration)
        .where(sql<boolean>`(retired_generation is null or retired_generation > ${latestPublicationGeneration})`)
        .where("completed", "=", true).where("side_a_score", "is not", null).where("side_b_score", "is not", null).orderBy("id").execute(),
      db.selectFrom("game_facts").selectAll().where("publication_generation", "<=", latestPublicationGeneration)
        .where(sql<boolean>`(retired_generation is null or retired_generation > ${latestPublicationGeneration})`).orderBy("played_at").orderBy("id").execute(),
      db.selectFrom("game_players").selectAll().orderBy("game_id").orderBy("player_entity_id").execute(),
      db.selectFrom("tournaments").selectAll().orderBy("id").execute(),
      getSyncStatus(db),
    ]);
    const entityById = new Map(entities.map(entity => [entity.id, entity]));
    const eraById = new Map(eras.map(era => [era.id, era]));
    const tournamentById = new Map(tournaments.map(tournament => [tournament.id, tournament]));
    const roster = new Map<string, { a: string[]; b: string[] }>();
    for (const player of players) {
      const entry = roster.get(player.game_id) ?? { a: [], b: [] };
      entry[player.side].push(player.player_entity_id); roster.set(player.game_id, entry);
    }
    const rows: SnapshotEntity[] = [];
    for (const entity of entities) {
      const presentation = entityPresentation({ kind: entity.kind, canonicalName: entity.canonical_name, playerId: entity.player_id });
      const entityEras = entity.kind === "team" ? eras.filter(era => era.team_entity_id === entity.id) : [];
      for (const era of [null, ...entityEras]) {
        const retained = media.find(item => era === null ? item.entity_id === entity.id && item.team_era_id === null : item.team_era_id === era.id);
        if (retained && !validMediaRights({ license: retained.license, attribution: retained.attribution, rightsBasis: retained.rights_basis })) throw new Error(`Retained media lacks rights evidence: ${retained.object_key}`);
        rows.push({
          id: entity.id, kind: entity.kind, ...presentation,
          publicId: publicByEntity.get(entity.id)!,
          ...(era === null ? {} : { publicEraId: publicByEra.get(era.id)! }),
          ...(era === null ? {} : { teamEraId: era.id, eraLabel: era.display_name, displayName: era.display_name }),
          canonicalName: entity.canonical_name, slug: entity.slug,
          aliases: aliases.filter(alias => alias.entity_id === entity.id).map(alias => alias.display_name),
          avatarLabel: presentation.displayName, retainedObjectKey: retained?.object_key ?? null,
          mediaUrl: presentationImageUrl({ kind: entity.kind, entityId: entity.id, retainedObjectKey: retained?.object_key ?? null }),
        });
      }
    }
    const side = (teamId: string, eraId: string | null, regionId: string | null, playerIds: string[]): SnapshotSide => {
      const team = entityById.get(teamId);
      if (!team) throw new Error(`Snapshot team is not published: ${teamId}`);
      const era = eraId === null ? undefined : eraById.get(eraId);
      if (eraId !== null && (!era || era.team_entity_id !== teamId)) throw new Error(`Invalid snapshot team era: ${eraId}`);
      return { teamId, eraId, regionId, playerIds, teamName: era?.display_name ?? team.canonical_name };
    };
    const gamesBySeries = new Map<string, SnapshotGame[]>();
    const seriesIds = new Set(series.map(item => item.id));
    for (const game of games) {
      if (!seriesIds.has(game.series_id)) continue;
      const members = roster.get(game.id) ?? { a: [], b: [] };
      const item: SnapshotGame = { id: game.id, seriesId: game.series_id, playedAt: game.played_at.toISOString(), gameNumber: game.game_number,
        sides: [side(game.side_a_team_id, game.side_a_era_id, game.side_a_region_id, members.a), side(game.side_b_team_id, game.side_b_era_id, game.side_b_region_id, members.b)],
        winnerSide: game.winner_team_id === null ? null : game.winner_team_id === game.side_a_team_id ? "a" : "b" };
      const list = gamesBySeries.get(game.series_id) ?? []; list.push(item); gamesBySeries.set(game.series_id, list);
    }
    const publicSeries: SnapshotSeries[] = series.map(item => {
      const tournament = tournamentById.get(item.tournament_id);
      if (!tournament) throw new Error(`Missing snapshot tournament: ${item.tournament_id}`);
      return { id: item.id, playedAt: item.played_at.toISOString(), date: item.played_at.toISOString().slice(0, 10),
        tournament: { id: tournament.id, name: tournament.name, category: tournament.category, league: tournament.league_slug as SnapshotSeries["tournament"]["league"] },
        bestOf: item.best_of, sides: [side(item.side_a_team_id, item.side_a_era_id, item.side_a_region_id, []), side(item.side_b_team_id, item.side_b_era_id, item.side_b_region_id, [])],
        games: gamesBySeries.get(item.id) ?? [], completed: item.completed, winnerSide: item.winner_team_id === null ? null : item.winner_team_id === item.side_a_team_id ? "a" : "b",
        score: { a: item.side_a_score!, b: item.side_b_score! } };
    });
    return { schemaVersion: 1, dataset: { version: dataset.version, coverage: dataset.coverage,
      lastSuccessfulSyncAt: dataset.lastSuccessfulSyncAt },
      coverageWarnings: dataset.coverageStatus.filter(scope => scope.status !== "complete").map(scope => ({ code: "PARTIAL_EVENT_COVERAGE", message: `${scope.provider} ${scope.competition} ${scope.seasonYear} coverage is ${scope.status}.` })),
      entities: rows, series: publicSeries, freshness: health.scopes,
      attribution: media.filter(item => rows.some(row => row.retainedObjectKey === item.object_key &&
        (item.team_era_id === null ? row.id === item.entity_id && row.teamEraId === undefined : row.teamEraId === item.team_era_id)))
        .map(item => ({ objectKey: item.object_key, sourceUrl: item.source_url, license: item.license, attribution: item.attribution!, ...(item.rights_basis === null ? {} : { rightsBasis: MediaRightsBasisSchema.parse(item.rights_basis), ...(item.entity_id === null ? {} : { entityId: item.entity_id }), ...(item.team_era_id === null ? {} : { teamEraId: item.team_era_id }) }) })) };
  });
}
