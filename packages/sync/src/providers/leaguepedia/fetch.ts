import { isCompletedSeriesScore } from "@riftversus/contracts";
import { LEAGUEPEDIA_CARGO_LIMIT, LeaguepediaApiError, LeaguepediaCargoEnvelopeError } from "./client.js";
import { decodeCargoExportRows } from "./cargo-export.js";
import { alternativeReviewEvidence, projectSourceRows, sourceScheduleIds, type SourceCorrection } from "./source-corrections.js";
import type {
  CargoPage, GamePlayersPageInput, GamesPageInput, LeaguepediaEntity, LeaguepediaGame, LeaguepediaGamePlayer,
  LeaguepediaMedia, LeaguepediaSeries, LeaguepediaSliceEvidence, LeaguepediaSnapshot, LeaguepediaTournament,
  LeaguepediaRawInput, MatchSchedulesPageInput, OffsetInput, QueryEvidenceResult, RawApiEvidence, TraversalEvidence,
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
  fetchTeamRedirectsPage(input: OffsetInput): Promise<CargoPage>;
  fetchPlayersPage(input: OffsetInput): Promise<CargoPage>;
  fetchPlayerRedirectsPage(input: OffsetInput): Promise<CargoPage>;
  fetchPlayerImagesPage?(input: OffsetInput & { playerPages: readonly string[] }): Promise<CargoPage>;
  fetchTournamentsPage(input: OffsetInput): Promise<CargoPage>;
  fetchMatchSchedulesPage(input: MatchSchedulesPageInput): Promise<CargoPage>;
  fetchGamesPage(input: GamesPageInput): Promise<CargoPage>;
  fetchGamePlayersPage(input: GamePlayersPageInput): Promise<CargoPage>;
  fetchImageInfoWithEvidence(titles: readonly string[]): Promise<QueryEvidenceResult>;
  fetchKnownPagesWithEvidence(titles: readonly string[]): Promise<QueryEvidenceResult>;
}

export interface SnapshotSliceRequest { competition: string; sourceCompetition?: string; seasonYear: number; from: string; to: string }
export interface SnapshotResourceLimits { maxBytes: number; maxPages: number; maxRows: number; maxReviewedPages: number }
export interface SnapshotRequest { slices: readonly SnapshotSliceRequest[]; sourceUrl: string; resourceLimits?: Partial<SnapshotResourceLimits> }

export class LeaguepediaSnapshotError extends Error {
  constructor(message: string, readonly rawEvidence: readonly RawApiEvidence[], readonly sourceUrl: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LeaguepediaSnapshotError";
  }
}

export async function fetchLeaguepediaRawInput(client: LeaguepediaReadClient, request: SnapshotRequest, corrections: readonly SourceCorrection[] = []): Promise<LeaguepediaRawInput> {
  if (request.slices.length === 0 || request.slices.length > 100) throw new Error("Leaguepedia snapshot requires between 1 and 100 bounded slices.");
  const budget = new SnapshotBudget(request.resourceLimits, request.sourceUrl);
  const slices = request.slices.map((slice) => { const sourceCompetition = slice.sourceCompetition ?? slice.competition; return { ...slice, sourceCompetition, sliceId: stableSliceId({ ...slice, sourceCompetition }) }; });
  const [teamPages, teamRedirectPages, playerPages, playerRedirectPages, tournamentPages, slicePages] = await Promise.all([
    fetchAllCargoPages((offset) => client.fetchTeamsPage({ offset }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length)),
    fetchAllCargoPages((offset) => client.fetchTeamRedirectsPage({ offset }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length)),
    fetchAllCargoPages((offset) => client.fetchPlayersPage({ offset }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length)),
    fetchAllCargoPages((offset) => client.fetchPlayerRedirectsPage({ offset }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length)),
    fetchAllCargoPages((offset) => client.fetchTournamentsPage({ offset }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length)),
    mapLimit(slices, 4, async (slice) => ({ slice, pages: await fetchAllCargoPages(async (offset) => withScope(await client.fetchGamesPage({ offset, from: slice.from, to: slice.to, competitions: [slice.sourceCompetition] }), { sliceIds: [slice.sliceId], competition: slice.sourceCompetition, seasonYear: slice.seasonYear, from: slice.from, to: slice.to }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length)) })),
  ]);
  const rawEvidence: RawApiEvidence[] = [teamPages, teamRedirectPages, playerPages, playerRedirectPages, tournamentPages, ...slicePages.map(({ pages }) => pages)].flatMap((page) => page.rawEvidence);
  try {
  const gameRows = uniqueRows(projectSourceRows("ScoreboardGames", slicePages.flatMap(({ pages }) => pages.rows), corrections), "GameId");
  const liveTeams = projectSourceRows("Teams", teamPages.rows, corrections);
  const liveTeamRedirects = projectSourceRows("TeamRedirects", teamRedirectPages.rows, corrections);
  const livePlayers = projectSourceRows("Players", playerPages.rows, corrections);
  const liveTeamSourceKeys = referencedTeamSourceKeys(liveTeams, liveTeamRedirects, gameRows.flatMap((row) => [
    requiredString(row.Team1, "ScoreboardGames Team1"),
    requiredString(row.Team2, "ScoreboardGames Team2"),
  ]), "Game team");
  const games = gameRows.map((row, index) => parseGame(row, index, liveTeamSourceKeys));
  const sliceIdsByMatch = new Map<string, Set<string>>();
  for (const { slice, pages } of slicePages) for (const row of projectSourceRows("ScoreboardGames", pages.rows, corrections)) {
    const matchId = requiredString(row.MatchId, "ScoreboardGames MatchId");
    sliceIdsByMatch.set(matchId, new Set([...(sliceIdsByMatch.get(matchId) ?? []), slice.sliceId]));
  }
  const schedulePagesByChunk = await mapLimit(chunks(uniqueStrings(games.map((game) => game.seriesKey)), 100), 4, async (matchIds) => {
    const sliceIds = uniqueStrings(matchIds.flatMap((matchId) => [...(sliceIdsByMatch.get(matchId) ?? [])]));
    return fetchAllCargoPages(async (offset) => withScope(await client.fetchMatchSchedulesPage({ offset, matchIds: sourceScheduleIds(matchIds, corrections) }), { sliceIds, matchIds }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length));
  });
  rawEvidence.push(...schedulePagesByChunk.flatMap((page) => page.rawEvidence));
  const directTeamKeys = new Set(liveTeamSourceKeys.values());
  const directTeams = liveTeams.filter((row) => directTeamKeys.has(requiredString(row.OverviewPage, "Teams OverviewPage")));
  const renameSelection = selectRelevantTeamRenameRows(liveTeams, liveTeamRedirects, directTeamKeys);
  const reviewedTeamRows = renameSelection.rows.map((row) => {
    const supplement = corrections.find((rule) => rule.table === "Teams" && rule.row && rule.value === row.OverviewPage
      && !teamPages.rows.some((original) => original.OverviewPage === rule.value));
    return supplement ? { ...row, OverviewPage: decodeURIComponent(new URL(supplement.sourceUrl).pathname.slice("/wiki/".length)).replaceAll("_", " ") } : row;
  });
  const reviewedPageTitles = reviewedPagesForTeams(reviewedTeamRows, budget.maxReviewedPages);
  const reviewedPageBatches = await mapLimit(chunks(reviewedPageTitles, 50), 4, async (titles) => {
    const result = await client.fetchKnownPagesWithEvidence(titles);
    for (const item of result.rawEvidence) budget.consume(item, 0);
    validateReviewedPageResult(titles, result);
    return result.rawEvidence;
  });
  rawEvidence.push(...reviewedPageBatches.flat());
  const sliceIdsByGame = new Map<string, Set<string>>();
  for (const { slice, pages } of slicePages) for (const row of projectSourceRows("ScoreboardGames", pages.rows, corrections)) {
    const gameId = requiredString(row.GameId, "ScoreboardGames GameId");
    sliceIdsByGame.set(gameId, new Set([...(sliceIdsByGame.get(gameId) ?? []), slice.sliceId]));
  }
  const playerPagesByChunk = await mapLimit(chunks(games.map((game) => game.sourceKey), 100), 4, async (gameIds) => {
    const sliceIds = uniqueStrings(gameIds.flatMap((gameId) => [...(sliceIdsByGame.get(gameId) ?? [])]));
    return fetchAllCargoPages(async (offset) => withScope(await client.fetchGamePlayersPage({ offset, gameIds }), { sliceIds, gameIds }), 200, 100_000, (page) => budget.consume(page.rawEvidence, page.rows.length));
  });
  rawEvidence.push(...playerPagesByChunk.flatMap((page) => page.rawEvidence));
  const gameKeys = new Set(games.map((game) => game.sourceKey));
  const playerFactRows = projectSourceRows("ScoreboardPlayers", playerPagesByChunk.flatMap((page) => page.rows), corrections.filter((rule) => rule.table !== "ScoreboardPlayers" || gameKeys.has(rule.value)));
  const referencedPlayerKeys = new Set(referencedPlayerSourceKeys(livePlayers, playerRedirectPages.rows, playerFactRows).values());
  const referencedPlayers = livePlayers.filter((row) => {
    const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID);
    return sourceKey !== null && referencedPlayerKeys.has(sourceKey);
  });
  const playerImagePages = client.fetchPlayerImagesPage === undefined
    ? { rows: [], rawEvidence: [] }
    : (await mapLimit(chunks(uniqueStrings(referencedPlayers.map((row) => stringValue(row.OverviewPage) ?? stringValue(row.ID) ?? "")), 50), 4, async (playerPages) => fetchAllCargoPages(
      (offset) => client.fetchPlayerImagesPage!({ offset, playerPages }),
      200,
      100_000,
      (page) => budget.consume(page.rawEvidence, page.rows.length),
    ))).reduce((combined, page) => ({ rows: [...combined.rows, ...page.rows], rawEvidence: [...combined.rawEvidence, ...page.rawEvidence] }), { rows: [] as Record<string, unknown>[], rawEvidence: [] as RawApiEvidence[] });
  rawEvidence.push(...playerImagePages.rawEvidence);
  const imageRequests = mediaImageRequests(directTeams, referencedPlayers, playerRedirectPages.rows, playerImagePages.rows);
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
    const failureEvidence = error instanceof LeaguepediaCargoEnvelopeError || error instanceof LeaguepediaApiError
      ? dedupeEvidence([...rawEvidence, error.rawEvidence])
      : error instanceof LeaguepediaSnapshotError
        ? dedupeEvidence([...rawEvidence, ...error.rawEvidence])
      : rawEvidence;
    throw new LeaguepediaSnapshotError(reason.message, failureEvidence, requireHttps(request.sourceUrl), { cause: reason });
  }
}

