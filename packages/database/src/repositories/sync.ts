import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import type { Kysely } from "kysely";

import type { Database } from "../types.js";
import type {
  BeginSyncRunInput, CompleteUnchangedSyncRunInput, DatasetVersion, FailSyncRunInput, GameFactInput, PublishDatasetInput, SeriesFactInput, SourceObjectInput, SyncRun,
} from "./types.js";

function toSyncRun(row: { id: string; provider: string; mode: string; status: string; parser_version: string; started_at: Date; finished_at: Date | null; error: string | null }): SyncRun {
  return {
    id: row.id, provider: row.provider, mode: row.mode as SyncRun["mode"], status: row.status as SyncRun["status"],
    parserVersion: row.parser_version, startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null, error: row.error,
  };
}

export async function beginSyncRun(input: BeginSyncRunInput, db: Kysely<Database>): Promise<SyncRun> {
  const row = await db.insertInto("sync_runs").values({
    id: randomUUID(), provider: input.provider, mode: input.mode, status: "running", parser_version: input.parserVersion,
  }).returning(["id", "provider", "mode", "status", "parser_version", "started_at", "finished_at", "error"]).executeTakeFirstOrThrow();
  return toSyncRun(row);
}

export async function recordSourceObject(input: SourceObjectInput, db: Kysely<Database>): Promise<"inserted" | "existing"> {
  return (await recordSourceObjectWithId(input, db)).status;
}

export async function recordSourceObjectWithId(input: SourceObjectInput, db: Kysely<Database>): Promise<{ id: string; status: "inserted" | "existing" }> {
  const id = randomUUID();
  const inserted = await db.insertInto("source_objects").values({
    id, provider: input.provider, source_key: input.sourceKey, source_url: input.sourceUrl,
    object_key: input.objectKey, checksum: input.checksum, content_type: input.contentType ?? null,
    byte_size: input.byteSize ?? null, parser_version: input.parserVersion,
  }).onConflict((conflict) => conflict.columns(["provider", "source_key"]).doNothing()).returning("id").executeTakeFirst();
  if (inserted !== undefined) return { id, status: "inserted" };
  const existing = await db.selectFrom("source_objects").select(["id", "source_url", "object_key", "checksum", "content_type", "byte_size", "parser_version"])
    .where("provider", "=", input.provider).where("source_key", "=", input.sourceKey).executeTakeFirstOrThrow();
  if (existing.source_url !== input.sourceUrl || existing.object_key !== input.objectKey || existing.checksum !== input.checksum || existing.content_type !== (input.contentType ?? null) || existing.byte_size !== (input.byteSize ?? null) || existing.parser_version !== input.parserVersion) throw new Error("Immutable source object metadata conflicts with an existing source key.");
  return { id: existing.id, status: "existing" };
}

export async function findDatasetVersion(version: string, db: Kysely<Database>): Promise<DatasetVersion | null> {
  const row = await db.selectFrom("dataset_versions").select(["id", "version", "published_at", "sync_run_id", "generation"]).where("version", "=", version).executeTakeFirst();
  return row === undefined ? null : { id: row.id, version: row.version, publishedAt: row.published_at.toISOString(), syncRunId: row.sync_run_id, generation: row.generation };
}

export async function completeUnchangedSyncRun(input: CompleteUnchangedSyncRunInput, db: Kysely<Database>): Promise<void> {
  const version = await db.selectFrom("dataset_versions").select("id").where("version", "=", input.version).executeTakeFirst();
  if (version === undefined) throw new Error("An unchanged sync run must reference an existing dataset version.");
  const result = await db.updateTable("sync_runs").set({ status: "succeeded", finished_at: new Date() }).where("id", "=", input.syncRunId).where("status", "=", "running").executeTakeFirst();
  if (result.numUpdatedRows !== 1n) throw new Error("Only a running sync run may complete unchanged.");
}

