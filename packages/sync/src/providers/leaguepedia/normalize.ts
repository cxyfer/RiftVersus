import { createHash } from "node:crypto";

import type { GameFactInput, GamePlayerInput, SeriesFactInput } from "@riftversus/database";

import type { ReviewedOverrides } from "../../overrides.js";
import type { StagedEntityDefinition, StagedRegionDefinition, StagedTeamEraDefinition, StagedTournamentDefinition } from "../../types.js";
import type {
  LeaguepediaCoverage, LeaguepediaCoverageEvidence, LeaguepediaNormalizationResult, LeaguepediaSnapshot,
  NormalizedLeaguepediaEntity, QuarantinedIdentity,
} from "./types.js";

const PROVIDER = "leaguepedia";

export function normalizeLeaguepediaSnapshot(snapshot: LeaguepediaSnapshot, overrides: ReviewedOverrides): LeaguepediaNormalizationResult {
  const sourceGameKeys = new Set(snapshot.games.map((game) => game.sourceKey));
  for (const player of snapshot.gamePlayers) if (!sourceGameKeys.has(player.gameKey)) throw new Error(`Player fact references unknown game ${player.gameKey}.`);
  const collisionKeys = ambiguousKeys(snapshot);
  const entities: NormalizedLeaguepediaEntity[] = [];
  const entityIds = new Map<string, string>();
  const eraIds = new Map<string, string>();
  const quarantine: QuarantinedIdentity[] = [];
  const entityDefinitions = new Map<string, StagedEntityDefinition>();
  const regionDefinitions = new Map<string, StagedRegionDefinition>();
  const teamEras: StagedTeamEraDefinition[] = [];
  const inferredEraObservations: { sourceKey: string; observed: { from: string; to: string }; validFrom: string | null; validTo: string | null }[] = [];
  const observedTeamDates = observedTeamFactDates(snapshot);
  const inferredTeamValidity = inferTeamValidity(snapshot, overrides, observedTeamDates);

  for (const entity of snapshot.entities) {
    const override = overrides.identities.get(entity.sourceKey);
    if (override !== undefined && override.kind !== undefined && override.kind !== entity.kind) throw new Error(`Reviewed override kind conflicts with ${entity.sourceKey}.`);
    if (collisionKeys.has(entity.sourceKey) && override === undefined) {
      quarantine.push({ sourceKey: entity.sourceKey, reason: "ambiguous_name" });
      continue;
    }
    const canonicalId = override?.canonicalId ?? stableUuid(`entity:${entity.kind}:${entity.sourceKey}`);
    const normalized: NormalizedLeaguepediaEntity = {
      ...entity,
      aliases: unique([...(override?.aliases ?? []), ...entity.aliases]),
      canonicalId,
      canonicalName: override?.canonicalName ?? entity.displayName,
      precedence: override === undefined ? "leaguepedia" : "override",
      ...(override?.validFrom === undefined ? {} : { validFrom: override.validFrom }),
      ...(override?.validTo === undefined ? {} : { validTo: override.validTo }),
    };
    entities.push(normalized);
    entityIds.set(entity.sourceKey, canonicalId);
    const previous = entityDefinitions.get(canonicalId);
    if (previous !== undefined && previous.kind !== entity.kind) throw new Error(`Canonical identity ${canonicalId} mixes entity kinds.`);
    entityDefinitions.set(canonicalId, {
      id: canonicalId,
      provider: PROVIDER,
      sourceKeys: unique([...(previous?.sourceKeys ?? []), entity.sourceKey]),
      kind: entity.kind,
      canonicalName: normalized.canonicalName,
      aliases: unique([...(previous?.aliases ?? []), normalized.displayName, ...normalized.aliases]),
    });
    if (entity.kind === "team") {
      const observed = observedTeamDates.get(entity.sourceKey);
      const hasReviewedValidity = override?.validFrom !== undefined || override?.validTo !== undefined;
      if (observed === undefined && !hasReviewedValidity) continue;
      const regionOverride = entity.region ? overrides.regions.get(entity.region) : undefined;
      const regionId = entity.region ? regionOverride?.canonicalId ?? stableUuid(`region:${entity.region}`) : null;
      if (entity.region && regionId) regionDefinitions.set(regionId, { id: regionId, provider: PROVIDER, sourceKey: entity.region, name: regionOverride?.canonicalName ?? entity.region });
      const inferred = inferredTeamValidity.get(entity.sourceKey);
      const validFrom = hasReviewedValidity ? normalized.validFrom ?? null : inferred?.validFrom ?? null;
      const validTo = hasReviewedValidity ? normalized.validTo ?? null : inferred?.validTo ?? null;
      if (!hasReviewedValidity && observed !== undefined) inferredEraObservations.push({ sourceKey: entity.sourceKey, observed, validFrom, validTo });
      const eraId = stableUuid(`team-era:${entity.sourceKey}:${validFrom ?? ""}:${validTo ?? ""}`);
      eraIds.set(entity.sourceKey, eraId);
      teamEras.push({ id: eraId, provider: PROVIDER, sourceKey: entity.sourceKey, teamEntityId: canonicalId, displayName: entity.displayName, regionId, validFrom, validTo });
    }
  }

  for (const entity of entities) {
    if (entity.kind !== "team" || !entity.lineage) continue;
    const sourceId = entityIds.get(entity.sourceKey);
    const targetId = entityIds.get(entity.lineage);
    if (sourceId === undefined || targetId === undefined || sourceId !== targetId) {
      throw new Error(`Official RenamedTo lineage ${entity.sourceKey} -> ${entity.lineage} must resolve to the same reviewed canonical identity.`);
    }
  }
  for (const { sourceKey, observed, validFrom, validTo } of inferredEraObservations) {
    if ((validFrom !== null && observed.from < validFrom) || (validTo !== null && observed.to > validTo)) {
      throw new Error(`Team ${sourceKey} observed facts ${observed.from}..${observed.to} fall outside inferred era ${validFrom ?? "open"}..${validTo ?? "open"}.`);
    }
  }

  const tournamentIds = new Map<string, string>();
  const tournaments: StagedTournamentDefinition[] = snapshot.tournaments.map((item) => {
    const override = overrides.tournaments.get(item.sourceKey);
    const id = override?.canonicalId ?? stableUuid(`tournament:${item.sourceKey}`);
    tournamentIds.set(item.sourceKey, id);
    const seasonYear = yearFrom(item.validFrom);
    const name = override?.canonicalName ?? item.displayName;
    return { id, provider: PROVIDER, sourceKey: item.sourceKey, name, aliases: unique([item.displayName, name]), category: override?.category ?? tournamentCategory(item.displayName), seasonYear, validFrom: item.validFrom ?? null, validTo: item.validTo ?? null };
  });

  const quarantinedKeys = new Set(quarantine.map((item) => item.sourceKey));
  const quarantinedSeriesKeys = new Set(snapshot.series.filter((item) => quarantinedKeys.has(item.sideATeam) || quarantinedKeys.has(item.sideBTeam)).map((item) => item.sourceKey));
  const quarantineAffectedGameKeys = new Set(snapshot.games.filter((item) => quarantinedSeriesKeys.has(item.seriesKey) || quarantinedKeys.has(item.sideATeam) || quarantinedKeys.has(item.sideBTeam)).map((item) => item.sourceKey));
  for (const item of snapshot.gamePlayers) if (quarantinedKeys.has(item.playerKey) || quarantinedKeys.has(item.teamKey)) quarantineAffectedGameKeys.add(item.gameKey);

  const seriesIds = new Map<string, string>();
  const seriesByKey = new Map(snapshot.series.map((item) => [item.sourceKey, item]));
  const series: SeriesFactInput[] = snapshot.series.filter((item) => !quarantinedSeriesKeys.has(item.sourceKey)).map((item) => {
    const tournamentId = tournamentIds.get(item.tournamentKey);
    if (tournamentId === undefined) throw new Error(`Series ${item.sourceKey} references unknown tournament ${item.tournamentKey}.`);
    const sideATeamId = requiredEntityId(entityIds, item.sideATeam, item.sourceKey);
    const sideBTeamId = requiredEntityId(entityIds, item.sideBTeam, item.sourceKey);
    if (sideATeamId === sideBTeamId) throw new Error(`Series ${item.sourceKey} has identical canonical sides.`);
    const scores = completedScores(item.bestOf, item.sideAScore, item.sideBScore, item.sourceKey);
    const id = stableUuid(`series:${item.sourceKey}`);
    const sideAEra = selectEra(teamEras, sideATeamId, item.playedAt, item.sourceKey);
    const sideBEra = selectEra(teamEras, sideBTeamId, item.playedAt, item.sourceKey);
    seriesIds.set(item.sourceKey, id);
    return {
      id, provider: PROVIDER, sourceKey: item.sourceKey, tournamentId, playedAt: validDate(item.playedAt, item.sourceKey),
      bestOf: item.bestOf, completed: true, sideATeamId, sideAEraId: sideAEra.id, sideARegionId: sideAEra.regionId ?? null,
      sideBTeamId, sideBEraId: sideBEra.id, sideBRegionId: sideBEra.regionId ?? null,
      sideAScore: scores.a, sideBScore: scores.b, winnerTeamId: scores.a > scores.b ? sideATeamId : sideBTeamId,
    };
  });

  const gameIds = new Map<string, string>();
  const games: GameFactInput[] = snapshot.games.filter((item) => !quarantineAffectedGameKeys.has(item.sourceKey)).map((item) => {
    const seriesId = seriesIds.get(item.seriesKey);
    const sourceSeries = seriesByKey.get(item.seriesKey);
    if (seriesId === undefined || sourceSeries === undefined) throw new Error(`Game ${item.sourceKey} references an unknown explicit series.`);
    const normalOrder = item.sideATeam === sourceSeries.sideATeam && item.sideBTeam === sourceSeries.sideBTeam;
    const reversedOrder = item.sideATeam === sourceSeries.sideBTeam && item.sideBTeam === sourceSeries.sideATeam;
    if (!normalOrder && !reversedOrder) throw new Error(`Game ${item.sourceKey} sides conflict with series ${item.seriesKey}.`);
    const sideATeamId = requiredEntityId(entityIds, item.sideATeam, item.sourceKey);
    const sideBTeamId = requiredEntityId(entityIds, item.sideBTeam, item.sourceKey);
    const winnerTeamId = item.winnerTeam === null ? null : requiredEntityId(entityIds, item.winnerTeam, item.sourceKey);
    if (winnerTeamId !== sideATeamId && winnerTeamId !== sideBTeamId) throw new Error(`Game ${item.sourceKey} winner is not a side.`);
    const playedAt = validDate(item.playedAt, item.sourceKey);
    if (playedAt < validDate(sourceSeries.playedAt, sourceSeries.sourceKey)) throw new Error(`Game ${item.sourceKey} precedes its series.`);
    const id = stableUuid(`game:${item.sourceKey}`);
    const sideAEra = selectEra(teamEras, sideATeamId, item.playedAt, item.sourceKey);
    const sideBEra = selectEra(teamEras, sideBTeamId, item.playedAt, item.sourceKey);
    gameIds.set(item.sourceKey, id);
    return {
      id, provider: PROVIDER, sourceKey: item.sourceKey, seriesId, gameNumber: positiveInteger(item.gameNumber, item.sourceKey), playedAt,
      sideATeamId, sideAEraId: sideAEra.id, sideARegionId: sideAEra.regionId ?? null,
      sideBTeamId, sideBEraId: sideBEra.id, sideBRegionId: sideBEra.regionId ?? null, winnerTeamId,
    };
  });

  const gamesById = new Map(games.map((game) => [game.id, game]));
  const rosterIncompleteGameKeys = new Set<string>();
  const authoritativeRosterGames = new Set<string>();
  for (const game of snapshot.games.filter((item) => !quarantineAffectedGameKeys.has(item.sourceKey))) {
    const roster = snapshot.gamePlayers.filter((item) => item.gameKey === game.sourceKey);
    const traversalComplete = snapshot.slices.filter((slice) => slice.gameSourceKeys.includes(game.sourceKey)).every((slice) => slice.traversal.complete);
    if (roster.length < 10 || !traversalComplete) { rosterIncompleteGameKeys.add(game.sourceKey); continue; }
    if (roster.length > 10) throw new Error(`Game ${game.sourceKey} roster exceeds 10 players.`);
    const uniquePlayers = new Set(roster.map((item) => item.playerKey));
    if (uniquePlayers.size !== 10) throw new Error(`Game ${game.sourceKey} roster contains duplicate players.`);
    const sideA = roster.filter((item) => item.teamKey === game.sideATeam).length;
    const sideB = roster.filter((item) => item.teamKey === game.sideBTeam).length;
    if (sideA !== 5 || sideB !== 5) throw new Error(`Game ${game.sourceKey} roster must contain five players per side.`);
    authoritativeRosterGames.add(game.sourceKey);
  }
  const playerFacts = new Set<string>();
  const gamePlayers: GamePlayerInput[] = snapshot.gamePlayers.filter((item) => authoritativeRosterGames.has(item.gameKey)).map((item) => {
    const gameId = gameIds.get(item.gameKey);
    if (gameId === undefined) throw new Error(`Player fact references unknown game ${item.gameKey}.`);
    const game = gamesById.get(gameId)!;
    const playerEntityId = requiredEntityId(entityIds, item.playerKey, item.gameKey);
    const teamEntityId = requiredEntityId(entityIds, item.teamKey, item.gameKey);
    const side = teamEntityId === game.sideATeamId ? "a" : teamEntityId === game.sideBTeamId ? "b" : null;
    if (side === null) throw new Error(`Player ${item.playerKey} team does not match game ${item.gameKey}.`);
    const expectedWin = teamEntityId === game.winnerTeamId;
    if (item.playerWin !== expectedWin) throw new Error(`Player ${item.playerKey} winner flag contradicts game ${item.gameKey}.`);
    const factKey = `${gameId}:${playerEntityId}`;
    if (playerFacts.has(factKey)) throw new Error(`Duplicate player participation ${item.gameKey}:${item.playerKey}.`);
    playerFacts.add(factKey);
    return { gameId, playerEntityId, teamEntityId, side };
  });

  return {
    entities,
    entityIds,
    eraIds,
    quarantine,
    quarantineAffectedGameKeys: [...quarantineAffectedGameKeys],
    rosterIncompleteGameKeys: [...rosterIncompleteGameKeys],
    dimensions: { entities: [...entityDefinitions.values()], teamEras, regions: [...regionDefinitions.values()], tournaments },
    facts: { series, games, gamePlayers },
    rosterGameIds: [...authoritativeRosterGames].map((key) => gameIds.get(key)!).filter(Boolean),
  };
}

