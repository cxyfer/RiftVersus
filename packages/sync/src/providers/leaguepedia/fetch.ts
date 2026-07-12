import { LEAGUEPEDIA_CARGO_LIMIT } from "./client.js";
import type {
  CargoPage, GamePlayersPageInput, GamesPageInput, LeaguepediaEntity, LeaguepediaGame, LeaguepediaGamePlayer,
  LeaguepediaMedia, LeaguepediaSeries, LeaguepediaSliceEvidence, LeaguepediaSnapshot, LeaguepediaTournament,
  OffsetInput, QueryEvidenceResult, RawApiEvidence, TraversalEvidence,
} from "./types.js";

export interface TraversedRows {
  rows: readonly Record<string, unknown>[];
  evidence: TraversalEvidence;
  rawEvidence: readonly RawApiEvidence[];
}

export async function fetchAllCargoPages(fetchPage: (offset: number) => Promise<CargoPage>, maximumPages = 10_000): Promise<TraversedRows> {
  if (!Number.isInteger(maximumPages) || maximumPages <= 0) throw new Error("maximumPages must be a positive integer.");
  const rows: Record<string, unknown>[] = [];
  const rawEvidence: RawApiEvidence[] = [];
  let offset = 0;
  let pages = 0;
  while (pages < maximumPages) {
    const page = await fetchPage(offset);
    if (page.offset !== offset) throw new Error("Leaguepedia Cargo page offset did not match the requested offset.");
    pages += 1;
    rows.push(...page.rows);
    rawEvidence.push(page.rawEvidence);
    if (page.rows.length < LEAGUEPEDIA_CARGO_LIMIT) return { rows, rawEvidence, evidence: { requestedPages: pages, visitedPages: pages, complete: true } };
    offset += page.rows.length;
  }
  return { rows, rawEvidence, evidence: { requestedPages: pages + 1, visitedPages: pages, complete: false } };
}

export interface LeaguepediaReadClient {
  fetchTeamsPage(input: OffsetInput): Promise<CargoPage>;
  fetchPlayersPage(input: OffsetInput): Promise<CargoPage>;
  fetchTournamentsPage(input: OffsetInput): Promise<CargoPage>;
  fetchGamesPage(input: GamesPageInput): Promise<CargoPage>;
  fetchGamePlayersPage(input: GamePlayersPageInput): Promise<CargoPage>;
  fetchImageInfoWithEvidence(titles: readonly string[]): Promise<QueryEvidenceResult>;
}

export interface SnapshotSliceRequest { competition: string; seasonYear: number; from: string; to: string }
export interface SnapshotRequest { slices: readonly SnapshotSliceRequest[]; sourceUrl: string }

export class LeaguepediaSnapshotError extends Error {
  constructor(message: string, readonly rawEvidence: readonly RawApiEvidence[], readonly sourceUrl: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LeaguepediaSnapshotError";
  }
}

