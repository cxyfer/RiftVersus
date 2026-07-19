import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { summarizeComparison } from "@riftversus/domain";

import { beginSyncRun, compareHeadToHead, getDatasetStatus, getMediaByKey, listAvailableFilters, publishDataset, searchEntities } from "../src/index.js";
import { createDb, destroyDb } from "../src/db.js";
import { migrateToLatest } from "../src/migrator.js";
import { comparisonReferenceFixture, createTestSchemaName, seedComparisonFixture, seedIds } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("comparison repositories", () => {
  const schema = createTestSchemaName();
  const adminPool = new Pool({ connectionString: databaseUrl });
  const db = createDb({ databaseUrl: databaseUrl!, schema });

  beforeAll(async () => {
    await adminPool.query(`create schema ${schema}`);
    await migrateToLatest(db, { schema });
    await seedComparisonFixture(db);
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: run.id, version: "fixture-publication", coverage: [] }, db);
  });
  afterAll(async () => {
    await destroyDb(db);
    await adminPool.query(`drop schema if exists ${schema} cascade`);
    await adminPool.end();
  });

  const query = (left: { kind: "team" | "player" | "region"; id: string; teamEraId?: string }, right: { kind: "team" | "player" | "region"; id: string; teamEraId?: string }) => ({ left, right, eventCategories: [], leagues: [], bestOf: [], tournamentIds: [], limit: 50 });

  it("matches the domain reference for all nine subject-kind combinations", async () => {
    const subjects = [
      { kind: "team" as const, id: seedIds.t1 },
      { kind: "player" as const, id: seedIds.faker },
      { kind: "region" as const, id: seedIds.lck },
    ];
    const opponents = [
      { kind: "team" as const, id: seedIds.weibo },
      { kind: "player" as const, id: seedIds.xiaohu },
      { kind: "region" as const, id: seedIds.lpl },
    ];
    for (const left of subjects) for (const right of opponents) {
      const response = await compareHeadToHead(query(left, right), db);
      const expected = summarizeComparison(query(left, right), comparisonReferenceFixture());
      const rows = [
        { id: seedIds.t1Series, leftName: "T1", rightName: "Weibo Gaming", leftScore: 3, rightScore: 1, winner: "left" },
        ...(left.kind === "region" && right.kind === "region"
          ? [{ id: seedIds.changedSeries, leftName: "Gen.G", rightName: "T1", leftScore: 0, rightScore: 2, winner: "right" }]
          : []),
        { id: seedIds.sktSeries, leftName: "SK Telecom T1", rightName: "Weibo Gaming", leftScore: 3, rightScore: 1, winner: "left" },
      ];
      expect(response.rows.length).toBeGreaterThan(0);
      expect(response.rows.length).toBe(response.seriesSummary.total);
      expect(new Set(response.rows.map((row) => row.id)).size).toBe(response.rows.length);
      expect(response.rows.map(({ id, leftName, rightName, leftScore, rightScore, winner }) => ({ id, leftName, rightName, leftScore, rightScore, winner }))).toEqual(rows);
      expect(response.seriesSummary).toEqual(expected.series);
      expect(response.gameSummary).toEqual(expected.games);
    }
  });

  it("orients player rows from physical side B without changing scores or winner", async () => {
    const response = await compareHeadToHead(query({ kind: "player", id: seedIds.xiaohu }, { kind: "player", id: seedIds.faker }), db);
    expect(response.rows.map(({ id, leftName, rightName, leftScore, rightScore, winner }) => ({ id, leftName, rightName, leftScore, rightScore, winner }))).toEqual([
      { id: seedIds.t1Series, leftName: "Weibo Gaming", rightName: "T1", leftScore: 1, rightScore: 3, winner: "right" },
      { id: seedIds.sktSeries, leftName: "Weibo Gaming", rightName: "SK Telecom T1", leftScore: 1, rightScore: 3, winner: "right" },
    ]);
    expect(response.seriesSummary).toEqual({ wins: 0, losses: 2, total: 2, winRate: 0 });
    expect(response.gameSummary).toEqual({ wins: 0, losses: 2, total: 2, winRate: 0 });
  });

  it("does not present an era that belongs to a different side team", async () => {
    const rollback = new Error("rollback mismatched team-era fixture");
    await expect(db.transaction().execute(async (trx) => {
      const id = randomUUID();
      await trx.insertInto("series_facts").values({
        id, provider: "fixture", source_key: `mismatched-era-${id}`, tournament_id: seedIds.worlds,
        played_at: new Date("2025-11-02T12:00:00Z"), best_of: 5, completed: true,
        side_a_team_id: seedIds.t1, side_a_region_id: seedIds.lck,
        side_b_team_id: seedIds.weibo, side_b_era_id: seedIds.t1Era, side_b_region_id: seedIds.lpl,
        side_a_score: 3, side_b_score: 1, winner_team_id: seedIds.t1, publication_generation: "0",
      }).execute();
      const response = await compareHeadToHead(query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), trx);
      expect(response.rows.find((row) => row.id === id)).toMatchObject({ leftName: "T1", rightName: "Weibo Gaming" });
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("keeps independent team lineage/era and applies filters plus keyset pagination", async () => {
    const lineage = await compareHeadToHead(query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), db);
    const exact = await compareHeadToHead(query({ kind: "team", id: seedIds.t1, teamEraId: seedIds.t1Era }, { kind: "team", id: seedIds.weibo }), db);
    expect(lineage.seriesSummary.total).toBe(2);
    expect(exact.seriesSummary.total).toBe(1);
    const pagedQuery = { ...query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), limit: 1 };
    const firstPage = await compareHeadToHead(pagedQuery, db);
    expect(firstPage.rows).toHaveLength(1);
    expect(firstPage.rows[0]).toMatchObject({ id: seedIds.t1Series, leftName: "T1", rightName: "Weibo Gaming", leftScore: 3, rightScore: 1, winner: "left" });
    expect(firstPage.nextCursor).toBeDefined();
    expect(firstPage.seriesSummary.total).toBe(2);
    const pageTwo = await compareHeadToHead({ ...pagedQuery, cursor: firstPage.nextCursor }, db);
    expect(pageTwo.rows).toHaveLength(1);
    expect(pageTwo.rows[0]).toMatchObject({ id: seedIds.sktSeries, leftName: "SK Telecom T1", rightName: "Weibo Gaming", leftScore: 3, rightScore: 1, winner: "left" });
    expect(pageTwo.seriesSummary).toEqual(firstPage.seriesSummary);
    expect(pageTwo.gameSummary).toEqual(firstPage.gameSummary);
    const rightEra = await compareHeadToHead(query({ kind: "team", id: seedIds.weibo }, { kind: "team", id: seedIds.t1, teamEraId: seedIds.t1Era }), db);
    expect(rightEra.seriesSummary.total).toBe(1);
    expect(rightEra.rows[0]).toMatchObject({ leftName: "Weibo Gaming", rightName: "T1", leftScore: 1, rightScore: 3, winner: "right" });
    const historicalEra = await compareHeadToHead(query({ kind: "team", id: seedIds.t1, teamEraId: seedIds.sktEra }, { kind: "team", id: seedIds.weibo }), db);
    expect(historicalEra.rows[0]).toMatchObject({ leftName: "SK Telecom T1", rightName: "Weibo Gaming" });
    const canonicalFallback = await compareHeadToHead(query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.genG }), db);
    expect(canonicalFallback.rows[0]).toMatchObject({ leftName: "T1", rightName: "Gen.G" });
    expect((await compareHeadToHead({ ...query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), to: "2023-12-31" }, db)).seriesSummary.total).toBe(1);
    expect((await compareHeadToHead({ ...query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), tournamentIds: [seedIds.worlds] }, db)).seriesSummary.total).toBe(2);
    expect((await compareHeadToHead({ ...query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.genG }), leagues: ["lck"] }, db)).seriesSummary.total).toBe(1);
  });

  it("uses alias search, derived filters, current media, and coverage warnings", async () => {
    expect((await searchEntities({ query: "skt" }, db)).entities).toEqual(expect.arrayContaining([expect.objectContaining({ id: seedIds.t1 })]));
    expect((await listAvailableFilters(db)).eventCategories).toEqual(expect.arrayContaining(["league", "worlds"]));
    expect(await getMediaByKey("media/t1.png", db)).toMatchObject({ objectKey: "media/t1.png" });
    expect(await getDatasetStatus(db)).toMatchObject({ version: "fixture-publication" });
    const comparison = await compareHeadToHead(query({ kind: "team", id: seedIds.t1 }, { kind: "region", id: seedIds.lpl }), db);
    expect(comparison.coverageWarnings).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: "NO_PUBLISHED_DATASET" })]));
  });

  it("resolves visible player and exact-era media and rejects invalid subject input", async () => {
    const player = await compareHeadToHead(query({ kind: "player", id: seedIds.faker }, { kind: "team", id: seedIds.weibo }), db);
    expect(player.subjects.left).toEqual({
      kind: "player",
      id: seedIds.faker,
      displayName: "Faker",
      realName: "Lee Sang-hyeok",
      mediaUrl: "/media/media/faker.png",
    });
    expect(player.rows.length).toBeGreaterThan(0);
    expect(player.rows.map(({ leftName, rightName }) => [leftName, rightName])).toEqual([
      ["T1", "Weibo Gaming"],
      ["SK Telecom T1", "Weibo Gaming"],
    ]);
    expect(player.mediaUrls.left).toBe("/media/media/faker.png");
    expect(player.mediaUrls.right).toBe(`/avatars/v2/team/${seedIds.weibo}.svg`);
    expect(player.subjects.left.mediaUrl).toBe(player.mediaUrls.left);
    expect(player.subjects.right.mediaUrl).toBe(player.mediaUrls.right);
    expect(await getMediaByKey("media/faker.png", db)).toMatchObject({ objectKey: "media/faker.png" });
    const playerWithoutMedia = await compareHeadToHead(query({ kind: "player", id: seedIds.xiaohu }, { kind: "player", id: seedIds.faker }), db);
    expect(playerWithoutMedia.mediaUrls.left).toBe(`/avatars/v2/player/${seedIds.xiaohu}.svg`);
    const regionWithoutMedia = await compareHeadToHead(query({ kind: "region", id: seedIds.lck }, { kind: "region", id: seedIds.lpl }), db);
    expect(regionWithoutMedia.mediaUrls.left).toBe(`/avatars/v2/region/${seedIds.lck}.svg`);
    expect(regionWithoutMedia.mediaUrls.right).toBe("/media/media/lpl.png");
    const era = await compareHeadToHead(query({ kind: "team", id: seedIds.t1, teamEraId: seedIds.t1Era }, { kind: "team", id: seedIds.weibo }), db);
    expect(era.mediaUrls.left).toBe("/media/media/t1-era.png");
    const eraWithoutMedia = await compareHeadToHead(query({ kind: "team", id: seedIds.t1, teamEraId: seedIds.sktEra }, { kind: "team", id: seedIds.weibo }), db);
    expect(eraWithoutMedia.mediaUrls.left).toBe(`/avatars/v2/team/${seedIds.t1}.svg`);
    await expect(compareHeadToHead({ ...query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), cursor: "not-a-cursor" }, db)).rejects.toThrow("Invalid comparison cursor");
    await expect(compareHeadToHead(query({ kind: "team", id: seedIds.weibo, teamEraId: seedIds.t1Era }, { kind: "team", id: seedIds.t1 }), db)).rejects.toThrow("Team era does not belong");
  });

  it("returns canonical presentation URLs from entity search", async () => {
    expect((await searchEntities({ query: "Weibo" }, db)).entities).toEqual([
      { kind: "team", id: seedIds.weibo, displayName: "Weibo Gaming", mediaUrl: `/avatars/v2/team/${seedIds.weibo}.svg` },
    ]);
    expect((await searchEntities({ query: "LCK" }, db)).entities).toEqual([
      { kind: "region", id: seedIds.lck, displayName: "LCK", mediaUrl: `/avatars/v2/region/${seedIds.lck}.svg` },
    ]);
    const faker = { kind: "player", id: seedIds.faker, displayName: "Faker", realName: "Lee Sang-hyeok", mediaUrl: "/media/media/faker.png" };
    expect((await searchEntities({ query: "Faker" }, db)).entities).toEqual([faker]);
    expect((await searchEntities({ query: "Lee Sang-hyeok" }, db)).entities).toEqual([faker]);
    expect((await searchEntities({ query: "Hide on bush" }, db)).entities).toEqual([faker]);
    expect((await searchEntities({ query: "F" }, db)).entities).toEqual(expect.arrayContaining([faker]));
    expect((await searchEntities({ query: "%" }, db)).entities).toEqual([]);
    expect((await searchEntities({ query: "_" }, db)).entities).toEqual([]);
    expect((await searchEntities({ query: "Xiaohu" }, db)).entities).toEqual([
      { kind: "player", id: seedIds.xiaohu, displayName: "Xiaohu", mediaUrl: `/avatars/v2/player/${seedIds.xiaohu}.svg` },
    ]);
    expect((await searchEntities({ query: "Substitute" }, db)).entities).toEqual([
      { kind: "player", id: seedIds.substitute, displayName: "Substitute", mediaUrl: `/avatars/v2/player/${seedIds.substitute}.svg` },
    ]);
  });

  it("keeps exact-era presentation URLs consistent between search and comparison", async () => {
    const search = await searchEntities({ query: "skt" }, db);
    const t1EraSearch = search.entities.find((entity) => entity.teamEraId === seedIds.t1Era);
    const sktEraSearch = search.entities.find((entity) => entity.teamEraId === seedIds.sktEra);
    expect.soft(t1EraSearch?.mediaUrl).toBe("/media/media/t1-era.png");
    expect.soft(sktEraSearch?.mediaUrl).toBe(`/avatars/v2/team/${seedIds.t1}.svg`);

    const t1EraComparison = await compareHeadToHead(query({ kind: "team", id: seedIds.t1, teamEraId: seedIds.t1Era }, { kind: "team", id: seedIds.weibo }), db);
    const sktEraComparison = await compareHeadToHead(query({ kind: "team", id: seedIds.t1, teamEraId: seedIds.sktEra }, { kind: "team", id: seedIds.weibo }), db);
    expect(t1EraSearch?.mediaUrl).toBe(t1EraComparison.subjects.left.mediaUrl);
    expect(sktEraSearch?.mediaUrl).toBe(sktEraComparison.subjects.left.mediaUrl);
  });

});