export async function fetchLeaguepediaSnapshot(client: LeaguepediaReadClient, request: SnapshotRequest): Promise<LeaguepediaSnapshot> { return parseLeaguepediaRawInput(await fetchLeaguepediaRawInput(client, request)); }

/** Deterministic replay parser. This is the only path from retained API envelopes to provider facts. */
export function parseLeaguepediaRawInput(input: LeaguepediaRawInput, corrections: readonly SourceCorrection[] = []): LeaguepediaSnapshot {
  validateInputProvenance(input);
  validateEvidenceScopes(input);
  const evidenceRows = (item: RawApiEvidence): Record<string, unknown>[] => item.table === undefined ? strictEvidenceRows(item) : projectSourceRows(item.table, strictEvidenceRows(item), corrections.filter((rule) => rule.row === undefined));
  const correctedGameRows = projectSourceRows("ScoreboardGames", input.rawEvidence.filter((item) => item.table === "ScoreboardGames").flatMap(strictEvidenceRows), corrections);
  const gameKeys = new Set(correctedGameRows.map((row) => row.GameId));
  const applicableCorrections = corrections.filter((rule) => rule.table !== "ScoreboardPlayers" || gameKeys.has(rule.value));
  const existingEvidenceIds = new Set(input.rawEvidence.map((item) => item.requestId));
  input = { ...input, rawEvidence: [...input.rawEvidence, ...alternativeReviewEvidence(applicableCorrections, gameKeys).filter((item) => !existingEvidenceIds.has(item.requestId))] };
  const rows = (table: NonNullable<RawApiEvidence["table"]>): Record<string, unknown>[] => projectSourceRows(table, input.rawEvidence.filter((item) => item.table === table).flatMap(strictEvidenceRows), applicableCorrections);
  const teamRows = rows("Teams");
  const teamRedirectRows = rows("TeamRedirects");
  const playerRows = rows("Players");
  const playerRedirectRows = rows("PlayerRedirects");
  const tournamentRows = rows("Tournaments");
  const scheduleRows = rows("MatchSchedule");
  const gameRows = uniqueRows(rows("ScoreboardGames"), "GameId");
  const playerFactRows = rows("ScoreboardPlayers");
  const teamSourceKeys = referencedTeamSourceKeys(teamRows, teamRedirectRows, [
    ...gameRows.flatMap((row) => [requiredString(row.Team1, "ScoreboardGames Team1"), requiredString(row.Team2, "ScoreboardGames Team2")]),
    ...scheduleRows.flatMap((row) => [requiredString(row.Team1, "MatchSchedule Team1"), requiredString(row.Team2, "MatchSchedule Team2")]),
    ...playerFactRows.map((row, index) => requiredString(row.Team, `ScoreboardPlayers row ${index} Team`)),
  ], "Referenced team");
  const games = gameRows.map((row, index) => parseGame(row, index, teamSourceKeys));
  const directlyRequiredTeamKeys = new Set(teamSourceKeys.values());
  const renameSelection = selectRelevantTeamRenameRows(teamRows, teamRedirectRows, directlyRequiredTeamKeys);
  const requiredTeamKeys = new Set(renameSelection.rows.map((row) => requiredString(row.OverviewPage, "Referenced Teams OverviewPage")));
  const playerSourceKeys = referencedPlayerSourceKeys(playerRows, playerRedirectRows, playerFactRows);
  const requiredPlayerKeys = new Set(playerSourceKeys.values());
  const requiredTournamentNames = new Set(scheduleRows.map((row, index) => requiredString(row.OverviewPage, `MatchSchedule row ${index} OverviewPage`)));
  const parsedTeams = parseOptionalDimensionRows("Teams", teamRows, (row, index) => {
    const parsed = parseEntity("team", row, index);
    return { ...parsed, lineage: renameSelection.lineageBySource.get(parsed.sourceKey) ?? null };
  }, requiredTeamKeys);
  const parsedPlayers = parseOptionalDimensionRows("Players", playerRows, (row, index) => parseEntity("player", row, index), requiredPlayerKeys);
  const parsedTournaments = parseOptionalDimensionRows("Tournaments", tournamentRows, parseTournament, requiredTournamentNames, (row) => uniqueStrings([
    ...[row.OverviewPage, row.Name].flatMap((value) => stringValue(value) ?? []),
    ...splitAliases(row.StandardName),
    ...splitAliases(row.AlternativeNames),
  ]));
  const selectedTeams = filterParsedDimensions(parsedTeams, requiredTeamKeys);
  const directlySelectedTeams = filterParsedDimensions(parsedTeams, directlyRequiredTeamKeys);
  const selectedPlayers = filterParsedDimensions(parsedPlayers, requiredPlayerKeys);
  const selectedTournamentRows = referencedTournamentRows(parsedTournaments.rows, scheduleRows);
  const selectedTournamentKeys = new Set(selectedTournamentRows.map((row, index) => requiredString(row.OverviewPage, `Selected Tournaments row ${index} OverviewPage`)));
  const selectedTournaments = filterParsedDimensions(parsedTournaments, selectedTournamentKeys);
  const entities = [...selectedTeams.values, ...selectedPlayers.values];
  const tournaments = selectedTournaments.values;
  const series = parseSeries(scheduleRows, games, selectedTournamentRows, teamSourceKeys);
  validateSeriesGames(series, games);
  const seriesByKey = new Map(series.map((item) => [item.sourceKey, item]));
  for (const game of games) if (!seriesByKey.has(game.seriesKey)) throw new LeaguepediaSnapshotError(`Game ${game.sourceKey} references unknown series ${game.seriesKey}.`, input.rawEvidence, input.sourceUrl);
  const media = parseMediaEvidence(input.rawEvidence, directlySelectedTeams.rows, selectedPlayers.rows, playerRedirectRows);
  const malformedOptionalRowKeys = [...parsedTeams.malformedRowKeys, ...parsedPlayers.malformedRowKeys, ...parsedTournaments.malformedRowKeys];
  const excludedOptionalDimensionRowKeys = [
    ...excludedDimensionKeys("Teams", parsedTeams.rows, selectedTeams.rows),
    ...excludedDimensionKeys("Players", parsedPlayers.rows, selectedPlayers.rows),
    ...excludedDimensionKeys("Tournaments", parsedTournaments.rows, selectedTournaments.rows),
  ];
  const sharedTables = ["Teams", "TeamRedirects", "Players", "PlayerRedirects", "Tournaments"] as const;
  const sharedTraversals = sharedTables.map((table) => traversalFor(input.rawEvidence.filter((item) => item.table === table)));
  const slices = input.slices.map(({ sliceId, competition, sourceCompetition, seasonYear, from, to }): LeaguepediaSliceEvidence => {
    validateSliceBounds(from, to, sliceId, input);
    if (sliceId !== stableSliceId({ competition, sourceCompetition, seasonYear, from, to })) throw new LeaguepediaSnapshotError(`Retained sliceId ${sliceId} is not canonical.`, input.rawEvidence, input.sourceUrl);
    const gameEvidence = input.rawEvidence.filter((item) => item.table === "ScoreboardGames" && item.scope?.sliceIds?.includes(sliceId));
    assertSliceScope(gameEvidence, { sliceId, competition: sourceCompetition, seasonYear, from, to });
    for (const item of gameEvidence) for (const row of strictEvidenceRows(item)) validateGameRowScope(row, { sourceCompetition, from, to }, item);
    const sliceGameRows = projectSourceRows("ScoreboardGames", gameEvidence.flatMap(strictEvidenceRows), applicableCorrections);
    for (const row of sliceGameRows) validateGameRowScope(row, { sourceCompetition, from, to }, gameEvidence[0]!);
    const sliceGames = uniqueRows(sliceGameRows, "GameId").map((row, index) => parseGame(row, index, teamSourceKeys));
    const gameSourceKeys = sliceGames.map((game) => game.sourceKey);
    const sliceMatchIds = new Set(sliceGames.map((game) => game.seriesKey));
    const scheduleEvidence = input.rawEvidence.filter((item) => item.table === "MatchSchedule" && item.scope?.sliceIds?.includes(sliceId));
    for (const item of scheduleEvidence) {
      const scopedMatchIds = new Set(item.scope?.matchIds ?? []);
      if (scopedMatchIds.size === 0 || evidenceRows(item).some((row) => !scopedMatchIds.has(requiredString(row.MatchId, "MatchSchedule MatchId")))) throw new LeaguepediaSnapshotError(`Retained schedule evidence ${item.requestId} conflicts with its match scope.`, [item], item.sourceUrl);
    }
    assertEvidenceScopeCoverage(scheduleEvidence, "matchIds", "MatchId", sliceMatchIds, "MatchSchedule", "match IDs", sliceId, input, evidenceRows);
    const scheduleGroups = new Map<string, RawApiEvidence[]>();
    for (const item of scheduleEvidence) { const key = canonicalJson(item.scope?.matchIds ?? []); scheduleGroups.set(key, [...(scheduleGroups.get(key) ?? []), item]); }
    const scheduleTraversal = sliceMatchIds.size === 0 ? { requestedPages: 0, visitedPages: 0, complete: true } : scheduleGroups.size === 0 ? traversalFor([]) : combineEvidence([...scheduleGroups.values()].map(traversalFor));
    const playerEvidence = input.rawEvidence.filter((item) => item.table === "ScoreboardPlayers" && item.scope?.sliceIds?.includes(sliceId));
    for (const item of playerEvidence) {
      const scopedGameIds = new Set(item.scope?.gameIds ?? []);
      if (scopedGameIds.size === 0 || strictEvidenceRows(item).some((row) => !scopedGameIds.has(requiredString(row.GameId, "ScoreboardPlayers GameId")))) throw new LeaguepediaSnapshotError(`Retained player evidence ${item.requestId} conflicts with its game scope.`, [item], item.sourceUrl);
    }
    assertEvidenceScopeCoverage(playerEvidence, "gameIds", "GameId", gameSourceKeys, "ScoreboardPlayers", "game IDs", sliceId, input);
    const playerGroups = new Map<string, RawApiEvidence[]>();
    for (const item of playerEvidence) { const key = canonicalJson(item.scope?.gameIds ?? []); playerGroups.set(key, [...(playerGroups.get(key) ?? []), item]); }
    const playerTraversal = gameSourceKeys.length === 0 ? { requestedPages: 0, visitedPages: 0, complete: true } : playerGroups.size === 0 ? traversalFor([]) : combineEvidence([...playerGroups.values()].map(traversalFor));
    return {
      sliceId, competition, sourceCompetition, seasonYear, from, to, gameSourceKeys,
      traversal: combineEvidence([...sharedTraversals, traversalFor(gameEvidence), scheduleTraversal, playerTraversal]),
      malformedOptionalRows: malformedOptionalRowKeys.length,
      malformedOptionalRowKeys: malformedOptionalRowKeys.slice(0, 10),
      excludedOptionalDimensionRows: excludedOptionalDimensionRowKeys.length,
      excludedOptionalDimensionRowKeys: excludedOptionalDimensionRowKeys.slice(0, 10),
      outOfScopeForwardRenames: renameSelection.outOfScopeForwardRenames.length,
      outOfScopeForwardRenameSamples: renameSelection.outOfScopeForwardRenames.slice(0, 10),
    };
  });
  return {
    provenance: input.provenance,
    revisionIds: uniqueNumbers(input.rawEvidence.flatMap((item) => item.revisionIds)),
    sourceUrl: requireHttps(input.sourceUrl),
    entities,
    tournaments,
    series,
    games,
    gamePlayers: playerFactRows.map((row, index) => parseGamePlayer(row, index, playerSourceKeys, teamSourceKeys)),
    media,
    traversal: topLevelTraversal(input.rawEvidence, slices),
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
  if (evidence.table === undefined || evidence.action !== "cargoexport") throw new LeaguepediaSnapshotError("Retained CargoExport evidence lacks its table/action identity.", [evidence], evidence.sourceUrl);
  try {
    const rows = decodeCargoExportRows(evidence.table, evidence.response);
    if (rows.length > LEAGUEPEDIA_CARGO_LIMIT) throw new Error("Retained CargoExport page exceeds the 500 row limit.");
    return rows;
  } catch (error) {
    throw new LeaguepediaSnapshotError(error instanceof Error ? error.message : String(error), [evidence], evidence.sourceUrl, { cause: error });
  }
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

function parseMediaEvidence(
  evidence: readonly RawApiEvidence[],
  teamRows: readonly Record<string, unknown>[],
  playerRows: readonly Record<string, unknown>[],
  playerRedirectRows: readonly Record<string, unknown>[],
): LeaguepediaMedia[] {
  const playerImageRows = evidence.filter((item) => item.table === "PlayerImages").flatMap(strictEvidenceRows);
  const requests = mediaImageRequests(teamRows, playerRows, playerRedirectRows, playerImageRows);
  const pages = evidence.filter((item) => item.action === "query").flatMap((item) => isRecord(item.response) && isRecord(item.response.query) && Array.isArray(item.response.query.pages)
    ? item.response.query.pages.filter((page): page is Record<string, unknown> => isRecord(page) && Array.isArray(page.imageinfo)) : []);
  return requests.map((request) => {
    const page = pages.find((item) => mediaFileTitle(stringValue(item.title)) === mediaFileTitle(request.title));
    const info = page && Array.isArray(page.imageinfo) ? page.imageinfo.find(isRecord) : undefined;
    const metadata = info && isRecord(info.extmetadata) ? info.extmetadata : {};
    return { sourceKey: request.title, entityKey: request.sourceKey, sourceUrl: info ? stringValue(info.url) : null, contentType: info ? stringValue(info.mime) : null, license: metadataValue(metadata.LicenseShortName) ?? metadataValue(metadata.UsageTerms), attribution: metadataValue(metadata.Artist) ?? metadataValue(metadata.Credit) };
  });
}

function mediaFileTitle(value: string | null): string | null {
  return value?.replace(/^File:/, "").replaceAll("_", " ") ?? null;
}

function mediaImageRequests(
  teamRows: readonly Record<string, unknown>[],
  playerRows: readonly Record<string, unknown>[],
  playerRedirectRows: readonly Record<string, unknown>[],
  playerImageRows: readonly Record<string, unknown>[],
): { sourceKey: string; title: string }[] {
  const teamRequests = teamRows.flatMap((row) => {
    const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID) ?? stringValue(row.Name);
    const title = stringValue(row.Image);
    return sourceKey === null || title === null ? [] : [{ sourceKey, title }];
  });
  const profilesByPlayer = selectPlayerProfiles(playerImageRows, playerRedirectRows);
  const playerRequests = playerRows.flatMap((row) => {
    const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID);
    if (sourceKey === null) return [];
    const profileTitle = profilesByPlayer.get(sourceKey);
    const title = profileTitle ?? stringValue(row.Image);
    return title === null ? [] : [{ sourceKey, title }];
  });
  return [...teamRequests, ...playerRequests];
}