export async function publishDataset(input: PublishDatasetInput, db: Kysely<Database>): Promise<DatasetVersion> {
  return db.transaction().execute(async (trx) => {
    // Version generations are global visibility state, so providers serialize only this allocation.
    await sql`select pg_advisory_xact_lock(817242991)`.execute(trx);
    const run = await trx.selectFrom("sync_runs").select(["id", "status"])
      .where("id", "=", input.syncRunId).executeTakeFirst();
    if (run === undefined || run.status !== "running") throw new Error("Only a running sync run may publish a dataset.");
    const facts = input.facts;
    const rosterGameIds = input.rosterGameIds ?? [...new Set((facts?.gamePlayers ?? []).map((player) => player.gameId))];
    if ((facts?.gamePlayers ?? []).some((player) => !rosterGameIds.includes(player.gameId))) throw new Error("Every game player must be included in rosterGameIds.");
    if ((facts !== undefined || rosterGameIds.length > 0) && input.sourceObjectId === undefined) throw new Error("Canonical fact publication requires sourceObjectId provenance.");
    if (input.sourceObjectId !== undefined) {
      const source = await trx.selectFrom("source_objects").select(["id", "provider", "source_key"]).where("id", "=", input.sourceObjectId).executeTakeFirst();
      if (source === undefined) throw new Error("Canonical fact publication source object does not exist.");
      for (const fact of [...(facts?.series ?? []), ...(facts?.games ?? [])]) if (fact.provider !== source.provider) throw new Error("Source object does not match canonical fact provenance.");
    }
    const latest = await trx.selectFrom("dataset_versions").select("generation").orderBy("generation", "desc").executeTakeFirst();
    const generation = (BigInt(latest?.generation ?? "0") + 1n).toString();
    await publishDimensions(input, trx);
    await publishOverrideApplications(input, trx);
    await publishMedia(input, trx);
    for (const item of facts?.series ?? []) await upsertSeries(item, generation, input.sourceObjectId!, trx);
    for (const item of facts?.games ?? []) await upsertGame(item, generation, input.sourceObjectId!, trx);
    if (rosterGameIds.length > 0) {
      const source = await trx.selectFrom("source_objects").select("provider").where("id", "=", input.sourceObjectId!).executeTakeFirstOrThrow();
      const games = await trx.selectFrom("game_facts").select(["id", "provider"]).where("id", "in", rosterGameIds).execute();
      if (games.length !== rosterGameIds.length || games.some((game) => game.provider !== source.provider)) throw new Error("Source object does not match canonical roster provenance.");
    }
    const gamePlayers = facts?.gamePlayers ?? [];
    if (rosterGameIds.length > 0) {
      const rosterByGame = new Map<string, typeof gamePlayers>();
      for (const player of gamePlayers) rosterByGame.set(player.gameId, [...(rosterByGame.get(player.gameId) ?? []), player]);
      for (const gameId of rosterGameIds) {
        const roster = rosterByGame.get(gameId) ?? [];
        const game = await trx.selectFrom("game_facts").select(["side_a_team_id", "side_b_team_id"]).where("id", "=", gameId).executeTakeFirst();
        if (game === undefined || roster.some((player) => player.teamEntityId !== (player.side === "a" ? game.side_a_team_id : game.side_b_team_id))) throw new Error("Game player roster does not match the canonical game side.");
        if (roster.length === 0) await trx.deleteFrom("game_players").where("game_id", "=", gameId).execute();
        else await trx.deleteFrom("game_players").where("game_id", "=", gameId).where("player_entity_id", "not in", roster.map((player) => player.playerEntityId)).execute();
      }
      await trx.insertInto("game_players").values(gamePlayers.map((item) => ({
      game_id: item.gameId, player_entity_id: item.playerEntityId, side: item.side, team_entity_id: item.teamEntityId,
      }))).onConflict((conflict) => conflict.columns(["game_id", "player_entity_id"]).doUpdateSet((eb) => ({ side: eb.ref("excluded.side"), team_entity_id: eb.ref("excluded.team_entity_id") }))).execute();
    }
    const finishedAt = new Date();
    const version = await trx.insertInto("dataset_versions").values({ id: randomUUID(), version: input.version, sync_run_id: input.syncRunId, generation })
      .returning(["id", "version", "published_at", "sync_run_id", "generation"]).executeTakeFirstOrThrow();
    if (input.coverage.length) await trx.insertInto("coverage_status").values(input.coverage.map((coverage) => ({
      id: randomUUID(), dataset_version_id: version.id, provider: coverage.provider, competition: coverage.competition,
      season_year: coverage.seasonYear, earliest_date: coverage.earliestDate ?? null, latest_date: coverage.latestDate ?? null,
      status: coverage.status, detail: coverage.detail ?? null,
    }))).execute();
    await trx.updateTable("sync_runs").set({ status: "succeeded", finished_at: finishedAt }).where("id", "=", input.syncRunId).execute();
    return { id: version.id, version: version.version, publishedAt: version.published_at.toISOString(), syncRunId: version.sync_run_id, generation: version.generation };
  });
}

