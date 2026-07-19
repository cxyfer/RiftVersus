import { Buffer } from "node:buffer";

import { sql } from "kysely";
import type { Kysely } from "kysely";

import type { ComparisonQuery, ComparisonResponse, ResolvedSubject, SubjectRef } from "@riftversus/contracts";

import type { Database } from "../types.js";
import { getDatasetStatus } from "./dataset.js";
import { latestPublicationGeneration, publishedEntityVisibility } from "./publication.js";
import { entityPresentation, presentationImageUrl } from "./presentation.js";

type Side = "a" | "b";
type PresentedSubject = ResolvedSubject & { mediaUrl: string };

interface SummaryCandidateRow {
  id: string;
  played_at: Date;
  tournament_id: string;
  tournament_name: string;
  category: "league" | "fst" | "msi" | "worlds" | "other";
  best_of: 1 | 3 | 5;
  side_a_team_id: string;
  side_a_era_id: string | null;
  side_a_region_id: string | null;
  side_b_team_id: string;
  side_b_era_id: string | null;
  side_b_region_id: string | null;
  side_a_score: number;
  side_b_score: number;
  winner_team_id: string;
}

interface CandidateRow extends SummaryCandidateRow {
  side_a_team_name: string;
  side_b_team_name: string;
}

interface DirectGameRow { id: string; series_id: string; played_at: Date; winner_team_id: string | null; left_team_id: string; }

function sideMatch(subject: SubjectRef, alias: "s" | "g", side: Side) {
  const team = sql.ref(`${alias}.side_${side}_team_id`);
  const era = sql.ref(`${alias}.side_${side}_era_id`);
  const region = sql.ref(`${alias}.side_${side}_region_id`);
  if (subject.kind === "team") return sql<boolean>`(${team} = ${subject.id} and (${subject.teamEraId === undefined} or ${era} = ${subject.teamEraId ?? null}))`;
  if (subject.kind === "region") return sql<boolean>`${region} = ${subject.id}`;
  return sql<boolean>`exists (select 1 from game_players player where player.game_id = ${sql.ref(`${alias}.id`)} and player.player_entity_id = ${subject.id} and player.side = ${side})`;
}

function assignment(left: SubjectRef, right: SubjectRef, alias: "s" | "g") {
  const leftA = sideMatch(left, alias, "a");
  const leftB = sideMatch(left, alias, "b");
  const rightA = sideMatch(right, alias, "a");
  const rightB = sideMatch(right, alias, "b");
  return sql<boolean>`((${leftA} and ${rightB}) or (${leftB} and ${rightA}))`;
}

function decodeCursor(cursor: string | undefined): { playedAt: string; id: string } | null {
  if (cursor === undefined) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value === "object" && value !== null && "playedAt" in value && "id" in value
      && typeof value.playedAt === "string" && typeof value.id === "string" && !Number.isNaN(Date.parse(value.playedAt))
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)) return { playedAt: new Date(value.playedAt).toISOString(), id: value.id };
  } catch { /* Fall through to a stable boundary error. */ }
  throw new Error("Invalid comparison cursor.");
}

function encodeCursor(row: CandidateRow): string {
  return Buffer.from(JSON.stringify({ playedAt: row.played_at.toISOString(), id: row.id })).toString("base64url");
}

