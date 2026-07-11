import { EntityKindSchema } from "@riftversus/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { validationError } from "../errors.js";
import type { AppDependencies } from "../types.js";

const EntityQuerySchema = z.object({
  q: z.string().trim().min(1),
  kinds: z.array(EntityKindSchema).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function values(value: unknown) {
  return (Array.isArray(value) ? value : [value]).flatMap((item) => typeof item === "string" ? item.split(",") : []).filter(Boolean);
}

export function registerEntityRoutes(app: FastifyInstance, dependencies: AppDependencies) {
  app.get("/api/entities", async (request) => {
    const query = request.query as Record<string, unknown>;
    const parsed = EntityQuerySchema.safeParse({ q: query.q, kinds: query.kinds === undefined ? undefined : values(query.kinds), limit: query.limit });
    if (!parsed.success) throw validationError(parsed.error);
    return dependencies.searchEntities({
      query: parsed.data.q,
      ...(parsed.data.kinds === undefined ? {} : { kinds: parsed.data.kinds }),
      limit: parsed.data.limit,
    });
  });
}
