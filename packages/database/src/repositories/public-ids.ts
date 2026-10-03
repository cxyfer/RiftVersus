import { allocatePublicIds } from "@riftversus/domain";
import type { Kysely } from "kysely";
import type { Database } from "../types.js";

export async function ensurePublicIds(db: Kysely<Database>): Promise<void> {
  const entities = await db.selectFrom("entities").select(["id", "kind", "canonical_name", "player_id"]).orderBy("id").execute();
  const existing = await db.selectFrom("entity_public_ids").selectAll().execute();
  const assignments = allocatePublicIds(entities.map(entity => ({
    id: entity.id, namespace: entity.kind, label: entity.player_id ?? entity.canonical_name,
    disambiguator: entity.canonical_name,
  })), existing.map(item => ({ id: item.entity_id, namespace: item.kind, publicId: item.public_id })));
  const known = new Set(existing.map(item => item.entity_id));
  for (const item of assignments) if (!known.has(item.id)) {
    await db.insertInto("entity_public_ids").values({ entity_id: item.id, kind: item.namespace as "player" | "team" | "region", public_id: item.publicId }).execute();
  }
  const eras = await db.selectFrom("team_eras").selectAll().orderBy("id").execute();
  const existingEras = await db.selectFrom("team_era_public_ids").selectAll().execute();
  const eraAssignments = allocatePublicIds(eras.map(era => ({
    id: era.id, namespace: era.team_entity_id, label: era.display_name,
    disambiguator: [era.valid_from ?? "open", era.valid_to ?? "open"].join("-"),
  })), existingEras.map(item => ({ id: item.team_era_id, namespace: item.entity_id, publicId: item.public_id })));
  const knownEras = new Set(existingEras.map(item => item.team_era_id));
  for (const item of eraAssignments) if (!knownEras.has(item.id)) {
    await db.insertInto("team_era_public_ids").values({ team_era_id: item.id, entity_id: item.namespace, public_id: item.publicId }).execute();
  }
}
