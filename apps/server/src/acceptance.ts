import type { Readable } from "node:stream";

import { DateSchema, UuidSchema, type ComparisonQuery, type ComparisonResponse, type EntityKind } from "@riftversus/contracts";
import type { AcceptanceDatasetEvidence, AcceptanceMediaObjectMetadata, AcceptanceSourceObjectMetadata } from "@riftversus/database";
import { encodeLeaguepediaRawInput, type LeaguepediaRawInput } from "@riftversus/sync";
import { z } from "zod";

import { ExpectedPresentationSchema, readAndHash, verifyPresentation } from "./acceptance-media.js";
import type { CanonicalAvatar } from "./avatar.js";

const TimestampSchema = z.iso.datetime({ offset: true });
const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const AwaitingSnapshotSchema = z.object({ schemaVersion: z.literal(2), status: z.literal("awaiting-reviewed-source"), note: z.string().min(1) }).strict();
const LocalSubjectRefSchema = z.object({
  kind: z.enum(["player", "team", "region"]), id: UuidSchema, teamEraId: UuidSchema.optional(),
}).strict().superRefine((subject, context) => {
  if (subject.kind !== "team" && subject.teamEraId !== undefined) context.addIssue({ code: "custom", message: "teamEraId is only valid for team subjects.", path: ["teamEraId"] });
});
const ExpectedRowSchema = z.object({
  id: UuidSchema, gameIds: z.array(UuidSchema).min(1), date: DateSchema, leftScore: z.number().int().nonnegative(), rightScore: z.number().int().nonnegative(), winner: z.enum(["left", "right"]),
}).strict();
const ReviewedCoverageRowSchema = z.object({
  provider: z.literal("leaguepedia"), competition: z.literal("Worlds"),
  seasonYear: z.number().int().min(2013).max(2025),
  earliestDate: DateSchema, latestDate: DateSchema, status: z.literal("complete"),
}).strict().superRefine((row, context) => {
  if (row.latestDate < row.earliestDate) context.addIssue({ code: "custom", message: "latestDate must not precede earliestDate.", path: ["latestDate"] });
});
const ReviewedCoverageSchema = z.object({
  status: z.literal("complete"), unresolvedSeries: z.literal(0), from: DateSchema, to: DateSchema, note: z.string().min(1),
  rows: z.array(ReviewedCoverageRowSchema).length(13),
}).strict().superRefine((coverage, context) => {
  const years = coverage.rows.map((row) => row.seasonYear);
  const uniqueYears = new Set(years);
  if (uniqueYears.size !== years.length) context.addIssue({ code: "custom", message: "Duplicate reviewed coverage season years are not allowed.", path: ["rows"] });
  for (let seasonYear = 2013; seasonYear <= 2025; seasonYear += 1) {
    if (!uniqueYears.has(seasonYear)) context.addIssue({ code: "custom", message: `Missing reviewed Worlds coverage for ${seasonYear}.`, path: ["rows"] });
  }
  const earliest = coverage.rows.map((row) => row.earliestDate).sort()[0];
  const latest = coverage.rows.map((row) => row.latestDate).sort().at(-1);
  if (earliest !== coverage.from || latest !== coverage.to) context.addIssue({ code: "custom", message: "Reviewed coverage bounds must equal the row date bounds.", path: ["rows"] });
});
const ReviewedSnapshotSchema = z.object({
  schemaVersion: z.literal(2), status: z.literal("reviewed"),
  comparison: z.object({ left: LocalSubjectRefSchema, right: LocalSubjectRefSchema }).strict(),
  datasetVersion: z.string().min(1),
  attribution: z.object({ provider: z.literal("Leaguepedia"), url: z.url() }).strict(),
  sources: z.array(z.object({
    pageId: z.number().int().positive(), revisionId: z.number().int().positive(), title: z.string().min(1),
    retrievedAt: TimestampSchema, objectKey: z.string().min(1), rawObjectChecksum: ChecksumSchema,
    requestId: z.string().min(1), requestUrl: z.url(),
  }).strict()).min(1),
  coverage: ReviewedCoverageSchema,
  expected: z.object({
    leftDisplayName: z.string().min(1), rightDisplayName: z.string().min(1),
    seriesWins: z.number().int().nonnegative(), seriesLosses: z.number().int().nonnegative(),
    gameWins: z.number().int().nonnegative(), gameLosses: z.number().int().nonnegative(),
    media: z.object({ left: ExpectedPresentationSchema, right: ExpectedPresentationSchema }).strict(),
    rows: z.array(ExpectedRowSchema).min(1).max(100),
  }).strict(),
  review: z.object({ reviewedAt: TimestampSchema, reviewer: z.string().min(1) }).strict(),
}).strict();

type ReviewedSnapshot = z.infer<typeof ReviewedSnapshotSchema>;

