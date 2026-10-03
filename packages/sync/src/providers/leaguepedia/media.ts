import type { RetainedMediaInput } from "../../types.js";
import type { LeaguepediaMedia } from "./types.js";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function inspectLeaguepediaMedia(input: readonly LeaguepediaMedia[], entityIds: ReadonlyMap<string, string>, eraIds: ReadonlyMap<string, string> = new Map()) {
  const output: RetainedMediaInput[] = [];
  const imageOwners = new Set(input.map(item => item.entityKey));
  const inventory = { candidates: input.length, eligible: 0, missing: [...entityIds.keys()].filter(key => !imageOwners.has(key)).length, rightsBlocked: 0, invalid: 0, unbound: 0, ambiguous: 0 };
  const byOwner = new Map<string, RetainedMediaInput[]>();
  for (const item of input) {
    if (item.sourceUrl === null || item.contentType === null) { inventory.missing++; continue; }
    let url: URL;
    try { url = new URL(item.sourceUrl); } catch { inventory.invalid++; continue; }
    if (url.protocol !== "https:" || !IMAGE_TYPES.has(item.contentType)) { inventory.invalid++; continue; }
    if (!item.license?.trim() || !item.attribution?.trim()) { inventory.rightsBlocked++; continue; }
    const entityId = entityIds.get(item.entityKey);
    if (entityId === undefined) { inventory.unbound++; continue; }
    const teamEraId = eraIds.get(item.entityKey);
    const owner = teamEraId ?? entityId;
    const media = { sourceUrl: url.toString(), attribution: item.attribution.trim(), license: item.license.trim(), entityId, ...(teamEraId === undefined ? {} : { teamEraId }) };
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), media]);
  }
  for (const candidates of byOwner.values()) {
    const unique = new Map(candidates.map(item => [JSON.stringify([item.sourceUrl, item.license, item.attribution]), item]));
    if (unique.size !== 1) { inventory.ambiguous += candidates.length; continue; }
    output.push([...unique.values()][0]!);
  }
  inventory.eligible = output.length;
  return { media: output, inventory };
}

export function parseLeaguepediaMedia(input: readonly LeaguepediaMedia[], entityIds: ReadonlyMap<string, string>, eraIds: ReadonlyMap<string, string> = new Map()): RetainedMediaInput[] {
  return inspectLeaguepediaMedia(input, entityIds, eraIds).media;
}
