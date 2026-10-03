import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { PublicSnapshotSchema, SnapshotIdSchema, SqliteManifestSchema, type PublicSnapshot, type SnapshotEntity, type SnapshotGame, type SnapshotSeries, type SnapshotSide, type SqliteManifest } from "@riftversus/contracts";
import { createSqliteSchema, SQLITE_PAGE_SIZE, SQLITE_REQUEST_CHUNK_SIZE, SQLITE_SCHEMA_VERSION } from "@riftversus/domain";
import { createDb, exportSnapshotFacts, findMediaObjectMetadataByKey } from "@riftversus/database";
import type { ObjectStore } from "@riftversus/sync";
import { generateCanonicalAvatar } from "./avatar.js";
import { renderMediaCredits } from "./media-credits.js";

const EMPTY_SNAPSHOT_ID = `sha256:${"0".repeat(64)}`;
const SAFE_FILE = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*$/u;
interface SqliteRow { [key: string]: unknown }

function sha256(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }
function json(value: unknown): string { return JSON.stringify(value); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function compareEntities(left: SnapshotEntity, right: SnapshotEntity): number { return compareText(left.id, right.id) || compareText(left.teamEraId ?? "", right.teamEraId ?? ""); }
function compareGames(left: SnapshotGame, right: SnapshotGame): number { return compareText(left.playedAt, right.playedAt) || compareText(left.id, right.id); }

function normalizeSide(side: SnapshotSide): SnapshotSide { return { ...side, playerIds: [...side.playerIds].sort(compareText) }; }

function normalizeProjection(projection: Omit<PublicSnapshot, "snapshotId">): PublicSnapshot {
  const normalized = PublicSnapshotSchema.parse({ ...projection, snapshotId: EMPTY_SNAPSHOT_ID });
  normalized.entities = [...normalized.entities].sort(compareEntities).map((entity) => ({ ...entity, aliases: [...new Set(entity.aliases)].sort(compareText) }));
  normalized.series = [...normalized.series].sort((left, right) => compareText(left.id, right.id)).map((series) => ({
    ...series,
    sides: [normalizeSide(series.sides[0]), normalizeSide(series.sides[1])],
    games: [...series.games].sort(compareGames).map((game) => ({ ...game, sides: [normalizeSide(game.sides[0]), normalizeSide(game.sides[1])] })),
  }));
  if (normalized.attribution !== undefined) normalized.attribution = [...normalized.attribution].sort((left, right) => compareText(left.objectKey, right.objectKey));
  return normalized;
}

export function snapshotDigest(snapshot: Omit<PublicSnapshot, "snapshotId">): string {
  const normalized = normalizeProjection(snapshot);
  const { snapshotId, ...content } = normalized;
  void snapshotId;
  return `sha256:${sha256(json(content))}`;
}

function snapshotWithDigest(projection: Omit<PublicSnapshot, "snapshotId">): PublicSnapshot {
  if (projection.series.some((series) => !series.completed || series.winnerSide === null)) throw new Error("Public SQLite snapshots require completed series with a winner.");
  if (projection.series.some((series) => series.sides.some((side) => side.playerIds.length > 0))) throw new Error("Public SQLite snapshots store player membership per game, not on series sides.");
  const normalized = normalizeProjection(projection);
  const { snapshotId: placeholder, ...content } = normalized;
  void placeholder;
  return PublicSnapshotSchema.parse({ ...content, snapshotId: snapshotDigest(content) });
}

function assertRegularFile(path: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (stats.isSymbolicLink()) throw new Error(`SQLite snapshot file is a symlink: ${path}`);
  if (!stats.isFile()) throw new Error(`SQLite snapshot path is not a regular file: ${path}`);
  if (stats.nlink !== 1) throw new Error(`SQLite snapshot file is hard-linked: ${path}`);
}

function assertSafeFile(file: string): void {
  if (!SAFE_FILE.test(file) || file.split("/").some((segment) => segment === "." || segment === "..")) throw new Error(`SQLite snapshot file path is unsafe: ${file}`);
}

async function assertMissing(path: string): Promise<void> {
  try { await lstat(path); } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`SQLite snapshot target already exists: ${path}`);
}

function metadataEntries(snapshot: PublicSnapshot): Array<[string, unknown]> {
  return [
    ["snapshotId", snapshot.snapshotId],
    ["dataset", snapshot.dataset],
    ["coverageWarnings", snapshot.coverageWarnings],
    ...(snapshot.freshness === undefined ? [] : [["freshness", snapshot.freshness] as [string, unknown]]),
    ...(snapshot.attribution === undefined ? [] : [["attribution", snapshot.attribution] as [string, unknown]]),
  ];
}

