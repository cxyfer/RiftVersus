import { Pool } from "pg";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PublicSnapshotSchema,
  type ComparisonQuery,
  type PublicSnapshot,
  type ResolvedSubject,
} from "@riftversus/contracts";
import { compareSqlite, searchSqlite } from "@riftversus/domain";
import { writeSnapshotData } from "../../../apps/data/src/export-snapshot.js";
import { openPublicSqlite } from "../../../apps/data/src/sqlite-reader.js";

import { beginSyncRun, compareHeadToHead, exportSnapshotFacts, searchEntities } from "../src/index.js";
import { createDb, destroyDb } from "../src/db.js";
import { migrateToLatest } from "../src/migrator.js";
import { publishDataset } from "../src/repositories/sync.js";
import { createTestSchemaName, seedComparisonFixture, seedIds } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const query = (left: ComparisonQuery["left"], right: ComparisonQuery["right"], extra: Partial<ComparisonQuery> = {}): ComparisonQuery => ({
  left,
  right,
  eventCategories: [],
  leagues: [],
  bestOf: [],
  tournamentIds: [],
  limit: 50,
  ...extra,
});

function comparisonShape(response: Awaited<ReturnType<typeof compareHeadToHead>>) {
  return {
    subjects: response.subjects,
    seriesSummary: response.seriesSummary,
    gameSummary: response.gameSummary,
    rows: response.rows.map(({ id, date, event, bestOf, leftName, rightName, leftScore, rightScore, winner }) => ({ id, date, event, bestOf, leftName, rightName, leftScore, rightScore, winner })),
    coverageWarnings: response.coverageWarnings,
    mediaUrls: response.mediaUrls,
    dataset: {
      version: response.dataset.version,
      lastSuccessfulSyncAt: response.dataset.lastSuccessfulSyncAt,
      coverage: response.dataset.coverage,
    },
  };
}

function subjectShape(subject: ResolvedSubject) {
  return {
    kind: subject.kind,
    id: subject.id,
    ...(subject.teamEraId === undefined ? {} : { teamEraId: subject.teamEraId }),
    displayName: subject.displayName,
    ...(subject.realName === undefined ? {} : { realName: subject.realName }),
    ...(subject.eraLabel === undefined ? {} : { eraLabel: subject.eraLabel }),
    mediaUrl: subject.mediaUrl,
  };
}

