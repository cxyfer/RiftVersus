import { describe, expect, it } from "vitest";

import {
  ApiErrorSchema,
  BestOfSchema,
  ComparisonQuerySchema,
  ComparisonResponseSchema,
  DateSchema,
  EntityKindSchema,
  EventCategorySchema,
  LeagueSlugSchema,
  ResolvedSubjectSchema,
  SubjectRefSchema,
} from "../src/index.js";

const leftId = "11111111-1111-4111-8111-111111111111";
const rightId = "22222222-2222-4222-8222-222222222222";
const eraId = "33333333-3333-4333-8333-333333333333";
const eventId = "44444444-4444-4444-8444-444444444444";
const seriesId = "55555555-5555-4555-8555-555555555555";

describe("shared runtime contracts", () => {
  it("accepts every stable vocabulary value", () => {
    expect(["player", "team", "region"].map((value) => EntityKindSchema.parse(value))).toEqual([
      "player",
      "team",
      "region",
    ]);
    expect(["league", "fst", "msi", "worlds", "other"].map((value) => EventCategorySchema.parse(value))).toEqual([
      "league",
      "fst",
      "msi",
      "worlds",
      "other",
    ]);
    expect([1, 3, 5].map((value) => BestOfSchema.parse(value))).toEqual([1, 3, 5]);
    expect(["lck", "lpl", "lec", "lcs"].map((value) => LeagueSlugSchema.parse(value))).toEqual(["lck", "lpl", "lec", "lcs"]);
  });

  it("uses lineage mode when a team has no exact era", () => {
    expect(SubjectRefSchema.parse({ kind: "team", id: leftId })).toEqual({ kind: "team", id: leftId });
  });

  it("accepts real calendar dates and rejects impossible dates", () => {
    expect(DateSchema.parse("2026-02-28")).toBe("2026-02-28");
    expect(DateSchema.safeParse("2026-99-99").success).toBe(false);
    expect(DateSchema.safeParse("2026-02-30").success).toBe(false);
  });

  it("rejects an era restriction for non-team subjects", () => {
    expect(() => SubjectRefSchema.parse({ kind: "player", id: leftId, teamEraId: eraId })).toThrow();
  });

  it("preserves a player's public ID and real name as separate fields", () => {
    const subject = {
      kind: "player" as const,
      id: leftId,
      displayName: "Faker",
      realName: "Lee Sang-hyeok",
    };

    expect(ResolvedSubjectSchema.parse(subject)).toEqual(subject);
  });

  it("rejects an empty player real name", () => {
    expect(
      ResolvedSubjectSchema.safeParse({
        kind: "player",
        id: leftId,
        displayName: "Faker",
        realName: "",
      }).success,
    ).toBe(false);
  });

  it("preserves team subjects without a real name", () => {
    const subject = { kind: "team" as const, id: leftId, displayName: "T1" };

    expect(ResolvedSubjectSchema.parse(subject)).toEqual(subject);
  });

  it("normalizes omitted filters and pagination defaults", () => {
    expect(
      ComparisonQuerySchema.parse({
        left: { kind: "team", id: leftId },
        right: { kind: "region", id: rightId },
      }),
    ).toMatchObject({ eventCategories: [], leagues: [], bestOf: [], tournamentIds: [], limit: 50 });
  });

  it("rejects a comparison of the same canonical subject", () => {
    expect(() =>
      ComparisonQuerySchema.parse({
        left: { kind: "team", id: leftId },
        right: { kind: "region", id: leftId },
      }),
    ).toThrow();
  });

  it("rejects an inverted date range and an oversized limit", () => {
    const subjects = {
      left: { kind: "team", id: leftId },
      right: { kind: "region", id: rightId },
    };

    expect(() => ComparisonQuerySchema.parse({ ...subjects, from: "2025-01-02", to: "2025-01-01" })).toThrow();
    expect(() => ComparisonQuerySchema.parse({ ...subjects, limit: 101 })).toThrow();
  });

  it("round-trips a complete comparison response", () => {
    const response = {
      subjects: {
        left: { kind: "team", id: leftId, displayName: "T1", mediaUrl: "/media/t1.png" },
        right: { kind: "region", id: rightId, displayName: "LPL", mediaUrl: "/media/lpl.png" },
      },
      query: {
        left: { kind: "team", id: leftId },
        right: { kind: "region", id: rightId },
        eventCategories: ["worlds"],
        leagues: [],
        bestOf: [5],
        tournamentIds: [eventId],
        from: "2024-01-01",
        to: "2024-12-31",
        limit: 50,
      },
      seriesSummary: { wins: 2, losses: 1, total: 3, winRate: 2 / 3 },
      gameSummary: { wins: 7, losses: 4, total: 11, winRate: 7 / 11 },
      rows: [
        {
          id: seriesId,
          date: "2024-11-02",
          event: { id: eventId, name: "World Championship", category: "worlds" },
          bestOf: 5,
          leftName: "T1",
          rightName: "Bilibili Gaming",
          leftScore: 3,
          rightScore: 2,
          winner: "left",
        },
      ],
      dataset: {
        version: "2026-07-12T03:00:00Z",
        lastSuccessfulSyncAt: "2026-07-12T03:00:00Z",
        coverage: { from: "2011-01-01", to: "2026-07-11" },
      },
      coverageWarnings: [{ code: "PARTIAL_EVENT_COVERAGE", message: "Some 2011 events are pending review." }],
      mediaUrls: { left: "/media/t1.png", right: "/media/lpl.png" },
    };

    expect(ComparisonResponseSchema.parse(response)).toEqual(response);
  });

  it("validates structured API errors", () => {
    expect(ApiErrorSchema.parse({ error: { code: "INVALID_QUERY", message: "Invalid comparison query." } })).toEqual({
      error: { code: "INVALID_QUERY", message: "Invalid comparison query." },
    });
  });
});
