import { createHash } from "node:crypto";

import type { ReviewedOverrides } from "../../overrides.js";
import { RetainableStageError, type SyncProvider, type SyncRequest } from "../../types.js";
import { LeaguepediaSnapshotError } from "./fetch.js";
import { parseLeaguepediaMedia } from "./media.js";
import { deriveLeaguepediaCoverage, normalizeLeaguepediaSnapshot } from "./normalize.js";
import type { LeaguepediaSnapshot } from "./types.js";

export { LeaguepediaClient } from "./client.js";
export { fetchAllCargoPages, fetchLeaguepediaSnapshot, LeaguepediaSnapshotError } from "./fetch.js";
export type { LeaguepediaReadClient, SnapshotRequest, SnapshotSliceRequest, TraversedRows } from "./fetch.js";
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
  const parserVersion = options.parserVersion ?? "leaguepedia-v1";
  return {
    id: "leaguepedia",
    parserVersion,
    async stage(request) {
      let snapshot: LeaguepediaSnapshot;
      try {
        snapshot = await options.loadSnapshot(request);
      } catch (error) {
        if (error instanceof LeaguepediaSnapshotError && error.rawEvidence.length > 0) {
          const bytes = new TextEncoder().encode(canonicalJson({ format: "riftversus-leaguepedia-raw-v1", evidence: error.rawEvidence }));
          const digest = createHash("sha256").update(bytes).digest("hex");
          throw new RetainableStageError(error.message, { sourceKey: `failed:sha256:${digest}`, sourceUrl: error.rawEvidence[0]!.sourceUrl, bytes, contentType: "application/json" }, { cause: error });
        }
        throw error;
      }
      let normalized: ReturnType<typeof normalizeLeaguepediaSnapshot>;
      try {
        validateRawEvidence(snapshot);
        normalized = normalizeLeaguepediaSnapshot(snapshot, options.overrides);
      } catch (error) {
        if (snapshot.rawEvidence.length > 0) throw retainableEvidenceError(error, snapshot.rawEvidence);
        throw error;
      }
      const raw = canonicalJson({ format: "riftversus-leaguepedia-raw-v1", evidence: snapshot.rawEvidence });
      const bytes = new TextEncoder().encode(raw);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const overrideDigest = createHash("sha256").update(canonicalJson(Object.values(options.overrides.checksums).sort())).digest("hex");
      const versionDigest = createHash("sha256").update(canonicalJson({ rawDigest: digest, parserVersion, overrideDigest })).digest("hex");
      const requested = request.mode === "backfill"
        ? request.competitions.flatMap((competition) => request.years.map((seasonYear) => ({ competition, seasonYear })))
        : inferredCoverage(snapshot);
      const coverage = requested.map(({ competition, seasonYear }) => {
        const slice = snapshot.slices.find((item) => item.competition === competition && item.seasonYear === seasonYear);
        const sliceGames = slice === undefined ? [] : snapshot.games.filter((game) => slice.gameSourceKeys.includes(game.sourceKey));
        const dates = sliceGames.map((game) => game.playedAt).sort();
        return deriveLeaguepediaCoverage({
          competition,
          seasonYear,
          observedRows: sliceGames.length,
          traversal: slice?.traversal ?? { requestedPages: 1, visitedPages: 0, complete: false },
          unresolvedRows: (slice?.malformedOptionalRows ?? 0) + normalized.quarantine.length,
          earliestDate: dates[0]?.slice(0, 10) ?? null,
          latestDate: dates.at(-1)?.slice(0, 10) ?? null,
        });
      });
      return {
        version: `leaguepedia-${versionDigest}`,
        provenance: { sourceDigest: `sha256:${digest}`, parserVersion, overrideChecksums: Object.values(options.overrides.checksums).sort() as `sha256:${string}`[] },
        source: {
          sourceKey: snapshot.revisionIds.length > 0 ? `revisions:${[...snapshot.revisionIds].sort((a, b) => a - b).join(",")}` : `sha256:${digest}`,
          sourceUrl: snapshot.rawEvidence[0]!.sourceUrl,
          bytes,
          contentType: "application/json",
        },
        media: parseLeaguepediaMedia(snapshot.media, normalized.entityIds),
        coverage,
        dimensions: normalized.dimensions,
        facts: normalized.facts,
        rosterGameIds: normalized.rosterGameIds,
      };
    },
  };
}

function inferredCoverage(snapshot: LeaguepediaSnapshot): { competition: string; seasonYear: number }[] {
  return snapshot.slices.map(({ competition, seasonYear }) => ({ competition, seasonYear }));
}
function requireHttps(value: string): string { const url = new URL(value); if (url.protocol !== "https:") throw new Error("Leaguepedia source URL must use HTTPS."); return url.toString(); }
function canonicalJson(value: unknown): string { return JSON.stringify(sortValue(value)); }
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]));
}

function validateRawEvidence(snapshot: LeaguepediaSnapshot): void {
  if (snapshot.rawEvidence.length === 0) throw new Error("Leaguepedia snapshot has no immutable raw API evidence.");
  const requestIds = new Set<string>();
  for (const item of snapshot.rawEvidence) {
    if (requestIds.has(item.requestId)) throw new Error(`Duplicate raw evidence requestId: ${item.requestId}.`);
    requestIds.add(item.requestId);
    requireHttps(item.sourceUrl);
    if (typeof item.response !== "object" || item.response === null || Array.isArray(item.response)) throw new Error(`Raw evidence ${item.requestId} response is invalid.`);
  }
  const evidenceRevisions = [...new Set(snapshot.rawEvidence.flatMap((item) => item.revisionIds))].sort((a, b) => a - b);
  const declaredRevisions = [...snapshot.revisionIds].sort((a, b) => a - b);
  if (canonicalJson(evidenceRevisions) !== canonicalJson(declaredRevisions)) throw new Error("Leaguepedia revisionIds do not match retained raw evidence.");
}

function retainableEvidenceError(error: unknown, evidence: LeaguepediaSnapshot["rawEvidence"]): RetainableStageError {
  const reason = error instanceof Error ? error : new Error(String(error));
  const bytes = new TextEncoder().encode(canonicalJson({ format: "riftversus-leaguepedia-raw-v1", evidence }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  return new RetainableStageError(reason.message, { sourceKey: `failed:sha256:${digest}`, sourceUrl: evidence[0]!.sourceUrl, bytes, contentType: "application/json" }, { cause: reason });
}
