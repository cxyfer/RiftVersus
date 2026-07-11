export interface SourceGame {
  readonly id: string;
  readonly tournamentId: string;
  readonly teamAId: string;
  readonly teamBId: string;
  readonly gameNumber: number | null;
  readonly winnerTeamId: string | null;
  readonly playedAt: string;
}

export interface ExplicitSeries {
  readonly id: string;
  readonly gameIds: readonly string[];
}

export interface GroupedSeries {
  readonly id: string;
  readonly source: "explicit" | "derived";
  readonly tournamentId: string;
  readonly teamIds: readonly [string, string];
  readonly gameIds: readonly string[];
  readonly winnerTeamId: string | null;
}

export interface GroupingValidationError {
  readonly code: "UNKNOWN_GAME" | "GAME_ASSIGNED_TWICE" | "INVALID_GAME" | "DUPLICATE_GAME_NUMBER" | "AMBIGUOUS_RESULT";
  readonly gameIds: readonly string[];
  readonly message: string;
}

export interface GroupingResult {
  readonly series: readonly GroupedSeries[];
  readonly errors: readonly GroupingValidationError[];
}

export const MAX_DERIVED_SERIES_WINDOW_MS = 12 * 60 * 60 * 1000;

function teamIdsFor(games: readonly SourceGame[]): readonly [string, string] {
  const first = games[0];
  if (first === undefined) {
    throw new Error("A grouped series requires at least one game.");
  }
  return first.teamAId.localeCompare(first.teamBId) < 0
    ? [first.teamAId, first.teamBId]
    : [first.teamBId, first.teamAId];
}

function groupKey(game: SourceGame): string {
  const teamIds = teamIdsFor([game]);
  return JSON.stringify([game.tournamentId, teamIds[0], teamIds[1]]);
}

function invalidGame(game: SourceGame): boolean {
  return game.teamAId === game.teamBId || Number.isNaN(Date.parse(game.playedAt));
}

function findWinner(games: readonly SourceGame[]): string | null {
  const wins = new Map<string, number>();
  for (const game of games) {
    if (game.winnerTeamId === null || (game.winnerTeamId !== game.teamAId && game.winnerTeamId !== game.teamBId)) {
      return null;
    }
    wins.set(game.winnerTeamId, (wins.get(game.winnerTeamId) ?? 0) + 1);
  }

  const entries = [...wins.entries()].sort((left, right) => right[1] - left[1]);
  const winner = entries[0];
  if (winner === undefined) {
    return null;
  }
  const runnerUp = entries[1];
  return runnerUp === undefined || winner[1] !== runnerUp[1] ? winner[0] : null;
}

function makeExplicitSeries(entry: ExplicitSeries, games: readonly SourceGame[]): GroupedSeries {
  const firstGame = games[0];
  if (firstGame === undefined) {
    throw new Error("An explicit series requires at least one game.");
  }
  return {
    id: entry.id,
    source: "explicit",
    tournamentId: firstGame.tournamentId,
    teamIds: teamIdsFor(games),
    gameIds: games.map((game) => game.id),
    winnerTeamId: findWinner(games),
  };
}

function deriveCluster(games: readonly SourceGame[], series: GroupedSeries[], errors: GroupingValidationError[]): void {
  const firstGame = games[0];
  if (firstGame === undefined) {
    return;
  }
  const gameIds = games.map((game) => game.id);
  if (games.some(invalidGame)) {
    errors.push({ code: "INVALID_GAME", gameIds, message: "Derived games need two teams and a valid match time." });
    return;
  }

  const gameNumbers = games.map((game) => game.gameNumber);
  if (gameNumbers.some((gameNumber) => gameNumber === null) || new Set(gameNumbers).size !== gameNumbers.length) {
    errors.push({ code: "DUPLICATE_GAME_NUMBER", gameIds, message: "Derived games require unique game numbers." });
    return;
  }

  const winnerTeamId = findWinner(games);
  if (winnerTeamId === null) {
    errors.push({ code: "AMBIGUOUS_RESULT", gameIds, message: "Derived games do not establish an unambiguous series winner." });
    return;
  }

  const teamIds = teamIdsFor(games);
  series.push({
    id: `derived:${firstGame.tournamentId}:${teamIds[0]}:${teamIds[1]}:${firstGame.id}`,
    source: "derived",
    tournamentId: firstGame.tournamentId,
    teamIds,
    gameIds,
    winnerTeamId,
  });
}

export function groupGamesIntoSeries(games: readonly SourceGame[], explicit: readonly ExplicitSeries[]): GroupingResult {
  const errors: GroupingValidationError[] = [];
  const series: GroupedSeries[] = [];
  const byId = new Map(games.map((game) => [game.id, game]));
  const assigned = new Set<string>();

  for (const entry of explicit) {
    const selected: SourceGame[] = [];
    const entryGameIds = new Set<string>();
    let valid = true;
    for (const gameId of entry.gameIds) {
      if (entryGameIds.has(gameId)) {
        errors.push({ code: "GAME_ASSIGNED_TWICE", gameIds: [gameId], message: "An explicit series lists a game more than once." });
        valid = false;
        continue;
      }
      entryGameIds.add(gameId);

      const game = byId.get(gameId);
      if (game === undefined) {
        errors.push({ code: "UNKNOWN_GAME", gameIds: [gameId], message: "Explicit series references an unknown game." });
        valid = false;
      } else if (assigned.has(gameId)) {
        errors.push({ code: "GAME_ASSIGNED_TWICE", gameIds: [gameId], message: "A game belongs to more than one explicit series." });
        valid = false;
      } else {
        selected.push(game);
      }
    }
    selected.forEach((game) => assigned.add(game.id));
    if (!valid || selected.length === 0) {
      continue;
    }
    series.push(makeExplicitSeries(entry, selected));
  }

  const buckets = new Map<string, SourceGame[]>();
  for (const game of games) {
    if (assigned.has(game.id)) {
      continue;
    }
    const key = groupKey(game);
    const bucket = buckets.get(key) ?? [];
    bucket.push(game);
    buckets.set(key, bucket);
  }

  for (const bucket of buckets.values()) {
    const sorted = [...bucket].sort((left, right) => Date.parse(left.playedAt) - Date.parse(right.playedAt));
    let cluster: SourceGame[] = [];
    let clusterStartedAt = 0;
    for (const game of sorted) {
      const playedAt = Date.parse(game.playedAt);
      if (cluster.length > 0 && playedAt - clusterStartedAt > MAX_DERIVED_SERIES_WINDOW_MS) {
        deriveCluster(cluster, series, errors);
        cluster = [];
      }
      if (cluster.length === 0) {
        clusterStartedAt = playedAt;
      }
      cluster.push(game);
    }
    if (cluster.length > 0) {
      deriveCluster(cluster, series, errors);
    }
  }

  return { series, errors };
}