function variantId(entity: SnapshotEntity): string { return entity.teamEraId === undefined ? entity.id : `${entity.id}:${entity.teamEraId}`; }
function sideValues(side: SnapshotSide): [string, string | null, string | null, string] { return [side.teamId, side.eraId, side.regionId, side.teamName]; }
function winnerTeamId(sides: readonly [SnapshotSide, SnapshotSide], winnerSide: "a" | "b" | null): string | null { return winnerSide === null ? null : winnerSide === "a" ? sides[0].teamId : sides[1].teamId; }

function createDatabase(path: string, snapshot: PublicSnapshot): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(`PRAGMA page_size=${SQLITE_PAGE_SIZE}; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA user_version=${SQLITE_SCHEMA_VERSION};`);
    createSqliteSchema(database);
    database.exec("BEGIN IMMEDIATE");
    try {
      const metadata = database.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
      for (const [key, value] of metadataEntries(snapshot)) metadata.run(key, json(value));

      const insertEntity = database.prepare(`INSERT INTO entity_variants
        (variant_id, entity_id, kind, team_era_id, display_name, real_name, era_label, canonical_name, slug, avatar_label, retained_object_key, media_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertAlias = database.prepare("INSERT INTO entity_aliases (entity_id, alias) VALUES (?, ?)");
      const insertTerm = database.prepare("INSERT INTO search_terms (entity_id, term) VALUES (?, ?)");
      const aliasesByEntity = new Map<string, string[]>();
      for (const entity of snapshot.entities) if (!aliasesByEntity.has(entity.id)) aliasesByEntity.set(entity.id, entity.aliases);
      const insertedAliases = new Set<string>();
      const insertedTerms = new Set<string>();
      const insertPublicId = database.prepare("INSERT INTO public_ids (kind, public_id, entity_id) VALUES (?, ?, ?)");
      const insertPublicEra = database.prepare("INSERT INTO public_era_ids (entity_id, public_id, team_era_id) VALUES (?, ?, ?)");
      const publicOwners = new Set<string>();
      for (const entity of snapshot.entities) {
        if (entity.publicId !== undefined && !publicOwners.has(entity.id)) {
          insertPublicId.run(entity.kind, entity.publicId, entity.id);
          publicOwners.add(entity.id);
        }
        if (entity.publicEraId !== undefined && entity.teamEraId !== undefined) insertPublicEra.run(entity.id, entity.publicEraId, entity.teamEraId);
        insertEntity.run(variantId(entity), entity.id, entity.kind, entity.teamEraId ?? null, entity.displayName, entity.realName ?? null, entity.eraLabel ?? null, entity.canonicalName, entity.slug, entity.avatarLabel, entity.retainedObjectKey, entity.mediaUrl);
        const aliases = aliasesByEntity.get(entity.id) ?? [];
        if (entity.teamEraId === undefined) for (const alias of aliases) {
          const key = `${entity.id}\u0000${alias}`;
          if (!insertedAliases.has(key)) { insertAlias.run(entity.id, alias); insertedAliases.add(key); }
        }
        const terms = new Set<string>([entity.canonicalName.toLowerCase(), entity.slug.toLowerCase(), ...(entity.teamEraId === undefined ? [entity.displayName.toLowerCase()] : []), ...aliases.map((alias) => alias.toLowerCase())]);
        for (const term of terms) {
          const key = `${entity.id}\u0000${term}`;
          if (!insertedTerms.has(key)) { insertTerm.run(entity.id, term); insertedTerms.add(key); }
        }
      }

      const tournaments = new Map(snapshot.series.map((series) => [series.tournament.id, series.tournament]));
      const insertTournament = database.prepare("INSERT INTO tournaments (id, name, category, league_slug) VALUES (?, ?, ?, ?)");
      for (const tournament of [...tournaments.values()].sort((left, right) => compareText(left.id, right.id))) insertTournament.run(tournament.id, tournament.name, tournament.category, tournament.league);

      const insertSeries = database.prepare(`INSERT INTO series_facts
        (id, played_at, date, tournament_id, best_of, side_a_team_id, side_b_team_id, side_a_era_id, side_b_era_id, side_a_region_id, side_b_region_id, side_a_name, side_b_name, side_a_score, side_b_score, winner_team_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const series of snapshot.series) {
        const a = sideValues(series.sides[0]); const b = sideValues(series.sides[1]);
        insertSeries.run(series.id, series.playedAt, series.date, series.tournament.id, series.bestOf, a[0], b[0], a[1], b[1], a[2], b[2], a[3], b[3], series.score.a, series.score.b, winnerTeamId(series.sides, series.winnerSide));
      }

      const insertGame = database.prepare(`INSERT INTO game_facts
        (id, series_id, played_at, game_number, side_a_team_id, side_b_team_id, side_a_era_id, side_b_era_id, side_a_region_id, side_b_region_id, side_a_name, side_b_name, winner_team_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertPlayer = database.prepare("INSERT INTO game_players (game_id, side, player_entity_id) VALUES (?, ?, ?)");
      for (const series of snapshot.series) for (const game of series.games) {
        const a = sideValues(game.sides[0]); const b = sideValues(game.sides[1]);
        insertGame.run(game.id, game.seriesId, game.playedAt, game.gameNumber, a[0], b[0], a[1], b[1], a[2], b[2], a[3], b[3], winnerTeamId(game.sides, game.winnerSide));
        for (const player of game.sides[0].playerIds) insertPlayer.run(game.id, "a", player);
        for (const player of game.sides[1].playerIds) insertPlayer.run(game.id, "b", player);
      }
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    database.exec("ANALYZE; VACUUM;");
    const pageSize = Number((database.prepare("PRAGMA page_size").get() as SqliteRow | undefined)?.page_size);
    if (pageSize !== SQLITE_PAGE_SIZE) throw new Error(`SQLite page size is ${pageSize}, expected ${SQLITE_PAGE_SIZE}.`);
    const integrity = String((database.prepare("PRAGMA integrity_check").get() as SqliteRow | undefined)?.integrity_check ?? "");
    if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity}`);
  } finally { database.close(); }
}

