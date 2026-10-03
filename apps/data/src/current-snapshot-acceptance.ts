import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Kysely } from "kysely";
import {
  DateSchema,
  MediaRightsBasisSchema,
  validMediaRights,
  SubjectRefSchema,
  UuidSchema,
  type ComparisonQuery,
  type PublicSnapshot,
  type ResolvedSubject,
  type SnapshotEntity,
} from "@riftversus/contracts";
import { compareSqlite } from "@riftversus/domain";
import {
  createDb,
  destroyDb,
  exportSnapshotFacts,
  getDatasetStatus,
  type Database,
  type SnapshotProjection,
} from "@riftversus/database";
import type { ObjectStore } from "@riftversus/sync";
import { z } from "zod";

import { ExpectedPresentationSchema } from "./acceptance-media.js";
import { generateCanonicalAvatar } from "./avatar.js";
import { snapshotDigest, verifyPublicSnapshot } from "./export-snapshot.js";
import { openPublicSqlite } from "./sqlite-reader.js";

const ReviewedSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  status: z.literal("reviewed"),
  comparison: z.object({ left: SubjectRefSchema, right: SubjectRefSchema }).strict(),
  coverage: z.object({ from: DateSchema, to: DateSchema }).passthrough(),
  expected: z.object({
    leftDisplayName: z.string().min(1),
    rightDisplayName: z.string().min(1),
    seriesWins: z.number().int().nonnegative(),
    seriesLosses: z.number().int().nonnegative(),
    gameWins: z.number().int().nonnegative(),
    gameLosses: z.number().int().nonnegative(),
    media: z.object({ left: ExpectedPresentationSchema, right: ExpectedPresentationSchema }).strict(),
    rows: z.array(z.object({
      id: UuidSchema,
      gameIds: z.array(UuidSchema).min(1),
      date: DateSchema,
      leftName: z.string().min(1),
      rightName: z.string().min(1),
      leftScore: z.number().int().nonnegative(),
      rightScore: z.number().int().nonnegative(),
      winner: z.enum(["left", "right"]),
    }).strict()).min(1),
  }).strict(),
}).passthrough();

export type CurrentReviewedSnapshot = z.infer<typeof ReviewedSnapshotSchema>;
type ReviewedSnapshot = CurrentReviewedSnapshot;
type Db = Kysely<Database>;

export interface CurrentSnapshotAcceptanceInput {
  databaseUrl: string;
  directory: string;
  store: ObjectStore;
  reviewedPath: string;
  approvedLeaguepediaEndpoint: string;
}

export interface CurrentSnapshotAcceptance {
  status: "ready" | "blocked";
  blockers: string[];
}

interface PublicPresentationAsset {
  bytes: Buffer;
  checksum: string;
  contentType: string;
  file: string;
  basePath: string;
}

interface FactAudit {
  factTable: "series_facts" | "game_facts";
  factId: string;
  sourceObjectId: string | null;
}

export interface CurrentFactRecord {
  kind: "series" | "game";
  id: string;
  provider: string;
  publicationGeneration: string;
  retiredGeneration: string | null;
  seriesId?: string;
}

export interface CurrentFactAudit {
  factTable: "series_facts" | "game_facts";
  factId: string;
  sourceObjectId: string | null;
}

export interface CurrentSourceRecord {
  id: string;
  provider: string;
  sourceUrl: string;
  objectKey: string;
  checksum: string;
  contentType: string | null;
  byteSize: string | null;
}

