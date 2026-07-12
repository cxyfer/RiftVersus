import type { FastifyInstance } from "fastify";

import { mediaUnavailableError, notFoundError } from "../errors.js";
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
export function registerMediaRoute(app: FastifyInstance, dependencies: Pick<AppDependencies, "getMedia" | "objectStore" | "mediaDelivery">) {
  app.get("/media/*", async (request, reply) => {
    const key = mediaKey(request.url);
    if (key === null) throw notFoundError();
    const media = await dependencies.getMedia(key);
    if (media === null) throw notFoundError();
    if (dependencies.objectStore === undefined) throw mediaUnavailableError();
    if (dependencies.mediaDelivery === "redirect") {
      return reply.redirect(await dependencies.objectStore.signedGetUrl(media.objectKey, 300));
    }
    const object = await dependencies.objectStore.get(media.objectKey);
    if (object === null) throw mediaUnavailableError();
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    if (media.contentType !== null) reply.type(media.contentType);
    return reply.send(object);
  });
}
