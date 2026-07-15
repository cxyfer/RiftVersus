import { randomUUID } from "node:crypto";

import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { beginSyncRun, publishDataset, searchEntities } from "../src/index.js";
import { createDb, destroyDb } from "../src/db.js";
import { migrateToLatest } from "../src/migrator.js";
import { buildComparisonQueryPlan } from "../src/repositories/comparison.js";
import type { Database } from "../src/types.js";
import { createTestSchemaName, seedComparisonFixture, seedIds } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const ENTITY_FIXTURE_ROWS = 100_000;
const COMPARISON_FIXTURE_SERIES = 5_000;

interface CapturedQuery { sql: string; parameters: readonly unknown[] }
interface ExplainNode {
  nodeType: string;
  relation?: string;
  index?: string;
  actualRows: number;
  actualLoops: number;
  rowsRemoved: number;
}
interface ExplainPlan { executionTimeMs: number; rootActualRows: number; nodes: ExplainNode[] }

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

function readExplain(value: unknown): ExplainPlan {
  if (!Array.isArray(value) || typeof value[0] !== "object" || value[0] === null) throw new Error("PostgreSQL EXPLAIN JSON must contain one document.");
  const document = value[0] as Record<string, unknown>;
  const root = document.Plan as Record<string, unknown>;
  const nodes: ExplainNode[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const child of candidate) visit(child);
      return;
    }
    if (typeof candidate !== "object" || candidate === null) return;
    const record = candidate as Record<string, unknown>;
    if (typeof record["Node Type"] === "string") {
      nodes.push({
        nodeType: record["Node Type"],
        ...(typeof record["Relation Name"] === "string" ? { relation: record["Relation Name"] } : {}),
        ...(typeof record["Index Name"] === "string" ? { index: record["Index Name"] } : {}),
        actualRows: Number(record["Actual Rows"] ?? 0),
        actualLoops: Number(record["Actual Loops"] ?? 0),
        rowsRemoved: Number(record["Rows Removed by Filter"] ?? 0)
          + Number(record["Rows Removed by Index Recheck"] ?? 0)
          + Number(record["Rows Removed by Join Filter"] ?? 0),
      });
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(root);
  return { executionTimeMs: Number(document["Execution Time"]), rootActualRows: Number(root["Actual Rows"]), nodes };
}

function expectSelectivePlan(plan: ExplainPlan, input: {
  criticalRelations: readonly string[];
  executionBudgetMs: number;
  outputRowBudget: number;
  scannedRowBudget: number;
  removedRowBudget: number;
}) {
  expect(plan.executionTimeMs).toBeLessThan(input.executionBudgetMs);
  expect(plan.rootActualRows).toBeLessThanOrEqual(input.outputRowBudget);
  const critical = plan.nodes.filter((node) => node.relation !== undefined && input.criticalRelations.includes(node.relation));
  expect(critical.length).toBeGreaterThan(0);
  expect(critical.filter((node) => node.nodeType === "Seq Scan")).toEqual([]);
  expect(Math.max(...critical.map((node) => node.actualRows * node.actualLoops)), JSON.stringify(critical, null, 2)).toBeLessThanOrEqual(input.scannedRowBudget);
  expect(critical.reduce((sum, node) => sum + node.rowsRemoved * node.actualLoops, 0), JSON.stringify(critical, null, 2)).toBeLessThanOrEqual(input.removedRowBudget);
}

