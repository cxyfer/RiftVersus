import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { MediaRightsBasisSchema, UuidSchema } from "@riftversus/contracts";
import { createDb, exportSnapshotFacts } from "@riftversus/database";
import { downloadBounded, runSync, type ObjectStore, type SyncConfig, type SyncProvider, type RetainedMediaInput } from "@riftversus/sync";
import { createDatabaseSyncRepository } from "./sync-service.js";

export const ReviewedMediaManifestSchema = z.object({
  version: z.literal(1),
  status: z.literal("reviewed"),
  assets: z.array(z.object({
    sourceUrl: z.url().refine(value => new URL(value).origin === "https://static.wikia.nocookie.net", "Expected Leaguepedia CDN media."),
    attribution: z.string().trim().min(1),
    rightsBasis: MediaRightsBasisSchema,
    owners: z.array(z.object({ id: UuidSchema, kind: z.enum(["player", "team", "team-era"]), sourceKey: z.string().trim().min(1), sourcePage: z.string().trim().min(1).optional() }).strict()).min(1),
  }).strict()).min(1).max(1000),
}).strict();

export type ReviewedMediaManifest = z.infer<typeof ReviewedMediaManifestSchema>;
export interface MediaOwnerInventory {
  entities: readonly { id: string; kind: string; canonicalName: string }[];
  aliases: readonly { entityId: string; sourceKey: string }[];
  eras: readonly { id: string; displayName: string; teamEntityId: string }[];
}

export function bindReviewedMedia(manifest: ReviewedMediaManifest, inventory: MediaOwnerInventory): RetainedMediaInput[] {
  const used = new Set<string>();
  const output: RetainedMediaInput[] = [];
  for (const asset of manifest.assets) for (const owner of asset.owners) {
    const key = `${owner.kind}:${owner.id}`;
    if (used.has(key)) throw new Error(`Conflicting reviewed images for ${key}.`);
    used.add(key);
    if (owner.kind === "team-era") {
      const era = inventory.eras.find(item => item.id === owner.id);
      if (era === undefined || era.displayName !== owner.sourceKey || !inventory.entities.some(item => item.id === era.teamEntityId && item.kind === "team")
        || (owner.sourcePage !== undefined && !inventory.aliases.some(item => item.entityId === era.teamEntityId && item.sourceKey === owner.sourcePage))) throw new Error(`Reviewed logo does not match the exact historical era: ${key}.`);
    } else {
      const entity = inventory.entities.find(item => item.id === owner.id && item.kind === owner.kind);
      if (entity === undefined || !inventory.aliases.some(item => item.entityId === owner.id && item.sourceKey === (owner.sourcePage ?? owner.sourceKey))
        || (owner.kind === "player" && owner.sourcePage !== undefined && owner.sourcePage !== owner.sourceKey)
        || (owner.kind === "team" && entity.canonicalName !== owner.sourceKey)) throw new Error(`Reviewed image source does not match its published entity: ${key}.`);
    }
    output.push({ sourceUrl: asset.sourceUrl, attribution: asset.attribution, license: null, rightsBasis: asset.rightsBasis,
      ...(owner.kind === "team-era" ? { teamEraId: owner.id } : { entityId: owner.id }) });
  }
  return output;
}

export async function executeReviewedMediaSync(config: SyncConfig, objectStore: ObjectStore): Promise<unknown> {
  const db = createDb({ databaseUrl: config.databaseUrl });
  try {
    const path = resolve(config.leaguepedia.overridesDir, "media.json");
    const bytes = await readFile(path);
    const manifest = ReviewedMediaManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const projection = await exportSnapshotFacts(db);
    const aliases = await db.selectFrom("entity_aliases").select(["entity_id", "source_key"]).where("provider", "=", "leaguepedia").execute();
    const eras = await db.selectFrom("team_eras").select(["id", "team_entity_id", "display_name"]).execute();
    const media = bindReviewedMedia(manifest, {
      entities: projection.entities.filter(item => item.teamEraId === undefined),
      aliases: aliases.map(item => ({ entityId: item.entity_id, sourceKey: item.source_key })),
      eras: eras.map(item => ({ id: item.id, teamEntityId: item.team_entity_id, displayName: item.display_name })),
    });
    const provider: SyncProvider = {
      id: "leaguepedia", parserVersion: "leaguepedia-reviewed-media-v1",
      async stage() {
        return { version: `leaguepedia-media-${digest}`, provenance: { parserVersion: this.parserVersion, sourceDigest: `sha256:${digest}`, overrideFiles: [{ file: "data/overrides/media.json", checksum: `sha256:${digest}` }] },
          source: { sourceKey: `reviewed-media:sha256:${digest}`, sourceUrl: config.leaguepedia.endpoint, bytes, contentType: "application/json" }, media,
          coverage: [], dimensions: { entities: [], teamEras: [], regions: [], tournaments: [] }, facts: { series: [], games: [], gamePlayers: [] }, rosterGameIds: [], publicationScopes: [] };
      },
    };
    const downloads = new Map<string, ReturnType<typeof downloadBounded>>();
    const result = await runSync(provider, { mode: "media" }, {
      objectStore, repository: createDatabaseSyncRepository(db), validate: () => undefined,
      downloadMedia(sourceUrl) {
        let download = downloads.get(sourceUrl);
        if (download === undefined) {
          download = downloadBounded({ url: sourceUrl, allowedHosts: config.leaguepedia.mediaHosts,
            allowedContentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"], maxBytes: 10_000_000, timeoutMs: 20_000 });
          downloads.set(sourceUrl, download);
        }
        return download;
      },
    });
    if (result.status === "locked") throw new Error("Media publication could not acquire the publication lock.");
    return { ...result, reviewedAssets: manifest.assets.length, reviewedOwners: media.length };
  } finally { await db.destroy(); }
}