export interface AcceptanceVerificationDependencies {
  approvedLeaguepediaEndpoint: string;
  maxRawObjectBytes: number;
  maxMediaObjectBytes: number;
  compare(query: ComparisonQuery): Promise<ComparisonResponse>;
  getRawObject(key: string): Promise<Readable | null>;
  getSourceMetadata(key: string): Promise<AcceptanceSourceObjectMetadata[]>;
  getDatasetEvidence(version: string, seriesIds: readonly string[]): Promise<AcceptanceDatasetEvidence>;
  getMediaMetadata(key: string): Promise<AcceptanceMediaObjectMetadata | null>;
  generateAvatar(kind: EntityKind, id: string): CanonicalAvatar;
}

export type AcceptanceEvaluation =
  | { status: "blocked"; blockers: string[] }
  | { status: "ready"; blockers: []; observed: { datasetVersion: string; seriesWins: number; seriesLosses: number; gameWins: number; gameLosses: number; seriesIds: string[] } };

function invalidSnapshot(error: z.ZodError): AcceptanceEvaluation {
  return { status: "blocked", blockers: error.issues.map((issue) => `Invalid acceptance snapshot at ${issue.path.join(".") || "root"}: ${issue.message}`) };
}

function approvedRequestUrl(requestUrl: string, endpoint: string, title: string): boolean {
  const source = new URL(requestUrl); const approved = new URL(endpoint);
  const props = new Set((source.searchParams.get("prop") ?? "").split("|"));
  const revisionProps = new Set((source.searchParams.get("rvprop") ?? "").split("|"));
  const titles = (source.searchParams.get("titles") ?? "").split("|");
  return source.protocol === "https:" && source.origin === approved.origin && source.pathname === approved.pathname
    && source.searchParams.get("action") === "query"
    && props.has("info") && props.has("revisions")
    && revisionProps.has("ids") && revisionProps.has("timestamp")
    && titles.includes(title);
}

function approvedAttributionUrl(attributionUrl: string, endpoint: string): boolean {
  try {
    const attribution = new URL(attributionUrl);
    const approvedEndpoint = new URL(endpoint);
    if (attribution.protocol !== "https:"
      || attribution.origin !== approvedEndpoint.origin
      || attribution.username !== ""
      || attribution.password !== ""
      || attribution.search !== ""
      || attribution.hash !== ""
      || attribution.href.includes("?")
      || attribution.href.includes("#")) return false;
    return decodeURIComponent(attribution.pathname) === "/wiki/Leaguepedia:Copyrights";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function productionRawInput(value: unknown, body: Buffer): LeaguepediaRawInput | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "format,input"
    || value.format !== "riftversus-leaguepedia-raw-v1" || !isRecord(value.input)
    || !isRecord(value.input.provenance) || value.input.provenance.kind !== "live"
    || typeof value.input.sourceUrl !== "string" || !Array.isArray(value.input.slices) || !Array.isArray(value.input.rawEvidence)) return undefined;
  const input = value.input as unknown as LeaguepediaRawInput;
  return body.equals(Buffer.from(encodeLeaguepediaRawInput(input))) ? input : undefined;
}

function exactEvidence(input: LeaguepediaRawInput, requestId: string): Record<string, unknown> | undefined {
  const matches = input.rawEvidence.filter((item): item is typeof item & Record<string, unknown> => isRecord(item) && item.requestId === requestId);
  return matches.length === 1 ? matches[0] : undefined;
}

function hasSamePageRevision(response: unknown, pageId: number, title: string, revisionId: number): boolean {
  if (!isRecord(response) || !isRecord(response.query)) return false;
  const rawPages = response.query.pages;
  const pages = Array.isArray(rawPages) ? rawPages : isRecord(rawPages) ? Object.values(rawPages) : [];
  return pages.some((page) => isRecord(page) && page.pageid === pageId && page.title === title
    && Array.isArray(page.revisions)
    && page.revisions.some((revision) => isRecord(revision) && revision.revid === revisionId));
}

function normalizedTimestamp(value: string): string | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
}