export function selectPlayerProfiles(
  rows: readonly Record<string, unknown>[],
  redirectRows: readonly Record<string, unknown>[],
): ReadonlyMap<string, string> {
  const candidates = new Map<string, Record<string, unknown>[]>();
  const profileKey = (value: unknown): unknown => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  const redirects = redirectRows.map(row => ({ ...row, OverviewPage: profileKey(row.OverviewPage), AllName: profileKey(row.AllName) }));
  for (const row of rows) {
    if (!isProfileImage(row)) continue;
    const normalized = { ...row, PlayerPage: profileKey(row.PlayerPage), PlayerRedirect: profileKey(row.PlayerRedirect), PlayerLink: profileKey(row.PlayerLink), Link: profileKey(row.Link) };
    const sourceKey = playerImageSourceKey(normalized, redirects);
    const title = stringValue(row.FileName);
    if (sourceKey === null || title === null) continue;
    candidates.set(sourceKey, [...(candidates.get(sourceKey) ?? []), row]);
  }
  return new Map([...candidates.entries()].flatMap(([sourceKey, items]) => {
    const selected = [...items].sort(comparePlayerImages)[0];
    const title = selected === undefined ? null : stringValue(selected.FileName);
    return title === null ? [] : [[sourceKey, title] as const];
  }));
}