describeWithDatabase("repository query-plan budgets", () => {
  const schema = createTestSchemaName();
  const adminPool = new Pool({ connectionString: databaseUrl });
  const db = createDb({ databaseUrl: databaseUrl!, schema });
  const capturedQueries: CapturedQuery[] = [];
  const planPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const loggedDb = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: planPool }),
    log(event) {
      if (event.level === "query") capturedQueries.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
    },
  }).withSchema(schema);
  const canonicalTarget = randomUUID();
  const slugTarget = randomUUID();
  const aliasTarget = randomUUID();

  beforeAll(async () => {
    await adminPool.query(`create schema ${schema}`);
    await migrateToLatest(db, { schema });
    await seedComparisonFixture(db);

    const noiseEntities = Array.from({ length: ENTITY_FIXTURE_ROWS }, (_, index) => ({
      id: randomUUID(), kind: "team" as const, canonical_name: `Plan Noise Entity ${String(index).padStart(5, "0")}`, slug: `plan-noise-${index}`,
    }));
    const searchTargets = [
      { id: canonicalTarget, kind: "team" as const, canonical_name: "Plan Canonical Needle", slug: "canonical-target" },
      { id: slugTarget, kind: "team" as const, canonical_name: "Slug Search Target", slug: "plan-slug-needle" },
      { id: aliasTarget, kind: "team" as const, canonical_name: "Alias Search Target", slug: "alias-target" },
    ];
    for (const batch of chunks([...noiseEntities, ...searchTargets], 2_000)) await db.insertInto("entities").values(batch).execute();
    const aliases = noiseEntities.map((entity, index) => ({
      id: randomUUID(), entity_id: entity.id, provider: "plan", source_key: `noise-alias-${index}`, display_name: `Plan Noise Alias ${String(index).padStart(5, "0")}`,
    }));
    aliases.push({ id: randomUUID(), entity_id: aliasTarget, provider: "plan", source_key: "alias-target", display_name: "Plan Alias Needle" });
    for (const batch of chunks(aliases, 1_000)) await db.insertInto("entity_aliases").values(batch).execute();

    const noiseTeamA = randomUUID();
    const noiseTeamB = randomUUID();
    const noisePlayerA = randomUUID();
    const noisePlayerB = randomUUID();
    await db.insertInto("entities").values([
      { id: noiseTeamA, kind: "team", canonical_name: "Plan Load Team A", slug: "plan-load-team-a" },
      { id: noiseTeamB, kind: "team", canonical_name: "Plan Load Team B", slug: "plan-load-team-b" },
      { id: noisePlayerA, kind: "player", canonical_name: "Plan Load Player A", slug: "plan-load-player-a" },
      { id: noisePlayerB, kind: "player", canonical_name: "Plan Load Player B", slug: "plan-load-player-b" },
    ]).execute();
    const comparisonRows = Array.from({ length: COMPARISON_FIXTURE_SERIES }, (_, index) => ({ seriesId: randomUUID(), gameId: randomUUID(), index }));
    for (const batch of chunks(comparisonRows, 1_000)) {
      await db.insertInto("series_facts").values(batch.map(({ seriesId, index }) => ({
        id: seriesId, provider: "plan", source_key: `noise-series-${index}`, tournament_id: seedIds.worlds,
        played_at: new Date("2024-01-01T00:00:00Z"), best_of: 1 as const, completed: true,
        side_a_team_id: noiseTeamA, side_b_team_id: noiseTeamB, side_a_score: 1, side_b_score: 0,
        winner_team_id: noiseTeamA, publication_generation: "0",
      }))).execute();
      await db.insertInto("game_facts").values(batch.map(({ seriesId, gameId, index }) => ({
        id: gameId, provider: "plan", source_key: `noise-game-${index}`, series_id: seriesId, game_number: 1,
        played_at: new Date("2024-01-01T00:00:00Z"), side_a_team_id: noiseTeamA, side_b_team_id: noiseTeamB,
        winner_team_id: noiseTeamA, publication_generation: "0",
      }))).execute();
      await db.insertInto("game_players").values(batch.flatMap(({ gameId }) => [
        { game_id: gameId, player_entity_id: noisePlayerA, side: "a" as const, team_entity_id: noiseTeamA },
        { game_id: gameId, player_entity_id: noisePlayerB, side: "b" as const, team_entity_id: noiseTeamB },
      ])).execute();
    }
    await db.insertInto("series_facts").values([canonicalTarget, slugTarget, aliasTarget].map((target, index) => ({
      id: randomUUID(), provider: "plan", source_key: `search-target-${index}`, tournament_id: seedIds.worlds,
      played_at: new Date(`2024-02-0${index + 1}T00:00:00Z`), best_of: 1 as const, completed: true,
      side_a_team_id: target, side_b_team_id: seedIds.weibo, side_a_score: 1, side_b_score: 0,
      winner_team_id: target, publication_generation: "0",
    }))).execute();

    const run = await beginSyncRun({ provider: "plan", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: run.id, version: "query-plan-publication", coverage: [] }, db);
    await adminPool.query(`analyze ${schema}.entities; analyze ${schema}.entity_aliases; analyze ${schema}.series_facts; analyze ${schema}.game_facts; analyze ${schema}.game_players`);
  }, 60_000);

  afterAll(async () => {
    await destroyDb(loggedDb);
    await destroyDb(db);
    await adminPool.query(`drop schema if exists ${schema} cascade`);
    await adminPool.end();
  }, 30_000);

  async function explainCapturedSearch(term: string, targetId: string): Promise<ExplainPlan> {
    capturedQueries.length = 0;
    expect((await searchEntities({ query: term }, loggedDb)).entities).toEqual(expect.arrayContaining([expect.objectContaining({ id: targetId })]));
    expect(capturedQueries).toHaveLength(1);
    const captured = capturedQueries[0]!;
    const result = await planPool.query({ text: `explain (analyze, buffers, format json) ${captured.sql}`, values: [...captured.parameters] });
    return readExplain(result.rows[0]?.["QUERY PLAN"]);
  }

  it.each([
    ["canonical name", "canonical needle", canonicalTarget, "entities_canonical_name_trgm"],
    ["slug", "slug-needle", slugTarget, "entities_slug_trgm"],
    ["alias", "alias needle", aliasTarget, "entity_aliases_display_name_trgm"],
  ])("keeps %s entity search selective and within the CI budget", async (_label, term, targetId, requiredIndex) => {
    const plan = await explainCapturedSearch(term, targetId);
    expectSelectivePlan(plan, { criticalRelations: ["entities", "entity_aliases"], executionBudgetMs: 500, outputRowBudget: 20, scannedRowBudget: 100, removedRowBudget: 200 });
    expect(plan.nodes.some((node) => node.index === requiredIndex)).toBe(true);
    console.info(JSON.stringify({ gate: `entity-${_label}`, executionTimeMs: plan.executionTimeMs, actualRows: plan.rootActualRows, indexes: plan.nodes.flatMap((node) => node.index === undefined ? [] : [node.index]) }));
  }, 10_000);

  it("keeps the production player comparison joins selective and within CI budgets", async () => {
    const query = { left: { kind: "player" as const, id: seedIds.faker }, right: { kind: "player" as const, id: seedIds.xiaohu }, eventCategories: [], leagues: [], bestOf: [], tournamentIds: [], limit: 50 };
    const statements = buildComparisonQueryPlan(query);
    const plans = await Promise.all([
      planPool.query(`explain (analyze, buffers, format json) ${statements.candidateSql.compile(loggedDb).sql}`, statements.candidateSql.compile(loggedDb).parameters as unknown[]),
      planPool.query(`explain (analyze, buffers, format json) ${statements.summarySql.compile(loggedDb).sql}`, statements.summarySql.compile(loggedDb).parameters as unknown[]),
      planPool.query(`explain (analyze, buffers, format json) ${statements.directSql.compile(loggedDb).sql}`, statements.directSql.compile(loggedDb).parameters as unknown[]),
    ]);
    const [candidate, summary, direct] = plans.map((result) => readExplain(result.rows[0]?.["QUERY PLAN"]));
    expectSelectivePlan(candidate!, { criticalRelations: ["series_facts", "game_facts", "game_players"], executionBudgetMs: 500, outputRowBudget: 51, scannedRowBudget: 250, removedRowBudget: 500 });
    expectSelectivePlan(summary!, { criticalRelations: ["series_facts", "game_facts", "game_players"], executionBudgetMs: 500, outputRowBudget: 50, scannedRowBudget: 250, removedRowBudget: 500 });
    expectSelectivePlan(direct!, { criticalRelations: ["series_facts", "game_facts", "game_players"], executionBudgetMs: 750, outputRowBudget: 250, scannedRowBudget: 500, removedRowBudget: 1_000 });

    const usedIndexes = new Set(plans.flatMap((result) => readExplain(result.rows[0]?.["QUERY PLAN"]).nodes.flatMap((node) => node.index === undefined ? [] : [node.index])));
    const semanticFamilies = {
      series: ["series_facts_pkey", "series_facts_comparison_lookup", "series_facts_publication_generation_lookup", "series_facts_retirement_visibility"],
      game: ["game_facts_pkey", "game_facts_series_game_number_unique", "game_facts_comparison_lookup", "game_facts_publication_generation_lookup", "game_facts_retirement_visibility"],
      player: ["game_players_pkey", "game_players_player_game_lookup", "game_players_game_player_lookup"],
    };
    for (const allowed of Object.values(semanticFamilies)) expect(allowed.some((index) => usedIndexes.has(index))).toBe(true);
    expect(usedIndexes.has("game_players_player_game_lookup")).toBe(true);
    console.info(JSON.stringify({ gate: "comparison-player", executionTimeMs: { candidate: candidate!.executionTimeMs, summary: summary!.executionTimeMs, direct: direct!.executionTimeMs }, actualRows: { candidate: candidate!.rootActualRows, summary: summary!.rootActualRows, direct: direct!.rootActualRows }, indexes: [...usedIndexes].sort() }));
  });
});
