import { UuidSchema, type ResolvedSubject, type RouteSubjectRef } from "@riftversus/contracts";
import type { SqliteExecutor } from "./sqlite-query.js";
import { normalizePublicId } from "./public-id.js";

export class UnknownPublicSubjectError extends Error {
  constructor() {
    super("找不到指定的比較對象，請重新選擇選手、戰隊或賽區。");
    this.name = "UnknownPublicSubjectError";
  }
}

export async function resolvePublicSubject(executor: SqliteExecutor, input: RouteSubjectRef): Promise<ResolvedSubject> {
  const legacyId = UuidSchema.safeParse(input.id).success;
  const idRows = await executor.all<{ entity_id: string; public_id: string }>(
    `SELECT entity_id, public_id FROM public_ids WHERE kind = ? AND ${legacyId ? "entity_id" : "public_id"} = ?`,
    [input.kind, legacyId ? input.id.toLowerCase() : normalizePublicId(input.id)],
  );
  const mapping = idRows[0];
  const entityId = mapping?.entity_id ?? (legacyId ? input.id.toLowerCase() : undefined);
  if (entityId === undefined) throw new UnknownPublicSubjectError();
  let eraId: string | undefined;
  let publicEraId: string | undefined;
  if (input.teamEraId !== undefined) {
    if (input.kind !== "team") throw new UnknownPublicSubjectError();
    const legacyEra = UuidSchema.safeParse(input.teamEraId).success;
    const eraRows = await executor.all<{ team_era_id: string; public_id: string }>(
      `SELECT team_era_id, public_id FROM public_era_ids WHERE entity_id = ? AND ${legacyEra ? "team_era_id" : "public_id"} = ?`,
      [entityId, legacyEra ? input.teamEraId.toLowerCase() : normalizePublicId(input.teamEraId)],
    );
    eraId = eraRows[0]?.team_era_id ?? (legacyEra ? input.teamEraId.toLowerCase() : undefined);
    publicEraId = eraRows[0]?.public_id;
    if (eraId === undefined) throw new UnknownPublicSubjectError();
  }
  const rows = await executor.all<{ entity_id: string; display_name: string; real_name: string | null; era_label: string | null; media_url: string }>(
    "SELECT entity_id, display_name, real_name, era_label, media_url FROM entity_variants WHERE entity_id = ? AND kind = ? AND team_era_id IS ?",
    [entityId, input.kind, eraId ?? null],
  );
  const row = rows[0];
  if (row === undefined) throw new UnknownPublicSubjectError();
  return { kind: input.kind, id: entityId, displayName: row.display_name, mediaUrl: row.media_url,
    ...(row.real_name === null ? {} : { realName: row.real_name }),
    ...(row.era_label === null ? {} : { eraLabel: row.era_label }),
    ...(mapping === undefined ? {} : { publicId: mapping.public_id }),
    ...(eraId === undefined ? {} : { teamEraId: eraId }),
    ...(publicEraId === undefined ? {} : { publicEraId }),
  };
}
