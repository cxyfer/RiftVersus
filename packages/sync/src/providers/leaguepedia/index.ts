import { createHash } from "node:crypto";

import type { ReviewedOverrides } from "../../overrides.js";
import { RetainableStageError, type SyncProvider, type SyncRequest } from "../../types.js";
import { LeaguepediaApiError, LeaguepediaCargoEnvelopeError } from "./client.js";
import { LeaguepediaSnapshotError, parseLeaguepediaRawInput } from "./fetch.js";
import { inspectLeaguepediaMedia } from "./media.js";
import { deriveLeaguepediaCoverage, normalizeLeaguepediaSnapshot } from "./normalize.js";
import { canonicalJson, encodeLeaguepediaRawInput } from "./serialization.js";
import type { LeaguepediaRawInput, LeaguepediaSnapshot } from "./types.js";

export { LeaguepediaApiError, LeaguepediaCargoEnvelopeError, LeaguepediaClient, LeaguepediaResourceLimitError } from "./client.js";
export { fetchAllCargoPages, fetchLeaguepediaRawInput, fetchLeaguepediaSnapshot, LeaguepediaSnapshotError, parseLeaguepediaRawInput } from "./fetch.js";
export type { LeaguepediaReadClient, SnapshotRequest, SnapshotResourceLimits, SnapshotSliceRequest, TraversedRows } from "./fetch.js";
export { parseLeaguepediaMedia } from "./media.js";
export { encodeLeaguepediaRawInput } from "./serialization.js";
export { deriveLeaguepediaCoverage, normalizeLeaguepediaSnapshot } from "./normalize.js";
export { loadOverrides } from "../../overrides.js";
export type * from "./types.js";

export interface LeaguepediaProviderOptions {
  loadRawInput: (request: SyncRequest) => Promise<LeaguepediaRawInput>;
  overrides: ReviewedOverrides;
  parserVersion?: string;
}

