import { describe, expect, it } from "vitest";

import { SUBJECT_IDS, defaultRouteState, parseRouteState, serializeRouteState, swapRouteState, toContractQuery } from "./model.js";

describe("comparison route state", () => {
  it("serializes filters in a canonical order", () => {
    const output = serializeRouteState({ ...defaultRouteState, events: ["worlds", "league"], leagues: ["LPL", "LCK"], bestOf: [5, 1, 3] });
    expect(output.toString()).toContain("events=league%2Cworlds");
    expect(output.toString()).toContain("leagues=LCK%2CLPL");
    expect(output.toString()).toContain("bestOf=1%2C3%2C5");
  });

  it("recovers invalid URLs to the usable default comparison", () => {
    const parsed = parseRouteState(new URLSearchParams("leftKind=team&leftId=bad&rightKind=team&rightId=bad"));
    expect(parsed.recovered).toBe(true);
    expect(parsed.state).toEqual(defaultRouteState);
  });

  it("swaps both subjects and validates the result against the API contract", () => {
    const swapped = swapRouteState(defaultRouteState);
    expect(swapped.leftId).toBe(SUBJECT_IDS.lpl);
    expect(swapped.rightId).toBe(SUBJECT_IDS.t1);
    expect(toContractQuery(swapped).left.id).toBe(SUBJECT_IDS.lpl);
  });
});