function playerImageSourceKey(row: Record<string, unknown>, redirectRows: readonly Record<string, unknown>[]): string | null {
  const target = stringValue(row.PlayerPage);
  const link = stringValue(row.PlayerRedirect) ?? stringValue(row.PlayerLink) ?? stringValue(row.Link);
  if (target !== null && link !== null) {
    const matches = redirectRows.filter((redirect) => stringValue(redirect.OverviewPage) === target && stringValue(redirect.AllName) !== null && redirectLookupKey(stringValue(redirect.AllName)!) === redirectLookupKey(link));
    return matches.length === 1 ? target : null;
  }
  if (link === null) return null;
  const targets = uniqueStrings(redirectRows.filter((redirect) => {
    const allName = stringValue(redirect.AllName);
    return allName !== null && redirectLookupKey(allName) === redirectLookupKey(link);
  }).flatMap((redirect) => stringValue(redirect.OverviewPage) ?? []));
  return targets.length === 1 ? targets[0]! : null;
}

function isProfileImage(row: Record<string, unknown>): boolean {
  const value = row.IsProfileImage;
  return value === 1 || value === "1";
}

function comparePlayerImages(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftDate = playerImageDate(left);
  const rightDate = playerImageDate(right);
  if (leftDate !== rightDate) return rightDate - leftDate;
  const leftTitle = stringValue(left.FileName) ?? "";
  const rightTitle = stringValue(right.FileName) ?? "";
  return leftTitle < rightTitle ? -1 : leftTitle > rightTitle ? 1 : 0;
}

