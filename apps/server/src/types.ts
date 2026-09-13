import type { ComparisonQuery, ComparisonResponse, Dataset } from "@riftversus/contracts";
import type { EntitySearchQuery, EntitySearchResponse, FilterOptions, MediaAsset } from "@riftversus/database";
import type { ObjectStore } from "@riftversus/sync";

import type { AvatarIdentity } from "./avatar.js";
import type { evaluateSyncHealth } from "./sync-health.js";

export interface AppDependencies {
  searchEntities(query: EntitySearchQuery): Promise<EntitySearchResponse>;
  listFilters(): Promise<FilterOptions>;
  compare(query: ComparisonQuery): Promise<ComparisonResponse | null>;
  getDataset(): Promise<Dataset | null>;
  getSyncHealth?(): Promise<ReturnType<typeof evaluateSyncHealth>>;
  getMedia(key: string): Promise<MediaAsset | null>;
  getAvatarIdentity(kind: AvatarIdentity["kind"], id: string): Promise<AvatarIdentity | null>;
  objectStore?: ObjectStore;
  mediaDelivery?: "proxy" | "redirect";
  staticDir?: string;
  staticHtml?: string;
}
