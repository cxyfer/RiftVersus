import { createHash } from "node:crypto";

import { ComparisonQuerySchema } from "@riftversus/contracts";
import type { FastifyInstance } from "fastify";

import { isMissingSubjectError, notFoundError, validationError } from "../errors.js";
import type { AppDependencies } from "../types.js";

function values(value: unknown) {
  return (Array.isArray(value) ? value : [value]).flatMap((item) => typeof item === "string" ? item.split(",") : []).filter(Boolean);
}

function optionalString(query: Record<string, unknown>, key: string) {
  const value = query[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeQuery(query: Record<string, unknown>) {
  const parsed = ComparisonQuerySchema.safeParse({
    left: { kind: query["left.kind"], id: query["left.id"], teamEraId: optionalString(query, "left.teamEraId") },
    right: { kind: query["right.kind"], id: query["right.id"], teamEraId: optionalString(query, "right.teamEraId") },
    from: optionalString(query, "from"),
    to: optionalString(query, "to"),
    eventCategories: values(query.eventCategories).sort(),
    bestOf: values(query.bestOf).sort(),
    tournamentIds: values(query.tournamentIds).sort(),
    cursor: optionalString(query, "cursor"),
    limit: query.limit,
  });
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function etag(query: ReturnType<typeof normalizeQuery>, datasetVersion: string) {
  const payload = canonicalJson({ datasetVersion, query });
  return `"${createHash("sha256").update(payload).digest("hex")}"`;
}

export function registerComparisonRoutes(app: FastifyInstance, dependencies: AppDependencies) {
  app.get("/api/comparisons", async (request, reply) => {
    const query = normalizeQuery(request.query as Record<string, unknown>);
    let comparison;
    try {
      comparison = await dependencies.compare(query);
    } catch (error) {
      if (isMissingSubjectError(error)) throw notFoundError();
      throw error;
    }
    if (comparison === null) throw notFoundError();

    const cacheTag = etag(query, comparison.dataset.version);
    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    reply.header("ETag", cacheTag);
    if (request.headers["if-none-match"] === cacheTag) return reply.code(304).send();
    return comparison;
  });
}