function slug(value: string): string {
  const result = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!result) throw new Error(`Cannot derive a canonical slug from ${value}.`);
  return result;
}

async function assertImmutableEntity(id: string, expected: { kind: "team" | "player" | "region"; canonicalName: string; slug: string }, trx: Kysely<Database>): Promise<void> {
  const row = await trx.selectFrom("entities").select(["kind", "canonical_name", "slug"]).where("id", "=", id).executeTakeFirst();
  if (row !== undefined && (row.kind !== expected.kind || row.canonical_name !== expected.canonicalName || row.slug !== expected.slug)) throw new Error(`Immutable canonical identity ${id} conflicts with staged data.`);
}

async function publishDimensions(input: PublishDatasetInput, trx: Kysely<Database>): Promise<void> {
  const dimensions = input.dimensions;
  if (dimensions === undefined) return;
  const entityRows = [
    ...dimensions.regions.map((item) => ({ id: item.id, kind: "region" as const, canonicalName: item.name, slug: slug(item.name) })),
    ...dimensions.entities.map((item) => ({ id: item.id, kind: item.kind, canonicalName: item.canonicalName, slug: slug(item.canonicalName) })),
  ];
  for (const item of entityRows) {
    await assertImmutableEntity(item.id, item, trx);
    await trx.insertInto("entities").values({ id: item.id, kind: item.kind, canonical_name: item.canonicalName, slug: item.slug }).onConflict((conflict) => conflict.column("id").doNothing()).execute();
  }
  for (const entity of dimensions.entities) {
    const aliases = [...new Set([...entity.sourceKeys, ...entity.aliases, entity.canonicalName])];
    for (const [index, displayName] of aliases.entries()) {
      const sourceKey = entity.sourceKeys[index] ?? `${entity.sourceKeys[0] ?? entity.id}:alias:${displayName}`;
      const existing = await trx.selectFrom("entity_aliases").select(["entity_id", "display_name"]).where("provider", "=", entity.provider).where("source_key", "=", sourceKey).executeTakeFirst();
      if (existing !== undefined && (existing.entity_id !== entity.id || existing.display_name !== displayName)) throw new Error(`Immutable alias ${entity.provider}:${sourceKey} conflicts with staged identity.`);
      await trx.insertInto("entity_aliases").values({ id: randomUUID(), entity_id: entity.id, provider: entity.provider, source_key: sourceKey, display_name: displayName }).onConflict((conflict) => conflict.columns(["provider", "source_key"]).doNothing()).execute();
    }
  }
  for (const region of dimensions.regions) {
    const existing = await trx.selectFrom("entity_aliases").select(["entity_id", "display_name"]).where("provider", "=", region.provider).where("source_key", "=", region.sourceKey).executeTakeFirst();
    if (existing !== undefined && (existing.entity_id !== region.id || existing.display_name !== region.name)) throw new Error(`Immutable region alias ${region.provider}:${region.sourceKey} conflicts with staged identity.`);
    await trx.insertInto("entity_aliases").values({ id: randomUUID(), entity_id: region.id, provider: region.provider, source_key: region.sourceKey, display_name: region.name }).onConflict((conflict) => conflict.columns(["provider", "source_key"]).doNothing()).execute();
  }
  for (const era of dimensions.teamEras) {
    const eraSlug = `${slug(era.displayName)}-${era.id.slice(0, 8)}`;
    const existing = await trx.selectFrom("team_eras").select(["team_entity_id", "display_name", "slug", "valid_from", "valid_to"]).where("id", "=", era.id).executeTakeFirst();
    if (existing !== undefined && (existing.team_entity_id !== era.teamEntityId || existing.display_name !== era.displayName || existing.slug !== eraSlug || existing.valid_from !== (era.validFrom ?? null) || existing.valid_to !== (era.validTo ?? null))) throw new Error(`Immutable team era ${era.id} conflicts with staged data.`);
    await trx.insertInto("team_eras").values({ id: era.id, team_entity_id: era.teamEntityId, display_name: era.displayName, slug: eraSlug, valid_from: era.validFrom ?? null, valid_to: era.validTo ?? null }).onConflict((conflict) => conflict.column("id").doNothing()).execute();
    if (era.regionId && era.validFrom) {
      const regionId = era.regionId; const validFrom = era.validFrom; const validTo = era.validTo ?? null;
      const existingRegion = await trx.selectFrom("team_region_history").select(["team_entity_id", "region_entity_id", "valid_from", "valid_to"]).where("provider", "=", era.provider).where("source_key", "=", era.sourceKey).executeTakeFirst();
      if (existingRegion !== undefined && (existingRegion.team_entity_id !== era.teamEntityId || existingRegion.region_entity_id !== regionId || existingRegion.valid_from !== validFrom || existingRegion.valid_to !== validTo)) throw new Error(`Immutable team region history ${era.provider}:${era.sourceKey} conflicts with staged data.`);
      await trx.insertInto("team_region_history").values({ team_entity_id: era.teamEntityId, region_entity_id: regionId, valid_from: validFrom, valid_to: validTo, provider: era.provider, source_key: era.sourceKey }).onConflict((conflict) => conflict.columns(["provider", "source_key"]).doNothing()).execute();
    }
  }
  for (const tournament of dimensions.tournaments) {
    const existing = await trx.selectFrom("tournaments").select(["id", "provider", "source_key", "name", "category", "start_date", "end_date"]).where((eb) => eb.or([eb("id", "=", tournament.id), eb.and([eb("provider", "=", tournament.provider), eb("source_key", "=", tournament.sourceKey)])])).executeTakeFirst();
    if (existing !== undefined && (existing.id !== tournament.id || existing.provider !== tournament.provider || existing.source_key !== tournament.sourceKey || existing.name !== tournament.name || existing.category !== tournament.category || existing.start_date !== (tournament.validFrom ?? null) || existing.end_date !== (tournament.validTo ?? null))) throw new Error(`Immutable tournament identity ${tournament.provider}:${tournament.sourceKey} conflicts with staged data.`);
    await trx.insertInto("tournaments").values({ id: tournament.id, provider: tournament.provider, source_key: tournament.sourceKey, name: tournament.name, category: tournament.category, start_date: tournament.validFrom ?? null, end_date: tournament.validTo ?? null }).onConflict((conflict) => conflict.column("id").doNothing()).execute();
  }
}