export async function fetchLeaguepediaSnapshot(client: LeaguepediaReadClient, request: SnapshotRequest): Promise<LeaguepediaSnapshot> {
  if (request.slices.length === 0) throw new Error("Leaguepedia snapshot requires at least one bounded slice.");
  const [teamPages, playerPages, tournamentPages, slicePages] = await Promise.all([
    fetchAllCargoPages((offset) => client.fetchTeamsPage({ offset })),
    fetchAllCargoPages((offset) => client.fetchPlayersPage({ offset })),
    fetchAllCargoPages((offset) => client.fetchTournamentsPage({ offset })),
    Promise.all(request.slices.map(async (slice) => ({ slice, pages: await fetchAllCargoPages((offset) => client.fetchGamesPage({ offset, from: slice.from, to: slice.to, competitions: [slice.competition] })) }))),
  ]);
  const rawEvidence: RawApiEvidence[] = [teamPages, playerPages, tournamentPages, ...slicePages.map(({ pages }) => pages)].flatMap((page) => page.rawEvidence);
  try {
  const entities = [
    ...teamPages.rows.map((row, index) => parseEntity("team", row, index)),
    ...playerPages.rows.map((row, index) => parseEntity("player", row, index)),
  ];
  const tournaments = tournamentPages.rows.map(parseTournament);
  const gameRows = uniqueRows(slicePages.flatMap(({ pages }) => pages.rows), "GameId");
  const games = gameRows.map(parseGame);
  const series = parseSeries(gameRows);
  const playerPagesByChunk = await Promise.all(chunks(games.map((game) => game.sourceKey), 100).map(async (gameIds) => fetchAllCargoPages((offset) => client.fetchGamePlayersPage({ offset, gameIds }))));
  rawEvidence.push(...playerPagesByChunk.flatMap((page) => page.rawEvidence));
  const gamePlayers = playerPagesByChunk.flatMap((page) => page.rows.map(parseGamePlayer));
  assertUniquePlayerFacts(gamePlayers);
  const imageRequests = [...teamPages.rows, ...playerPages.rows].flatMap((row) => {
    const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID) ?? stringValue(row.Name);
    const title = stringValue(row.Image);
    return sourceKey === null || title === null ? [] : [{ sourceKey, title }];
  });
  const mediaResult = await fetchMedia(client, imageRequests);
  rawEvidence.push(...mediaResult.rawEvidence);
  const slices: LeaguepediaSliceEvidence[] = slicePages.map(({ slice, pages }) => ({
    competition: slice.competition,
    seasonYear: slice.seasonYear,
    gameSourceKeys: pages.rows.map((row, index) => requiredString(row.GameId, `ScoreboardGames row ${index} GameId`)),
    traversal: pages.evidence,
    malformedOptionalRows: 0,
  }));
  const allTraversals = [teamPages, playerPages, tournamentPages, ...slicePages.map(({ pages }) => pages), ...playerPagesByChunk];
  return {
    revisionIds: uniqueNumbers(rawEvidence.flatMap((item) => item.revisionIds)),
    sourceUrl: requireHttps(request.sourceUrl),
    entities,
    tournaments,
    series,
    games,
    gamePlayers,
    media: mediaResult.media,
    traversal: combineEvidence(allTraversals.map((page) => page.evidence)),
    slices,
    rawEvidence,
  };
  } catch (error) {
    const reason = error instanceof Error ? error : new Error(String(error));
    throw new LeaguepediaSnapshotError(reason.message, rawEvidence, requireHttps(request.sourceUrl), { cause: reason });
  }
}

function parseEntity(kind: "team" | "player", row: Record<string, unknown>, index: number): LeaguepediaEntity {
  const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID);
  if (sourceKey === null) throw new Error(`${kind} row ${index} is missing a stable source key.`);
  return {
    kind,
    sourceKey,
    displayName: requiredString(row.Name, `${kind} ${sourceKey} Name`),
    aliases: splitAliases(row.Aliases),
    ...(kind === "team" ? { region: stringValue(row.Region) } : {}),
    validFrom: optionalDate(row.DateStart, sourceKey),
    validTo: optionalDate(row.DateEnd, sourceKey),
  };
}

function parseTournament(row: Record<string, unknown>, index: number): LeaguepediaTournament {
  const sourceKey = requiredString(row.OverviewPage, `Tournaments row ${index} OverviewPage`);
  return { sourceKey, displayName: requiredString(row.Name, `Tournament ${sourceKey} Name`), validFrom: optionalDate(row.DateStart, sourceKey), validTo: optionalDate(row.DateEnd, sourceKey) };
}

function parseGame(row: Record<string, unknown>, index: number): LeaguepediaGame {
  const sourceKey = requiredString(row.GameId, `ScoreboardGames row ${index} GameId`);
  const seriesKey = stringValue(row.MatchId) ?? stringValue(row.MatchHistory);
  if (seriesKey === null) throw new Error(`Game ${sourceKey} is missing an explicit series key.`);
  const sideATeam = requiredString(row.Team1, `Game ${sourceKey} Team1`);
  const sideBTeam = requiredString(row.Team2, `Game ${sourceKey} Team2`);
  if (sideATeam === sideBTeam) throw new Error(`Game ${sourceKey} has identical sides.`);
  const winner = requiredInteger(row.Winner, `Game ${sourceKey} Winner`);
  if (winner !== 1 && winner !== 2) throw new Error(`Game ${sourceKey} winner must be side 1 or 2.`);
  return {
    sourceKey,
    seriesKey,
    playedAt: requiredTimestamp(row.DateTime_UTC, sourceKey),
    sideATeam,
    sideBTeam,
    gameNumber: positiveInteger(row.N_GameInMatch, `Game ${sourceKey} number`),
    winnerTeam: winner === 1 ? sideATeam : sideBTeam,
  };
}

