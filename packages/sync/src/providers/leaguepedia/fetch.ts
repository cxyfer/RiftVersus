import { LEAGUEPEDIA_CARGO_LIMIT } from "./client.js";
import type {
  CargoPage, GamePlayersPageInput, GamesPageInput, LeaguepediaEntity, LeaguepediaGame, LeaguepediaGamePlayer,
  LeaguepediaMedia, LeaguepediaSeries, LeaguepediaSnapshot, OffsetInput, TraversalEvidence,
} from "./types.js";

export interface TraversedRows {
  rows: readonly Record<string, unknown>[];
  evidence: TraversalEvidence;
}

export async function fetchAllCargoPages(fetchPage: (offset: number) => Promise<CargoPage>, maximumPages = 10_000): Promise<TraversedRows> {
  if (!Number.isInteger(maximumPages) || maximumPages <= 0) throw new Error("maximumPages must be a positive integer.");
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  let pages = 0;
  while (pages < maximumPages) {
    const page = await fetchPage(offset);
    if (page.offset !== offset) throw new Error("Leaguepedia Cargo page offset did not match the requested offset.");
    pages += 1;
    rows.push(...page.rows);
    if (page.rows.length < LEAGUEPEDIA_CARGO_LIMIT) return { rows, evidence: { requestedPages: pages, visitedPages: pages, complete: true } };
    offset += page.rows.length;
  }
  return { rows, evidence: { requestedPages: pages + 1, visitedPages: pages, complete: false } };
}

export interface LeaguepediaReadClient {
  fetchTeamsPage(input: OffsetInput): Promise<CargoPage>;
  fetchPlayersPage(input: OffsetInput): Promise<CargoPage>;
  fetchGamesPage(input: GamesPageInput): Promise<CargoPage>;
  fetchGamePlayersPage(input: GamePlayersPageInput): Promise<CargoPage>;
  fetchImageInfo(titles: readonly string[]): Promise<Record<string, unknown>>;
}

export interface SnapshotRequest {
  from: string;
  to: string;
  competitions: readonly string[];
  sourceUrl: string;
}

export async function fetchLeaguepediaSnapshot(client: LeaguepediaReadClient, request: SnapshotRequest): Promise<LeaguepediaSnapshot> {
  const [teamPages, playerPages, gamePages] = await Promise.all([
    fetchAllCargoPages((offset) => client.fetchTeamsPage({ offset })),
    fetchAllCargoPages((offset) => client.fetchPlayersPage({ offset })),
    fetchAllCargoPages((offset) => client.fetchGamesPage({ offset, from: request.from, to: request.to, competitions: request.competitions })),
  ]);
  const entities = [
    ...teamPages.rows.map((row) => parseEntity("team", row)).filter(nonNull),
    ...playerPages.rows.map((row) => parseEntity("player", row)).filter(nonNull),
  ];
  const games = gamePages.rows.map(parseGame).filter(nonNull);
  const series = parseSeries(gamePages.rows);
  const playerPagesByChunk = await Promise.all(chunks(games.map((game) => game.sourceKey), 100).map(async (gameIds) => fetchAllCargoPages((offset) => client.fetchGamePlayersPage({ offset, gameIds }))));
  const gamePlayers = playerPagesByChunk.flatMap((page) => page.rows.map(parseGamePlayer).filter(nonNull));
  const imageRequests = [...teamPages.rows, ...playerPages.rows].flatMap((row) => {
    const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID) ?? stringValue(row.Name);
    const title = stringValue(row.Image);
    return sourceKey === null || title === null ? [] : [{ sourceKey, title }];
  });
  const media = await fetchMedia(client, imageRequests);
  const evidence = combineEvidence([teamPages.evidence, playerPages.evidence, gamePages.evidence, ...playerPagesByChunk.map((page) => page.evidence)]);
  return { revisionIds: [], sourceUrl: request.sourceUrl, entities, series, games, gamePlayers, media, traversal: evidence };
}

function parseEntity(kind: "team" | "player", row: Record<string, unknown>): LeaguepediaEntity | null {
  const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID) ?? stringValue(row.Name);
  const displayName = stringValue(row.Name) ?? sourceKey;
  if (sourceKey === null || displayName === null) return null;
  return {
    kind, sourceKey, displayName, aliases: splitAliases(row.Aliases),
    ...(kind === "team" ? { region: stringValue(row.Region), validFrom: stringValue(row.DateStart), validTo: stringValue(row.DateEnd) } : {}),
  };
}