async function resolveSubject(subject: SubjectRef, db: Kysely<Database>): Promise<PresentedSubject> {
  const row = await db.selectFrom("entities as entity")
    .leftJoin("team_eras as era", (join) => subject.teamEraId === undefined
      ? join.on("era.team_entity_id", "=", subject.id).on("era.id", "=", sql.lit(null))
      : join.on("era.id", "=", subject.teamEraId))
    .leftJoin("media_assets as media", (join) => subject.teamEraId === undefined
      ? join.onRef("media.entity_id", "=", "entity.id").on("media.is_current", "=", true)
      : join.on("media.team_era_id", "=", subject.teamEraId).on("media.is_current", "=", true))
    .select(["entity.id", "entity.kind", "entity.canonical_name", "entity.player_id", "era.display_name as era_label", "media.object_key as media_key"])
    .where("entity.id", "=", subject.id)
    .where(publishedEntityVisibility(sql<string>`${subject.id}::uuid`))
    .executeTakeFirst();
  if (row === undefined || row.kind !== subject.kind) throw new Error(`Unknown ${subject.kind} subject: ${subject.id}`);
  if (subject.teamEraId !== undefined) {
    const validEra = await db.selectFrom("team_eras").select("id").where("id", "=", subject.teamEraId).where("team_entity_id", "=", subject.id).executeTakeFirst();
    if (validEra === undefined) throw new Error("Team era does not belong to the selected team.");
  }
  const presentation = entityPresentation({ kind: row.kind, canonicalName: row.canonical_name, playerId: row.player_id });
  return {
    kind: subject.kind, id: subject.id, ...presentation, displayName: row.era_label ?? presentation.displayName,
    ...(subject.teamEraId === undefined ? {} : { teamEraId: subject.teamEraId, eraLabel: row.era_label ?? row.canonical_name }),
    mediaUrl: presentationImageUrl({ kind: subject.kind, entityId: subject.id, retainedObjectKey: row.media_key }),
  };
}

function record(outcomes: readonly ("left" | "right")[]) {
  const wins = outcomes.filter((outcome) => outcome === "left").length;
  const losses = outcomes.length - wins;
  return { wins, losses, total: outcomes.length, winRate: outcomes.length === 0 ? 0 : wins / outcomes.length };
}

