import { createHash } from "node:crypto";

import type { GameFactInput, GamePlayerInput, SeriesFactInput } from "@riftversus/database";

import type { ReviewedOverrides } from "../../overrides.js";
import type {
  LeaguepediaCoverage, LeaguepediaCoverageEvidence, LeaguepediaNormalizationResult, LeaguepediaSnapshot,
  NormalizedLeaguepediaEntity, QuarantinedIdentity,
} from "./types.js";

const PROVIDER = "leaguepedia";

export function normalizeLeaguepediaSnapshot(snapshot: LeaguepediaSnapshot, overrides: ReviewedOverrides): LeaguepediaNormalizationResult {
  const collisionKeys = ambiguousKeys(snapshot);
  const entities: NormalizedLeaguepediaEntity[] = [];
  const entityIds = new Map<string, string>();
  const quarantine: QuarantinedIdentity[] = [];

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
  }

  const seriesIds = new Map<string, string>();
  const series: SeriesFactInput[] = snapshot.series.map((item) => {
    const tournament = overrides.tournaments.get(item.tournamentKey);
    const tournamentId = tournament?.canonicalId ?? stableUuid(`tournament:${item.tournamentKey}`);
    const sideATeamId = requiredEntityId(entityIds, item.sideATeam, item.sourceKey);
    const sideBTeamId = requiredEntityId(entityIds, item.sideBTeam, item.sourceKey);
    if (sideATeamId === sideBTeamId) throw new Error(`Series ${item.sourceKey} has identical sides.`);
    const id = stableUuid(`series:${item.sourceKey}`);
    seriesIds.set(item.sourceKey, id);
    const completed = scoreCompletes(item.bestOf, item.sideAScore, item.sideBScore);
    return {
      id, provider: PROVIDER, sourceKey: item.sourceKey, tournamentId, playedAt: validDate(item.playedAt, item.sourceKey),
      bestOf: item.bestOf, completed, sideATeamId, sideAEraId: sideATeamId, sideARegionId: regionId(snapshot, item.sideATeam),
      sideBTeamId, sideBEraId: sideBTeamId, sideBRegionId: regionId(snapshot, item.sideBTeam),
      sideAScore: item.sideAScore, sideBScore: item.sideBScore,
      winnerTeamId: completed ? (item.sideAScore! > item.sideBScore! ? sideATeamId : sideBTeamId) : null,
    };
  });

  const gameIds = new Map<string, string>();
  const games: GameFactInput[] = snapshot.games.map((item) => {
    const seriesId = seriesIds.get(item.seriesKey);
    if (seriesId === undefined) throw new Error(`Game ${item.sourceKey} references an unknown explicit series.`);
    const sideATeamId = requiredEntityId(entityIds, item.sideATeam, item.sourceKey);
    const sideBTeamId = requiredEntityId(entityIds, item.sideBTeam, item.sourceKey);
    const winnerTeamId = item.winnerTeam === null ? null : requiredEntityId(entityIds, item.winnerTeam, item.sourceKey);
    if (winnerTeamId !== null && winnerTeamId !== sideATeamId && winnerTeamId !== sideBTeamId) throw new Error(`Game ${item.sourceKey} winner is not a side.`);
    const id = stableUuid(`game:${item.sourceKey}`);
    gameIds.set(item.sourceKey, id);
    return {
      id, provider: PROVIDER, sourceKey: item.sourceKey, seriesId, gameNumber: positiveInteger(item.gameNumber, item.sourceKey),
      playedAt: validDate(item.playedAt, item.sourceKey), sideATeamId, sideAEraId: sideATeamId, sideARegionId: regionId(snapshot, item.sideATeam),
      sideBTeamId, sideBEraId: sideBTeamId, sideBRegionId: regionId(snapshot, item.sideBTeam), winnerTeamId,
    };
  });

  const gamesById = new Map(games.map((game) => [game.id, game]));
  const gamePlayers: GamePlayerInput[] = snapshot.gamePlayers.map((item) => {
    const gameId = gameIds.get(item.gameKey);
    if (gameId === undefined) throw new Error(`Player fact references unknown game ${item.gameKey}.`);
    const game = gamesById.get(gameId)!;
    const playerEntityId = requiredEntityId(entityIds, item.playerKey, item.gameKey);
    const teamEntityId = requiredEntityId(entityIds, item.teamKey, item.gameKey);
    const side = teamEntityId === game.sideATeamId ? "a" : teamEntityId === game.sideBTeamId ? "b" : null;
    if (side === null) throw new Error(`Player ${item.playerKey} team does not match game ${item.gameKey}.`);
    return { gameId, playerEntityId, teamEntityId, side };
  });

  return { entities, entityIds, quarantine, facts: { series, games, gamePlayers }, rosterGameIds: [...new Set(gamePlayers.map((item) => item.gameId))] };
}

export function deriveLeaguepediaCoverage(evidence: LeaguepediaCoverageEvidence): LeaguepediaCoverage {
  const base = { provider: PROVIDER, competition: evidence.competition, seasonYear: evidence.seasonYear, earliestDate: evidence.earliestDate ?? null, latestDate: evidence.latestDate ?? null };
  if (evidence.observedRows === 0) return { ...base, status: "missing", detail: "No rows returned; zero rows never prove coverage." };
  if (!evidence.traversal.complete || evidence.traversal.visitedPages !== evidence.traversal.requestedPages) return { ...base, status: "partial", detail: `Visited ${evidence.traversal.visitedPages} of ${evidence.traversal.requestedPages} bounded pages.` };
  return { ...base, status: "complete", detail: `Verified ${evidence.observedRows} rows across ${evidence.traversal.visitedPages} bounded pages.` };
}

function ambiguousKeys(snapshot: LeaguepediaSnapshot): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const entity of snapshot.entities) {
    for (const name of [entity.displayName, ...entity.aliases]) {
      const key = name.trim().toLocaleLowerCase();
      if (key) owners.set(key, new Set([...(owners.get(key) ?? []), entity.sourceKey]));
    }
  }
  return new Set([...owners.values()].filter((values) => values.size > 1).flatMap((values) => [...values]));
}
function requiredEntityId(ids: ReadonlyMap<string, string>, key: string, factKey: string): string {
  const id = ids.get(key);
  if (id === undefined) throw new Error(`Fact ${factKey} references unresolved or quarantined identity ${key}.`);
  return id;
}
function regionId(snapshot: LeaguepediaSnapshot, teamKey: string): string | null {
  const region = snapshot.entities.find((entity) => entity.kind === "team" && entity.sourceKey === teamKey)?.region;
  return region ? stableUuid(`region:${region}`) : null;
}
function scoreCompletes(bestOf: 1 | 3 | 5, a: number | null, b: number | null): boolean {
  if (a === null || b === null || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return false;
  const target = Math.floor(bestOf / 2) + 1;
  return (a === target && b < target) || (b === target && a < target);
}
function validDate(value: string, key: string): Date { const date = new Date(value); if (Number.isNaN(date.valueOf())) throw new Error(`Invalid date for ${key}.`); return date; }
function positiveInteger(value: number, key: string): number { if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid game number for ${key}.`); return value; }
function unique(values: readonly string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function stableUuid(value: string): string {
  const hex = createHash("sha256").update(`riftversus:${PROVIDER}:${value}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}
