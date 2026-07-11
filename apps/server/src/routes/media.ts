import type { FastifyInstance } from "fastify";

import { notFoundError } from "../errors.js";

/** Task 9 owns allow-listed media delivery; reserving the route prevents SPA fallback. */
export function registerMediaRoute(app: FastifyInstance) {
  app.get("/media/:key", async () => {
    throw notFoundError();
  });
}
