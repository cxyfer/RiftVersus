import { createHash } from "node:crypto";

import type { ReviewedOverrides } from "../../overrides.js";
import type { SyncProvider, SyncRequest } from "../../types.js";
import { parseLeaguepediaMedia } from "./media.js";
import { deriveLeaguepediaCoverage, normalizeLeaguepediaSnapshot } from "./normalize.js";
import type { LeaguepediaSnapshot } from "./types.js";

export { LeaguepediaClient } from "./client.js";
export { fetchAllCargoPages, fetchLeaguepediaSnapshot } from "./fetch.js";
export type { LeaguepediaReadClient, SnapshotRequest, TraversedRows } from "./fetch.js";
export { parseLeaguepediaMedia } from "./media.js";
export { deriveLeaguepediaCoverage, normalizeLeaguepediaSnapshot } from "./normalize.js";
export { loadOverrides } from "../../overrides.js";
export type * from "./types.js";

export interface LeaguepediaProviderOptions {
  loadSnapshot: (request: SyncRequest) => Promise<LeaguepediaSnapshot>;
  overrides: ReviewedOverrides;
  parserVersion?: string;
}

export function createLeaguepediaProvider(options: LeaguepediaProviderOptions): SyncProvider {
  return {
    id: "leaguepedia",
    parserVersion: options.parserVersion ?? "leaguepedia-v1",
    async stage(request) {
      const snapshot = await options.loadSnapshot(request);
      const normalized = normalizeLeaguepediaSnapshot(snapshot, options.overrides);
      const raw = canonicalJson(snapshot);
      const bytes = new TextEncoder().encode(raw);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const requested = request.mode === "backfill"
        ? request.competitions.flatMap((competition) => request.years.map((seasonYear) => ({ competition, seasonYear })))
        : inferredCoverage(snapshot);
      const dates = snapshot.games.map((game) => game.playedAt).sort();
      const coverage = requested.map(({ competition, seasonYear }) => deriveLeaguepediaCoverage({
        competition,
        seasonYear,
        observedRows: snapshot.games.filter((game) => new Date(game.playedAt).getUTCFullYear() === seasonYear && competitionMatches(snapshot, game.seriesKey, competition)).length,
        traversal: snapshot.traversal,
        earliestDate: dates[0]?.slice(0, 10) ?? null,
        latestDate: dates.at(-1)?.slice(0, 10) ?? null,
      }));
      return {
        version: `leaguepedia-${digest.slice(0, 16)}`,
        source: {
          sourceKey: snapshot.revisionIds.length > 0 ? `revisions:${[...snapshot.revisionIds].sort((a, b) => a - b).join(",")}` : `sha256:${digest}`,
          sourceUrl: requireHttps(snapshot.sourceUrl),
          bytes,
          contentType: "application/json",
        },
        media: parseLeaguepediaMedia(snapshot.media, normalized.entityIds),
        coverage,
        facts: normalized.facts,
        rosterGameIds: normalized.rosterGameIds,
      };
    },
  };
}

function inferredCoverage(snapshot: LeaguepediaSnapshot): { competition: string; seasonYear: number }[] {
  const values = new Map<string, { competition: string; seasonYear: number }>();
  for (const series of snapshot.series) {
    const seasonYear = new Date(series.playedAt).getUTCFullYear();
    values.set(`${series.tournamentKey}:${seasonYear}`, { competition: series.tournamentKey, seasonYear });
  }
  return [...values.values()];
}
function competitionMatches(snapshot: LeaguepediaSnapshot, seriesKey: string, requested: string): boolean {
  const tournament = snapshot.series.find((series) => series.sourceKey === seriesKey)?.tournamentKey ?? "";
  return tournament.toLocaleLowerCase().includes(requested.toLocaleLowerCase()) || (requested.toLocaleLowerCase() === "worlds" && /world championship/i.test(tournament));
}
function requireHttps(value: string): string { const url = new URL(value); if (url.protocol !== "https:") throw new Error("Leaguepedia source URL must use HTTPS."); return url.toString(); }
function canonicalJson(value: unknown): string { return JSON.stringify(sortValue(value)); }
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]));
}
