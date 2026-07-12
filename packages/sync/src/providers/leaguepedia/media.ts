import type { RetainedMediaInput } from "../../types.js";
import type { LeaguepediaMedia } from "./types.js";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function parseLeaguepediaMedia(input: readonly LeaguepediaMedia[], entityIds: ReadonlyMap<string, string>): RetainedMediaInput[] {
  const output: RetainedMediaInput[] = [];
  for (const item of input) {
    if (item.sourceUrl === null || item.contentType === null || item.license === null || item.attribution === null) continue;
    const url = new URL(item.sourceUrl);
    if (url.protocol !== "https:" || !IMAGE_TYPES.has(item.contentType) || !item.license.trim() || !item.attribution.trim()) continue;
    const entityId = entityIds.get(item.entityKey);
    if (entityId === undefined) continue;
    output.push({ sourceUrl: url.toString(), attribution: item.attribution.trim(), license: item.license.trim(), entityId });
  }
  return output;
}