function parseSeries(rows: readonly Record<string, unknown>[]): LeaguepediaSeries[] {
  const result = new Map<string, LeaguepediaSeries>();
  for (const [index, row] of rows.entries()) {
    const sourceKey = stringValue(row.MatchId) ?? stringValue(row.MatchHistory);
    if (sourceKey === null) throw new Error(`ScoreboardGames row ${index} is missing an explicit series key.`);
    const bestOf = bestOfValue(row.BestOf, sourceKey);
    const sideATeam = requiredString(row.Team1, `Series ${sourceKey} Team1`);
    const sideBTeam = requiredString(row.Team2, `Series ${sourceKey} Team2`);
    if (sideATeam === sideBTeam) throw new Error(`Series ${sourceKey} has identical sides.`);
    const sideAScore = nonNegativeInteger(row.Team1Score, `Series ${sourceKey} Team1Score`);
    const sideBScore = nonNegativeInteger(row.Team2Score, `Series ${sourceKey} Team2Score`);
    validateCompletedScore(bestOf, sideAScore, sideBScore, sourceKey);
    const candidate: LeaguepediaSeries = {
      sourceKey,
      tournamentKey: requiredString(row.Tournament, `Series ${sourceKey} Tournament`),
      playedAt: requiredTimestamp(row.DateTime_UTC, sourceKey),
      sideATeam,
      sideBTeam,
      bestOf,
      sideAScore,
      sideBScore,
    };
    const previous = result.get(sourceKey);
    if (previous !== undefined) {
      const previousIdentity = { ...previous, playedAt: undefined };
      const candidateIdentity = { ...candidate, playedAt: undefined };
      if (canonicalJson(previousIdentity) !== canonicalJson(candidateIdentity)) throw new Error(`Leaguepedia series ${sourceKey} has conflicting game rows.`);
      result.set(sourceKey, { ...previous, playedAt: previous.playedAt < candidate.playedAt ? previous.playedAt : candidate.playedAt });
    } else result.set(sourceKey, candidate);
  }
  return [...result.values()];
}

function parseGamePlayer(row: Record<string, unknown>, index: number): LeaguepediaGamePlayer {
  const playerWin = requiredInteger(row.PlayerWin, `ScoreboardPlayers row ${index} PlayerWin`);
  if (playerWin !== 0 && playerWin !== 1) throw new Error(`ScoreboardPlayers row ${index} PlayerWin must be 0 or 1.`);
  return {
    gameKey: requiredString(row.GameId, `ScoreboardPlayers row ${index} GameId`),
    playerKey: requiredString(row.PlayerName, `ScoreboardPlayers row ${index} PlayerName`),
    teamKey: requiredString(row.Team, `ScoreboardPlayers row ${index} Team`),
    playerWin: playerWin === 1,
  };
}

async function fetchMedia(client: LeaguepediaReadClient, requests: readonly { sourceKey: string; title: string }[]): Promise<{ media: LeaguepediaMedia[]; rawEvidence: RawApiEvidence[] }> {
  const output: LeaguepediaMedia[] = [];
  const rawEvidence: RawApiEvidence[] = [];
  for (const batch of chunks(requests, 50)) {
    const result = await client.fetchImageInfoWithEvidence(batch.map((item) => item.title));
    rawEvidence.push(...result.rawEvidence);
    const pages = isRecord(result.data.query) && Array.isArray(result.data.query.pages) ? result.data.query.pages.filter(isRecord) : [];
    for (const request of batch) {
      const page = pages.find((item) => stringValue(item.title)?.replace(/^File:/, "") === request.title.replace(/^File:/, ""));
      const info = page !== undefined && Array.isArray(page.imageinfo) ? page.imageinfo.find(isRecord) : undefined;
      const metadata = info !== undefined && isRecord(info.extmetadata) ? info.extmetadata : {};
      output.push({
        sourceKey: request.title,
        entityKey: request.sourceKey,
        sourceUrl: info === undefined ? null : stringValue(info.url),
        contentType: info === undefined ? null : stringValue(info.mime),
        license: metadataValue(metadata.LicenseShortName) ?? metadataValue(metadata.UsageTerms),
        attribution: metadataValue(metadata.Artist) ?? metadataValue(metadata.Credit),
      });
    }
  }
  return { media: output, rawEvidence };
}

