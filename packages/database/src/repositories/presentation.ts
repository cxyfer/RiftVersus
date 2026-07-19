import { UuidSchema } from "@riftversus/contracts";
import type { EntityKind } from "@riftversus/contracts";
import { sql, type Kysely } from "kysely";

import type { Database } from "../types.js";
import { publishedEntityVisibility } from "./publication.js";

export function entityPresentation(input: {
  kind: EntityKind;
  canonicalName: string;
  playerId: string | null;
}): { displayName: string; realName?: string } {
  if (input.kind !== "player" || input.playerId === null) return { displayName: input.canonicalName };
  return input.playerId === input.canonicalName
    ? { displayName: input.playerId }
    : { displayName: input.playerId, realName: input.canonicalName };
}

export function presentationImageUrl(input: {
  kind: EntityKind;
  entityId: string;
  retainedObjectKey: string | null;
}): string {
  return input.retainedObjectKey === null
    ? `/avatars/v2/${input.kind}/${UuidSchema.parse(input.entityId).toLowerCase()}.svg`
    : `/media/${input.retainedObjectKey}`;
}

export async function getAvatarIdentity(
  kind: EntityKind,
  id: string,
  db: Kysely<Database>,
): Promise<{ kind: EntityKind; id: string; label: string } | null> {
  const canonicalId = UuidSchema.parse(id).toLowerCase();
  const row = await db.selectFrom("entities as entity")
    .select(["entity.kind", "entity.id", "entity.canonical_name", "entity.player_id"])
    .where("entity.id", "=", canonicalId)
    .where(publishedEntityVisibility(sql.ref("entity.id")))
    .executeTakeFirst();

  if (row === undefined || row.kind !== kind) return null;
  const presentation = entityPresentation({
    kind: row.kind,
    canonicalName: row.canonical_name,
    playerId: row.player_id,
  });
  return { kind: row.kind, id: row.id, label: presentation.displayName };
}
