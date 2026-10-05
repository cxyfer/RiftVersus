import { describe, expect, it } from "vitest";
import { isCompletedSeriesScore } from "../src/series-format.js";
import { BestOfSchema, EventCategorySchema, RecordSummarySchema, SeriesRowSchema } from "../src/comparison.js";

describe("historical domestic and EWC contracts", () => {
  it("retains BO2 and EWC as explicit filters", () => {
    expect(BestOfSchema.parse(2)).toBe(2);
    expect(EventCategorySchema.parse("ewc")).toBe("ewc");
  });

  it("validates the full BO2 score rather than majority-to-win rules", () => {
    for (const [a, b] of [[2, 0], [1, 1], [0, 2]]) expect(isCompletedSeriesScore(2, a!, b!)).toBe(true);
    for (const [a, b] of [[0, 0], [1, 0], [2, 1], [3, 0]]) expect(isCompletedSeriesScore(2, a!, b!)).toBe(false);
    expect(isCompletedSeriesScore(3, 1, 1)).toBe(false);
  });

  it("represents finished draws independently of a winning side", () => {
    expect(SeriesRowSchema.shape.winner.parse("draw")).toBe("draw");
    expect(RecordSummarySchema.parse({ wins: 1, losses: 1, draws: 2, total: 4, winRate: 0.25 }).draws).toBe(2);
  });
});
