import { describe, expect, it } from "vitest";

import { comparisonQueryToSearchParams } from "./client.js";
import { defaultRouteState, toContractQuery } from "../model.js";

describe("HTTP API client", () => {
  it("maps the canonical comparison query to Task 6 dotted HTTP keys", () => {
    const query = toContractQuery({ ...defaultRouteState, leagues: ["lpl"], bestOf: [5, 1], events: ["worlds", "league"] });
    const params = comparisonQueryToSearchParams(query);
    expect(params.get("left.kind")).toBe("team");
    expect(params.get("right.id")).toBe(defaultRouteState.rightId);
    expect(params.get("eventCategories")).toBe("league,worlds");
    expect(params.get("leagues")).toBe("lpl");
    expect(params.get("bestOf")).toBe("1,5");
  });
});
