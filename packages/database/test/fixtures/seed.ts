import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";
import type { DomainSeries } from "@riftversus/domain";

import type { Database } from "../../src/types.js";

export const seedIds = {
  // Kept for the migration integrity suite, which deliberately uses generic rows.
  teamA: "00000000-0000-4000-8000-000000000001",
  teamB: "00000000-0000-4000-8000-000000000002",
  teamC: "00000000-0000-4000-8000-000000000003",
  player: "00000000-0000-4000-8000-000000000004",
  region: "00000000-0000-4000-8000-000000000005",
  tournament: "00000000-0000-4000-8000-000000000009",
  series: "00000000-0000-4000-8000-000000000010",
  game: "00000000-0000-4000-8000-000000000011",
  t1: "11111111-1111-4111-8111-111111111111",
  sktEra: "11111111-1111-4111-8111-111111111112",
  t1Era: "11111111-1111-4111-8111-111111111113",
  lpl: "22222222-2222-4222-8222-222222222221",
  lck: "22222222-2222-4222-8222-222222222222",
  weibo: "33333333-3333-4333-8333-333333333331",
  genG: "33333333-3333-4333-8333-333333333332",
  faker: "44444444-4444-4444-8444-444444444441",
  xiaohu: "44444444-4444-4444-8444-444444444442",
  substitute: "44444444-4444-4444-8444-444444444443",
  worlds: "55555555-5555-4555-8555-555555555551",
  lckTournament: "55555555-5555-4555-8555-555555555552",
  sktSeries: "66666666-6666-4666-8666-666666666661",
  t1Series: "66666666-6666-4666-8666-666666666662",
  incompleteSeries: "66666666-6666-4666-8666-666666666663",
  changedSeries: "66666666-6666-4666-8666-666666666664",
  t1Game: "77777777-7777-4777-8777-000000000002",
  sourceObject: "00000000-0000-4000-8000-000000000012",
  overrideApplication: "00000000-0000-4000-8000-000000000013",
  sourceObjectTwo: "00000000-0000-4000-8000-000000000014",
} as const;

export function createTestSchemaName() {
  return `rv_test_${crypto.randomUUID().replaceAll("-", "")}`;
}

const gameId = (value: number) => `77777777-7777-4777-8777-${String(value).padStart(12, "0")}`;
const mediaId = (value: number) => `88888888-8888-4888-8888-${String(value).padStart(12, "0")}`;

export function comparisonReferenceFixture(): DomainSeries[] {
  const side = (teamId: string, eraId: string | null, regionId: string | null, playerIds: string[]) => ({ teamId, eraId, regionId, playerIds });
  const t1 = (eraId: string, regionId: string, players: string[] = [seedIds.faker]) => side(seedIds.t1, eraId, regionId, players);
  const weibo = (players: string[] = [seedIds.xiaohu]) => side(seedIds.weibo, null, seedIds.lpl, players);
  const genG = () => side(seedIds.genG, null, seedIds.lck, []);
  const game = (id: string, seriesId: string, playedAt: string, sides: DomainSeries["sides"], winnerSide: "a" | "b") => ({ id, seriesId, playedAt, gameNumber: 1, sides, winnerSide });
  const sktSides = [t1(seedIds.sktEra, seedIds.lck), weibo()] as const;
  const t1Sides = [t1(seedIds.t1Era, seedIds.lck), weibo()] as const;
  const changedSides = [t1(seedIds.t1Era, seedIds.lpl), genG()] as const;
  return [
    { id: seedIds.sktSeries, date: "2023-11-02", tournament: { id: seedIds.worlds, name: "World Championship", category: "worlds" }, bestOf: 5, sides: sktSides, games: [game(gameId(1), seedIds.sktSeries, "2023-11-02T12:00:00.000Z", sktSides, "a")], completed: true, winnerSide: "a", score: { a: 3, b: 1 } },
    { id: seedIds.t1Series, date: "2024-11-02", tournament: { id: seedIds.worlds, name: "World Championship", category: "worlds" }, bestOf: 5, sides: t1Sides, games: [game(gameId(2), seedIds.t1Series, "2024-11-02T12:00:00.000Z", t1Sides, "a"), game(gameId(3), seedIds.t1Series, "2024-11-02T13:00:00.000Z", [t1(seedIds.t1Era, seedIds.lck, [seedIds.substitute]), weibo()] as const, "b")], completed: true, winnerSide: "a", score: { a: 3, b: 1 } },
    { id: seedIds.incompleteSeries, date: "2024-07-02", tournament: { id: seedIds.lckTournament, name: "LCK", category: "league" }, bestOf: 3, sides: changedSides, games: [], completed: false, winnerSide: null, score: { a: 0, b: 0 } },
    { id: seedIds.changedSeries, date: "2024-06-02", tournament: { id: seedIds.lckTournament, name: "LCK", category: "league" }, bestOf: 3, sides: changedSides, games: [game(gameId(4), seedIds.changedSeries, "2024-06-02T12:00:00.000Z", changedSides, "a")], completed: true, winnerSide: "a", score: { a: 2, b: 0 } },
  ];
}

