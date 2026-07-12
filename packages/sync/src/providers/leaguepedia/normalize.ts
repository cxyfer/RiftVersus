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
  const collisionKeys = ambiguousKeys(snapshot);
  const entities: NormalizedLeaguepediaEntity[] = [];
  const entityIds = new Map<string, string>();
  const eraIds = new Map<string, string>();
  const quarantine: QuarantinedIdentity[] = [];
  const entityDefinitions = new Map<string, StagedEntityDefinition>();
  const regionDefinitions = new Map<string, StagedRegionDefinition>();
  const teamEras: StagedTeamEraDefinition[] = [];

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
      const regionId = entity.region ? stableUuid(`region:${entity.region}`) : null;
      if (entity.region && regionId) regionDefinitions.set(regionId, { id: regionId, provider: PROVIDER, sourceKey: entity.region, name: entity.region });
      const eraId = stableUuid(`team-era:${entity.sourceKey}:${normalized.validFrom ?? ""}:${normalized.validTo ?? ""}`);
      eraIds.set(entity.sourceKey, eraId);
      teamEras.push({ id: eraId, provider: PROVIDER, sourceKey: entity.sourceKey, teamEntityId: canonicalId, displayName: entity.displayName, regionId, validFrom: normalized.validFrom ?? null, validTo: normalized.validTo ?? null });
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

  const seriesIds = new Map<string, string>();
  const seriesByKey = new Map(snapshot.series.map((item) => [item.sourceKey, item]));
  const series: SeriesFactInput[] = snapshot.series.map((item) => {
    const tournamentId = tournamentIds.get(item.tournamentKey);
    if (tournamentId === undefined) throw new Error(`Series ${item.sourceKey} references unknown tournament ${item.tournamentKey}.`);
    const sideATeamId = requiredEntityId(entityIds, item.sideATeam, item.sourceKey);
    const sideBTeamId = requiredEntityId(entityIds, item.sideBTeam, item.sourceKey);
    if (sideATeamId === sideBTeamId) throw new Error(`Series ${item.sourceKey} has identical canonical sides.`);
    const scores = completedScores(item.bestOf, item.sideAScore, item.sideBScore, item.sourceKey);
    const id = stableUuid(`series:${item.sourceKey}`);
    seriesIds.set(item.sourceKey, id);
    return {
      id, provider: PROVIDER, sourceKey: item.sourceKey, tournamentId, playedAt: validDate(item.playedAt, item.sourceKey),
      bestOf: item.bestOf, completed: true, sideATeamId, sideAEraId: requiredEraId(eraIds, item.sideATeam, item.sourceKey), sideARegionId: regionId(snapshot, item.sideATeam),
      sideBTeamId, sideBEraId: requiredEraId(eraIds, item.sideBTeam, item.sourceKey), sideBRegionId: regionId(snapshot, item.sideBTeam),
      sideAScore: scores.a, sideBScore: scores.b, winnerTeamId: scores.a > scores.b ? sideATeamId : sideBTeamId,
    };
  });

  const gameIds = new Map<string, string>();
  const games: GameFactInput[] = snapshot.games.map((item) => {
    const seriesId = seriesIds.get(item.seriesKey);
    const sourceSeries = seriesByKey.get(item.seriesKey);
    if (seriesId === undefined || sourceSeries === undefined) throw new Error(`Game ${item.sourceKey} references an unknown explicit series.`);
    if (item.sideATeam !== sourceSeries.sideATeam || item.sideBTeam !== sourceSeries.sideBTeam) throw new Error(`Game ${item.sourceKey} sides conflict with series ${item.seriesKey}.`);
    const sideATeamId = requiredEntityId(entityIds, item.sideATeam, item.sourceKey);
    const sideBTeamId = requiredEntityId(entityIds, item.sideBTeam, item.sourceKey);
    const winnerTeamId = item.winnerTeam === null ? null : requiredEntityId(entityIds, item.winnerTeam, item.sourceKey);
    if (winnerTeamId !== sideATeamId && winnerTeamId !== sideBTeamId) throw new Error(`Game ${item.sourceKey} winner is not a side.`);
    const playedAt = validDate(item.playedAt, item.sourceKey);
    if (playedAt < validDate(sourceSeries.playedAt, sourceSeries.sourceKey)) throw new Error(`Game ${item.sourceKey} precedes its series.`);
    const id = stableUuid(`game:${item.sourceKey}`);
    gameIds.set(item.sourceKey, id);
    return {
      id, provider: PROVIDER, sourceKey: item.sourceKey, seriesId, gameNumber: positiveInteger(item.gameNumber, item.sourceKey), playedAt,
      sideATeamId, sideAEraId: requiredEraId(eraIds, item.sideATeam, item.sourceKey), sideARegionId: regionId(snapshot, item.sideATeam),
      sideBTeamId, sideBEraId: requiredEraId(eraIds, item.sideBTeam, item.sourceKey), sideBRegionId: regionId(snapshot, item.sideBTeam), winnerTeamId,
    };
  });

  const gamesById = new Map(games.map((game) => [game.id, game]));
  const playerFacts = new Set<string>();
  const gamePlayers: GamePlayerInput[] = snapshot.gamePlayers.map((item) => {
    const gameId = gameIds.get(item.gameKey);
    if (gameId === undefined) throw new Error(`Player fact references unknown game ${item.gameKey}.`);
    const game = gamesById.get(gameId)!;
    const playerEntityId = requiredEntityId(entityIds, item.playerKey, item.gameKey);
    const teamEntityId = requiredEntityId(entityIds, item.teamKey, item.gameKey);
    const side = teamEntityId === game.sideATeamId ? "a" : teamEntityId === game.sideBTeamId ? "b" : null;
    if (side === null) throw new Error(`Player ${item.playerKey} team does not match game ${item.gameKey}.`);
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
    dimensions: { entities: [...entityDefinitions.values()], teamEras, regions: [...regionDefinitions.values()], tournaments },
    facts: { series, games, gamePlayers },
    rosterGameIds: [...new Set(gamePlayers.map((item) => item.gameId))],
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
function requiredEntityId(ids: ReadonlyMap<string, string>, key: string, factKey: string): string { const id = ids.get(key); if (id === undefined) throw new Error(`Fact ${factKey} references unresolved or quarantined identity ${key}.`); return id; }
function requiredEraId(ids: ReadonlyMap<string, string>, key: string, factKey: string): string { const id = ids.get(key); if (id === undefined) throw new Error(`Fact ${factKey} references missing team era ${key}.`); return id; }
function regionId(snapshot: LeaguepediaSnapshot, teamKey: string): string | null { const region = snapshot.entities.find((entity) => entity.kind === "team" && entity.sourceKey === teamKey)?.region; return region ? stableUuid(`region:${region}`) : null; }
function completedScores(bestOf: 1 | 3 | 5, a: number | null, b: number | null, key: string): { a: number; b: number } { if (a === null || b === null || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) throw new Error(`Series ${key} scores are invalid.`); const target = Math.floor(bestOf / 2) + 1; if (!((a === target && b < target) || (b === target && a < target))) throw new Error(`Series ${key} score is inconsistent with BestOf ${bestOf}.`); return { a, b }; }
function validDate(value: string, key: string): Date { const date = new Date(value); if (Number.isNaN(date.valueOf())) throw new Error(`Invalid date for ${key}.`); return date; }
function positiveInteger(value: number, key: string): number { if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid game number for ${key}.`); return value; }
function yearFrom(value: string | null | undefined): number | null { if (!value) return null; const result = Number(value.slice(0, 4)); return Number.isInteger(result) ? result : null; }
function tournamentCategory(name: string): StagedTournamentDefinition["category"] { if (/world/i.test(name)) return "worlds"; if (/mid.?season|msi/i.test(name)) return "msi"; if (/first stand|fst/i.test(name)) return "fst"; if (/league|lck|lpl|lec|lcs/i.test(name)) return "league"; return "other"; }
function unique(values: readonly string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function stableUuid(value: string): string { const hex = createHash("sha256").update(`riftversus:${PROVIDER}:${value}`).digest("hex").slice(0, 32); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`; }
