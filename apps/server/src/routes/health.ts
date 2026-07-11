import type { FastifyInstance } from "fastify";

import { notReadyError } from "../errors.js";
import type { AppDependencies } from "../types.js";

export function registerHealthRoutes(app: FastifyInstance, dependencies: AppDependencies) {
  app.get("/health/live", async () => ({ status: "live" }));
  app.get("/health/ready", async () => {
    try {
      if (await dependencies.getDataset() === null) throw notReadyError();
      return { status: "ready" };
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) throw error;
      throw notReadyError();
    }
  });
}
