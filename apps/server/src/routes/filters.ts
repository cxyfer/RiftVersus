import type { FastifyInstance } from "fastify";

import type { AppDependencies } from "../types.js";

export function registerFilterRoutes(app: FastifyInstance, dependencies: AppDependencies) {
  app.get("/api/filters", async () => dependencies.listFilters());
}
