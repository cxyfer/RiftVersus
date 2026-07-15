import { EntityKindSchema, UuidSchema } from "@riftversus/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { generateCanonicalAvatar } from "../avatar.js";
import { notFoundError } from "../errors.js";

const AvatarParamsSchema = z.object({
  kind: EntityKindSchema,
  id: UuidSchema,
});

export function registerAvatarRoute(app: FastifyInstance): void {
  app.get<{ Params: { kind: string; id: string } }>("/avatars/:kind/:id.svg", async (request, reply) => {
    const parsed = AvatarParamsSchema.safeParse(request.params);
    if (!parsed.success) throw notFoundError();

    const avatar = generateCanonicalAvatar(parsed.data.kind, parsed.data.id);
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("ETag", `"sha256-${avatar.checksum}"`);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return reply.type(avatar.contentType).send(avatar.body);
  });
}