/** Internal SQL owner shared by repository execution and integration plan checks. */
export function buildComparisonQueryPlan(query: ComparisonQuery) {
  const candidateAssignment = assignment(query.left, query.right, "s");
  const directAssignment = assignment(query.left, query.right, "g");
  const requiresDirectGame = query.left.kind === "player" || query.right.kind === "player";
  const candidateMatch = requiresDirectGame ? sql<boolean>`exists (select 1 from game_facts g where g.series_id = s.id and ${directAssignment})` : candidateAssignment;
  const cursor = decodeCursor(query.cursor);
  const filters = [
    sql<boolean>`s.publication_generation <= ${latestPublicationGeneration} and (s.retired_generation is null or s.retired_generation > ${latestPublicationGeneration}) and s.completed = true and s.winner_team_id is not null and s.side_a_score is not null and s.side_b_score is not null`, candidateMatch,
    query.from === undefined ? sql<boolean>`true` : sql<boolean>`s.played_at::date >= ${query.from}`,
    query.to === undefined ? sql<boolean>`true` : sql<boolean>`s.played_at::date <= ${query.to}`,
    query.eventCategories.length === 0 ? sql<boolean>`true` : sql<boolean>`t.category = any(${sql.val(query.eventCategories)}::text[])`,
    query.leagues.length === 0 ? sql<boolean>`true` : sql<boolean>`t.league_slug = any(${sql.val(query.leagues)}::text[])`,
    query.bestOf.length === 0 ? sql<boolean>`true` : sql<boolean>`s.best_of = any(${sql.val(query.bestOf)}::smallint[])`,
    query.tournamentIds.length === 0 ? sql<boolean>`true` : sql<boolean>`s.tournament_id = any(${sql.val(query.tournamentIds)}::uuid[])`,
    cursor === null ? sql<boolean>`true` : sql<boolean>`(s.played_at, s.id) < (${cursor.playedAt}::timestamptz, ${cursor.id}::uuid)`,
  ];
  const summaryFilters = filters.slice(0, 8);
  if (!requiresDirectGame) {
    const candidateSql = sql<CandidateRow>`with candidate_series as (select s.id, s.played_at, s.tournament_id, t.name as tournament_name, t.category, s.best_of, s.side_a_team_id, s.side_a_era_id, s.side_a_region_id, s.side_b_team_id, s.side_b_era_id, s.side_b_region_id, s.side_a_score, s.side_b_score, s.winner_team_id, coalesce(side_a_era.display_name, side_a_team.canonical_name) as side_a_team_name, coalesce(side_b_era.display_name, side_b_team.canonical_name) as side_b_team_name from series_facts s join tournaments t on t.id = s.tournament_id join entities side_a_team on side_a_team.id = s.side_a_team_id join entities side_b_team on side_b_team.id = s.side_b_team_id left join team_eras side_a_era on side_a_era.id = s.side_a_era_id and side_a_era.team_entity_id = s.side_a_team_id left join team_eras side_b_era on side_b_era.id = s.side_b_era_id and side_b_era.team_entity_id = s.side_b_team_id where ${sql.join(filters, sql` and `)}) select * from candidate_series order by played_at desc, id desc limit ${query.limit + 1}`;
    const summarySql = sql<SummaryCandidateRow>`with candidate_series as (select s.id, s.played_at, s.tournament_id, t.name as tournament_name, t.category, s.best_of, s.side_a_team_id, s.side_a_era_id, s.side_a_region_id, s.side_b_team_id, s.side_b_era_id, s.side_b_region_id, s.side_a_score, s.side_b_score, s.winner_team_id from series_facts s join tournaments t on t.id = s.tournament_id where ${sql.join(summaryFilters, sql` and `)}) select * from candidate_series`;
    const directSql = sql<DirectGameRow>`with candidate_series as (select s.id from series_facts s join tournaments t on t.id = s.tournament_id where ${sql.join(summaryFilters, sql` and `)}), direct_games as (select distinct g.id, g.series_id, g.played_at, g.winner_team_id, case when ${sideMatch(query.left, "g", "a")} and ${sideMatch(query.right, "g", "b")} then g.side_a_team_id else g.side_b_team_id end as left_team_id from game_facts g join candidate_series candidate on candidate.id = g.series_id where g.publication_generation <= ${latestPublicationGeneration} and (g.retired_generation is null or g.retired_generation > ${latestPublicationGeneration}) and ${directAssignment}) select * from direct_games`;
    return { candidateSql, summarySql, directSql };
  }

  const participantGames = query.left.kind === "player" && query.right.kind === "player"
    ? sql`select left_player.game_id from game_players left_player join game_players right_player on right_player.game_id = left_player.game_id and right_player.side <> left_player.side where left_player.player_entity_id = ${query.left.id} and right_player.player_entity_id = ${query.right.id}`
    : query.left.kind === "player"
      ? sql`select player.game_id from game_players player where player.player_entity_id = ${query.left.id}`
      : sql`select player.game_id from game_players player where player.player_entity_id = ${query.right.id}`;
  const playerCandidateFilters = [filters[0]!, ...filters.slice(2)];
  const playerSummaryFilters = [summaryFilters[0]!, ...summaryFilters.slice(2)];
  const matchedSeries = sql`select distinct g.series_id from participant_games participant join game_facts g on g.id = participant.game_id where g.publication_generation <= ${latestPublicationGeneration} and (g.retired_generation is null or g.retired_generation > ${latestPublicationGeneration}) and ${directAssignment}`;
  const candidateSql = sql<CandidateRow>`with participant_games as materialized (${participantGames}), matched_series as materialized (${matchedSeries}), candidate_series as (select s.id, s.played_at, s.tournament_id, t.name as tournament_name, t.category, s.best_of, s.side_a_team_id, s.side_a_era_id, s.side_a_region_id, s.side_b_team_id, s.side_b_era_id, s.side_b_region_id, s.side_a_score, s.side_b_score, s.winner_team_id, coalesce(side_a_era.display_name, side_a_team.canonical_name) as side_a_team_name, coalesce(side_b_era.display_name, side_b_team.canonical_name) as side_b_team_name from matched_series matched join series_facts s on s.id = matched.series_id join tournaments t on t.id = s.tournament_id join entities side_a_team on side_a_team.id = s.side_a_team_id join entities side_b_team on side_b_team.id = s.side_b_team_id left join team_eras side_a_era on side_a_era.id = s.side_a_era_id and side_a_era.team_entity_id = s.side_a_team_id left join team_eras side_b_era on side_b_era.id = s.side_b_era_id and side_b_era.team_entity_id = s.side_b_team_id where ${sql.join(playerCandidateFilters, sql` and `)}) select * from candidate_series order by played_at desc, id desc limit ${query.limit + 1}`;
  const summarySql = sql<SummaryCandidateRow>`with participant_games as materialized (${participantGames}), matched_series as materialized (${matchedSeries}), candidate_series as (select s.id, s.played_at, s.tournament_id, t.name as tournament_name, t.category, s.best_of, s.side_a_team_id, s.side_a_era_id, s.side_a_region_id, s.side_b_team_id, s.side_b_era_id, s.side_b_region_id, s.side_a_score, s.side_b_score, s.winner_team_id from matched_series matched join series_facts s on s.id = matched.series_id join tournaments t on t.id = s.tournament_id where ${sql.join(playerSummaryFilters, sql` and `)}) select * from candidate_series`;
  const directSql = sql<DirectGameRow>`with participant_games as materialized (${participantGames}), matched_series as materialized (${matchedSeries}), candidate_series as (select s.id from matched_series matched join series_facts s on s.id = matched.series_id join tournaments t on t.id = s.tournament_id where ${sql.join(playerSummaryFilters, sql` and `)}), direct_games as (select distinct g.id, g.series_id, g.played_at, g.winner_team_id, case when ${sideMatch(query.left, "g", "a")} and ${sideMatch(query.right, "g", "b")} then g.side_a_team_id else g.side_b_team_id end as left_team_id from participant_games participant join game_facts g on g.id = participant.game_id join candidate_series candidate on candidate.id = g.series_id where g.publication_generation <= ${latestPublicationGeneration} and (g.retired_generation is null or g.retired_generation > ${latestPublicationGeneration}) and ${directAssignment}) select * from direct_games`;
  return { candidateSql, summarySql, directSql };
}