function manifestFor(snapshot: PublicSnapshot, databaseBytes: Uint8Array): SqliteManifest {
  const databaseChecksum = sha256(databaseBytes);
  return SqliteManifestSchema.parse({
    schemaVersion: SQLITE_SCHEMA_VERSION,
    snapshotId: snapshot.snapshotId,
    dataset: snapshot.dataset,
    coverageWarnings: snapshot.coverageWarnings,
    ...(snapshot.freshness === undefined ? {} : { freshness: snapshot.freshness }),
    ...(snapshot.attribution === undefined ? {} : { attribution: snapshot.attribution }),
    database: { file: `${databaseChecksum}/database.sqlite`, checksum: databaseChecksum, byteSize: databaseBytes.byteLength, pageSize: SQLITE_PAGE_SIZE, requestChunkSize: SQLITE_REQUEST_CHUNK_SIZE },
  });
}

async function writeSqliteData(directory: string, snapshot: PublicSnapshot): Promise<void> {
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error(`Snapshot output is not a directory: ${root}`);
  const dataPath = join(root, "data");
  await assertMissing(dataPath);
  const stage = join(root, `.data.tmp-${randomUUID()}`);
  try {
    await mkdir(stage);
    const temporaryDatabase = join(stage, "database.sqlite");
    createDatabase(temporaryDatabase, snapshot);
    const databaseBytes = new Uint8Array(await readFile(temporaryDatabase));
    const manifest = manifestFor(snapshot, databaseBytes);
    const databaseDirectory = join(stage, manifest.database.file.slice(0, -"/database.sqlite".length));
    await mkdir(databaseDirectory);
    await rename(temporaryDatabase, join(databaseDirectory, "database.sqlite"));
    await writeFile(join(stage, "manifest.json"), json(manifest), { encoding: "utf8", flag: "wx" });
    await rename(stage, dataPath);
  } finally { await rm(stage, { recursive: true, force: true }).catch(() => undefined); }
}

function parseJsonValue(row: SqliteRow | undefined, key: string): unknown {
  if (row === undefined || typeof row.value !== "string") throw new Error(`SQLite metadata is missing ${key}.`);
  try { return JSON.parse(row.value); } catch (error) { throw new Error(`SQLite metadata ${key} is not valid JSON.`, { cause: error }); }
}
function stringValue(row: SqliteRow, key: string): string { if (typeof row[key] !== "string") throw new Error(`SQLite row ${key} is not text.`); return row[key] as string; }
function nullableStringValue(row: SqliteRow, key: string): string | null { if (row[key] !== null && typeof row[key] !== "string") throw new Error(`SQLite row ${key} is not nullable text.`); return row[key] as string | null; }
function numberValue(row: SqliteRow, key: string): number { if (typeof row[key] !== "number" || !Number.isSafeInteger(row[key])) throw new Error(`SQLite row ${key} is not a safe integer.`); return row[key] as number; }