export function deriveLeaguepediaCoverage(evidence: LeaguepediaCoverageEvidence): LeaguepediaCoverage {
  const base = { provider: PROVIDER, competition: evidence.competition, seasonYear: evidence.seasonYear, earliestDate: evidence.earliestDate ?? null, latestDate: evidence.latestDate ?? null };
  if (evidence.observedRows === 0) return { ...base, status: "missing", detail: "No rows returned; zero rows never prove coverage." };
  if (!evidence.traversal.complete || evidence.traversal.visitedPages !== evidence.traversal.requestedPages) return { ...base, status: "partial", detail: `Visited ${evidence.traversal.visitedPages} of ${evidence.traversal.requestedPages} bounded pages.` };
  if ((evidence.unresolvedRows ?? 0) > 0) return { ...base, status: "partial", detail: `${evidence.unresolvedRows} provider rows or identities remain quarantined.` };
  return { ...base, status: "complete", detail: `Verified ${evidence.observedRows} rows across ${evidence.traversal.visitedPages} bounded pages.` };
}

function ambiguousKeys(snapshot: LeaguepediaSnapshot): Set<string> { const owners = new Map<string, Set<string>>(); for (const entity of snapshot.entities) for (const name of [entity.displayName, ...entity.aliases]) { const key = name.trim().toLocaleLowerCase(); if (key) owners.set(key, new Set([...(owners.get(key) ?? []), entity.sourceKey])); } return new Set([...owners.values()].filter((values) => values.size > 1).flatMap((values) => [...values])); }
function observedTeamFactDates(snapshot: LeaguepediaSnapshot): Map<string, { from: string; to: string }> {
  const result = new Map<string, { from: string; to: string }>();
  for (const fact of [...snapshot.series, ...snapshot.games]) {
    validDate(fact.playedAt, fact.sourceKey);
    const day = fact.playedAt.slice(0, 10);
    for (const sourceKey of [fact.sideATeam, fact.sideBTeam]) {
      const current = result.get(sourceKey);
      result.set(sourceKey, { from: current === undefined || day < current.from ? day : current.from, to: current === undefined || day > current.to ? day : current.to });
    }
  }
  return result;
}
function inferTeamValidity(
  snapshot: LeaguepediaSnapshot,
  overrides: ReviewedOverrides,
  observed: ReadonlyMap<string, { from: string; to: string }>,
): Map<string, { validFrom: string | null; validTo: string | null }> {
  const teams = new Map(snapshot.entities.filter((entity) => entity.kind === "team").map((entity) => [entity.sourceKey, entity]));
  const isStaged = (sourceKey: string): boolean => {
    const override = overrides.identities.get(sourceKey);
    return observed.has(sourceKey) || override?.validFrom !== undefined || override?.validTo !== undefined;
  };
  const reaches = (sourceKey: string, targetKey: string): boolean => {
    const visited = new Set<string>();
    let current = teams.get(sourceKey)?.lineage ?? null;
    while (current !== null) {
      if (current === targetKey) return true;
      if (visited.has(current)) return false;
      visited.add(current);
      current = teams.get(current)?.lineage ?? null;
    }
    return false;
  };
  const nextBoundary = (sourceKey: string): string | null => {
    const visited = new Set<string>();
    let current = teams.get(sourceKey)?.lineage ?? null;
    while (current !== null) {
      if (visited.has(current)) return null;
      visited.add(current);
      const override = overrides.identities.get(current);
      if (override?.validFrom !== undefined) return override.validFrom;
      const dates = observed.get(current);
      if (dates !== undefined) return dates.from;
      current = teams.get(current)?.lineage ?? null;
    }
    return null;
  };
  const result = new Map<string, { validFrom: string | null; validTo: string | null }>();
  for (const [sourceKey, dates] of observed) {
    const hasStagedPredecessor = [...teams.keys()].some((candidate) => candidate !== sourceKey && isStaged(candidate) && reaches(candidate, sourceKey));
    const successorBoundary = nextBoundary(sourceKey);
    result.set(sourceKey, {
      validFrom: hasStagedPredecessor ? dates.from : null,
      validTo: successorBoundary === null ? null : previousDay(successorBoundary),
    });
  }
  return result;
}
function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid inferred team era boundary ${day}.`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function requiredEntityId(ids: ReadonlyMap<string, string>, key: string, factKey: string): string { const id = ids.get(key); if (id === undefined) throw new Error(`Fact ${factKey} references unresolved or quarantined identity ${key}.`); return id; }
function selectEra(eras: readonly StagedTeamEraDefinition[], teamEntityId: string, playedAt: string, factKey: string): StagedTeamEraDefinition { const day = playedAt.slice(0, 10); const candidates = eras.filter((era) => era.teamEntityId === teamEntityId && (!era.validFrom || era.validFrom <= day) && (!era.validTo || era.validTo >= day)); if (candidates.length !== 1) throw new Error(`Fact ${factKey} requires exactly one team era at ${day}; found ${candidates.length}.`); return candidates[0]!; }
function completedScores(bestOf: 1 | 3 | 5, a: number | null, b: number | null, key: string): { a: number; b: number } { if (a === null || b === null || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) throw new Error(`Series ${key} scores are invalid.`); const target = Math.floor(bestOf / 2) + 1; if (!((a === target && b < target) || (b === target && a < target))) throw new Error(`Series ${key} score is inconsistent with BestOf ${bestOf}.`); return { a, b }; }
function validDate(value: string, key: string): Date { const date = new Date(value); if (Number.isNaN(date.valueOf())) throw new Error(`Invalid date for ${key}.`); return date; }
function positiveInteger(value: number, key: string): number { if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid game number for ${key}.`); return value; }
function yearFrom(value: string | null | undefined): number | null { if (!value) return null; const result = Number(value.slice(0, 4)); return Number.isInteger(result) ? result : null; }
function tournamentCategory(name: string): StagedTournamentDefinition["category"] { if (/world/i.test(name)) return "worlds"; if (/mid.?season|msi/i.test(name)) return "msi"; if (/first stand|fst/i.test(name)) return "fst"; if (/league|lck|lpl|lec|lcs/i.test(name)) return "league"; return "other"; }
function unique(values: readonly string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function stableUuid(value: string): string { const hex = createHash("sha256").update(`riftversus:${PROVIDER}:${value}`).digest("hex").slice(0, 32); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`; }
