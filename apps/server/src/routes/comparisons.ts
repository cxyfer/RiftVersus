import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { ComparisonQuerySchema, UuidSchema } from "@riftversus/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { isMissingSubjectError, notFoundError, validationError } from "../errors.js";
import { ifNoneMatchMatches } from "../http-cache.js";
import type { AppDependencies } from "../types.js";

const CursorPayloadSchema = z.object({ playedAt: z.iso.datetime(), id: UuidSchema });
const CursorSchema = z.string().min(1).superRefine((cursor, context) => {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    context.addIssue({ code: "custom", message: "Invalid comparison cursor." });
    return;
  }
  try {
    if (!CursorPayloadSchema.safeParse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).success) {
      context.addIssue({ code: "custom", message: "Invalid comparison cursor." });
    }
  } catch {
    context.addIssue({ code: "custom", message: "Invalid comparison cursor." });
  }
});

function values(value: unknown) {
  return (Array.isArray(value) ? value : [value]).flatMap((item) => typeof item === "string" ? item.split(",") : []).filter(Boolean);
}

function optionalString(query: Record<string, unknown>, key: string) {
  const value = query[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeQuery(query: Record<string, unknown>) {
  let cursor: string | undefined;
  if (query.cursor !== undefined) {
    const parsedCursor = CursorSchema.safeParse(query.cursor);
    if (!parsedCursor.success) throw validationError(parsedCursor.error);
    cursor = parsedCursor.data;
  }
  const parsed = ComparisonQuerySchema.safeParse({
    left: { kind: query["left.kind"], id: query["left.id"], teamEraId: optionalString(query, "left.teamEraId") },
    right: { kind: query["right.kind"], id: query["right.id"], teamEraId: optionalString(query, "right.teamEraId") },
    from: optionalString(query, "from"),
    to: optionalString(query, "to"),
    eventCategories: values(query.eventCategories).sort(),
    leagues: values(query.leagues).sort(),
    bestOf: values(query.bestOf).sort(),
    tournamentIds: values(query.tournamentIds).sort(),
    cursor,
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
    if (ifNoneMatchMatches(request.headers["if-none-match"], cacheTag)) return reply.code(304).send();
    return comparison;
  });
}