/** Exact domain comparison fixture, inserted as canonical persistence facts. */
export async function seedComparisonFixture(db: Kysely<Database>) {
  await db.insertInto("entities").values([
    { id: seedIds.t1, kind: "team", canonical_name: "T1", slug: "t1" },
    { id: seedIds.weibo, kind: "team", canonical_name: "Weibo Gaming", slug: "weibo" },
    { id: seedIds.genG, kind: "team", canonical_name: "Gen.G", slug: "geng" },
    { id: seedIds.faker, kind: "player", canonical_name: "Lee Sang-hyeok", player_id: "Faker", slug: "lee-sang-hyeok" },
    { id: seedIds.xiaohu, kind: "player", canonical_name: "Xiaohu", slug: "xiaohu" },
    { id: seedIds.substitute, kind: "player", canonical_name: "Substitute", player_id: "Substitute", slug: "substitute" },
    { id: seedIds.lpl, kind: "region", canonical_name: "LPL", slug: "lpl" },
    { id: seedIds.lck, kind: "region", canonical_name: "LCK", slug: "lck" },
  ]).execute();
  await db.insertInto("team_eras").values([
    { id: seedIds.sktEra, team_entity_id: seedIds.t1, display_name: "SK Telecom T1", slug: "skt" },
    { id: seedIds.t1Era, team_entity_id: seedIds.t1, display_name: "T1", slug: "t1" },
  ]).execute();
  await db.insertInto("entity_aliases").values([
    { id: randomUUID(), entity_id: seedIds.t1, provider: "fixture", source_key: "skt", display_name: "SKT T1" },
    { id: randomUUID(), entity_id: seedIds.faker, provider: "fixture", source_key: "hide-on-bush", display_name: "Hide on bush" },
  ]).execute();
  await db.insertInto("media_objects").values([
    { object_key: "media/t1.png", checksum: "fixture-t1", content_type: "image/png", byte_size: "1" },
    { object_key: "media/lpl.png", checksum: "fixture-lpl", content_type: "image/png", byte_size: "1" },
    { object_key: "media/faker.png", checksum: "fixture-faker", content_type: "image/png", byte_size: "1" },
    { object_key: "media/t1-era.png", checksum: "fixture-t1-era", content_type: "image/png", byte_size: "1" },
  ]).execute();
  await db.insertInto("media_assets").values([
    { id: mediaId(1), entity_id: seedIds.t1, kind: "logo", source_url: "https://example.test/t1.png", object_key: "media/t1.png", is_current: true },
    { id: mediaId(2), entity_id: seedIds.lpl, kind: "logo", source_url: "https://example.test/lpl.png", object_key: "media/lpl.png", is_current: true },
    { id: mediaId(3), entity_id: seedIds.faker, kind: "portrait", source_url: "https://example.test/faker.png", object_key: "media/faker.png", is_current: true },
    { id: mediaId(4), team_era_id: seedIds.t1Era, kind: "logo", source_url: "https://example.test/t1-era.png", object_key: "media/t1-era.png", is_current: true },
  ]).execute();
  await db.insertInto("tournaments").values([
    { id: seedIds.worlds, provider: "fixture", source_key: "worlds", name: "World Championship", category: "worlds", start_date: "2024-10-01", end_date: "2024-11-02" },
    { id: seedIds.lckTournament, provider: "fixture", source_key: "lck", name: "LCK", league_slug: "lck", category: "league", start_date: "2024-01-01", end_date: "2024-12-31" },
  ]).execute();
  const series = [
    { id: seedIds.sktSeries, source_key: "skt", tournament_id: seedIds.worlds, played_at: new Date("2023-11-02T12:00:00Z"), best_of: 5 as const, completed: true, side_a_team_id: seedIds.t1, side_a_era_id: seedIds.sktEra, side_a_region_id: seedIds.lck, side_b_team_id: seedIds.weibo, side_b_region_id: seedIds.lpl, side_a_score: 3, side_b_score: 1, winner_team_id: seedIds.t1 },
    { id: seedIds.t1Series, source_key: "t1", tournament_id: seedIds.worlds, played_at: new Date("2024-11-02T12:00:00Z"), best_of: 5 as const, completed: true, side_a_team_id: seedIds.t1, side_a_era_id: seedIds.t1Era, side_a_region_id: seedIds.lck, side_b_team_id: seedIds.weibo, side_b_region_id: seedIds.lpl, side_a_score: 3, side_b_score: 1, winner_team_id: seedIds.t1 },
    { id: seedIds.incompleteSeries, source_key: "incomplete", tournament_id: seedIds.lckTournament, played_at: new Date("2024-07-02T12:00:00Z"), best_of: 3 as const, completed: false, side_a_team_id: seedIds.t1, side_a_era_id: seedIds.t1Era, side_a_region_id: seedIds.lpl, side_b_team_id: seedIds.genG, side_b_region_id: seedIds.lck },
    { id: seedIds.changedSeries, source_key: "changed", tournament_id: seedIds.lckTournament, played_at: new Date("2024-06-02T12:00:00Z"), best_of: 3 as const, completed: true, side_a_team_id: seedIds.t1, side_a_era_id: seedIds.t1Era, side_a_region_id: seedIds.lpl, side_b_team_id: seedIds.genG, side_b_region_id: seedIds.lck, side_a_score: 2, side_b_score: 0, winner_team_id: seedIds.t1 },
  ];
  await db.insertInto("series_facts").values(series.map((row) => ({ provider: "fixture", publication_generation: "0", ...row }))).execute();
  const games = [
    { id: gameId(1), series_id: seedIds.sktSeries, source_key: "skt-1", played_at: new Date("2023-11-02T12:00:00Z"), side_a_team_id: seedIds.t1, side_a_era_id: seedIds.sktEra, side_a_region_id: seedIds.lck, side_b_team_id: seedIds.weibo, side_b_region_id: seedIds.lpl, winner_team_id: seedIds.t1 },
    { id: gameId(2), series_id: seedIds.t1Series, source_key: "t1-1", played_at: new Date("2024-11-02T12:00:00Z"), side_a_team_id: seedIds.t1, side_a_era_id: seedIds.t1Era, side_a_region_id: seedIds.lck, side_b_team_id: seedIds.weibo, side_b_region_id: seedIds.lpl, winner_team_id: seedIds.t1 },
    { id: gameId(3), series_id: seedIds.t1Series, source_key: "t1-2", played_at: new Date("2024-11-02T13:00:00Z"), side_a_team_id: seedIds.t1, side_a_era_id: seedIds.t1Era, side_a_region_id: seedIds.lck, side_b_team_id: seedIds.weibo, side_b_region_id: seedIds.lpl, winner_team_id: seedIds.weibo },
    { id: gameId(4), series_id: seedIds.changedSeries, source_key: "changed-1", played_at: new Date("2024-06-02T12:00:00Z"), side_a_team_id: seedIds.t1, side_a_era_id: seedIds.t1Era, side_a_region_id: seedIds.lpl, side_b_team_id: seedIds.genG, side_b_region_id: seedIds.lck, winner_team_id: seedIds.t1 },
  ];
  await db.insertInto("game_facts").values(games.map((row, index) => ({ provider: "fixture", publication_generation: "0", game_number: index === 2 ? 2 : 1, ...row }))).execute();
  await db.insertInto("game_players").values([
    { game_id: gameId(1), player_entity_id: seedIds.faker, side: "a", team_entity_id: seedIds.t1 },
    { game_id: gameId(1), player_entity_id: seedIds.xiaohu, side: "b", team_entity_id: seedIds.weibo },
    { game_id: gameId(2), player_entity_id: seedIds.faker, side: "a", team_entity_id: seedIds.t1 },
    { game_id: gameId(2), player_entity_id: seedIds.xiaohu, side: "b", team_entity_id: seedIds.weibo },
    { game_id: gameId(3), player_entity_id: seedIds.substitute, side: "a", team_entity_id: seedIds.t1 },
    { game_id: gameId(3), player_entity_id: seedIds.xiaohu, side: "b", team_entity_id: seedIds.weibo },
    { game_id: gameId(4), player_entity_id: seedIds.faker, side: "a", team_entity_id: seedIds.t1 },
  ]).execute();
}
