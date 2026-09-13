import type { FastifyInstance } from "fastify";

import { notReadyError } from "../errors.js";
import type { AppDependencies } from "../types.js";

export function registerHealthRoutes(app: FastifyInstance, dependencies: AppDependencies) {
  app.get("/health/sync", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (dependencies.getSyncHealth === undefined) throw notReadyError();
    const health = await dependencies.getSyncHealth();
    return reply.code(health.status === "healthy" ? 200 : 503).send(health);
  });
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
