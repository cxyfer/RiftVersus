import { ComparisonResponseSchema, ResolvedSubjectSchema, type ComparisonQuery } from "@riftversus/contracts";
import { z } from "zod";

import type { ComparisonApi, EntityOption } from "./types.js";

const EntityResponseSchema = z.object({ entities: z.array(ResolvedSubjectSchema) });

const kindSubtitle = { player: "選手", team: "戰隊", region: "賽區" } as const;

async function requestJson(url: URL): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

export function comparisonQueryToSearchParams(query: ComparisonQuery): URLSearchParams {
  const params = new URLSearchParams({
    "left.kind": query.left.kind,
    "left.id": query.left.id,
    "right.kind": query.right.kind,
    "right.id": query.right.id,
    limit: String(query.limit),
  });
  if (query.left.teamEraId) params.set("left.teamEraId", query.left.teamEraId);
  if (query.right.teamEraId) params.set("right.teamEraId", query.right.teamEraId);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.eventCategories.length) params.set("eventCategories", [...query.eventCategories].sort().join(","));
  if (query.leagues.length) params.set("leagues", [...query.leagues].sort().join(","));
  if (query.bestOf.length) params.set("bestOf", [...query.bestOf].sort((left, right) => left - right).join(","));
  if (query.tournamentIds.length) params.set("tournamentIds", [...query.tournamentIds].sort().join(","));
  if (query.cursor) params.set("cursor", query.cursor);
  return params;
}

export const httpApi: ComparisonApi = {
  async searchEntities(query, kinds) {
    const params = new URLSearchParams({ q: query, limit: "20" });
    if (kinds.length) params.set("kinds", kinds.join(","));
    const payload = EntityResponseSchema.parse(await requestJson(new URL(`/api/entities?${params}`, window.location.origin)));
    return payload.entities.map((entity): EntityOption => ({ ...entity, subtitle: kindSubtitle[entity.kind] }));
  },
  async compare(query) {
    return ComparisonResponseSchema.parse(await requestJson(new URL(`/api/comparisons?${comparisonQueryToSearchParams(query)}`, window.location.origin)));
  },
};
