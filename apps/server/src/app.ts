import staticPlugin from "@fastify/static";
import sensible from "@fastify/sensible";
import Fastify from "fastify";

import { notFoundError, sendApiError } from "./errors.js";
import { registerComparisonRoutes } from "./routes/comparisons.js";
import { registerDatasetRoutes } from "./routes/dataset.js";
import { registerEntityRoutes } from "./routes/entities.js";
import { registerFilterRoutes } from "./routes/filters.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMediaRoute } from "./routes/media.js";
import type { AppDependencies } from "./types.js";

export function buildApp(dependencies: AppDependencies) {
  const app = Fastify({ logger: false });
  void app.register(sensible);
  if (dependencies.staticDir !== undefined) void app.register(staticPlugin, { root: dependencies.staticDir, wildcard: false });

  app.setErrorHandler((error, _request, reply) => sendApiError(reply, error));
  registerEntityRoutes(app, dependencies);
  registerFilterRoutes(app, dependencies);
  registerComparisonRoutes(app, dependencies);
  registerDatasetRoutes(app, dependencies);
  registerHealthRoutes(app, dependencies);
  registerMediaRoute(app);

  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, "http://riftversus.local").pathname;
    const isReservedNamespace = pathname === "/api" || pathname.startsWith("/api/") || pathname === "/media" || pathname.startsWith("/media/");
    if (request.method === "GET" && !isReservedNamespace) {
      if (dependencies.staticHtml !== undefined) return reply.type("text/html; charset=utf-8").send(dependencies.staticHtml);
      if (dependencies.staticDir !== undefined) return reply.type("text/html; charset=utf-8").sendFile("index.html");
    }
    return sendApiError(reply, notFoundError());
  });

  return app;
}