export interface CurrentFactProvenanceInput {
  seriesIds: readonly string[];
  gameIds: readonly string[];
  gameToSeries: ReadonlyMap<string, string>;
  seriesFacts: readonly CurrentFactRecord[];
  gameFacts: readonly CurrentFactRecord[];
  audits: readonly CurrentFactAudit[];
  sources: readonly CurrentSourceRecord[];
  latestGeneration: bigint;
  approvedLeaguepediaEndpoint: string;
  store: ObjectStore;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function entityKey(entity: Pick<SnapshotEntity, "kind" | "id" | "teamEraId">): string {
  return `${entity.kind}:${entity.id}:${entity.teamEraId ?? ""}`;
}

function contentTypeForExtension(extension: string): string | null {
  return ({
    gif: "image/gif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
  } as const)[extension.toLowerCase() as "gif" | "jpg" | "jpeg" | "png" | "svg" | "webp"] ?? null;
}

function publicPresentationPath(mediaUrl: string): { filename: string; checksum: string; contentType: string; basePath: string } | null {
  if (!mediaUrl.startsWith("/") || mediaUrl.includes("?") || mediaUrl.includes("#")) return null;
  const marker = "/presentation/";
  const markerIndex = mediaUrl.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const basePath = mediaUrl.slice(0, markerIndex + 1);
  const filename = mediaUrl.slice(markerIndex + marker.length);
  const match = /^(?<checksum>[a-f0-9]{64})\.(?<extension>gif|jpe?g|png|svg|webp)$/u.exec(filename);
  if (!match?.groups) return null;
  const contentType = contentTypeForExtension(match.groups.extension!);
  if (contentType === null) return null;
  return { filename, checksum: match.groups.checksum!, contentType, basePath };
}

async function readPublicPresentation(directory: string, mediaUrl: string): Promise<PublicPresentationAsset | null> {
  const path = publicPresentationPath(mediaUrl);
  if (path === null) return null;
  const bytes = await readFile(join(directory, "presentation", path.filename));
  const checksum = sha256(bytes);
  return { ...path, bytes, checksum, file: join(directory, "presentation", path.filename) };
}

function publicSnapshotContent(snapshot: PublicSnapshot): Omit<PublicSnapshot, "snapshotId"> {
  const { snapshotId, ...content } = snapshot;
  void snapshotId;
  return content;
}

/** Compare DB export and public content; mediaUrl is the only transport-specific difference. */
export function compareSnapshotProjection(projection: SnapshotProjection, snapshot: PublicSnapshot): string[] {
  const blockers: string[] = [];
  const publicEntities = new Map(snapshot.entities.map((entity) => [entityKey(entity), entity]));
  const normalizedEntities = projection.entities.map((entity) => {
    const publicEntity = publicEntities.get(entityKey(entity));
    if (publicEntity === undefined) {
      blockers.push(`Public snapshot is missing entity ${entityKey(entity)}.`);
      return entity;
    }
    return { ...entity, mediaUrl: publicEntity.mediaUrl };
  });
  if (snapshot.entities.length !== projection.entities.length) blockers.push("Public snapshot entity count does not match the database projection.");
  const expected = { ...projection, entities: normalizedEntities };
  if (snapshotDigest(expected) !== snapshotDigest(publicSnapshotContent(snapshot))) {
    blockers.push("Public snapshot does not exactly match the current database projection after media URL normalization.");
  }
  return blockers;
}

function approvedSourceUrl(value: string, endpoint: string): boolean {
  try {
    const source = new URL(value);
    const approved = new URL(endpoint);
    return source.protocol === "https:"
      && source.origin === approved.origin
      && source.pathname === approved.pathname
      && source.search === ""
      && source.hash === "";
  } catch {
    return false;
  }
}

async function readStoreObject(store: ObjectStore, key: string): Promise<{
  bytes: Buffer;
  checksum: string;
  metadataChecksum: string;
  contentType: string;
  metadataByteSize: number;
  byteSize: number;
} | null> {
  const metadata = await store.head(key);
  if (metadata === null || metadata.byteSize === null || metadata.contentType === null) return null;
  const stream = await store.get(key);
  if (stream === null) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  return {
    bytes,
    checksum: sha256(bytes),
    metadataChecksum: metadata.checksum,
    contentType: metadata.contentType,
    metadataByteSize: metadata.byteSize,
    byteSize: bytes.byteLength,
  };
}

function activeFactIds(snapshot: PublicSnapshot): { seriesIds: string[]; gameIds: string[]; gameToSeries: Map<string, string> } {
  const seriesIds: string[] = [];
  const gameIds: string[] = [];
  const gameToSeries = new Map<string, string>();
  for (const series of snapshot.series) {
    seriesIds.push(series.id);
    for (const game of series.games) {
      gameIds.push(game.id);
      gameToSeries.set(game.id, series.id);
    }
  }
  return { seriesIds, gameIds, gameToSeries };
}

export async function verifyFactProvenanceRecords(input: CurrentFactProvenanceInput): Promise<string[]> {
  const { seriesIds, gameIds, gameToSeries, seriesFacts, gameFacts, audits, sources, latestGeneration, approvedLeaguepediaEndpoint, store } = input;
  const blockers: string[] = [];
  if (new Set(seriesIds).size !== seriesIds.length) blockers.push("Public snapshot contains duplicate series IDs.");
  if (new Set(gameIds).size !== gameIds.length) blockers.push("Public snapshot contains duplicate game IDs.");
  const latestAudits = new Map<string, FactAudit>();
  for (const audit of audits) {
    const key = `${audit.factTable}:${audit.factId}`;
    if (!latestAudits.has(key)) latestAudits.set(key, { factTable: audit.factTable, factId: audit.factId, sourceObjectId: audit.sourceObjectId });
  }

  const sourceIds = new Set<string>();
  const seriesById = new Map(seriesFacts.map((fact) => [fact.id, fact]));
  const gameById = new Map(gameFacts.map((fact) => [fact.id, fact]));
  if (seriesById.size !== new Set(seriesIds).size) blockers.push("Current database is missing one or more public series facts.");
  if (gameById.size !== new Set(gameIds).size) blockers.push("Current database is missing one or more public game facts.");
  for (const id of seriesIds) {
    const fact = seriesById.get(id);
    if (fact === undefined) continue;
    if (fact.provider !== "leaguepedia") blockers.push(`Series fact ${fact.id} is not owned by Leaguepedia.`);
    if (BigInt(fact.publicationGeneration) > latestGeneration || (fact.retiredGeneration !== null && BigInt(fact.retiredGeneration) <= latestGeneration)) blockers.push(`Series fact ${fact.id} is not active at the latest generation.`);
    const audit = latestAudits.get(`series_facts:${fact.id}`);
    if (audit?.sourceObjectId === null || audit === undefined) blockers.push(`Series fact ${fact.id} has no source-object audit.`);
    else sourceIds.add(audit.sourceObjectId);
  }
  for (const id of gameIds) {
    const fact = gameById.get(id);
    if (fact === undefined) continue;
    if (fact.provider !== "leaguepedia") blockers.push(`Game fact ${fact.id} is not owned by Leaguepedia.`);
    if (gameToSeries.get(fact.id) !== fact.seriesId) blockers.push(`Game fact ${fact.id} is attached to the wrong series.`);
    if (BigInt(fact.publicationGeneration) > latestGeneration || (fact.retiredGeneration !== null && BigInt(fact.retiredGeneration) <= latestGeneration)) blockers.push(`Game fact ${fact.id} is not active at the latest generation.`);
    const audit = latestAudits.get(`game_facts:${fact.id}`);
    if (audit?.sourceObjectId === null || audit === undefined) blockers.push(`Game fact ${fact.id} has no source-object audit.`);
    else sourceIds.add(audit.sourceObjectId);
  }

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  if (sourceById.size !== sourceIds.size) blockers.push("One or more fact source objects are missing from PostgreSQL.");
  const checkedObjects = new Map<string, Awaited<ReturnType<typeof readStoreObject>>>();
  for (const sourceId of sourceIds) {
    const source = sourceById.get(sourceId);
    if (source === undefined) continue;
    if (source.provider !== "leaguepedia" || !approvedSourceUrl(source.sourceUrl, approvedLeaguepediaEndpoint)) blockers.push(`Source object ${source.id} is not tied to the approved Leaguepedia endpoint.`);
    if (source.contentType !== "application/json" || source.byteSize === null) blockers.push(`Source object ${source.id} has invalid raw metadata.`);
    let stored = checkedObjects.get(source.objectKey);
    if (stored === undefined) {
      stored = await readStoreObject(store, source.objectKey);
      checkedObjects.set(source.objectKey, stored);
    }
    if (stored === null) {
      blockers.push(`Source object ${source.objectKey} is missing or has incomplete object metadata.`);
      continue;
    }
    if (stored.metadataChecksum !== stored.checksum || stored.metadataByteSize !== stored.byteSize
      || stored.checksum !== source.checksum || stored.byteSize !== Number(source.byteSize) || stored.contentType !== source.contentType) {
      blockers.push(`Source object ${source.objectKey} does not match PostgreSQL checksum, size, or content type.`);
    }
  }
  return blockers;
}

async function verifyFactProvenance(
  snapshot: PublicSnapshot,
  db: Db,
  store: ObjectStore,
  latestGeneration: bigint,
  approvedLeaguepediaEndpoint: string,
  blockers: string[],
): Promise<void> {
  const { seriesIds, gameIds, gameToSeries } = activeFactIds(snapshot);
  const allFactIds = [...new Set([...seriesIds, ...gameIds])];
  const seriesRows = seriesIds.length === 0 ? [] : await db.selectFrom("series_facts").selectAll().where("id", "in", seriesIds).execute();
  const gameRows = gameIds.length === 0 ? [] : await db.selectFrom("game_facts").selectAll().where("id", "in", gameIds).execute();
  const audits = allFactIds.length === 0 ? [] : await db.selectFrom("fact_mutation_audits")
    .select(["fact_table", "fact_id", "source_object_id", "audit_id"])
    .where("fact_id", "in", allFactIds)
    .orderBy("audit_id", "desc")
    .execute();
  const latestAudits = new Map<string, (typeof audits)[number]>();
  for (const audit of audits) {
    const key = `${audit.fact_table}:${audit.fact_id}`;
    if (!latestAudits.has(key)) latestAudits.set(key, audit);
  }
  const currentAudits = [...latestAudits.values()];
  const sourceIds = [...new Set(currentAudits.map((audit) => audit.source_object_id).filter((id): id is string => id !== null))];
  const sources = sourceIds.length === 0 ? [] : await db.selectFrom("source_objects").selectAll().where("id", "in", sourceIds).execute();
  const currentBlockers = await verifyFactProvenanceRecords({
    seriesIds,
    gameIds,
    gameToSeries,
    seriesFacts: seriesRows.map((fact) => ({ kind: "series" as const, id: fact.id, provider: fact.provider, publicationGeneration: fact.publication_generation, retiredGeneration: fact.retired_generation })),
    gameFacts: gameRows.map((fact) => ({ kind: "game" as const, id: fact.id, provider: fact.provider, publicationGeneration: fact.publication_generation, retiredGeneration: fact.retired_generation, seriesId: fact.series_id })),
    audits: currentAudits.map((audit) => ({ factTable: audit.fact_table, factId: audit.fact_id, sourceObjectId: audit.source_object_id })),
    sources: sources.map((source) => ({ id: source.id, provider: source.provider, sourceUrl: source.source_url, objectKey: source.object_key, checksum: source.checksum, contentType: source.content_type, byteSize: source.byte_size })),
    latestGeneration,
    approvedLeaguepediaEndpoint,
    store,
  });
  blockers.push(...currentBlockers);
}

async function verifyRetainedPresentation(
  entity: SnapshotEntity,
  publicAsset: PublicPresentationAsset,
  snapshot: PublicSnapshot,
  db: Db,
  store: ObjectStore,
  blockers: string[],
): Promise<void> {
  if (entity.retainedObjectKey === null) return;
  const media = await db.selectFrom("media_assets").selectAll().where("object_key", "=", entity.retainedObjectKey).where("is_current", "=", true).execute();
  const owner = media.find((row) => entity.teamEraId === undefined
    ? row.entity_id === entity.id && row.team_era_id === null
    : row.team_era_id === entity.teamEraId);
  const object = await db.selectFrom("media_objects").selectAll().where("object_key", "=", entity.retainedObjectKey).executeTakeFirst();
  if (owner === undefined || object === undefined) {
    blockers.push(`Retained media ${entity.retainedObjectKey} is missing its current PostgreSQL owner or object metadata.`);
    return;
  }
  if (!validMediaRights({ license: owner.license, attribution: owner.attribution, rightsBasis: owner.rights_basis, checksum: object.checksum })) blockers.push(`Retained media ${entity.retainedObjectKey} lacks valid rights or attribution evidence.`);
  if (publicAsset.contentType !== object.content_type || publicAsset.checksum !== object.checksum || publicAsset.bytes.byteLength !== Number(object.byte_size)) blockers.push(`Public retained media ${entity.retainedObjectKey} does not match PostgreSQL media metadata.`);
  const stored = await readStoreObject(store, entity.retainedObjectKey);
  if (stored === null || stored.metadataChecksum !== stored.checksum || stored.metadataByteSize !== stored.byteSize
    || stored.checksum !== object.checksum || stored.byteSize !== Number(object.byte_size) || stored.contentType !== object.content_type || !stored.bytes.equals(publicAsset.bytes)) blockers.push(`Retained media ${entity.retainedObjectKey} does not match the immutable object store bytes.`);
  const attribution = snapshot.attribution?.find((item) => item.objectKey === entity.retainedObjectKey && (item.rightsBasis === undefined
    || (entity.teamEraId === undefined ? item.entityId === entity.id && item.teamEraId === undefined : item.teamEraId === entity.teamEraId)));
  if (attribution === undefined || attribution.sourceUrl !== owner.source_url || attribution.license !== owner.license || attribution.attribution !== owner.attribution) blockers.push(`Public attribution for ${entity.retainedObjectKey} does not match PostgreSQL media rights metadata.`);
  if (attribution !== undefined && JSON.stringify(attribution.rightsBasis ?? null) !== JSON.stringify(owner.rights_basis === null ? null : MediaRightsBasisSchema.parse(owner.rights_basis))) blockers.push(`Public editorial rights for ${entity.retainedObjectKey} do not match PostgreSQL evidence.`);
}

async function verifyPresentationAssets(snapshot: PublicSnapshot, directory: string, db: Db, store: ObjectStore, blockers: string[]): Promise<void> {
  const basePaths = new Set<string>();
  const seen = new Map<string, PublicPresentationAsset>();
  for (const entity of snapshot.entities) {
    let asset = seen.get(entity.mediaUrl);
    if (asset === undefined) {
      const path = publicPresentationPath(entity.mediaUrl);
      if (path === null) {
        blockers.push(`Entity ${entityKey(entity)} has an invalid public presentation URL.`);
        continue;
      }
      basePaths.add(path.basePath);
      try {
        const loaded = await readPublicPresentation(directory, entity.mediaUrl);
        if (loaded === null) throw new Error("invalid path");
        asset = loaded;
        seen.set(entity.mediaUrl, loaded);
      } catch {
        blockers.push(`Public presentation asset is missing for ${entityKey(entity)}.`);
        continue;
      }
      if (asset.checksum !== path.checksum) blockers.push(`Public presentation checksum does not match its URL for ${entityKey(entity)}.`);
      if (asset.bytes.byteLength === 0) blockers.push(`Public presentation asset is empty for ${entityKey(entity)}.`);
    }
    if (asset === undefined) continue;
    if (entity.retainedObjectKey === null) {
      const avatar = generateCanonicalAvatar({ kind: entity.kind, id: entity.id, label: entity.avatarLabel });
      if (asset.contentType !== avatar.contentType || asset.checksum !== avatar.checksum || !asset.bytes.equals(avatar.body)) blockers.push(`Generated avatar bytes do not match the canonical identity for ${entityKey(entity)}.`);
    } else {
      await verifyRetainedPresentation(entity, asset, snapshot, db, store, blockers);
    }
  }
  if (basePaths.size > 1) blockers.push("Public presentation URLs use inconsistent site base paths.");
}

function comparisonQuery(reviewed: ReviewedSnapshot): ComparisonQuery {
  return {
    left: reviewed.comparison.left,
    right: reviewed.comparison.right,
    from: reviewed.coverage.from,
    to: reviewed.coverage.to,
    eventCategories: ["worlds"],
    leagues: [],
    bestOf: [5],
    tournamentIds: [],
    limit: 100,
  };
}

function subjectMatches(subject: ResolvedSubject, expected: { kind: string; id: string }): boolean {
  return subject.kind === expected.kind && subject.id === expected.id;
}

export async function verifyHistoricalInvariant(snapshot: PublicSnapshot, reviewed: CurrentReviewedSnapshot, directory: string, blockers: string[]): Promise<void> {
  let response;
  try {
    const sqlite = await openPublicSqlite(directory);
    try { response = await compareSqlite(sqlite.executor, comparisonQuery(reviewed), snapshot.snapshotId); }
    finally { sqlite.close(); }
  } catch (error) {
    blockers.push(`Reviewed historical comparison could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const expected = reviewed.expected;
  if (!subjectMatches(response.subjects.left, reviewed.comparison.left) || !subjectMatches(response.subjects.right, reviewed.comparison.right)
    || response.subjects.left.displayName !== expected.leftDisplayName || response.subjects.right.displayName !== expected.rightDisplayName) blockers.push("Current snapshot subject presentation does not match the reviewed historical comparison.");
  if (response.seriesSummary.wins !== expected.seriesWins || response.seriesSummary.losses !== expected.seriesLosses || response.gameSummary.wins !== expected.gameWins || response.gameSummary.losses !== expected.gameLosses) blockers.push("Current snapshot historical summaries do not match the reviewed comparison.");
  const rows = response.rows.map(({ id, date, leftName, rightName, leftScore, rightScore, winner }) => ({ id, date, leftName, rightName, leftScore, rightScore, winner }));
  const expectedRows = expected.rows.map(({ id, date, leftName, rightName, leftScore, rightScore, winner }) => ({ id, date, leftName, rightName, leftScore, rightScore, winner }));
  if (JSON.stringify(rows) !== JSON.stringify(expectedRows) || response.nextCursor !== undefined) blockers.push("Current snapshot historical rows do not match the reviewed comparison.");
  const snapshotSeriesById = new Map(snapshot.series.map((series) => [series.id, series]));
  for (const expectedRow of expected.rows) {
    const series = snapshotSeriesById.get(expectedRow.id);
    const actualGameIds = series?.games.map((game) => game.id).sort() ?? [];
    const expectedGameIds = [...expectedRow.gameIds].sort();
    if (JSON.stringify(actualGameIds) !== JSON.stringify(expectedGameIds)) blockers.push(`Current snapshot game IDs do not match reviewed series ${expectedRow.id}.`);
  }
  if (response.coverageWarnings.length > 0) blockers.push("Current snapshot historical comparison contains coverage warnings.");

  const mediaExpectations: Array<["left" | "right", ResolvedSubject, Extract<typeof expected.media.left, { kind: "retained-media" }> | Extract<typeof expected.media.left, { kind: "generated-avatar" }>, string]> = [
    ["left", response.subjects.left, expected.media.left, response.mediaUrls.left],
    ["right", response.subjects.right, expected.media.right, response.mediaUrls.right],
  ];
  for (const [side, subject, media, mediaUrl] of mediaExpectations) {
    const asset = await readPublicPresentation(directory, mediaUrl).catch(() => null);
    if (asset === null) {
      blockers.push(`Reviewed ${side} presentation is missing from the public snapshot.`);
      continue;
    }
    const retained = snapshot.entities.find(entity => entity.id === subject.id && entity.teamEraId === subject.teamEraId)?.retainedObjectKey;
    const expectedAsset = media.kind === "generated-avatar" && retained != null && media.retainedPreference !== undefined ? media.retainedPreference : media;
    if (asset.checksum !== expectedAsset.checksum || asset.contentType !== expectedAsset.contentType) blockers.push(`Reviewed ${side} presentation checksum or content type does not match the reviewed evidence.`);
    if (media.kind === "generated-avatar" && (subject.kind !== media.entityKind || subject.id !== media.entityId)) blockers.push(`Reviewed ${side} generated avatar identity does not match the current subject.`);
  }
}

async function readReviewedSnapshot(path: string): Promise<ReviewedSnapshot> {
  return ReviewedSnapshotSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function verifyCurrentSnapshot(input: CurrentSnapshotAcceptanceInput): Promise<CurrentSnapshotAcceptance> {
  let snapshot: PublicSnapshot;
  let reviewed: ReviewedSnapshot;
  try {
    snapshot = await verifyPublicSnapshot(input.directory);
  } catch (error) {
    return { status: "blocked", blockers: [`Public snapshot verification failed: ${error instanceof Error ? error.message : String(error)}`] };
  }
  try {
    reviewed = await readReviewedSnapshot(input.reviewedPath);
  } catch (error) {
    return { status: "blocked", blockers: [`Reviewed historical acceptance is invalid: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const db = createDb({ databaseUrl: input.databaseUrl });
  try {
    const latest = await db.selectFrom("dataset_versions").select(["version", "generation"]).orderBy("generation", "desc").executeTakeFirst();
    const status = await getDatasetStatus(db);
    if (latest === undefined || status === null) return { status: "blocked", blockers: ["No published dataset is available for current snapshot acceptance."] };
    const projection = await exportSnapshotFacts(db);
    const blockers = compareSnapshotProjection(projection, snapshot);
    if (snapshot.dataset.version !== latest.version || snapshot.dataset.version !== status.version) blockers.push("Public snapshot dataset identity is not the latest PostgreSQL publication.");
    await verifyFactProvenance(snapshot, db, input.store, BigInt(latest.generation), input.approvedLeaguepediaEndpoint, blockers);
    await verifyPresentationAssets(snapshot, input.directory, db, input.store, blockers);
    await verifyHistoricalInvariant(snapshot, reviewed, input.directory, blockers);
    return blockers.length === 0 ? { status: "ready", blockers: [] } : { status: "blocked", blockers };
  } finally {
    await destroyDb(db);
  }
}