export function createLeaguepediaProvider(options: LeaguepediaProviderOptions): SyncProvider {
  const parserVersion = options.parserVersion ?? "leaguepedia-v3";
  return {
    id: "leaguepedia",
    parserVersion,
    async stage(request) {
      let rawInput: LeaguepediaRawInput;
      try {
        rawInput = await options.loadRawInput(request);
      } catch (error) {
        if (error instanceof LeaguepediaCargoEnvelopeError || error instanceof LeaguepediaApiError) throw retainableEvidenceError(error, [error.rawEvidence]);
        if (error instanceof LeaguepediaSnapshotError && error.rawEvidence.length > 0) {
          const bytes = new TextEncoder().encode(canonicalJson({ format: "riftversus-leaguepedia-raw-v1", provenance: { kind: "live" }, evidence: error.rawEvidence }));
          const digest = createHash("sha256").update(bytes).digest("hex");
          throw new RetainableStageError(error.message, { sourceKey: `failed:sha256:${digest}`, sourceUrl: error.rawEvidence[0]!.sourceUrl, bytes, contentType: "application/json" }, { cause: error });
        }
        throw error;
      }
      let snapshot: LeaguepediaSnapshot;
      let normalized: ReturnType<typeof normalizeLeaguepediaSnapshot>;
      try {
        snapshot = parseLeaguepediaRawInput(rawInput);
        validateRawEvidence(snapshot);
        normalized = normalizeLeaguepediaSnapshot(snapshot, options.overrides);
      } catch (error) {
        if (rawInput.rawEvidence.length > 0) throw retainableRawInputError(error, rawInput);
        throw error;
      }
      const bytes = encodeLeaguepediaRawInput(rawInput);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const overrideFiles = reviewedOverrideFiles(options.overrides.checksums);
      const overrideDigest = createHash("sha256").update(canonicalJson(overrideFiles)).digest("hex");
      const versionDigest = createHash("sha256").update(canonicalJson({ rawDigest: digest, parserVersion, overrideDigest })).digest("hex");
      const mediaInspection = inspectLeaguepediaMedia(snapshot.media, normalized.entityIds, normalized.eraIds);
      const requested = uniqueCoverageKeys(request.mode === "backfill"
        ? request.competitions.flatMap((competition) => request.years.map((seasonYear) => ({ competition, seasonYear })))
        : inferredCoverage(snapshot));
      const coverage = requested.map(({ competition, seasonYear }) => {
        const slices = snapshot.slices.filter((item) => item.competition === competition && item.seasonYear === seasonYear);
        const gameKeys = new Set(slices.flatMap((slice) => slice.gameSourceKeys));
        const sliceGames = snapshot.games.filter((game) => gameKeys.has(game.sourceKey));
        const unresolvedRows = slices.reduce((sum, slice) => sum + unresolvedForSlice(snapshot, normalized, slice), 0);
        const dates = sliceGames.map((game) => game.playedAt).sort();
        const derived = deriveLeaguepediaCoverage({
          competition,
          seasonYear,
          observedRows: sliceGames.length,
          traversal: slices.length === 0 ? { requestedPages: 1, visitedPages: 0, complete: false } : combineTraversal(slices.map((slice) => slice.traversal)),
          unresolvedRows,
          earliestDate: dates[0]?.slice(0, 10) ?? null,
          latestDate: dates.at(-1)?.slice(0, 10) ?? null,
        });
        const malformedOptionalRows = Math.max(0, ...slices.map((slice) => slice.malformedOptionalRows));
        const malformedOptionalRowKeys = uniqueStrings(slices.flatMap((slice) => slice.malformedOptionalRowKeys)).slice(0, 10);
        const excludedOptionalDimensionRows = Math.max(0, ...slices.map((slice) => slice.excludedOptionalDimensionRows));
        const excludedOptionalDimensionRowKeys = uniqueStrings(slices.flatMap((slice) => slice.excludedOptionalDimensionRowKeys)).slice(0, 10);
        const outOfScopeForwardRenames = Math.max(0, ...slices.map((slice) => slice.outOfScopeForwardRenames));
        const outOfScopeForwardRenameSamples = uniqueStrings(slices.flatMap((slice) => slice.outOfScopeForwardRenameSamples)).slice(0, 10);
        const auditDetails = [
          `Media inventory (import scope): ${JSON.stringify(mediaInspection.inventory)}; missing or ineligible assets use generated fallback.`,
          malformedOptionalRows === 0 ? "" : `Ignored ${malformedOptionalRows} malformed unreferenced optional dimension rows (samples: ${malformedOptionalRowKeys.join(", ")}); raw evidence retained.`,
          excludedOptionalDimensionRows === 0 ? "" : `Excluded ${excludedOptionalDimensionRows} valid optional dimension rows not referenced by imported facts or rename closure (samples: ${excludedOptionalDimensionRowKeys.join(", ")}); raw evidence retained.`,
          outOfScopeForwardRenames === 0 ? "" : `Audited ${outOfScopeForwardRenames} forward renames outside imported fact identity scope (samples: ${outOfScopeForwardRenameSamples.join(", ")}); raw evidence retained.`,
        ].filter(Boolean).join(" ");
        const audited = auditDetails === "" ? derived : { ...derived, detail: `${derived.detail ?? ""} ${auditDetails}`.trim() };
        if (rawInput.provenance.kind !== "synthetic-fixture") return audited;
        return { ...audited, status: audited.status === "complete" ? "partial" as const : audited.status, detail: `${audited.detail ?? ""} synthetic fixture is not source coverage.`.trim() };
      });
      const publicationScopes = snapshot.slices.map((slice) => {
        const unresolvedRows = unresolvedForSlice(snapshot, normalized, slice);
        const observedRows = slice.gameSourceKeys.length;
        const status = observedRows === 0 ? "missing" as const : rawInput.provenance.kind === "synthetic-fixture" ? "partial" as const : slice.traversal.complete && unresolvedRows === 0 ? "complete" as const : "partial" as const;
        return { provider: "leaguepedia", tournamentSourceKey: slice.sourceCompetition, from: slice.from, to: slice.to, status, unresolvedRows };
      });
      return {
        version: `leaguepedia-${versionDigest}`,
        provenance: { sourceDigest: `sha256:${digest}`, parserVersion, overrideFiles: overrideFiles as { file: string; checksum: `sha256:${string}` }[] },
        source: {
          sourceKey: `sha256:${digest}`,
          sourceUrl: rawInput.sourceUrl,
          bytes,
          contentType: "application/json",
        },
        media: mediaInspection.media,
        coverage,
        dimensions: normalized.dimensions,
        facts: normalized.facts,
        rosterGameIds: normalized.rosterGameIds,
        publicationScopes,
      };
    },
  };
}