function sideFromRow(row: SqliteRow, side: "a" | "b", players: string[]): SnapshotSide {
  return { teamId: stringValue(row, `side_${side}_team_id`), eraId: nullableStringValue(row, `side_${side}_era_id`), regionId: nullableStringValue(row, `side_${side}_region_id`), playerIds: players, teamName: stringValue(row, `side_${side}_name`) };
}

async function readSqliteSnapshot(directory: string, manifest: SqliteManifest): Promise<PublicSnapshot> {
  assertSafeFile(manifest.database.file);
  const databasePath = join(resolve(directory), "data", ...manifest.database.file.split("/"));
  const stats = await lstat(databasePath);
  assertRegularFile(databasePath, stats);
  const databaseBytes = new Uint8Array(await readFile(databasePath));
  if (databaseBytes.byteLength !== manifest.database.byteSize || sha256(databaseBytes) !== manifest.database.checksum) throw new Error("SQLite database checksum or size mismatch.");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const pageSize = Number((database.prepare("PRAGMA page_size").get() as SqliteRow | undefined)?.page_size);
    if (pageSize !== manifest.database.pageSize) throw new Error("SQLite database page size mismatch.");
    const userVersion = Number((database.prepare("PRAGMA user_version").get() as SqliteRow)?.user_version);
    if (userVersion !== manifest.schemaVersion) throw new Error("SQLite database schema version mismatch.");
    const integrity = String((database.prepare("PRAGMA integrity_check").get() as SqliteRow | undefined)?.integrity_check ?? "");
    if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity}`);
    const metadata = new Map((database.prepare("SELECT key, value FROM metadata ORDER BY key").all() as SqliteRow[]).map((row) => [stringValue(row, "key"), row]));
    const metadataSnapshotId = SnapshotIdSchema.parse(parseJsonValue(metadata.get("snapshotId"), "snapshotId"));
    if (metadataSnapshotId !== manifest.snapshotId) throw new Error("SQLite metadata snapshot ID mismatch.");
    const dataset = PublicSnapshotSchema.shape.dataset.parse(parseJsonValue(metadata.get("dataset"), "dataset"));
    const coverageWarnings = PublicSnapshotSchema.shape.coverageWarnings.parse(parseJsonValue(metadata.get("coverageWarnings"), "coverageWarnings"));
    const freshnessRow = metadata.get("freshness"); const attributionRow = metadata.get("attribution");
    const freshness = freshnessRow === undefined ? undefined : PublicSnapshotSchema.shape.freshness.parse(parseJsonValue(freshnessRow, "freshness"));
    const attribution = attributionRow === undefined ? undefined : PublicSnapshotSchema.shape.attribution.parse(parseJsonValue(attributionRow, "attribution"));
    if (json(dataset) !== json(manifest.dataset) || json(coverageWarnings) !== json(manifest.coverageWarnings)
      || json(freshness) !== json(manifest.freshness) || json(attribution) !== json(manifest.attribution)) {
      throw new Error("SQLite metadata does not match the public manifest.");
    }

    const aliases = new Map<string, string[]>();
    for (const row of database.prepare("SELECT entity_id, alias FROM entity_aliases ORDER BY entity_id, alias").all() as SqliteRow[]) {
      const entityId = stringValue(row, "entity_id"); aliases.set(entityId, [...(aliases.get(entityId) ?? []), stringValue(row, "alias")]);
    }
    const entities: SnapshotEntity[] = [];
    const hasPublicIds = userVersion >= 3;
    const publicIds = hasPublicIds ? database.prepare("SELECT entity_id, public_id FROM public_ids").all() as SqliteRow[] : [];
    const publicEras = hasPublicIds ? database.prepare("SELECT team_era_id, public_id FROM public_era_ids").all() as SqliteRow[] : [];
    for (const row of database.prepare("SELECT entity_id, kind, team_era_id, display_name, real_name, era_label, canonical_name, slug, avatar_label, retained_object_key, media_url FROM entity_variants ORDER BY entity_id, team_era_id IS NOT NULL, team_era_id").all() as SqliteRow[]) {
      const realName = nullableStringValue(row, "real_name"); const eraLabel = nullableStringValue(row, "era_label"); const teamEraId = nullableStringValue(row, "team_era_id");
      const entityId = stringValue(row, "entity_id");
      const publicId = publicIds.find(item => item.entity_id === entityId)?.public_id;
      const publicEraId = publicEras.find(item => item.team_era_id === teamEraId)?.public_id;
      const routeIds = { ...(typeof publicId === "string" ? { publicId } : {}), ...(typeof publicEraId === "string" ? { publicEraId } : {}) };
      entities.push({ id: entityId, kind: stringValue(row, "kind") as SnapshotEntity["kind"], ...routeIds, displayName: stringValue(row, "display_name"), ...(realName === null ? {} : { realName }), ...(eraLabel === null ? {} : { eraLabel }), ...(teamEraId === null ? {} : { teamEraId }), canonicalName: stringValue(row, "canonical_name"), slug: stringValue(row, "slug"), aliases: [...(aliases.get(entityId) ?? [])], avatarLabel: stringValue(row, "avatar_label"), retainedObjectKey: nullableStringValue(row, "retained_object_key"), mediaUrl: stringValue(row, "media_url") });
    }

    const playersByGame = new Map<string, { a: string[]; b: string[] }>();
    for (const row of database.prepare("SELECT game_id, side, player_entity_id FROM game_players ORDER BY game_id, side, player_entity_id").all() as SqliteRow[]) {
      const gameId = stringValue(row, "game_id"); const side = stringValue(row, "side");
      if (side !== "a" && side !== "b") throw new Error(`Invalid SQLite game player side: ${side}`);
      const entry = playersByGame.get(gameId) ?? { a: [], b: [] }; entry[side].push(stringValue(row, "player_entity_id")); playersByGame.set(gameId, entry);
    }
    const gamesBySeries = new Map<string, SnapshotGame[]>();
    for (const row of database.prepare("SELECT id, series_id, played_at, game_number, side_a_team_id, side_b_team_id, side_a_era_id, side_b_era_id, side_a_region_id, side_b_region_id, side_a_name, side_b_name, winner_team_id FROM game_facts ORDER BY played_at, id").all() as SqliteRow[]) {
      const gameId = stringValue(row, "id"); const seriesId = stringValue(row, "series_id"); const players = playersByGame.get(gameId) ?? { a: [], b: [] };
      const sides: [SnapshotSide, SnapshotSide] = [{ teamId: stringValue(row, "side_a_team_id"), eraId: nullableStringValue(row, "side_a_era_id"), regionId: nullableStringValue(row, "side_a_region_id"), playerIds: players.a, teamName: stringValue(row, "side_a_name") }, { teamId: stringValue(row, "side_b_team_id"), eraId: nullableStringValue(row, "side_b_era_id"), regionId: nullableStringValue(row, "side_b_region_id"), playerIds: players.b, teamName: stringValue(row, "side_b_name") }];
      const winner = nullableStringValue(row, "winner_team_id"); const winnerSide = winner === null ? null : winner === sides[0].teamId ? "a" : winner === sides[1].teamId ? "b" : (() => { throw new Error(`SQLite game winner is not one of its sides: ${gameId}`); })();
      const game: SnapshotGame = { id: gameId, seriesId, playedAt: stringValue(row, "played_at"), gameNumber: numberValue(row, "game_number"), sides, winnerSide };
      gamesBySeries.set(seriesId, [...(gamesBySeries.get(seriesId) ?? []), game]);
    }
    const tournaments = new Map<string, SqliteRow>();
    for (const row of database.prepare("SELECT id, name, category, league_slug FROM tournaments ORDER BY id").all() as SqliteRow[]) tournaments.set(stringValue(row, "id"), row);
    const series: SnapshotSeries[] = [];
    for (const row of database.prepare("SELECT id, played_at, date, tournament_id, best_of, side_a_team_id, side_b_team_id, side_a_era_id, side_b_era_id, side_a_region_id, side_b_region_id, side_a_name, side_b_name, side_a_score, side_b_score, winner_team_id FROM series_facts ORDER BY id").all() as SqliteRow[]) {
      const id = stringValue(row, "id"); const tournament = tournaments.get(stringValue(row, "tournament_id"));
      if (tournament === undefined) throw new Error(`SQLite series tournament is missing: ${stringValue(row, "tournament_id")}`);
      const sides: [SnapshotSide, SnapshotSide] = [sideFromRow(row, "a", []), sideFromRow(row, "b", [])];
      const winner = nullableStringValue(row, "winner_team_id"); const winnerSide = winner === null ? null : winner === sides[0].teamId ? "a" : winner === sides[1].teamId ? "b" : (() => { throw new Error(`SQLite series winner is not one of its sides: ${id}`); })();
      series.push({ id, playedAt: stringValue(row, "played_at"), date: stringValue(row, "date"), tournament: { id: stringValue(tournament, "id"), name: stringValue(tournament, "name"), category: stringValue(tournament, "category") as SnapshotSeries["tournament"]["category"], league: nullableStringValue(tournament, "league_slug") as SnapshotSeries["tournament"]["league"] }, bestOf: numberValue(row, "best_of") as SnapshotSeries["bestOf"], sides, games: [...(gamesBySeries.get(id) ?? [])].sort(compareGames), completed: winner !== null, winnerSide, score: { a: numberValue(row, "side_a_score"), b: numberValue(row, "side_b_score") } });
    }
    const snapshot = PublicSnapshotSchema.parse({ schemaVersion: 1, snapshotId: manifest.snapshotId, dataset, coverageWarnings, entities, series, ...(freshness === undefined ? {} : { freshness }), ...(attribution === undefined ? {} : { attribution }) });
    const { snapshotId, ...content } = snapshot; void snapshotId;
    if (snapshotDigest(content) !== manifest.snapshotId) throw new Error("SQLite snapshot content checksum mismatch.");
    return snapshot;
  } finally { database.close(); }
}

export async function verifyPublicSnapshot(directory: string): Promise<PublicSnapshot> {
  const root = resolve(directory); const manifestPath = join(root, "data", "manifest.json"); const manifestStats = await lstat(manifestPath); assertRegularFile(manifestPath, manifestStats);
  let rawManifest: unknown;
  try { rawManifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch (error) { throw new Error("SQLite snapshot manifest is not valid JSON.", { cause: error }); }
  const manifest = SqliteManifestSchema.parse(rawManifest);
  const snapshot = await readSqliteSnapshot(root, manifest);
  if (snapshot.snapshotId !== manifest.snapshotId) throw new Error("SQLite snapshot manifest ID mismatch.");
  return snapshot;
}

export async function writeSnapshotData(directory: string, projection: Omit<PublicSnapshot, "snapshotId">): Promise<PublicSnapshot> {
  const snapshot = snapshotWithDigest(projection); await writeSqliteData(directory, snapshot); return verifyPublicSnapshot(directory);
}

export async function exportPublicSnapshot(input: { databaseUrl: string; directory: string; store: ObjectStore; basePath?: string }): Promise<PublicSnapshot> {
  const basePath = input.basePath ?? "/";
  if (!basePath.startsWith("/") || !basePath.endsWith("/") || basePath.includes("..") || /[?#\\]/u.test(basePath)) throw new Error("Invalid public base path.");
  const db = createDb({ databaseUrl: input.databaseUrl });
  try {
    const projection = await exportSnapshotFacts(db); await mkdir(join(input.directory, "presentation"), { recursive: true });
    for (const entity of projection.entities) {
      let bytes: Uint8Array; let extension: string;
      if (entity.retainedObjectKey !== null) {
        const media = await findMediaObjectMetadataByKey(entity.retainedObjectKey, db); if (!media) throw new Error(`Missing retained media metadata: ${entity.retainedObjectKey}`);
        const metadata = await input.store.head(entity.retainedObjectKey); const stream = await input.store.get(entity.retainedObjectKey); if (!metadata || !stream) throw new Error(`Missing retained media: ${entity.retainedObjectKey}`);
        const chunks: Buffer[] = []; let length = 0; for await (const chunk of stream) { const part = Buffer.from(chunk); length += part.length; if (length > 10_000_000) throw new Error("Retained media is too large."); chunks.push(part); }
        bytes = Buffer.concat(chunks); if (sha256(bytes) !== metadata.checksum || metadata.byteSize !== length || media.checksum !== metadata.checksum) throw new Error("Retained media checksum mismatch.");
        extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[metadata.contentType ?? ""] ?? ""; if (!extension) throw new Error("Unsupported retained media content type.");
      } else { bytes = generateCanonicalAvatar({ kind: entity.kind, id: entity.id, label: entity.avatarLabel }).body; extension = "svg"; }
      const filename = `${sha256(bytes)}.${extension}`; await writeFile(join(input.directory, "presentation", filename), bytes); entity.mediaUrl = `${basePath}presentation/${filename}`;
    }
    await writeFile(join(input.directory, "presentation", "image-credits.html"), renderMediaCredits(projection, basePath));
    return writeSnapshotData(input.directory, projection);
  } finally { await db.destroy(); }
}