function uniqueRows(rows: readonly Record<string, unknown>[], key: string): Record<string, unknown>[] {
  const output = new Map<string, Record<string, unknown>>();
  for (const [index, row] of rows.entries()) {
    const sourceKey = requiredString(row[key], `row ${index} ${key}`);
    const previous = output.get(sourceKey);
    if (previous !== undefined && canonicalJson(previous) !== canonicalJson(row)) throw new Error(`Conflicting Leaguepedia rows for ${key} ${sourceKey}.`);
    output.set(sourceKey, row);
  }
  return [...output.values()];
}
function assertUniquePlayerFacts(items: readonly LeaguepediaGamePlayer[]): void {
  const seen = new Set<string>();
  for (const item of items) { const key = `${item.gameKey}:${item.playerKey}`; if (seen.has(key)) throw new Error(`Duplicate player fact ${key}.`); seen.add(key); }
}
function validateCompletedScore(bestOf: 1 | 3 | 5, a: number, b: number, sourceKey: string): void { const target = Math.floor(bestOf / 2) + 1; if (!((a === target && b < target) || (b === target && a < target))) throw new Error(`Series ${sourceKey} score is inconsistent with BestOf ${bestOf}.`); }
function combineEvidence(items: readonly TraversalEvidence[]): TraversalEvidence { return { requestedPages: items.reduce((sum, item) => sum + item.requestedPages, 0), visitedPages: items.reduce((sum, item) => sum + item.visitedPages, 0), complete: items.every((item) => item.complete) }; }
function chunks<T>(items: readonly T[], size: number): T[][] { const result: T[][] = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }
function splitAliases(value: unknown): string[] { return (stringValue(value) ?? "").split(/[,;/]/).map((item) => item.trim()).filter(Boolean); }
function requiredString(value: unknown, name: string): string { const result = stringValue(value); if (result === null) throw new Error(`${name} is required.`); return result; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function requiredInteger(value: unknown, name: string): number { const result = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN; if (!Number.isInteger(result)) throw new Error(`${name} must be an integer.`); return result; }
function nonNegativeInteger(value: unknown, name: string): number { const result = requiredInteger(value, name); if (result < 0) throw new Error(`${name} must be non-negative.`); return result; }
function positiveInteger(value: unknown, name: string): number { const result = requiredInteger(value, name); if (result <= 0) throw new Error(`${name} must be positive.`); return result; }
function bestOfValue(value: unknown, key: string): 1 | 3 | 5 { const result = requiredInteger(value, `Series ${key} BestOf`); if (result !== 1 && result !== 3 && result !== 5) throw new Error(`Series ${key} BestOf must be 1, 3, or 5.`); return result; }
function requiredTimestamp(value: unknown, key: string): string { const result = requiredString(value, `${key} timestamp`); if (Number.isNaN(new Date(result).valueOf())) throw new Error(`${key} timestamp is invalid.`); return result; }
function optionalDate(value: unknown, key: string): string | null { const result = stringValue(value); if (result === null) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(`${key} date is invalid.`); return result; }
function metadataValue(value: unknown): string | null { return isRecord(value) ? stringValue(value.value) : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requireHttps(value: string): string { const url = new URL(value); if (url.protocol !== "https:") throw new Error("Leaguepedia source URL must use HTTPS."); return url.toString(); }
function canonicalJson(value: unknown): string { return JSON.stringify(sortValue(value)); }
function sortValue(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortValue); if (!isRecord(value)) return value; return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)])); }
function uniqueNumbers(values: readonly number[]): number[] { return [...new Set(values)].sort((a, b) => a - b); }
