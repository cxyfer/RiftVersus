import { LEAGUEPEDIA_CARGO_LIMIT, LeaguepediaCargoEnvelopeError } from "./client.js";
import type {
  CargoPage, GamePlayersPageInput, GamesPageInput, LeaguepediaEntity, LeaguepediaGame, LeaguepediaGamePlayer,
  LeaguepediaMedia, LeaguepediaSeries, LeaguepediaSliceEvidence, LeaguepediaSnapshot, LeaguepediaTournament,
  LeaguepediaRawInput, OffsetInput, QueryEvidenceResult, RawApiEvidence, TraversalEvidence,
} from "./types.js";

export interface TraversedRows {
  rows: readonly Record<string, unknown>[];
  evidence: TraversalEvidence;
  rawEvidence: readonly RawApiEvidence[];
}

export async function fetchAllCargoPages(fetchPage: (offset: number) => Promise<CargoPage>, maximumPages = 200, maximumRows = 100_000, consumePage?: (page: CargoPage) => void): Promise<TraversedRows> {
  if (!Number.isInteger(maximumPages) || maximumPages <= 0) throw new Error("maximumPages must be a positive integer.");
  const rows: Record<string, unknown>[] = [];
  const rawEvidence: RawApiEvidence[] = [];
  let offset = 0;
  let pages = 0;
  while (pages < maximumPages) {
    const page = await fetchPage(offset);
    if (page.offset !== offset) throw new Error("Leaguepedia Cargo page offset did not match the requested offset.");
    consumePage?.(page);
    pages += 1;
    rows.push(...page.rows);
    if (page.rows.length > LEAGUEPEDIA_CARGO_LIMIT) throw new LeaguepediaSnapshotError("Leaguepedia Cargo page exceeds 500 rows.", rawEvidence, page.rawEvidence.sourceUrl);
    if (rows.length > maximumRows) throw new LeaguepediaSnapshotError("Leaguepedia Cargo traversal exceeds the aggregate row limit.", rawEvidence, page.rawEvidence.sourceUrl);
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

export interface SnapshotSliceRequest { competition: string; sourceCompetition?: string; seasonYear: number; from: string; to: string }
export interface SnapshotResourceLimits { maxBytes: number; maxPages: number; maxRows: number }
export interface SnapshotRequest { slices: readonly SnapshotSliceRequest[]; sourceUrl: string; resourceLimits?: Partial<SnapshotResourceLimits> }

export class LeaguepediaSnapshotError extends Error {
  constructor(message: string, readonly rawEvidence: readonly RawApiEvidence[], readonly sourceUrl: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LeaguepediaSnapshotError";
  }
}

export async function fetchLeaguepediaRawInput(client: LeaguepediaReadClient, request: SnapshotRequest): Promise<LeaguepediaRawInput> {
  if (request.slices.length === 0 || request.slices.length > 100) throw new Error("Leaguepedia snapshot requires between 1 and 100 bounded slices.");
  const budget = new SnapshotBudget(request.resourceLimits, request.sourceUrl);
  const slices = request.slices.map((slice) => { const sourceCompetition = slice.sourceCompetition ?? slice.competition; return { ...slice, sourceCompetition, sliceId: stableSliceId({ ...slice, sourceCompetition }) }; });
  const [teamPages, playerPages, tournamentPages, slicePages] = await Promise.all([
    fetchAllCargoPages((offset) => client.fetchTeamsPage({ offset }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length)),
    fetchAllCargoPages((offset) => client.fetchPlayersPage({ offset }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length)),
    fetchAllCargoPages((offset) => client.fetchTournamentsPage({ offset }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length)),
    mapLimit(slices, 4, async (slice) => ({ slice, pages: await fetchAllCargoPages(async (offset) => withScope(await client.fetchGamesPage({ offset, from: slice.from, to: slice.to, competitions: [slice.sourceCompetition] }), { sliceIds: [slice.sliceId], competition: slice.sourceCompetition, seasonYear: slice.seasonYear, from: slice.from, to: slice.to }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length)) })),
  ]);
  const rawEvidence: RawApiEvidence[] = [teamPages, playerPages, tournamentPages, ...slicePages.map(({ pages }) => pages)].flatMap((page) => page.rawEvidence);
  try {
  const gameRows = uniqueRows(slicePages.flatMap(({ pages }) => pages.rows), "GameId");
  const games = gameRows.map(parseGame);
  const sliceIdsByGame = new Map<string, Set<string>>();
  for (const { slice, pages } of slicePages) for (const row of pages.rows) {
    const gameId = requiredString(row.GameId, "ScoreboardGames GameId");
    sliceIdsByGame.set(gameId, new Set([...(sliceIdsByGame.get(gameId) ?? []), slice.sliceId]));
  }
  const playerPagesByChunk = await mapLimit(chunks(games.map((game) => game.sourceKey), 100), 4, async (gameIds) => {
    const sliceIds = uniqueStrings(gameIds.flatMap((gameId) => [...(sliceIdsByGame.get(gameId) ?? [])]));
    return fetchAllCargoPages(async (offset) => withScope(await client.fetchGamePlayersPage({ offset, gameIds }), { sliceIds, gameIds }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length));
  });
  rawEvidence.push(...playerPagesByChunk.flatMap((page) => page.rawEvidence));
  const imageRequests = [...teamPages.rows, ...playerPages.rows].flatMap((row) => {
    const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID) ?? stringValue(row.Name);
    const title = stringValue(row.Image);
    return sourceKey === null || title === null ? [] : [{ sourceKey, title }];
  });
  const mediaResult = await fetchMedia(client, imageRequests, (item) => budget.consume(item, 0));
  rawEvidence.push(...mediaResult.rawEvidence);
  return {
    provenance: { kind: "live" },
    sourceUrl: requireHttps(request.sourceUrl),
    slices,
    rawEvidence,
  };
  } catch (error) {
    const reason = error instanceof Error ? error : new Error(String(error));
    const failureEvidence = error instanceof LeaguepediaCargoEnvelopeError
      ? dedupeEvidence([...rawEvidence, error.rawEvidence])
      : rawEvidence;
    throw new LeaguepediaSnapshotError(reason.message, failureEvidence, requireHttps(request.sourceUrl), { cause: reason });
  }
}

export async function fetchLeaguepediaSnapshot(client: LeaguepediaReadClient, request: SnapshotRequest): Promise<LeaguepediaSnapshot> { return parseLeaguepediaRawInput(await fetchLeaguepediaRawInput(client, request)); }

/** Deterministic replay parser. This is the only path from retained API envelopes to provider facts. */
export function parseLeaguepediaRawInput(input: LeaguepediaRawInput): LeaguepediaSnapshot {
  validateInputProvenance(input);
  validateEvidenceScopes(input);
  const rows = (table: RawApiEvidence["table"]): Record<string, unknown>[] => input.rawEvidence.filter((item) => item.table === table).flatMap(strictEvidenceRows);
  const teamRows = rows("Teams");
  const playerRows = rows("Players");
  const tournamentRows = rows("Tournaments");
  const gameRows = uniqueRows(rows("ScoreboardGames"), "GameId");
  const playerFactRows = rows("ScoreboardPlayers");
  const entities = [...teamRows.map((row, index) => parseEntity("team", row, index)), ...playerRows.map((row, index) => parseEntity("player", row, index))];
  const games = gameRows.map(parseGame);
  const series = parseSeries(gameRows);
  const seriesByKey = new Map(series.map((item) => [item.sourceKey, item]));
  for (const game of games) if (!seriesByKey.has(game.seriesKey)) throw new LeaguepediaSnapshotError(`Game ${game.sourceKey} references unknown series ${game.seriesKey}.`, input.rawEvidence, input.sourceUrl);
  const media = parseMediaEvidence(input.rawEvidence, [...teamRows, ...playerRows]);
  const sharedTables = ["Teams", "Players", "Tournaments"] as const;
  const sharedTraversals = sharedTables.map((table) => traversalFor(input.rawEvidence.filter((item) => item.table === table)));
  const slices = input.slices.map(({ sliceId, competition, sourceCompetition, seasonYear, from, to }): LeaguepediaSliceEvidence => {
    validateSliceBounds(from, to, sliceId, input);
    if (sliceId !== stableSliceId({ competition, sourceCompetition, seasonYear, from, to })) throw new LeaguepediaSnapshotError(`Retained sliceId ${sliceId} is not canonical.`, input.rawEvidence, input.sourceUrl);
    const gameEvidence = input.rawEvidence.filter((item) => item.table === "ScoreboardGames" && item.scope?.sliceIds?.includes(sliceId));
    assertSliceScope(gameEvidence, { sliceId, competition: sourceCompetition, seasonYear, from, to });
    for (const item of gameEvidence) for (const row of strictEvidenceRows(item)) validateGameRowScope(row, { sourceCompetition, from, to }, item);
    const sliceGameRows = gameEvidence.flatMap(strictEvidenceRows);
    const gameSourceKeys = uniqueRows(sliceGameRows, "GameId").map((row, index) => parseGame(row, index).sourceKey);
    const playerEvidence = input.rawEvidence.filter((item) => item.table === "ScoreboardPlayers" && item.scope?.sliceIds?.includes(sliceId));
    for (const item of playerEvidence) {
      const scopedGameIds = new Set(item.scope?.gameIds ?? []);
      if (scopedGameIds.size === 0 || strictEvidenceRows(item).some((row) => !scopedGameIds.has(requiredString(row.GameId, "ScoreboardPlayers GameId")))) throw new LeaguepediaSnapshotError(`Retained player evidence ${item.requestId} conflicts with its game scope.`, [item], item.sourceUrl);
    }
    const playerGroups = new Map<string, RawApiEvidence[]>();
    for (const item of playerEvidence) { const key = canonicalJson(item.scope?.gameIds ?? []); playerGroups.set(key, [...(playerGroups.get(key) ?? []), item]); }
    const playerTraversal = gameSourceKeys.length === 0 ? { requestedPages: 0, visitedPages: 0, complete: true } : playerGroups.size === 0 ? traversalFor([]) : combineEvidence([...playerGroups.values()].map(traversalFor));
    return { sliceId, competition, sourceCompetition, seasonYear, from, to, gameSourceKeys, traversal: combineEvidence([...sharedTraversals, traversalFor(gameEvidence), playerTraversal]), malformedOptionalRows: 0 };
  });
  return {
    provenance: input.provenance,
    revisionIds: uniqueNumbers(input.rawEvidence.flatMap((item) => item.revisionIds)),
    sourceUrl: requireHttps(input.sourceUrl),
    entities,
    tournaments: tournamentRows.map(parseTournament),
    series,
    games,
    gamePlayers: playerFactRows.map(parseGamePlayer),
    media,
    traversal: combineEvidence(slices.map((slice) => slice.traversal)),
    slices,
    rawEvidence: input.rawEvidence,
  };
}

function validateInputProvenance(input: LeaguepediaRawInput): void {
  if (input.provenance?.kind === "live") return;
  if (input.provenance?.kind === "synthetic-fixture" && typeof input.provenance.name === "string" && input.provenance.name.length > 0) return;
  throw new LeaguepediaSnapshotError("Leaguepedia raw input provenance is missing or invalid.", input.rawEvidence, input.sourceUrl);
}

function strictEvidenceRows(evidence: RawApiEvidence): Record<string, unknown>[] {
  const cargo = evidence.response.cargoquery;
  if (!Array.isArray(cargo)) throw new LeaguepediaSnapshotError("Retained Cargo evidence must contain a cargoquery array.", [evidence], evidence.sourceUrl);
  if (cargo.length > LEAGUEPEDIA_CARGO_LIMIT) throw new LeaguepediaSnapshotError("Retained Cargo page exceeds the 500 row limit.", [evidence], evidence.sourceUrl);
  return cargo.map((item, index) => {
    if (!isRecord(item) || !isRecord(item.title)) throw new LeaguepediaSnapshotError(`Retained Cargo item ${index} is malformed.`, [evidence], evidence.sourceUrl);
    return item.title;
  });
}

function traversalFor(evidence: readonly RawApiEvidence[]): TraversalEvidence {
  if (evidence.length === 0) return { requestedPages: 1, visitedPages: 0, complete: false };
  let expectedOffset = 0;
  for (const item of evidence) {
    if (item.offset !== expectedOffset) throw new LeaguepediaSnapshotError(`Retained Cargo traversal expected offset ${expectedOffset}, received ${item.offset ?? "missing"}.`, evidence, item.sourceUrl);
    expectedOffset += strictEvidenceRows(item).length;
  }
  const lastRows = strictEvidenceRows(evidence.at(-1)!).length;
  return { requestedPages: evidence.length + (lastRows === LEAGUEPEDIA_CARGO_LIMIT ? 1 : 0), visitedPages: evidence.length, complete: lastRows < LEAGUEPEDIA_CARGO_LIMIT };
}

function parseMediaEvidence(evidence: readonly RawApiEvidence[], entityRows: readonly Record<string, unknown>[]): LeaguepediaMedia[] {
  const requests = entityRows.flatMap((row) => { const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID); const title = stringValue(row.Image); return sourceKey && title ? [{ sourceKey, title }] : []; });
  const pages = evidence.filter((item) => item.action === "query").flatMap((item) => isRecord(item.response.query) && Array.isArray(item.response.query.pages) ? item.response.query.pages.filter(isRecord) : []);
  return requests.map((request) => {
    const page = pages.find((item) => stringValue(item.title)?.replace(/^File:/, "") === request.title.replace(/^File:/, ""));
    const info = page && Array.isArray(page.imageinfo) ? page.imageinfo.find(isRecord) : undefined;
    const metadata = info && isRecord(info.extmetadata) ? info.extmetadata : {};
    return { sourceKey: request.title, entityKey: request.sourceKey, sourceUrl: info ? stringValue(info.url) : null, contentType: info ? stringValue(info.mime) : null, license: metadataValue(metadata.LicenseShortName) ?? metadataValue(metadata.UsageTerms), attribution: metadataValue(metadata.Artist) ?? metadataValue(metadata.Credit) };
  });
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

async function fetchMedia(client: LeaguepediaReadClient, requests: readonly { sourceKey: string; title: string }[], consume?: (evidence: RawApiEvidence) => void): Promise<{ media: LeaguepediaMedia[]; rawEvidence: RawApiEvidence[] }> {
  const output: LeaguepediaMedia[] = [];
  const rawEvidence: RawApiEvidence[] = [];
  for (const batch of chunks(requests, 50)) {
    const result = await client.fetchImageInfoWithEvidence(batch.map((item) => item.title));
    for (const item of result.rawEvidence) consume?.(item);
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
function uniqueStrings(items: readonly string[]): string[] { return [...new Set(items)]; }
function stableSliceId(slice: SnapshotSliceRequest & { sourceCompetition: string }): string { return `${encodeURIComponent(slice.competition)}:${encodeURIComponent(slice.sourceCompetition)}:${slice.seasonYear}:${slice.from}:${slice.to}`; }
function withScope(page: CargoPage, scope: NonNullable<RawApiEvidence["scope"]>): CargoPage { return { ...page, rawEvidence: { ...page.rawEvidence, scope } }; }
function assertSliceScope(evidence: readonly RawApiEvidence[], slice: SnapshotSliceRequest & { sliceId: string }): void {
  for (const item of evidence) if (item.scope?.competition !== slice.competition || item.scope.seasonYear !== slice.seasonYear || item.scope.from !== slice.from || item.scope.to !== slice.to) throw new LeaguepediaSnapshotError(`Retained Cargo evidence scope conflicts with slice ${slice.sliceId}.`, [item], item.sourceUrl);
}
function validateGameRowScope(row: Record<string, unknown>, scope: { sourceCompetition: string; from: string; to: string }, evidence: RawApiEvidence): void {
  const tournament = requiredString(row.Tournament, "ScoreboardGames Tournament");
  if (tournament !== scope.sourceCompetition) throw new LeaguepediaSnapshotError(`Retained game row tournament ${tournament} does not match requested source key ${scope.sourceCompetition}.`, [evidence], evidence.sourceUrl);
  const timestamp = requiredTimestamp(row.DateTime_UTC, requiredString(row.GameId, "ScoreboardGames GameId"));
  const playedAt = new Date(timestamp).valueOf(); const from = new Date(`${scope.from}T00:00:00Z`).valueOf(); const to = new Date(`${scope.to}T00:00:00Z`).valueOf();
  if (playedAt < from || playedAt >= to) throw new LeaguepediaSnapshotError(`Retained game row timestamp ${timestamp} is outside [${scope.from}, ${scope.to}).`, [evidence], evidence.sourceUrl);
}
function validateSliceBounds(from: string, to: string, sliceId: string, input: LeaguepediaRawInput): void {
  const format = /^\d{4}-\d{2}-\d{2}$/;
  const fromTime = new Date(`${from}T00:00:00Z`).valueOf(); const toTime = new Date(`${to}T00:00:00Z`).valueOf();
  if (!format.test(from) || !format.test(to) || !Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime >= toTime) throw new LeaguepediaSnapshotError(`Retained slice ${sliceId} has invalid date bounds.`, input.rawEvidence, input.sourceUrl);
}
function validateEvidenceScopes(input: LeaguepediaRawInput): void {
  const declared = new Set(input.slices.map((slice) => slice.sliceId));
  if (declared.size !== input.slices.length) throw new LeaguepediaSnapshotError("Retained input contains duplicate sliceIds.", input.rawEvidence, input.sourceUrl);
  for (const item of input.rawEvidence) if (item.table === "ScoreboardGames" || item.table === "ScoreboardPlayers") {
    const sliceIds = item.scope?.sliceIds ?? [];
    if (sliceIds.length === 0 || sliceIds.some((sliceId) => !declared.has(sliceId))) throw new LeaguepediaSnapshotError(`Retained evidence ${item.requestId} has an unknown or missing slice scope.`, [item], item.sourceUrl);
  }
}
class SnapshotBudget {
  readonly #limits: SnapshotResourceLimits;
  readonly #evidence: RawApiEvidence[] = [];
  #bytes = 0; #pages = 0; #rows = 0;
  constructor(limits: Partial<SnapshotResourceLimits> | undefined, readonly sourceUrl: string) {
    this.#limits = { maxBytes: positiveLimit(limits?.maxBytes ?? 100_000_000, "maxBytes"), maxPages: positiveLimit(limits?.maxPages ?? 2_000, "maxPages"), maxRows: positiveLimit(limits?.maxRows ?? 500_000, "maxRows") };
  }
  consume(evidence: RawApiEvidence, rows: number): void {
    this.#evidence.push(evidence); this.#pages += 1; this.#rows += rows; this.#bytes += evidence.responseBytes ?? new TextEncoder().encode(JSON.stringify(evidence.response)).byteLength;
    if (this.#bytes > this.#limits.maxBytes || this.#pages > this.#limits.maxPages || this.#rows > this.#limits.maxRows) throw new LeaguepediaSnapshotError(`Leaguepedia snapshot exceeds its global resource budget (${this.#bytes} bytes, ${this.#pages} pages, ${this.#rows} rows).`, [...this.#evidence], this.sourceUrl);
  }
}
function positiveLimit(value: number, name: string): number { if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`); return value; }
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
function dedupeEvidence(items: readonly RawApiEvidence[]): RawApiEvidence[] { return [...new Map(items.map((item) => [item.requestId, item])).values()]; }
async function mapLimit<T, R>(items: readonly T[], concurrency: number, operation: (item: T) => Promise<R>): Promise<R[]> { const output = new Array<R>(items.length); let next = 0; const worker = async () => { while (true) { const index = next++; if (index >= items.length) return; output[index] = await operation(items[index]!); } }; await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker)); return output; }