function parseGame(row: Record<string, unknown>): LeaguepediaGame | null {
  const sourceKey = stringValue(row.GameId);
  const seriesKey = stringValue(row.MatchId) ?? stringValue(row.MatchHistory);
  const playedAt = stringValue(row.DateTime_UTC);
  const sideATeam = stringValue(row.Team1);
  const sideBTeam = stringValue(row.Team2);
  const gameNumber = numberValue(row.N_GameInMatch);
  if (sourceKey === null || seriesKey === null || playedAt === null || sideATeam === null || sideBTeam === null || gameNumber === null) return null;
  const winner = numberValue(row.Winner);
  return { sourceKey, seriesKey, playedAt, sideATeam, sideBTeam, gameNumber, winnerTeam: winner === 1 ? sideATeam : winner === 2 ? sideBTeam : null };
}

function parseSeries(rows: readonly Record<string, unknown>[]): LeaguepediaSeries[] {
  const result = new Map<string, LeaguepediaSeries>();
  for (const row of rows) {
    const sourceKey = stringValue(row.MatchId) ?? stringValue(row.MatchHistory);
    const tournamentKey = stringValue(row.Tournament);
    const playedAt = stringValue(row.DateTime_UTC);
    const sideATeam = stringValue(row.Team1);
    const sideBTeam = stringValue(row.Team2);
    const bestOf = bestOfValue(row.BestOf);
    if (sourceKey === null || tournamentKey === null || playedAt === null || sideATeam === null || sideBTeam === null || bestOf === null) continue;
    const candidate = { sourceKey, tournamentKey, playedAt, sideATeam, sideBTeam, bestOf, sideAScore: numberValue(row.Team1Score), sideBScore: numberValue(row.Team2Score) };
    const previous = result.get(sourceKey);
    if (previous !== undefined && (previous.tournamentKey !== candidate.tournamentKey || previous.sideATeam !== candidate.sideATeam || previous.sideBTeam !== candidate.sideBTeam || previous.bestOf !== candidate.bestOf)) throw new Error(`Leaguepedia series ${sourceKey} has conflicting game rows.`);
    result.set(sourceKey, candidate);
  }
  return [...result.values()];
}

function parseGamePlayer(row: Record<string, unknown>): LeaguepediaGamePlayer | null {
  const gameKey = stringValue(row.GameId);
  const playerKey = stringValue(row.PlayerName);
  const teamKey = stringValue(row.Team);
  return gameKey === null || playerKey === null || teamKey === null ? null : { gameKey, playerKey, teamKey };
}

async function fetchMedia(client: LeaguepediaReadClient, requests: readonly { sourceKey: string; title: string }[]): Promise<LeaguepediaMedia[]> {
  if (requests.length === 0) return [];
  const output: LeaguepediaMedia[] = [];
  for (const batch of chunks(requests, 50)) {
    const response = await client.fetchImageInfo(batch.map((item) => item.title));
    const pages = isRecord(response.query) && Array.isArray(response.query.pages) ? response.query.pages.filter(isRecord) : [];
    for (const page of pages) {
      const title = stringValue(page.title)?.replace(/^File:/, "");
      const request = batch.find((item) => item.title.replace(/^File:/, "") === title);
      const info = Array.isArray(page.imageinfo) ? page.imageinfo.find(isRecord) : undefined;
      if (request === undefined || info === undefined) continue;
      const metadata = isRecord(info.extmetadata) ? info.extmetadata : {};
      output.push({
        sourceKey: request.title, entityKey: request.sourceKey, sourceUrl: stringValue(info.url), contentType: stringValue(info.mime),
        license: metadataValue(metadata.LicenseShortName) ?? metadataValue(metadata.UsageTerms),
        attribution: metadataValue(metadata.Artist) ?? metadataValue(metadata.Credit),
      });
    }
  }
  return output;
}

function combineEvidence(items: readonly TraversalEvidence[]): TraversalEvidence {
  return { requestedPages: items.reduce((sum, item) => sum + item.requestedPages, 0), visitedPages: items.reduce((sum, item) => sum + item.visitedPages, 0), complete: items.every((item) => item.complete) };
}
function chunks<T>(items: readonly T[], size: number): T[][] { const result: T[][] = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }
function splitAliases(value: unknown): string[] { return (stringValue(value) ?? "").split(/[,;/]/).map((item) => item.trim()).filter(Boolean); }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function numberValue(value: unknown): number | null { const result = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN; return Number.isInteger(result) ? result : null; }
function bestOfValue(value: unknown): 1 | 3 | 5 | null { const result = numberValue(value); return result === 1 || result === 3 || result === 5 ? result : null; }
function metadataValue(value: unknown): string | null { return isRecord(value) ? stringValue(value.value) : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonNull<T>(value: T | null): value is T { return value !== null; }
