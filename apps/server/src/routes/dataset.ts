import type { FastifyInstance } from "fastify";

import { notFoundError } from "../errors.js";
import type { AppDependencies } from "../types.js";

export function registerDatasetRoutes(app: FastifyInstance, dependencies: AppDependencies) {
  app.get("/api/dataset", async () => {
    const dataset = await dependencies.getDataset();
    if (dataset === null) throw notFoundError();
    return dataset;
  });
}
