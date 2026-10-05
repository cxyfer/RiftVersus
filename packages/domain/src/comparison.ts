import type { BestOf, EventCategory } from "@riftversus/contracts";

export type SideKey = "a" | "b";
export type ComparisonWinner = "left" | "right" | "draw";

export interface DomainSide {
  readonly teamId: string;
  readonly eraId: string | null;
  readonly regionId: string | null;
  readonly playerIds: readonly string[];
}

export interface DomainGame {
  readonly id: string;
  readonly seriesId: string;
  readonly playedAt: string;
  readonly gameNumber: number;
  readonly sides: readonly [DomainSide, DomainSide];
  readonly winnerSide: SideKey | null;
}

export interface DomainTournament {
  readonly id: string;
  readonly name: string;
  readonly category: EventCategory;
}

export interface DomainSeries {
  readonly id: string;
  readonly date: string;
  readonly tournament: DomainTournament;
  readonly bestOf: BestOf;
  readonly sides: readonly [DomainSide, DomainSide];
  readonly games: readonly DomainGame[];
  readonly completed: boolean;
  readonly winnerSide: SideKey | null;
  readonly score: Readonly<Record<SideKey, number>>;
}

export type ComparisonSubject =
  | { readonly kind: "player"; readonly id: string }
  | { readonly kind: "region"; readonly id: string }
  | { readonly kind: "team"; readonly id: string; readonly teamEraId?: string };

export interface ComparisonQuery {
  readonly left: ComparisonSubject;
  readonly right: ComparisonSubject;
  readonly from?: string;
  readonly to?: string;
  readonly eventCategories: readonly EventCategory[];
  readonly bestOf: readonly BestOf[];
  readonly tournamentIds: readonly string[];
  readonly cursor?: string;
  readonly limit: number;
}

export interface DirectGame {
  readonly game: DomainGame;
  readonly leftSide: SideKey;
  readonly rightSide: SideKey;
  readonly winner: ComparisonWinner | null;
}

export interface RecordSummary {
  readonly wins: number;
  readonly losses: number;
  readonly draws?: number;
  readonly total: number;
  readonly winRate: number;
}

export interface ComparisonSummary {
  readonly series: RecordSummary;
  readonly games: RecordSummary;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported subject kind: ${String(value)}`);
}

function matchesSubject(subject: ComparisonSubject, side: DomainSide): boolean {
  switch (subject.kind) {
    case "player":
      return side.playerIds.includes(subject.id);
    case "region":
      return side.regionId === subject.id;
    case "team":
      return side.teamId === subject.id && (subject.teamEraId === undefined || side.eraId === subject.teamEraId);
    default:
      return assertNever(subject);
  }
}

function sideAt(sides: readonly [DomainSide, DomainSide], key: SideKey): DomainSide {
  return key === "a" ? sides[0] : sides[1];
}

function resolveSides(query: ComparisonQuery, sides: readonly [DomainSide, DomainSide]): Readonly<{ left: SideKey; right: SideKey }> | null {
  const leftOnA = matchesSubject(query.left, sideAt(sides, "a"));
  const leftOnB = matchesSubject(query.left, sideAt(sides, "b"));
  const rightOnA = matchesSubject(query.right, sideAt(sides, "a"));
  const rightOnB = matchesSubject(query.right, sideAt(sides, "b"));

  if (leftOnA && rightOnB) {
    return { left: "a", right: "b" };
  }

  if (leftOnB && rightOnA) {
    return { left: "b", right: "a" };
  }

  return null;
}

function hasPlayerSubject(query: ComparisonQuery): boolean {
  return query.left.kind === "player" || query.right.kind === "player";
}

function passesFilters(query: ComparisonQuery, series: DomainSeries): boolean {
  if (query.from !== undefined && series.date < query.from) {
    return false;
  }

  if (query.to !== undefined && series.date > query.to) {
    return false;
  }

  if (query.eventCategories.length > 0 && !query.eventCategories.includes(series.tournament.category)) {
    return false;
  }

  if (query.bestOf.length > 0 && !query.bestOf.includes(series.bestOf)) {
    return false;
  }

  return query.tournamentIds.length === 0 || query.tournamentIds.includes(series.tournament.id);
}

function recordFrom(outcomes: readonly (ComparisonWinner | null)[]): RecordSummary {
  const wins = outcomes.filter((outcome) => outcome === "left").length;
  const losses = outcomes.filter((outcome) => outcome === "right").length;
  const draws = outcomes.filter((outcome) => outcome === "draw").length;
  const total = wins + losses + draws;

  return { wins, losses, ...(draws > 0 ? { draws } : {}), total, winRate: total === 0 ? 0 : wins / total };
}

function leftTeamIdForSeries(query: ComparisonQuery, series: DomainSeries): string | null {
  const seriesAssignment = resolveSides(query, series.sides);
  if (seriesAssignment !== null) {
    return sideAt(series.sides, seriesAssignment.left).teamId;
  }

  for (const game of series.games) {
    const directGame = resolveDirectGame(query, game);
    if (directGame !== null) {
      return sideAt(game.sides, directGame.leftSide).teamId;
    }
  }

  return null;
}

export function resolveDirectGame(query: ComparisonQuery, game: DomainGame): DirectGame | null {
  const assignment = resolveSides(query, game.sides);
  if (assignment === null) {
    return null;
  }

  const winner = game.winnerSide === null ? null : game.winnerSide === assignment.left ? "left" : "right";
  return { game, leftSide: assignment.left, rightSide: assignment.right, winner };
}

export function qualifiesSeries(query: ComparisonQuery, series: DomainSeries): boolean {
  if (!passesFilters(query, series)) {
    return false;
  }

  if (hasPlayerSubject(query)) {
    return series.games.some((game) => resolveDirectGame(query, game) !== null);
  }

  return resolveSides(query, series.sides) !== null;
}

export function summarizeComparison(query: ComparisonQuery, series: readonly DomainSeries[]): ComparisonSummary {
  const seenSeriesIds = new Set<string>();
  const seriesOutcomes: ComparisonWinner[] = [];
  const gameOutcomes: ComparisonWinner[] = [];

  for (const item of series) {
    const completedDraw = item.bestOf === 2 && item.score.a === 1 && item.score.b === 1;
    if (seenSeriesIds.has(item.id) || !item.completed || (item.winnerSide === null && !completedDraw) || !qualifiesSeries(query, item)) {
      continue;
    }
    seenSeriesIds.add(item.id);

    const leftTeamId = leftTeamIdForSeries(query, item);
    if (leftTeamId === null) {
      continue;
    }
    const winnerTeamId = item.winnerSide === null ? null : sideAt(item.sides, item.winnerSide).teamId;
    seriesOutcomes.push(winnerTeamId === null ? "draw" : winnerTeamId === leftTeamId ? "left" : "right");

    if (hasPlayerSubject(query)) {
      for (const game of item.games) {
        const directGame = resolveDirectGame(query, game);
        if (directGame !== null && directGame.winner !== null) gameOutcomes.push(directGame.winner);
      }
    } else {
      const assignment = resolveSides(query, item.sides);
      if (assignment === null) continue;
      const leftScore = item.score[assignment.left];
      const rightScore = item.score[assignment.right];
      for (let index = 0; index < leftScore; index += 1) gameOutcomes.push("left");
      for (let index = 0; index < rightScore; index += 1) gameOutcomes.push("right");
    }
  }

  return { series: recordFrom(seriesOutcomes), games: recordFrom(gameOutcomes) };
}