async function publishOverrideApplications(input: PublishDatasetInput, trx: Kysely<Database>): Promise<void> {
  for (const item of input.overrideApplications ?? []) await trx.insertInto("override_applications").values({ id: randomUUID(), override_file: item.overrideFile, checksum: item.checksum, sync_run_id: input.syncRunId }).onConflict((conflict) => conflict.columns(["override_file", "checksum"]).doNothing()).execute();
}

async function publishMedia(input: PublishDatasetInput, trx: Kysely<Database>): Promise<void> {
  for (const item of input.media ?? []) {
    if (!item.entityId && !item.teamEraId) throw new Error("Published media requires a canonical entity or team era owner.");
    const entity = item.entityId ? await trx.selectFrom("entities").select("kind").where("id", "=", item.entityId).executeTakeFirstOrThrow() : null;
    const kind = item.teamEraId || entity?.kind === "team" || entity?.kind === "region" ? "logo" : "portrait";
    const existing = await trx.selectFrom("media_assets").select(["id", "entity_id", "team_era_id", "provider", "source_url", "checksum", "content_type", "byte_size"]).where("object_key", "=", item.objectKey).executeTakeFirst();
    if (existing !== undefined && (existing.entity_id !== (item.entityId ?? null) || existing.team_era_id !== (item.teamEraId ?? null) || existing.provider !== item.provider || existing.source_url !== item.sourceUrl || existing.checksum !== item.checksum || existing.content_type !== item.contentType || existing.byte_size !== item.byteSize)) throw new Error(`Immutable media object ${item.objectKey} conflicts with staged metadata.`);
    if (item.entityId) await trx.updateTable("media_assets").set({ is_current: false }).where("entity_id", "=", item.entityId).where("kind", "=", kind).execute();
    else await trx.updateTable("media_assets").set({ is_current: false }).where("team_era_id", "=", item.teamEraId!).where("kind", "=", kind).execute();
    if (existing === undefined) {
      await trx.insertInto("media_assets").values({ id: randomUUID(), entity_id: item.entityId ?? null, team_era_id: item.teamEraId ?? null, kind, provider: item.provider, source_url: item.sourceUrl, object_key: item.objectKey, checksum: item.checksum, content_type: item.contentType, byte_size: item.byteSize, attribution: item.attribution, license: item.license ?? null, is_current: true }).execute();
    } else await trx.updateTable("media_assets").set({ is_current: true, attribution: item.attribution, license: item.license ?? null }).where("id", "=", existing.id).execute();
  }
}

