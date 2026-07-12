import type { FastifyInstance } from "fastify";

import { notFoundError } from "../errors.js";
import type { AppDependencies } from "../types.js";

function mediaKey(requestUrl: string): string | null {
  const rawPath = requestUrl.split("?", 1)[0] ?? "";
  if (!rawPath.startsWith("/media/")) return null;
  const rawKey = rawPath.slice("/media/".length);
  if (!rawKey || /%(?:2f|5c|25)/i.test(rawKey)) return null;
  try {
    const key = decodeURIComponent(rawKey);
    if (key.includes("%") || key.includes("\\") || key.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
    return key;
  } catch {
    return null;
  }
}

/** Media keys are nested object keys, never filesystem paths or client-provided URLs. */
export function registerMediaRoute(app: FastifyInstance, dependencies: Pick<AppDependencies, "getMedia">) {
  app.get("/media/*", async (request, reply) => {
    const key = mediaKey(request.url);
    if (key === null) throw notFoundError();
    const media = await dependencies.getMedia(key);
    if (media === null) throw notFoundError();
    return reply.redirect(media.sourceUrl);
  });
}
