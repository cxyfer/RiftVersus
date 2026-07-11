import type { EventCategory } from "@riftversus/contracts";

export interface TournamentClassificationInput {
  readonly id: string;
  readonly name: string;
  readonly leagueName?: string;
}

export interface TournamentOverride {
  readonly tournamentId: string;
  readonly category: EventCategory;
}

const leagueNames = new Set(["lck", "lpl", "lec", "lcs"]);

export function classifyTournament(input: TournamentClassificationInput, overrides: readonly TournamentOverride[]): EventCategory {
  const override = overrides.find((entry) => entry.tournamentId === input.id);
  if (override !== undefined) {
    return override.category;
  }

  const name = input.name.toLocaleLowerCase();
  if (name.includes("world championship") || /\bworlds\b/.test(name)) {
    return "worlds";
  }
  if (name.includes("mid-season invitational") || /\bmsi\b/.test(name)) {
    return "msi";
  }
  if (name.includes("first stand")) {
    return "fst";
  }
  if (input.leagueName !== undefined && leagueNames.has(input.leagueName.toLocaleLowerCase())) {
    return "league";
  }

  return "other";
}