/**
 * The CTEs are deliberately split: candidate_series owns series-level filters,
 * while direct_games enforces game-time player membership before aggregation.
 */
export async function compareHeadToHead(query: ComparisonQuery, db: Kysely<Database>): Promise<ComparisonResponse> {
  const { candidateSql, summarySql, directSql } = buildComparisonQueryPlan(query);
  /*
    with candidate_series as (
      select s.id, s.played_at, s.tournament_id, t.name as tournament_name, t.category, s.best_of,
        s.side_a_team_id, s.side_a_era_id, s.side_a_region_id, s.side_b_team_id, s.side_b_era_id, s.side_b_region_id,
        s.side_a_score, s.side_b_score, s.winner_team_id
      from series_facts s join tournaments t on t.id = s.tournament_id
      where ${sql.join(filters, sql` and `)}
    ) select * from candidate_series order by played_at desc, id desc limit ${query.limit + 1}`;
  */ const candidates = (await candidateSql.execute(db)).rows;
  const page = candidates.slice(0, query.limit);
  /* const summarySql = sql<CandidateRow>`
    with candidate_series as (
      select s.id, s.played_at, s.tournament_id, t.name as tournament_name, t.category, s.best_of,
        s.side_a_team_id, s.side_a_era_id, s.side_a_region_id, s.side_b_team_id, s.side_b_era_id, s.side_b_region_id,
        s.side_a_score, s.side_b_score, s.winner_team_id
      from series_facts s join tournaments t on t.id = s.tournament_id
      where ${sql.join(summaryFilters, sql` and `)}
    ) select * from candidate_series`;
  */ const summaryCandidates = (await summarySql.execute(db)).rows;
  /* const directSql = sql<DirectGameRow>`
    with candidate_series as (
      select s.id from series_facts s join tournaments t on t.id = s.tournament_id
      where ${sql.join(summaryFilters, sql` and `)}
    ), direct_games as (
      select distinct g.id, g.series_id, g.played_at, g.winner_team_id,
        case when ${sideMatch(query.left, "g", "a")} and ${sideMatch(query.right, "g", "b")} then g.side_a_team_id else g.side_b_team_id end as left_team_id
      from game_facts g join candidate_series candidate on candidate.id = g.series_id
      where g.publication_generation <= ${latestPublicationGeneration} and ${directAssignment}
    ) select * from direct_games`;
  */ const directGames = (await directSql.execute(db)).rows;
  const directBySeries = new Map<string, DirectGameRow[]>();
  for (const game of directGames) directBySeries.set(game.series_id, [...(directBySeries.get(game.series_id) ?? []), game]);
  const seriesOutcomes: Array<"left" | "right"> = [];
  for (const candidate of summaryCandidates) {
    const leftTeam = query.left.kind === "team" ? candidate.side_a_team_id === query.left.id && (query.left.teamEraId === undefined || candidate.side_a_era_id === query.left.teamEraId) ? candidate.side_a_team_id : candidate.side_b_team_id === query.left.id && (query.left.teamEraId === undefined || candidate.side_b_era_id === query.left.teamEraId) ? candidate.side_b_team_id : null
      : query.left.kind === "region" ? candidate.side_a_region_id === query.left.id ? candidate.side_a_team_id : candidate.side_b_region_id === query.left.id ? candidate.side_b_team_id : null
      : directBySeries.get(candidate.id)?.sort((a, b) => a.played_at.getTime() - b.played_at.getTime() || a.id.localeCompare(b.id))[0]?.left_team_id ?? null;
    if (leftTeam !== null) seriesOutcomes.push(candidate.winner_team_id === leftTeam ? "left" : "right");
  }
  const gameOutcomes = directGames.flatMap((game) => game.winner_team_id === null ? [] : [game.winner_team_id === game.left_team_id ? "left" as const : "right" as const]);
  const [left, right, status] = await Promise.all([resolveSubject(query.left, db), resolveSubject(query.right, db), getDatasetStatus(db)]);
  return {
    subjects: { left, right }, query, seriesSummary: record(seriesOutcomes), gameSummary: record(gameOutcomes),
    rows: page.map((candidate) => {
      const leftSide = query.left.kind === "team"
        ? candidate.side_a_team_id === query.left.id && (query.left.teamEraId === undefined || candidate.side_a_era_id === query.left.teamEraId) ? "a" : "b"
        : query.left.kind === "region" ? candidate.side_a_region_id === query.left.id ? "a" : "b"
        : candidate.side_a_team_id === (directBySeries.get(candidate.id)?.sort((a, b) => a.played_at.getTime() - b.played_at.getTime() || a.id.localeCompare(b.id))[0]?.left_team_id) ? "a" : "b";
      const leftName = leftSide === "a" ? candidate.side_a_team_name : candidate.side_b_team_name;
      const rightName = leftSide === "a" ? candidate.side_b_team_name : candidate.side_a_team_name;
      return {
        id: candidate.id, date: candidate.played_at.toISOString().slice(0, 10),
        event: { id: candidate.tournament_id, name: candidate.tournament_name, category: candidate.category }, bestOf: candidate.best_of,
        leftName, rightName,
        leftScore: leftSide === "a" ? candidate.side_a_score : candidate.side_b_score,
        rightScore: leftSide === "a" ? candidate.side_b_score : candidate.side_a_score,
        winner: candidate.winner_team_id === (leftSide === "a" ? candidate.side_a_team_id : candidate.side_b_team_id) ? "left" as const : "right" as const,
      };
    }),
    ...(candidates.length > query.limit ? { nextCursor: encodeCursor(page.at(-1)!) } : {}),
    dataset: status === null ? { version: "unpublished", lastSuccessfulSyncAt: new Date(0).toISOString(), coverage: { from: "1970-01-01", to: "1970-01-01" } } : {
      version: status.version, lastSuccessfulSyncAt: status.lastSuccessfulSyncAt, coverage: status.coverage,
    },
    coverageWarnings: status === null ? [{ code: "NO_PUBLISHED_DATASET", message: "No published dataset is available yet." }]
      : status.coverageStatus.filter((coverage) => coverage.status !== "complete").map((coverage) => ({ code: "PARTIAL_EVENT_COVERAGE", message: `${coverage.provider} ${coverage.competition} ${coverage.seasonYear} coverage is ${coverage.status}.` })),
    mediaUrls: { left: left.mediaUrl, right: right.mediaUrl },
  };
}
