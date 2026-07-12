import { ComparisonQuerySchema, type BestOf, type ComparisonQuery, type EntityKind, type EventCategory, type LeagueSlug } from "@riftversus/contracts";

export type LeagueCode = LeagueSlug;

export interface ComparisonRouteState {
  leftKind: EntityKind;
  leftId: string;
  leftEraId?: string;
  rightKind: EntityKind;
  rightId: string;
  rightEraId?: string;
  from?: string;
  to?: string;
  events: EventCategory[];
  leagues: LeagueCode[];
  bestOf: BestOf[];
}

export const SUBJECT_IDS = {
  t1: "11111111-1111-4111-8111-111111111111",
  geng: "22222222-2222-4222-8222-222222222222",
  blg: "33333333-3333-4333-8333-333333333333",
  faker: "44444444-4444-4444-8444-444444444444",
  knight: "55555555-5555-4555-8555-555555555555",
  lck: "66666666-6666-4666-8666-666666666666",
  lpl: "77777777-7777-4777-8777-777777777777",
} as const;

export const defaultRouteState: ComparisonRouteState = {
  leftKind: "team",
  leftId: SUBJECT_IDS.t1,
  rightKind: "region",
  rightId: SUBJECT_IDS.lpl,
  from: "2019-01-01",
  to: "2026-12-31",
  events: ["worlds"],
  leagues: [],
  bestOf: [5],
};

const kinds = new Set<EntityKind>(["player", "team", "region"]);
const events = new Set<EventCategory>(["league", "fst", "msi", "worlds", "other"]);
const leagues = new Set<LeagueCode>(["lck", "lpl", "lec", "lcs"]);
const bestOf = new Set<BestOf>([1, 3, 5]);

function csv(value: string | null): string[] {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

function sorted<T extends string | number>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right))) as T[];
}

export function toContractQuery(state: ComparisonRouteState): ComparisonQuery {
  return ComparisonQuerySchema.parse({
    left: {
      kind: state.leftKind,
      id: state.leftId,
      ...(state.leftEraId ? { teamEraId: state.leftEraId } : {}),
    },
    right: {
      kind: state.rightKind,
      id: state.rightId,
      ...(state.rightEraId ? { teamEraId: state.rightEraId } : {}),
    },
    ...(state.from ? { from: state.from } : {}),
    ...(state.to ? { to: state.to } : {}),
    eventCategories: sorted(state.events),
    leagues: sorted(state.leagues),
    bestOf: sorted(state.bestOf),
    tournamentIds: [],
  });
}

export function parseRouteState(input: URLSearchParams): { state: ComparisonRouteState; recovered: boolean } {
  const proposed: ComparisonRouteState = {
    leftKind: input.get("leftKind") as EntityKind,
    leftId: input.get("leftId") ?? "",
    ...(input.get("leftEraId") ? { leftEraId: input.get("leftEraId")! } : {}),
    rightKind: input.get("rightKind") as EntityKind,
    rightId: input.get("rightId") ?? "",
    ...(input.get("rightEraId") ? { rightEraId: input.get("rightEraId")! } : {}),
    ...(input.get("from") ? { from: input.get("from")! } : {}),
    ...(input.get("to") ? { to: input.get("to")! } : {}),
    events: csv(input.get("events")).filter((value): value is EventCategory => events.has(value as EventCategory)),
    leagues: csv(input.get("leagues")).filter((value): value is LeagueCode => leagues.has(value as LeagueCode)),
    bestOf: csv(input.get("bestOf")).map(Number).filter((value): value is BestOf => bestOf.has(value as BestOf)),
  };

  const invalidKind = !kinds.has(proposed.leftKind) || !kinds.has(proposed.rightKind);
  const invalidEra = (proposed.leftKind !== "team" && proposed.leftEraId) || (proposed.rightKind !== "team" && proposed.rightEraId);
  try {
    if (invalidKind || invalidEra) throw new Error("invalid route subject");
    toContractQuery(proposed);
    return { state: { ...proposed, events: sorted(proposed.events), leagues: sorted(proposed.leagues), bestOf: sorted(proposed.bestOf) }, recovered: false };
  } catch {
    return { state: defaultRouteState, recovered: true };
  }
}

export function serializeRouteState(state: ComparisonRouteState): URLSearchParams {
  const output = new URLSearchParams({
    leftKind: state.leftKind,
    leftId: state.leftId,
    rightKind: state.rightKind,
    rightId: state.rightId,
  });
  if (state.leftEraId) output.set("leftEraId", state.leftEraId);
  if (state.rightEraId) output.set("rightEraId", state.rightEraId);
  if (state.from) output.set("from", state.from);
  if (state.to) output.set("to", state.to);
  if (state.events.length) output.set("events", sorted(state.events).join(","));
  if (state.leagues.length) output.set("leagues", sorted(state.leagues).join(","));
  if (state.bestOf.length) output.set("bestOf", sorted(state.bestOf).join(","));
  return output;
}

export function swapRouteState(state: ComparisonRouteState): ComparisonRouteState {
  return {
    ...state,
    leftKind: state.rightKind,
    leftId: state.rightId,
    ...(state.rightEraId ? { leftEraId: state.rightEraId } : {}),
    rightKind: state.leftKind,
    rightId: state.leftId,
    ...(state.leftEraId ? { rightEraId: state.leftEraId } : {}),
  };
}
