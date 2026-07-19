import staticPlugin from "@fastify/static";
import sensible from "@fastify/sensible";
import { ApiErrorSchema } from "@riftversus/contracts";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { notFoundError, sendApiError } from "./errors.js";
import { registerAvatarRoute } from "./routes/avatar.js";
import { registerComparisonRoutes } from "./routes/comparisons.js";
import { registerDatasetRoutes } from "./routes/dataset.js";
import { registerEntityRoutes } from "./routes/entities.js";
import { registerFilterRoutes } from "./routes/filters.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMediaRoute } from "./routes/media.js";
import type { AppDependencies } from "./types.js";

const MAX_PATH_DECODE_DEPTH = 4;

function isReservedPathname(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/")
    || pathname === "/media" || pathname.startsWith("/media/")
    || pathname === "/avatars" || pathname.startsWith("/avatars/");
}

function isReservedNamespace(requestUrl: string) {
  let pathname = requestUrl.split("?", 1)[0] ?? "/";
  for (let depth = 0; depth <= MAX_PATH_DECODE_DEPTH; depth += 1) {
    if (isReservedPathname(pathname)) return true;
    if (!/%[0-9A-Fa-f]{2}/.test(pathname)) return false;
    if (depth === MAX_PATH_DECODE_DEPTH) return true;
    try {
      const decodedPathname = decodeURIComponent(pathname);
      if (decodedPathname === pathname) return false;
      pathname = decodedPathname;
    } catch {
      return true;
    }
  }
  return true;
}

export function buildApp(dependencies: AppDependencies) {
  const staticIndexPath = dependencies.staticDir === undefined ? undefined : join(dependencies.staticDir, "index.html");
  const hasStaticIndex = staticIndexPath !== undefined && existsSync(staticIndexPath);
  const app = Fastify({
    logger: false,
    routerOptions: {
      onBadUrl: (_path, _request, response) => {
        response.statusCode = 400;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify(ApiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Invalid request." } })));
      },
    },
  });
  void app.register(sensible);
  if (dependencies.staticDir !== undefined && hasStaticIndex) {
    void app.register(staticPlugin, { root: dependencies.staticDir, wildcard: false });
  }

  app.setErrorHandler((error, _request, reply) => sendApiError(reply, error));
  registerEntityRoutes(app, dependencies);
  registerFilterRoutes(app, dependencies);
  registerComparisonRoutes(app, dependencies);
  registerDatasetRoutes(app, dependencies);
  registerHealthRoutes(app, dependencies);
  registerMediaRoute(app, dependencies);
  registerAvatarRoute(app, dependencies);

  app.setNotFoundHandler(async (request, reply) => {
    if (request.method === "GET" && !isReservedNamespace(request.url)) {
      if (dependencies.staticHtml !== undefined) return reply.type("text/html; charset=utf-8").send(dependencies.staticHtml);
      if (dependencies.staticDir !== undefined) {
        if (!hasStaticIndex) return sendApiError(reply, notFoundError());
        try {
          return reply.type("text/html; charset=utf-8").send(await readFile(staticIndexPath!));
        } catch {
          return sendApiError(reply, notFoundError());
        }
      }
    }
    return sendApiError(reply, notFoundError());
  });

  return app;
}
