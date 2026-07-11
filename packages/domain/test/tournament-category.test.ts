import { describe, expect, it } from "vitest";

import { classifyTournament } from "../src/tournament-category.js";

describe("tournament classification", () => {
  it("applies explicit overrides before deterministic name and league rules", () => {
    const input = { id: "worlds-qualifier", name: "World Championship Qualifier", leagueName: "LCK" };

    expect(classifyTournament(input, [{ tournamentId: input.id, category: "other" }])).toBe("other");
    expect(classifyTournament({ id: "worlds", name: "2024 World Championship" }, [])).toBe("worlds");
    expect(classifyTournament({ id: "msi", name: "Mid-Season Invitational" }, [])).toBe("msi");
    expect(classifyTournament({ id: "fst", name: "First Stand Tournament" }, [])).toBe("fst");
    expect(classifyTournament({ id: "lpl", name: "Summer", leagueName: "LPL" }, [])).toBe("league");
    expect(classifyTournament({ id: "unknown", name: "Regional Cup" }, [])).toBe("other");
  });
});