function playerImageDate(row: Record<string, unknown>): number {
  const value = [row.SortDate, row.TournamentDateStartFuzzy, row.TournamentDate, row.DateStartFuzzy, row.Date]
    .map(stringValue)
    .find((item): item is string => item !== null);
  if (value === undefined) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function reviewedPagesForTeams(teamRows: readonly Record<string, unknown>[], maximum: number): string[] {
  const uniquePages = uniqueStrings(teamRows.map((row, index) => requiredString(row.OverviewPage, `Teams row ${index} OverviewPage`))).sort();
  if (uniquePages.length > maximum) throw new Error(`Leaguepedia snapshot reviewed page count ${uniquePages.length} exceeds the ${maximum} page limit.`);
  return uniquePages;
}

interface RelevantTeamRenameSelection {
  rows: Record<string, unknown>[];
  lineageBySource: ReadonlyMap<string, string>;
  outOfScopeForwardRenames: string[];
}

function selectRelevantTeamRenameRows(
  teamRows: readonly Record<string, unknown>[],
  redirectRows: readonly Record<string, unknown>[],
  directSourceKeys: ReadonlySet<string>,
): RelevantTeamRenameSelection {
  const rowsBySource = new Map<string, Record<string, unknown>[]>();
  for (const [index, row] of teamRows.entries()) {
    const sourceKey = requiredString(row.OverviewPage, `Teams row ${index} OverviewPage`);
    rowsBySource.set(sourceKey, [...(rowsBySource.get(sourceKey) ?? []), row]);
  }
  for (const sourceKey of directSourceKeys) if (rowsBySource.get(sourceKey)?.length !== 1) throw new Error(`Canonical fact team ${sourceKey} lacks a unique Teams OverviewPage mapping.`);

  const redirectTargets = new Map<string, Set<string>>();
  for (const [index, row] of redirectRows.entries()) {
    const allName = requiredString(row.AllName, `TeamRedirects row ${index} AllName`);
    const target = requiredString(row._pageName, `TeamRedirects row ${index} _pageName`);
    const key = teamRedirectKey(allName);
    redirectTargets.set(key, new Set([...(redirectTargets.get(key) ?? []), target]));
  }

  const discovered = new Map<string, { source: string; target: string }>();
  const inScope = new Set<string>();
  for (const root of directSourceKeys) {
    const pathNodes = [root];
    const pathEdges: { key: string; source: string; target: string }[] = [];
    const positions = new Map<string, number>([[root, 0]]);
    let current = root;
    while (true) {
      const currentRows = rowsBySource.get(current) ?? [];
      if (currentRows.length !== 1) {
        if (directSourceKeys.has(current)) throw new Error(`Team rename closure lacks a unique Teams OverviewPage ${current}.`);
        break;
      }
      const row = currentRows[0]!;
      const renamedTo = stringValue(row.RenamedTo);
      if (renamedTo === null) break;
      const targets = [...(redirectTargets.get(teamRedirectKey(renamedTo)) ?? [])];
      if (targets.length !== 1) {
        if (targets.some((target) => directSourceKeys.has(target)) || directSourceKeys.has(renamedTo)) throw new Error(`Team RenamedTo target ${renamedTo} lacks a unique TeamRedirects AllName mapping.`);
        break;
      }
      const target = targets[0]!;
      const key = `${current}\u0000${target}`;
      const edge = { key, source: current, target };
      discovered.set(key, edge);
      pathEdges.push(edge);
      if (rowsBySource.get(target)?.length !== 1) {
        if (directSourceKeys.has(target)) throw new Error(`Team RenamedTo target ${renamedTo} lacks a unique Teams OverviewPage mapping.`);
        break;
      }
      const cycleAt = positions.get(target);
      if (cycleAt !== undefined) {
        if (pathNodes.slice(cycleAt).some((sourceKey) => directSourceKeys.has(sourceKey))) throw new Error(`Official RenamedTo closure contains a cycle at ${target}.`);
        break;
      }
      pathNodes.push(target);
      positions.set(target, pathNodes.length - 1);
      current = target;
    }
    let lastDirectNode = 0;
    for (let index = 1; index < pathNodes.length; index += 1) if (directSourceKeys.has(pathNodes[index]!)) lastDirectNode = index;
    for (let index = 0; index < lastDirectNode; index += 1) inScope.add(pathEdges[index]!.key);
  }

  const lineageBySource = new Map<string, string>();
  const selectedKeys = new Set(directSourceKeys);
  for (const key of inScope) {
    const edge = discovered.get(key)!;
    lineageBySource.set(edge.source, edge.target);
    selectedKeys.add(edge.source);
    selectedKeys.add(edge.target);
  }
  const outOfScopeForwardRenames = [...discovered.values()]
    .filter((edge) => !inScope.has(`${edge.source}\u0000${edge.target}`))
    .map((edge) => `${edge.source} -> ${edge.target}`)
    .sort();
  return {
    rows: [...selectedKeys].map((sourceKey) => rowsBySource.get(sourceKey)![0]!),
    lineageBySource,
    outOfScopeForwardRenames,
  };
}

function referencedPlayerSourceKeys(playerRows: readonly Record<string, unknown>[], redirectRows: readonly Record<string, unknown>[], playerFactRows: readonly Record<string, unknown>[]): Map<string, string> {
  const playerKeys = uniqueStrings(playerFactRows.flatMap((row) => stringValue(row.PlayerName) ?? []));
  return new Map(playerKeys.map((playerKey) => {
    const key = redirectLookupKey(playerKey);
    const targets = uniqueStrings(redirectRows.filter((row) => {
      const allName = stringValue(row.AllName);
      return allName !== null && redirectLookupKey(allName) === key;
    }).flatMap((row) => stringValue(row.OverviewPage) ?? []));
    const candidates = targets.flatMap((target) => playerRows.filter((row) => stringValue(row.OverviewPage) === target));
    if (candidates.length === 1) parseEntity("player", candidates[0]!, 0);
    const valid = candidates.filter((row, index) => { try { parseEntity("player", row, index); return true; } catch { return false; } });
    if (valid.length !== 1) throw new Error(`Player ${playerKey} lacks exactly one valid PlayerRedirects target.`);
    return [playerKey, requiredString(valid[0]!.OverviewPage, `PlayerRedirects target for ${playerKey}`)] as const;
  }));
}

function referencedTournamentRows(tournamentRows: readonly Record<string, unknown>[], scheduleRows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const sourceKeys = uniqueStrings(scheduleRows.map((row, index) => requiredString(row.OverviewPage, `MatchSchedule row ${index} OverviewPage`)));
  const wanted = new Set(sourceKeys);
  for (const sourceKey of sourceKeys) {
    if (tournamentRows.filter((row) => stringValue(row.OverviewPage) === sourceKey).length !== 1) throw new Error(`MatchSchedule tournament ${sourceKey} lacks exactly one Tournaments OverviewPage row.`);
  }
  return tournamentRows.filter((row, index) => wanted.has(requiredString(row.OverviewPage, `Tournaments row ${index} OverviewPage`)));
}

function referencedTeamSourceKeys(teamRows: readonly Record<string, unknown>[], redirectRows: readonly Record<string, unknown>[], references: readonly string[], referenceLabel: string): Map<string, string> {
  return new Map(uniqueStrings(references).map((reference) => {
    const referenceKey = teamRedirectKey(reference);
    const sourceKeys = uniqueStrings(redirectRows.filter((row) => {
      const allName = stringValue(row.AllName);
      return allName !== null && teamRedirectKey(allName) === referenceKey;
    }).map((row, index) => requiredString(row._pageName, `TeamRedirects row ${index} _pageName`)));
    if (sourceKeys.length !== 1) throw new Error(`${referenceLabel} ${reference} lacks a unique TeamRedirects AllName mapping.`);
    const matches = teamRows.filter((row) => stringValue(row.OverviewPage) === sourceKeys[0]);
    if (matches.length !== 1) throw new Error(`${referenceLabel} ${reference} redirect target ${sourceKeys[0]} lacks a unique Teams OverviewPage mapping.`);
    return [reference, sourceKeys[0]!] as const;
  }));
}

function teamRedirectKey(value: string): string { return redirectLookupKey(value); }
function redirectLookupKey(value: string): string { return value.trim().toLocaleLowerCase("en-US"); }
function requiredTeamSourceKey(sourceKeys: ReadonlyMap<string, string>, reference: string, label: string): string {
  const sourceKey = sourceKeys.get(reference);
  if (sourceKey === undefined) throw new Error(`${label} lacks a resolved TeamRedirects target.`);
  return sourceKey;
}

function validateReviewedPageResult(titles: readonly string[], result: QueryEvidenceResult): void {
  if (result.rawEvidence.length !== 1) throw new LeaguepediaSnapshotError("Known-page query must retain exactly one raw evidence envelope.", result.rawEvidence, result.rawEvidence[0]?.sourceUrl ?? "unknown");
  const evidence = result.rawEvidence[0]!;
  const query = isRecord(evidence.response) && isRecord(evidence.response.query) ? evidence.response.query : undefined;
  const pages = query !== undefined && Array.isArray(query.pages) ? query.pages.filter(isRecord) : [];
  for (const title of titles) {
    const matches = pages.filter((page) => stringValue(page.title) === title);
    const revisions = matches.length === 1 && Array.isArray(matches[0]!.revisions) ? matches[0]!.revisions.filter(isRecord) : [];
    const pageId = matches.length === 1 ? matches[0]!.pageid : undefined;
    const revisionIds = revisions.flatMap((revision) => typeof revision.revid === "number" && Number.isInteger(revision.revid) && revision.revid > 0 ? [revision.revid] : []);
    if (matches.length !== 1 || typeof pageId !== "number" || !Number.isInteger(pageId) || pageId <= 0 || revisionIds.length === 0
      || revisionIds.some((revisionId) => !evidence.revisionIds.includes(revisionId))) {
      throw new LeaguepediaSnapshotError(`Known Leaguepedia page ${title} lacks exact page/revision evidence.`, result.rawEvidence, evidence.sourceUrl);
    }
  }
}

function parseEntity(kind: "team" | "player", row: Record<string, unknown>, index: number): LeaguepediaEntity {
  const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID);
  if (sourceKey === null) throw new Error(`${kind} row ${index} is missing a stable source key.`);
  return {
    kind,
    sourceKey,
    displayName: requiredString(row.Name, `${kind} ${sourceKey} Name`),
    ...(kind === "player" ? { playerId: requiredString(row.ID, `player ${sourceKey} ID`) } : {}),
    aliases: [...splitAliases(row.Short), ...splitAliases(row.Aliases)],
    ...(kind === "team" ? { region: stringValue(row.Region) } : {}),
    ...(kind === "team" ? { lineage: stringValue(row.RenamedTo) } : {}),
    validFrom: optionalDate(row.DateStart, sourceKey),
    validTo: optionalDate(row.DateEnd, sourceKey),
  };
}

