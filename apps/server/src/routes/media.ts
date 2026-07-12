import type { FastifyInstance } from "fastify";

import { mediaUnavailableError, notFoundError } from "../errors.js";
import type { AppDependencies } from "../types.js";

// SVG may include active content. Serve it as a download instead of rendering it on our origin.
const safeContentTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

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
      try {
        return reply.redirect(await dependencies.objectStore.signedGetUrl(media.objectKey, 300));
      } catch {
        throw mediaUnavailableError();
      }
    }
    let object;
    try {
      object = await dependencies.objectStore.get(media.objectKey);
    } catch {
      throw mediaUnavailableError();
    }
    if (object === null) throw mediaUnavailableError();
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.type(media.contentType !== null && safeContentTypes.has(media.contentType) ? media.contentType : "application/octet-stream");
    return reply.send(object);
  });
}