function verifyDatasetEvidence(snapshot: ReviewedSnapshot, evidence: AcceptanceDatasetEvidence, reviewedSourceIds: ReadonlySet<string>, blockers: string[]): void {
  if (evidence.dataset === null) { blockers.push("Canonical dataset version has no PostgreSQL publication evidence."); return; }
  const normalizeCoverage = (rows: AcceptanceDatasetEvidence["coverage"] | ReviewedSnapshot["coverage"]["rows"]) => rows
    .map((row) => ({
      provider: row.provider, competition: row.competition, seasonYear: row.seasonYear,
      earliestDate: row.earliestDate, latestDate: row.latestDate, status: row.status,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider)
      || left.competition.localeCompare(right.competition)
      || left.seasonYear - right.seasonYear);
  if (JSON.stringify(normalizeCoverage(evidence.coverage)) !== JSON.stringify(normalizeCoverage(snapshot.coverage.rows))) {
    blockers.push("Canonical dataset coverage rows do not exactly match the reviewed snapshot.");
  }
  for (const expected of snapshot.expected.rows) {
    const series = evidence.facts.filter((fact) => fact.kind === "series" && fact.id === expected.id);
    const games = evidence.facts.filter((fact) => fact.kind === "game" && fact.seriesId === expected.id);
    const observedGameIds = games.map((fact) => fact.id).sort(); const expectedGameIds = [...expected.gameIds].sort();
    if (series.length !== 1 || JSON.stringify(observedGameIds) !== JSON.stringify(expectedGameIds)) blockers.push(`Canonical dataset game facts do not exactly match reviewed series ${expected.id}.`);
    for (const fact of [...series, ...games]) {
      if (fact.provider !== "leaguepedia" || fact.publicationGeneration !== evidence.dataset.generation || fact.retiredGeneration !== null
        || fact.sourceObjectId === null || !reviewedSourceIds.has(fact.sourceObjectId)) blockers.push(`Canonical dataset fact provenance is invalid for ${fact.kind} ${fact.id}.`);
    }
  }
}

function verifyCanonical(snapshot: ReviewedSnapshot, response: ComparisonResponse, blockers: string[]): void {
  const { expected } = snapshot;
  if (response.subjects.left.id !== snapshot.comparison.left.id || response.subjects.left.kind !== snapshot.comparison.left.kind
    || response.subjects.right.id !== snapshot.comparison.right.id || response.subjects.right.kind !== snapshot.comparison.right.kind
    || response.subjects.left.displayName !== expected.leftDisplayName || response.subjects.right.displayName !== expected.rightDisplayName) {
    blockers.push("Canonical subject and opponent resolution does not match the reviewed snapshot.");
  }
  const media = [response.subjects.left.mediaUrl, response.subjects.right.mediaUrl, response.mediaUrls.left, response.mediaUrls.right];
  if (media.some((url) => url === undefined || url.endsWith("placeholder.svg"))) blockers.push("Both canonical subjects must resolve to non-placeholder presentation images.");
  if (response.seriesSummary.wins !== expected.seriesWins || response.seriesSummary.losses !== expected.seriesLosses) blockers.push("Reviewed expectations do not match canonical series totals.");
  if (response.gameSummary.wins !== expected.gameWins || response.gameSummary.losses !== expected.gameLosses) blockers.push("Reviewed expectations do not match canonical game totals.");
  const observedRows = response.rows.map(({ id, date, leftScore, rightScore, winner }) => ({ id, date, leftScore, rightScore, winner }));
  const expectedRows = expected.rows.map(({ id, date, leftScore, rightScore, winner }) => ({ id, date, leftScore, rightScore, winner }));
  if (JSON.stringify(observedRows) !== JSON.stringify(expectedRows) || response.nextCursor !== undefined) blockers.push("Canonical chronological series rows do not match the reviewed snapshot.");
  if (response.rows.some((row, index) => index > 0 && row.date > response.rows[index - 1]!.date)) blockers.push("Canonical series rows are not in reverse chronological order.");
  if (response.dataset.version !== snapshot.datasetVersion) blockers.push("Canonical dataset version does not match the reviewed snapshot.");
  if (response.dataset.coverage.from !== snapshot.coverage.from || response.dataset.coverage.to !== snapshot.coverage.to) blockers.push("Canonical dataset coverage does not match the reviewed snapshot.");
  if (response.coverageWarnings.length > 0) blockers.push("Canonical comparison still contains coverage warnings.");
  if (expected.rows.length !== expected.seriesWins + expected.seriesLosses) blockers.push("Reviewed series totals do not match the reviewed chronological rows.");
  if (expected.rows.reduce((total, row) => total + row.gameIds.length, 0) !== expected.gameWins + expected.gameLosses) blockers.push("Reviewed game totals do not match the reviewed game fact IDs.");
}

export async function verifyAcceptanceSnapshot(input: unknown, dependencies: AcceptanceVerificationDependencies): Promise<AcceptanceEvaluation> {
  const status = z.object({ schemaVersion: z.literal(2), status: z.string() }).safeParse(input);
  if (!status.success) return invalidSnapshot(status.error);
  if (status.data.status === "awaiting-reviewed-source") {
    const awaiting = AwaitingSnapshotSchema.safeParse(input);
    return awaiting.success ? { status: "blocked", blockers: ["Reviewed source status is awaiting-reviewed-source."] } : invalidSnapshot(awaiting.error);
  }
  const parsed = ReviewedSnapshotSchema.safeParse(input);
  if (!parsed.success) return invalidSnapshot(parsed.error);
  const snapshot = parsed.data; const blockers: string[] = [];
  const reviewedSourceIds = new Set<string>();

  try { void new URL(dependencies.approvedLeaguepediaEndpoint); }
  catch { return { status: "blocked", blockers: ["Configured Leaguepedia endpoint is invalid."] }; }
  if (!approvedAttributionUrl(snapshot.attribution.url, dependencies.approvedLeaguepediaEndpoint)) {
    blockers.push("Attribution must use the official Leaguepedia legal page on the approved endpoint origin.");
  }

  for (const source of snapshot.sources) {
    if (!approvedRequestUrl(source.requestUrl, dependencies.approvedLeaguepediaEndpoint, source.title)) blockers.push(`Source ${source.title} does not use the approved Leaguepedia endpoint known-page query.`);
    try {
      const registered = await dependencies.getSourceMetadata(source.objectKey);
      const sourceMetadata = registered.find((item) => item.provider === "leaguepedia" && item.sourceUrl === dependencies.approvedLeaguepediaEndpoint
        && item.objectKey === source.objectKey && item.checksum === source.rawObjectChecksum);
      if (sourceMetadata === undefined) blockers.push(`Immutable raw object lacks registered PostgreSQL source provenance for ${source.objectKey}.`);
      else if (normalizedTimestamp(source.retrievedAt) !== normalizedTimestamp(sourceMetadata.retrievedAt)) blockers.push(`Immutable raw object retrieval timestamp does not match PostgreSQL provenance for ${source.objectKey}.`);
      else reviewedSourceIds.add(sourceMetadata.id);
      const stream = await dependencies.getRawObject(source.objectKey);
      if (stream === null) { blockers.push(`Immutable raw object is missing for ${source.objectKey}.`); continue; }
      const retained = await readAndHash(stream, dependencies.maxRawObjectBytes);
      if (retained.checksum !== source.rawObjectChecksum) blockers.push(`Immutable raw object checksum mismatch for ${source.objectKey}.`);
      if (sourceMetadata !== undefined && (sourceMetadata.contentType !== "application/json" || sourceMetadata.byteSize !== String(retained.body.byteLength) || sourceMetadata.parserVersion.length === 0)) blockers.push(`Immutable raw object PostgreSQL metadata is invalid for ${source.objectKey}.`);
      const rawJson = JSON.parse(retained.body.toString("utf8")) as unknown;
      const input = productionRawInput(rawJson, retained.body);
      if (input === undefined || input.sourceUrl !== dependencies.approvedLeaguepediaEndpoint) {
        blockers.push(`Immutable raw object is not the canonical Leaguepedia raw wrapper for ${source.objectKey}.`);
        continue;
      }
      const evidence = exactEvidence(input, source.requestId);
      if (evidence === undefined
        || evidence.sourceUrl !== source.requestUrl
        || !Array.isArray(evidence.revisionIds)
        || !evidence.revisionIds.includes(source.revisionId)
        || !hasSamePageRevision(evidence.response, source.pageId, source.title, source.revisionId)) {
        blockers.push(`Immutable raw object does not contain exact request evidence with the same page title and revision evidence for ${source.title}.`);
      }
    } catch (error) { blockers.push(`Immutable raw object verification failed for ${source.objectKey}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  try {
    const response = await dependencies.compare({
      left: snapshot.comparison.left, right: snapshot.comparison.right, eventCategories: ["worlds"], leagues: [], bestOf: [5], tournamentIds: [], limit: 100,
    });
    verifyCanonical(snapshot, response, blockers);
    const datasetEvidence = await dependencies.getDatasetEvidence(snapshot.datasetVersion, snapshot.expected.rows.map((row) => row.id));
    verifyDatasetEvidence(snapshot, datasetEvidence, reviewedSourceIds, blockers);
    if (response.subjects.left.mediaUrl !== response.mediaUrls.left || response.subjects.right.mediaUrl !== response.mediaUrls.right) blockers.push("Canonical subject media URLs do not match comparison media URLs.");
    await verifyPresentation("left", response.subjects.left, response.mediaUrls.left, snapshot.expected.media.left, dependencies, blockers);
    await verifyPresentation("right", response.subjects.right, response.mediaUrls.right, snapshot.expected.media.right, dependencies, blockers);
    if (blockers.length > 0) return { status: "blocked", blockers };
    return { status: "ready", blockers: [], observed: {
      datasetVersion: response.dataset.version, seriesWins: response.seriesSummary.wins, seriesLosses: response.seriesSummary.losses,
      gameWins: response.gameSummary.wins, gameLosses: response.gameSummary.losses, seriesIds: response.rows.map((row) => row.id),
    } };
  } catch (error) {
    blockers.push(`Canonical PostgreSQL comparison failed: ${error instanceof Error ? error.message : String(error)}`);
    return { status: "blocked", blockers };
  }
}