function inferredCoverage(snapshot: LeaguepediaSnapshot): { competition: string; seasonYear: number }[] {
  return uniqueCoverageKeys(snapshot.slices.map(({ competition, seasonYear }) => ({ competition, seasonYear })));
}
function uniqueCoverageKeys(items: readonly { competition: string; seasonYear: number }[]): { competition: string; seasonYear: number }[] { return [...new Map(items.map((item) => [JSON.stringify([item.competition, item.seasonYear]), item])).values()]; }
function uniqueStrings(items: readonly string[]): string[] { return [...new Set(items)]; }
function unresolvedForSlice(snapshot: LeaguepediaSnapshot, normalized: ReturnType<typeof normalizeLeaguepediaSnapshot>, slice: LeaguepediaSnapshot["slices"][number]): number {
  const gameKeys = new Set(slice.gameSourceKeys);
  const unresolvedGames = new Set([...normalized.quarantineAffectedGameKeys, ...normalized.rosterIncompleteGameKeys].filter((key) => gameKeys.has(key)));
  const games = snapshot.games.filter((game) => gameKeys.has(game.sourceKey));
  const seriesKeys = new Set(games.map((game) => game.seriesKey));
  let incompleteSeries = 0;
  for (const seriesKey of seriesKeys) {
    const series = snapshot.series.find((item) => item.sourceKey === seriesKey);
    if (series === undefined || series.sideAScore === null || series.sideBScore === null) { incompleteSeries += 1; continue; }
    const seriesGames = games.filter((game) => game.seriesKey === seriesKey);
    const expected = series.sideAScore + series.sideBScore;
    const numbers = seriesGames.map((game) => game.gameNumber);
    if (expected <= 0 || numbers.length !== expected || new Set(numbers).size !== numbers.length || numbers.some((number) => number < 1 || number > expected) || !Array.from({ length: expected }, (_, index) => index + 1).every((number) => numbers.includes(number))) incompleteSeries += 1;
  }
  return unresolvedGames.size + incompleteSeries;
}
function reviewedOverrideFiles(checksums: Readonly<Record<string, string>>): { file: string; checksum: `sha256:${string}` }[] {
  return Object.entries(checksums).map(([file, checksum]) => {
    if (file.startsWith("/") || file.includes("\\") || file.split("/").includes("..") || !file.includes("/")) throw new Error(`Reviewed override file identity must be a stable repository-relative path: ${file}`);
    if (!/^sha256:[a-f0-9]{64}$/.test(checksum)) throw new Error(`Reviewed override checksum is invalid for ${file}.`);
    return { file, checksum: checksum as `sha256:${string}` };
  }).sort((a, b) => a.file.localeCompare(b.file));
}
function combineTraversal(items: readonly LeaguepediaSnapshot["traversal"][]): LeaguepediaSnapshot["traversal"] { return { requestedPages: items.reduce((sum, item) => sum + item.requestedPages, 0), visitedPages: items.reduce((sum, item) => sum + item.visitedPages, 0), complete: items.every((item) => item.complete) }; }
function requireHttps(value: string): string { const url = new URL(value); if (url.protocol !== "https:") throw new Error("Leaguepedia source URL must use HTTPS."); return url.toString(); }
function validateRawEvidence(snapshot: LeaguepediaSnapshot): void {
  if (snapshot.rawEvidence.length === 0) throw new Error("Leaguepedia snapshot has no immutable raw API evidence.");
  const requestIds = new Set<string>();
  for (const item of snapshot.rawEvidence) {
    if (requestIds.has(item.requestId)) throw new Error(`Duplicate raw evidence requestId: ${item.requestId}.`);
    requestIds.add(item.requestId);
    requireHttps(item.sourceUrl);
    const validQuery = item.action === "query" && typeof item.response === "object" && item.response !== null && !Array.isArray(item.response);
    const validCargo = item.action === "cargoexport" && Array.isArray(item.response);
    if (!validQuery && !validCargo) throw new Error(`Raw evidence ${item.requestId} response is invalid.`);
  }
  const evidenceRevisions = [...new Set(snapshot.rawEvidence.flatMap((item) => item.revisionIds))].sort((a, b) => a - b);
  const declaredRevisions = [...snapshot.revisionIds].sort((a, b) => a - b);
  if (canonicalJson(evidenceRevisions) !== canonicalJson(declaredRevisions)) throw new Error("Leaguepedia revisionIds do not match retained raw evidence.");
}

function retainableEvidenceError(error: unknown, evidence: LeaguepediaSnapshot["rawEvidence"]): RetainableStageError {
  const reason = error instanceof Error ? error : new Error(String(error));
  const bytes = new TextEncoder().encode(canonicalJson({ format: "riftversus-leaguepedia-raw-v1", provenance: { kind: "live" }, evidence }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  return new RetainableStageError(reason.message, { sourceKey: `failed:sha256:${digest}`, sourceUrl: evidence[0]!.sourceUrl, bytes, contentType: "application/json" }, { cause: reason });
}
function retainableRawInputError(error: unknown, input: LeaguepediaRawInput): RetainableStageError {
  const reason = error instanceof Error ? error : new Error(String(error));
  const bytes = new TextEncoder().encode(canonicalJson({ format: "riftversus-leaguepedia-raw-v1", input }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  return new RetainableStageError(reason.message, { sourceKey: `failed:sha256:${digest}`, sourceUrl: input.rawEvidence[0]!.sourceUrl, bytes, contentType: "application/json" }, { cause: reason });
}
