import { UuidSchema } from "@riftversus/contracts";
import type { EntityKind } from "@riftversus/contracts";

export function presentationImageUrl(input: {
  kind: EntityKind;
  entityId: string;
  retainedObjectKey: string | null;
}): string {
  return input.retainedObjectKey === null
    ? `/avatars/${input.kind}/${UuidSchema.parse(input.entityId).toLowerCase()}.svg`
    : `/media/${input.retainedObjectKey}`;
}