function parseOptionalDimensionRows<T>(
  table: "Teams" | "Players" | "Tournaments",
  rows: readonly Record<string, unknown>[],
  parseRow: (row: Record<string, unknown>, index: number) => T,
  requiredKeys: ReadonlySet<string>,
  keysForRow: (row: Record<string, unknown>) => readonly string[] = (row) => [stringValue(row.OverviewPage) ?? stringValue(row.ID) ?? ""],
): { rows: Record<string, unknown>[]; values: T[]; malformedRowKeys: string[] } {
  const retainedRows: Record<string, unknown>[] = [];
  const values: T[] = [];
  const malformedRowKeys: string[] = [];
  for (const [index, row] of rows.entries()) {
    try {
      const value = parseRow(row, index);
      retainedRows.push(row);
      values.push(value);
    } catch (error) {
      if (keysForRow(row).some((key) => requiredKeys.has(key))) throw error;
      malformedRowKeys.push(`${table}:${stringValue(row.OverviewPage) ?? stringValue(row.ID) ?? `row-${index}`}`);
    }
  }
  return { rows: retainedRows, values, malformedRowKeys };
}

function filterParsedDimensions<T>(parsed: { rows: readonly Record<string, unknown>[]; values: readonly T[] }, keys: ReadonlySet<string>): { rows: Record<string, unknown>[]; values: T[] } {
  const rows: Record<string, unknown>[] = [];
  const values: T[] = [];
  for (const [index, row] of parsed.rows.entries()) {
    const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID);
    if (sourceKey !== null && keys.has(sourceKey)) { rows.push(row); values.push(parsed.values[index]!); }
  }
  return { rows, values };
}

function excludedDimensionKeys(table: "Teams" | "Players" | "Tournaments", allRows: readonly Record<string, unknown>[], selectedRows: readonly Record<string, unknown>[]): string[] {
  const selected = new Set(selectedRows.map((row) => stringValue(row.OverviewPage) ?? stringValue(row.ID)));
  return allRows.flatMap((row, index) => {
    const sourceKey = stringValue(row.OverviewPage) ?? stringValue(row.ID) ?? `row-${index}`;
    return selected.has(sourceKey) ? [] : [`${table}:${sourceKey}`];
  });
}

function parseTournament(row: Record<string, unknown>, index: number): LeaguepediaTournament {
  const sourceKey = requiredString(row.OverviewPage, `Tournaments row ${index} OverviewPage`);
  return { sourceKey, displayName: requiredString(row.Name, `Tournament ${sourceKey} Name`), validFrom: optionalDate(row.DateStart, sourceKey), validTo: optionalDate(row.DateEnd, sourceKey) };
}

