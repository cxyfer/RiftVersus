import { describe, expect, it } from "vitest";

import { canonicalRouteState, SUBJECT_IDS, defaultRouteState, parseRouteState, serializeRouteState, swapRouteState, toContractQuery, toRouteQuery } from "./model.js";

describe("comparison route state", () => {
  it("preserves readable IDs and canonicalizes old IDs without losing filters", () => {
    const subjects = { left: { kind: "team" as const, id: SUBJECT_IDS.t1, publicId: "t1", displayName: "T1" }, right: { kind: "region" as const, id: SUBJECT_IDS.lpl, publicId: "lpl", displayName: "LPL" } };
    const legacy = { ...defaultRouteState, leftId: SUBJECT_IDS.t1, rightId: SUBJECT_IDS.lpl };
    const state = canonicalRouteState(legacy, subjects);
    expect(state).toEqual({ ...defaultRouteState, leftId: "t1", rightId: "lpl" });
    expect(parseRouteState(serializeRouteState(state))).toEqual({ state, recovered: false });
    expect(toContractQuery(state, subjects)).toEqual(toContractQuery(legacy));
  });
  it("serializes filters in a canonical order", () => {
    const output = serializeRouteState({ ...defaultRouteState, events: ["worlds", "league"], leagues: ["lpl", "lck"], bestOf: [5, 1, 3] });
    expect(output.toString()).toContain("events=league%2Cworlds");
    expect(output.toString()).toContain("leagues=lck%2Clpl");
    expect(output.toString()).toContain("bestOf=1%2C3%2C5");
  });

  it("recovers invalid URLs to the usable default comparison", () => {
    const parsed = parseRouteState(new URLSearchParams("leftKind=team&leftId=bad&rightKind=team&rightId=bad"));
    expect(parsed.recovered).toBe(true);
    expect(parsed.state).toEqual(defaultRouteState);
  });

  it("swaps both subjects and validates the result against the API contract", () => {
    const swapped = swapRouteState(defaultRouteState);
    expect(swapped.leftId).toBe("lpl");
    expect(swapped.rightId).toBe("t1");
    expect(toRouteQuery(swapped).left.id).toBe("lpl");
  });

  it("round-trips team era and date scope through canonical URL state", () => {
    const state = { ...defaultRouteState, leftEraId: "88888888-8888-4888-8888-888888888888", from: "2020-01-01", to: "2025-12-31" };
    const parsed = parseRouteState(serializeRouteState(state));
    expect(parsed).toEqual({ state, recovered: false });
  });
});