async function authorizeExistingFact(table: "series_facts" | "game_facts", id: string, sourceObjectId: string, trx: Kysely<Database>): Promise<boolean> {
  const existing = await trx.selectFrom(table).select("id").where("id", "=", id).executeTakeFirst();
  if (existing !== undefined) await sql`select riftversus_authorize_fact_update(${sql.lit(table)}::regclass, ${id}::uuid, 'source_object', ${sourceObjectId}::uuid)`.execute(trx);
  return existing !== undefined;
}

async function upsertSeries(item: SeriesFactInput, generation: string, sourceObjectId: string, trx: Kysely<Database>) {
  const existing = await authorizeExistingFact("series_facts", item.id, sourceObjectId, trx);
  const values = { id: item.id, provider: item.provider, source_key: item.sourceKey, tournament_id: item.tournamentId, played_at: item.playedAt, best_of: item.bestOf, completed: item.completed, side_a_team_id: item.sideATeamId, side_a_era_id: item.sideAEraId ?? null, side_a_region_id: item.sideARegionId ?? null, side_b_team_id: item.sideBTeamId, side_b_era_id: item.sideBEraId ?? null, side_b_region_id: item.sideBRegionId ?? null, side_a_score: item.sideAScore ?? null, side_b_score: item.sideBScore ?? null, winner_team_id: item.winnerTeamId ?? null, publication_generation: generation };
  await trx.insertInto("series_facts").values(values).onConflict((conflict) => conflict.column("id").doUpdateSet(values)).execute();
  if (!existing) await trx.insertInto("fact_mutation_audits").values({ fact_table: "series_facts", fact_id: item.id, source_object_id: sourceObjectId, override_application_id: null, old_payload: {}, new_payload: values }).execute();
}

async function upsertGame(item: GameFactInput, generation: string, sourceObjectId: string, trx: Kysely<Database>) {
  const existing = await authorizeExistingFact("game_facts", item.id, sourceObjectId, trx);
  const values = { id: item.id, provider: item.provider, source_key: item.sourceKey, series_id: item.seriesId, game_number: item.gameNumber, played_at: item.playedAt, side_a_team_id: item.sideATeamId, side_a_era_id: item.sideAEraId ?? null, side_a_region_id: item.sideARegionId ?? null, side_b_team_id: item.sideBTeamId, side_b_era_id: item.sideBEraId ?? null, side_b_region_id: item.sideBRegionId ?? null, winner_team_id: item.winnerTeamId ?? null, publication_generation: generation };
  await trx.insertInto("game_facts").values(values).onConflict((conflict) => conflict.column("id").doUpdateSet(values)).execute();
  if (!existing) await trx.insertInto("fact_mutation_audits").values({ fact_table: "game_facts", fact_id: item.id, source_object_id: sourceObjectId, override_application_id: null, old_payload: {}, new_payload: values }).execute();
}

export async function failSyncRun(input: FailSyncRunInput, db: Kysely<Database>): Promise<void> {
  await db.updateTable("sync_runs").set({ status: "failed", finished_at: new Date(), error: input.error })
    .where("id", "=", input.syncRunId).where("status", "=", "running").execute();
}

function advisoryLockKey(provider: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const character of provider) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asIntN(64, hash * 0x100000001b3n);
  }
  return hash;
}

export async function withSyncAdvisoryLock<T>(provider: string, callback: () => Promise<T>, db: Kysely<Database>): Promise<"ran" | "locked"> {
  return db.connection().execute(async (connection) => {
    const key = advisoryLockKey(provider).toString();
    const lock = await sql<{ acquired: boolean }>`select pg_try_advisory_lock(${key}::bigint) as acquired`.execute(connection);
    if (!lock.rows[0]?.acquired) return "locked";
    let operationFailed = false;
    let operationError: unknown;
    try { await callback(); }
    catch (error) { operationFailed = true; operationError = error; }
    let releaseFailed = false;
    let releaseError: unknown;
    try { await sql`select pg_advisory_unlock(${key}::bigint)`.execute(connection); }
    catch (error) { releaseFailed = true; releaseError = error; }
    if (releaseFailed && operationFailed) throw new AggregateError([operationError, releaseError], "Sync operation and advisory lock release both failed.", { cause: operationError });
    if (releaseFailed) throw releaseError;
    if (operationFailed) throw operationError;
    return "ran";
  });
}
