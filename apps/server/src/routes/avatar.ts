import { EntityKindSchema, UuidSchema } from "@riftversus/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { generateCanonicalAvatar } from "@riftversus/data";
import { notFoundError } from "../errors.js";
import { ifNoneMatchMatches } from "../http-cache.js";
import type { AppDependencies } from "../types.js";

const AvatarParamsSchema = z.object({
  kind: EntityKindSchema,
  id: UuidSchema,
});

export function registerAvatarRoute(app: FastifyInstance, dependencies: AppDependencies): void {
  app.get<{ Params: { kind: string; id: string } }>("/avatars/v2/:kind/:id.svg", async (request, reply) => {
    const parsed = AvatarParamsSchema.safeParse(request.params);
    if (!parsed.success) throw notFoundError();

    const canonicalId = parsed.data.id.toLowerCase();
    const identity = await dependencies.getAvatarIdentity(parsed.data.kind, canonicalId);
    const resolvedId = identity === null ? null : UuidSchema.safeParse(identity.id);
    if (identity === null || identity.kind !== parsed.data.kind || !resolvedId?.success || resolvedId.data.toLowerCase() !== canonicalId) {
      throw notFoundError();
    }
    const avatar = generateCanonicalAvatar(identity);
    const cacheTag = `"sha256-${avatar.checksum}"`;
    reply.header("Cache-Control", "public, no-cache");
    reply.header("ETag", cacheTag);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    if (ifNoneMatchMatches(request.headers["if-none-match"], cacheTag)) return reply.code(304).send();
    return reply.type(avatar.contentType).send(avatar.body);
  });
}