function parseGame(row: Record<string, unknown>, index: number, teamSourceKeys: ReadonlyMap<string, string>): LeaguepediaGame {
  const sourceKey = requiredString(row.GameId, `ScoreboardGames row ${index} GameId`);
  const seriesKey = requiredString(row.MatchId, `Game ${sourceKey} MatchId`);
  const rawSideA = requiredString(row.Team1, `Game ${sourceKey} Team1`);
  const rawSideB = requiredString(row.Team2, `Game ${sourceKey} Team2`);
  const sideATeam = requiredTeamSourceKey(teamSourceKeys, rawSideA, `Game ${sourceKey} Team1`);
  const sideBTeam = requiredTeamSourceKey(teamSourceKeys, rawSideB, `Game ${sourceKey} Team2`);
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

function parseSeries(scheduleRows: readonly Record<string, unknown>[], games: readonly LeaguepediaGame[], tournamentRows: readonly Record<string, unknown>[], teamSourceKeys: ReadonlyMap<string, string>): LeaguepediaSeries[] {
  const gamesByMatch = new Map<string, LeaguepediaGame[]>();
  for (const game of games) gamesByMatch.set(game.seriesKey, [...(gamesByMatch.get(game.seriesKey) ?? []), game]);
  const schedulesByMatch = new Map<string, Record<string, unknown>[]>();
  for (const [index, row] of scheduleRows.entries()) {
    const matchId = requiredString(row.MatchId, `MatchSchedule row ${index} MatchId`);
    requiredString(row.UniqueMatch, `MatchSchedule ${matchId} UniqueMatch`);
    if (!gamesByMatch.has(matchId)) throw new Error(`Orphan MatchSchedule row ${matchId} does not join an imported MatchId.`);
    schedulesByMatch.set(matchId, [...(schedulesByMatch.get(matchId) ?? []), row]);
  }
  return [...gamesByMatch.entries()].map(([sourceKey, matchGames]) => {
    const schedules = schedulesByMatch.get(sourceKey) ?? [];
    if (schedules.length !== 1) throw new Error(`Imported MatchId ${sourceKey} requires exactly one retained MatchSchedule row; found ${schedules.length}.`);
    const schedule = schedules[0]!;
    const tournamentKey = requiredString(schedule.OverviewPage, `MatchSchedule ${sourceKey} OverviewPage`);
    requiredTimestamp(schedule.DateTime_UTC, `MatchSchedule ${sourceKey}`);
    if (tournamentRows.filter((row) => stringValue(row.OverviewPage) === tournamentKey).length !== 1) throw new Error(`MatchSchedule ${sourceKey} tournament ${tournamentKey} lacks exactly one Tournaments OverviewPage row.`);
    const rawSideA = requiredString(schedule.Team1, `MatchSchedule ${sourceKey} Team1`);
    const rawSideB = requiredString(schedule.Team2, `MatchSchedule ${sourceKey} Team2`);
    const sideATeam = requiredTeamSourceKey(teamSourceKeys, rawSideA, `MatchSchedule ${sourceKey} Team1`);
    const sideBTeam = requiredTeamSourceKey(teamSourceKeys, rawSideB, `MatchSchedule ${sourceKey} Team2`);
    if (sideATeam === sideBTeam) throw new Error(`MatchSchedule ${sourceKey} has identical sides.`);
    const bestOfValue = positiveInteger(schedule.BestOf, `MatchSchedule ${sourceKey} BestOf`);
    if (bestOfValue !== 1 && bestOfValue !== 2 && bestOfValue !== 3 && bestOfValue !== 5) throw new Error(`MatchSchedule ${sourceKey} BestOf must be 1, 2, 3, or 5.`);
    const bestOf = bestOfValue as 1 | 2 | 3 | 5;
    const sideAScore = nonNegativeInteger(schedule.Team1Score, `MatchSchedule ${sourceKey} Team1Score`);
    const sideBScore = nonNegativeInteger(schedule.Team2Score, `MatchSchedule ${sourceKey} Team2Score`);
    validateCompletedScore(bestOf, sideAScore, sideBScore, sourceKey);
    const winner = requiredInteger(schedule.Winner, `MatchSchedule ${sourceKey} Winner`);
    if (winner !== 0 && winner !== 1 && winner !== 2) throw new Error(`MatchSchedule ${sourceKey} Winner must be draw or side 1 or 2.`);
    const expectedWinner = sideAScore === sideBScore ? 0 : sideAScore > sideBScore ? 1 : 2;
    if (winner !== expectedWinner) throw new Error(`MatchSchedule ${sourceKey} winner conflicts with final score ${sideAScore}-${sideBScore}.`);
    for (const game of matchGames) {
      const normalOrder = game.sideATeam === sideATeam && game.sideBTeam === sideBTeam;
      const reversedOrder = game.sideATeam === sideBTeam && game.sideBTeam === sideATeam;
      if (!normalOrder && !reversedOrder) throw new Error(`MatchSchedule ${sourceKey} teams do not match the imported game pair.`);
    }
    const playedAt = matchGames.reduce((earliest, game) => new Date(game.playedAt).valueOf() < new Date(earliest).valueOf() ? game.playedAt : earliest, matchGames[0]!.playedAt);
    return { sourceKey, tournamentKey, playedAt, sideATeam, sideBTeam, bestOf, sideAScore, sideBScore };
  });
}

function parseGamePlayer(row: Record<string, unknown>, index: number, playerSourceKeys: ReadonlyMap<string, string>, teamSourceKeys: ReadonlyMap<string, string>): LeaguepediaGamePlayer {
  const playerWin = requiredString(row.PlayerWin, `ScoreboardPlayers row ${index} PlayerWin`);
  if (playerWin !== "Yes" && playerWin !== "No") throw new Error(`ScoreboardPlayers row ${index} PlayerWin must be Yes or No.`);
  const playerName = requiredString(row.PlayerName, `ScoreboardPlayers row ${index} PlayerName`);
  const playerKey = playerSourceKeys.get(playerName);
  if (playerKey === undefined) throw new Error(`ScoreboardPlayers row ${index} player ${playerName} lacks a resolved PlayerRedirects target.`);
  return {
    gameKey: requiredString(row.GameId, `ScoreboardPlayers row ${index} GameId`),
    playerKey,
    teamKey: requiredTeamSourceKey(teamSourceKeys, requiredString(row.Team, `ScoreboardPlayers row ${index} Team`), `ScoreboardPlayers row ${index} Team`),
    playerWin: playerWin === "Yes",
  };
}

function validateSeriesGames(series: readonly LeaguepediaSeries[], games: readonly LeaguepediaGame[]): void {
  for (const item of series) {
    const rows = games.filter((game) => game.seriesKey === item.sourceKey).sort((a, b) => a.gameNumber - b.gameNumber);
    const expected = (item.sideAScore ?? 0) + (item.sideBScore ?? 0);
    const numbers = rows.map((game) => game.gameNumber);
    const sideAWins = rows.filter((game) => game.winnerTeam === item.sideATeam).length;
    const sideBWins = rows.filter((game) => game.winnerTeam === item.sideBTeam).length;
    const hasInvalidNumbers = new Set(numbers).size !== numbers.length || numbers.some((number) => number > expected);
    if (rows.length > expected || hasInvalidNumbers || sideAWins > (item.sideAScore ?? 0) || sideBWins > (item.sideBScore ?? 0)) {
      throw new Error(`Series ${item.sourceKey} game rows conflict with final score ${item.sideAScore}-${item.sideBScore} (rows=${rows.length}/${expected}, numbers=${numbers.join(",")}, wins=${sideAWins}-${sideBWins}).`);
    }
  }
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
      const page = pages.find((item) => mediaFileTitle(stringValue(item.title)) === mediaFileTitle(request.title));
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
  if (!sameSourceKey(tournament, scope.sourceCompetition)) throw new LeaguepediaSnapshotError(`Retained game row tournament ${tournament} does not match requested source key ${scope.sourceCompetition}.`, [evidence], evidence.sourceUrl);
  const timestamp = requiredTimestamp(row.DateTime_UTC, requiredString(row.GameId, "ScoreboardGames GameId"));
  const playedAt = new Date(timestamp).valueOf(); const from = new Date(`${scope.from}T00:00:00Z`).valueOf(); const to = new Date(`${scope.to}T00:00:00Z`).valueOf();
  if (playedAt < from || playedAt >= to) throw new LeaguepediaSnapshotError(`Retained game row timestamp ${timestamp} is outside [${scope.from}, ${scope.to}).`, [evidence], evidence.sourceUrl);
}
function validateSliceBounds(from: string, to: string, sliceId: string, input: LeaguepediaRawInput): void {
  const format = /^\d{4}-\d{2}-\d{2}$/;
  const fromTime = new Date(`${from}T00:00:00Z`).valueOf(); const toTime = new Date(`${to}T00:00:00Z`).valueOf();
  if (!format.test(from) || !format.test(to) || !Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime >= toTime) throw new LeaguepediaSnapshotError(`Retained slice ${sliceId} has invalid date bounds.`, input.rawEvidence, input.sourceUrl);
}
function sameSourceKey(left: string, right: string): boolean { return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase(); }
function validateEvidenceScopes(input: LeaguepediaRawInput): void {
  const declared = new Set(input.slices.map((slice) => slice.sliceId));
  if (declared.size !== input.slices.length) throw new LeaguepediaSnapshotError("Retained input contains duplicate sliceIds.", input.rawEvidence, input.sourceUrl);
  for (const item of input.rawEvidence) if (item.table === "MatchSchedule" || item.table === "ScoreboardGames" || item.table === "ScoreboardPlayers") {
    const sliceIds = item.scope?.sliceIds ?? [];
    if (sliceIds.length === 0 || sliceIds.some((sliceId) => !declared.has(sliceId))) throw new LeaguepediaSnapshotError(`Retained evidence ${item.requestId} has an unknown or missing slice scope.`, [item], item.sourceUrl);
  }
}
function assertEvidenceScopeCoverage(
  evidence: readonly RawApiEvidence[],
  scopeKey: "matchIds" | "gameIds",
  rowKey: "MatchId" | "GameId",
  requiredIds: Iterable<string>,
  table: "MatchSchedule" | "ScoreboardPlayers",
  idLabel: "match IDs" | "game IDs",
  sliceId: string,
  input: LeaguepediaRawInput,
  readRows: (item: RawApiEvidence) => Record<string, unknown>[] = strictEvidenceRows,
): void {
  const required = [...requiredIds];
  const declaredIds = new Set(evidence.flatMap((item) => item.scope?.[scopeKey] ?? []));
  const missingDeclaredIds = required.filter((id) => !declaredIds.has(id));
  if (missingDeclaredIds.length > 0) {
    const sample = missingDeclaredIds.slice(0, 3).join(", ");
    throw new LeaguepediaSnapshotError(
      `Retained ${table} evidence scope does not cover ${missingDeclaredIds.length} required ${idLabel} for slice ${sliceId}; sample: ${sample}.`,
      evidence,
      input.sourceUrl,
    );
  }
  const observedIds = new Set(evidence.flatMap(readRows).map((row) => requiredString(row[rowKey], `${table} ${rowKey}`)));
  // 真正空 roster 交給 normalization 標示 partial；出現在錯誤 slice 的資料仍拒絕。
  const allObservedIds = table === "ScoreboardPlayers" ? new Set(input.rawEvidence.filter((item) => item.table === table).flatMap(readRows).map((row) => requiredString(row[rowKey], `${table} ${rowKey}`))) : null;
  const missingObservedIds = required.filter((id) => !observedIds.has(id) && (allObservedIds === null || allObservedIds.has(id)));
  if (missingObservedIds.length > 0) {
    const sample = missingObservedIds.slice(0, 3).join(", ");
    throw new LeaguepediaSnapshotError(
      `Retained ${table} evidence response does not cover ${missingObservedIds.length} required ${idLabel} for slice ${sliceId}; sample: ${sample}.`,
      evidence,
      input.sourceUrl,
    );
  }
}
class SnapshotBudget {
  readonly #limits: SnapshotResourceLimits;
  readonly #evidence: RawApiEvidence[] = [];
  #bytes = 0; #pages = 0; #rows = 0;
  constructor(limits: Partial<SnapshotResourceLimits> | undefined, readonly sourceUrl: string) {
    this.#limits = {
      maxBytes: positiveLimit(limits?.maxBytes ?? 100_000_000, "maxBytes"),
      maxPages: positiveLimit(limits?.maxPages ?? 2_000, "maxPages"),
      maxRows: positiveLimit(limits?.maxRows ?? 500_000, "maxRows"),
      maxReviewedPages: positiveLimit(limits?.maxReviewedPages ?? 5_000, "maxReviewedPages"),
    };
  }
  get maxReviewedPages(): number { return this.#limits.maxReviewedPages; }
  consume(evidence: RawApiEvidence, rows: number): void {
    this.#evidence.push(evidence); this.#pages += 1; this.#rows += rows; this.#bytes += evidence.responseBytes ?? new TextEncoder().encode(JSON.stringify(evidence.response)).byteLength;
    if (this.#bytes > this.#limits.maxBytes || this.#pages > this.#limits.maxPages || this.#rows > this.#limits.maxRows) throw new LeaguepediaSnapshotError(`Leaguepedia snapshot exceeds its global resource budget (${this.#bytes} bytes, ${this.#pages} pages, ${this.#rows} rows).`, [...this.#evidence], this.sourceUrl);
  }
}
function positiveLimit(value: number, name: string): number { if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`); return value; }
function validateCompletedScore(bestOf: 1 | 2 | 3 | 5, a: number, b: number, sourceKey: string): void { if (!isCompletedSeriesScore(bestOf, a, b)) throw new Error(`Series ${sourceKey} score is inconsistent with BestOf ${bestOf}.`); }
function topLevelTraversal(evidence: readonly RawApiEvidence[], slices: readonly LeaguepediaSliceEvidence[]): TraversalEvidence {
  const requestIds = new Set(evidence.map((item, index) => requiredString(item.requestId, `Raw evidence row ${index} requestId`)));
  return { requestedPages: requestIds.size, visitedPages: requestIds.size, complete: slices.every((slice) => slice.traversal.complete) };
}
function combineEvidence(items: readonly TraversalEvidence[]): TraversalEvidence { return { requestedPages: items.reduce((sum, item) => sum + item.requestedPages, 0), visitedPages: items.reduce((sum, item) => sum + item.visitedPages, 0), complete: items.every((item) => item.complete) }; }
function chunks<T>(items: readonly T[], size: number): T[][] { const result: T[][] = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }
function splitAliases(value: unknown): string[] { return (stringValue(value) ?? "").split(/[,;/]/).map((item) => item.trim()).filter(Boolean); }
function requiredString(value: unknown, name: string): string { const result = stringValue(value); if (result === null) throw new Error(`${name} is required.`); return result; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function requiredInteger(value: unknown, name: string): number { const result = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN; if (!Number.isInteger(result)) throw new Error(`${name} must be an integer.`); return result; }
function nonNegativeInteger(value: unknown, name: string): number { const result = requiredInteger(value, name); if (result < 0) throw new Error(`${name} must be non-negative.`); return result; }
function positiveInteger(value: unknown, name: string): number { const result = requiredInteger(value, name); if (result <= 0) throw new Error(`${name} must be positive.`); return result; }
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