describeWithDatabase("public snapshot parity", () => {
  const schema = createTestSchemaName();
  const adminPool = new Pool({ connectionString: databaseUrl });
  const db = createDb({ databaseUrl: databaseUrl!, schema });
  let snapshot: PublicSnapshot;
  let directory: string;
  let sqlite: Awaited<ReturnType<typeof openPublicSqlite>>;

  beforeAll(async () => {
    await adminPool.query(`create schema ${schema}`);
    await migrateToLatest(db, { schema });
    await seedComparisonFixture(db);
    // Public snapshots require rights evidence for every retained media object.
    await db.updateTable("media_assets").set({ license: "CC BY-SA 4.0", attribution: "RiftVersus fixture contributors" }).execute();
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: run.id, version: "fixture-publication", coverage: [] }, db);

    const projection = await exportSnapshotFacts(db);
    directory = await mkdtemp(join(tmpdir(), "riftversus-sqlite-parity-"));
    snapshot = PublicSnapshotSchema.parse(await writeSnapshotData(directory, projection));
    sqlite = await openPublicSqlite(directory);
  });

  afterAll(async () => {
    sqlite?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    await destroyDb(db);
    await adminPool.query(`drop schema if exists ${schema} cascade`);
    await adminPool.end();
  });

  it("exports a schema-valid projection and preserves the SQL dataset identity", () => {
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.snapshotId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(snapshot.dataset.version).toBe("fixture-publication");
    expect(snapshot.dataset.coverage).toEqual({ from: "1970-01-01", to: "1970-01-01" });
    expect(Number.isNaN(Date.parse(snapshot.dataset.lastSuccessfulSyncAt))).toBe(false);
    expect(snapshot.series.map((item) => item.id)).toEqual([seedIds.changedSeries, seedIds.sktSeries, seedIds.t1Series].sort());
  });

  it("matches SQL comparison semantics for players, regions, teams, and exact team eras", async () => {
    const subjects: ComparisonQuery["left"][] = [
      { kind: "team", id: seedIds.t1 },
      { kind: "player", id: seedIds.faker },
      { kind: "region", id: seedIds.lck },
    ];
    const opponents: ComparisonQuery["right"][] = [
      { kind: "team", id: seedIds.weibo },
      { kind: "player", id: seedIds.xiaohu },
      { kind: "region", id: seedIds.lpl },
    ];

    for (const left of subjects) for (const right of opponents) {
      const input = query(left, right);
      const [sqlResponse, staticResponse] = await Promise.all([
        compareHeadToHead(input, db),
        compareSqlite(sqlite.executor, input, snapshot.snapshotId),
      ]);
      expect(comparisonShape(staticResponse)).toEqual(comparisonShape(sqlResponse));
    }

    const eraInputs = [
      query({ kind: "team", id: seedIds.t1, teamEraId: seedIds.sktEra }, { kind: "team", id: seedIds.weibo }),
      query({ kind: "team", id: seedIds.t1, teamEraId: seedIds.t1Era }, { kind: "team", id: seedIds.weibo }),
      query({ kind: "team", id: seedIds.weibo }, { kind: "team", id: seedIds.t1, teamEraId: seedIds.t1Era }),
    ];
    for (const input of eraInputs) {
      const [sqlResponse, staticResponse] = await Promise.all([
        compareHeadToHead(input, db),
        compareSqlite(sqlite.executor, input, snapshot.snapshotId),
      ]);
      expect(comparisonShape(staticResponse)).toEqual(comparisonShape(sqlResponse));
    }
  });

  it("matches SQL league, date, and best-of filters", async () => {
    const inputs = [
      query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.genG }, { leagues: ["lck"], bestOf: [3] }),
      query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }, { to: "2023-12-31" }),
      query({ kind: "region", id: seedIds.lpl }, { kind: "region", id: seedIds.lck }, { from: "2024-01-01", to: "2024-12-31", tournamentIds: [seedIds.lckTournament] }),
    ];
    for (const input of inputs) {
      const [sqlResponse, staticResponse] = await Promise.all([
        compareHeadToHead(input, db),
        compareSqlite(sqlite.executor, input, snapshot.snapshotId),
      ]);
      expect(comparisonShape(staticResponse)).toEqual(comparisonShape(sqlResponse));
    }
  });

  it("matches SQL entity search including player real names and historical team eras", async () => {
    for (const term of ["skt", "Faker", "Lee Sang-hyeok", "Weibo", "LCK", "%", "_"]) {
      const [sqlResponse, staticResponse] = await Promise.all([
        searchEntities({ query: term }, db),
        searchSqlite(sqlite.executor, term),
      ]);
      const normalize = (entities: readonly ResolvedSubject[]) => entities.map(subjectShape).sort((left, right) => `${left.kind}:${left.id}:${left.teamEraId ?? ""}`.localeCompare(`${right.kind}:${right.id}:${right.teamEraId ?? ""}`));
      expect(normalize(staticResponse)).toEqual(normalize(sqlResponse.entities));
    }
  });

  it("walks SQL and snapshot cursors with equal rows and summaries but different cursor bindings", async () => {
    const base = query({ kind: "team", id: seedIds.t1 }, { kind: "team", id: seedIds.weibo }, { limit: 1 });
    let sqlCursor: string | undefined;
    let snapshotCursor: string | undefined;
    let pageCount = 0;
    for (;;) {
      const input = { ...base, ...(sqlCursor === undefined ? {} : { cursor: sqlCursor }) };
      const staticInput = { ...base, ...(snapshotCursor === undefined ? {} : { cursor: snapshotCursor }) };
      const [sqlResponse, staticResponse] = await Promise.all([
        compareHeadToHead(input, db),
        compareSqlite(sqlite.executor, staticInput, snapshot.snapshotId),
      ]);
      expect(comparisonShape(staticResponse)).toEqual(comparisonShape(sqlResponse));
      expect(Boolean(staticResponse.nextCursor)).toBe(Boolean(sqlResponse.nextCursor));
      if (pageCount === 0) expect(staticResponse.nextCursor).not.toBe(sqlResponse.nextCursor);
      pageCount += 1;
      if (sqlResponse.nextCursor === undefined || staticResponse.nextCursor === undefined) break;
      sqlCursor = sqlResponse.nextCursor;
      snapshotCursor = staticResponse.nextCursor;
      if (pageCount > 10) throw new Error("Cursor walk did not terminate.");
    }
    expect(pageCount).toBe(2);
  });
});
