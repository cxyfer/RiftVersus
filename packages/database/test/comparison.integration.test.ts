import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { summarizeComparison } from "@riftversus/domain";

import { compareHeadToHead, getDatasetStatus, getMediaByKey, listAvailableFilters, searchEntities } from "../src/index.js";
import { createDb, destroyDb } from "../src/db.js";
import { migrateToLatest } from "../src/migrator.js";
import { comparisonOracleFixture, createTestSchemaName, seedComparisonFixture, seedIds } from "./fixtures/seed.js";

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
  });
  afterAll(async () => {
    await destroyDb(db);
    await adminPool.query(`drop schema if exists ${schema} cascade`);
    await adminPool.end();
  });

  const query = (left: { kind: "team" | "player" | "region"; id: string; teamEraId?: string }, right: { kind: "team" | "player" | "region"; id: string; teamEraId?: string }) => ({ left, right, eventCategories: [], bestOf: [], tournamentIds: [], limit: 50 });

  it("matches the domain oracle for all nine subject-kind combinations", async () => {
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
      const expected = summarizeComparison(query(left, right), comparisonOracleFixture());
      expect(response.seriesSummary).toEqual(expected.series);
      expect(response.gameSummary).toEqual(expected.games);
    }
  });

  it("keeps independent team lineage/era and applies filters plus keyset pagination", async () => {
    const lineage = await compareHeadToHead(query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), db);
    const exact = await compareHeadToHead(query({ kind: "team", id: seedIds.t1, teamEraId: seedIds.t1Era }, { kind: "team", id: seedIds.weibo }), db);
    expect(lineage.seriesSummary.total).toBe(2);
    expect(exact.seriesSummary.total).toBe(1);
    const filtered = await compareHeadToHead({ ...query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), from: "2024-01-01", eventCategories: ["worlds"], bestOf: [5], limit: 1 }, db);
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.nextCursor).toBeDefined();
    const pageTwo = await compareHeadToHead({ ...query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }), limit: 1, cursor: filtered.nextCursor }, db);
    expect(pageTwo.rows[0]?.id).not.toBe(filtered.rows[0]?.id);
  });

  it("uses alias search, derived filters, current media, and coverage warnings", async () => {
    expect((await searchEntities({ query: "skt" }, db)).entities).toEqual(expect.arrayContaining([expect.objectContaining({ id: seedIds.t1 })]));
    expect((await listAvailableFilters(db)).eventCategories).toEqual(expect.arrayContaining(["league", "worlds"]));
    expect(await getMediaByKey("media/t1.png", db)).toMatchObject({ objectKey: "media/t1.png" });
    expect(await getDatasetStatus(db)).toBeNull();
    const comparison = await compareHeadToHead(query({ kind: "team", id: seedIds.t1 }, { kind: "region", id: seedIds.lpl }), db);
    expect(comparison.coverageWarnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "NO_PUBLISHED_DATASET" })]));
  });
});
