import type { ComparisonQuery, ComparisonResponse, Dataset } from "@riftversus/contracts";
import type { EntitySearchQuery, EntitySearchResponse, FilterOptions, MediaAsset } from "@riftversus/database";
import type { ObjectStore } from "@riftversus/sync";

export interface AppDependencies {
  searchEntities(query: EntitySearchQuery): Promise<EntitySearchResponse>;
  listFilters(): Promise<FilterOptions>;
  compare(query: ComparisonQuery): Promise<ComparisonResponse | null>;
  getDataset(): Promise<Dataset | null>;
  getMedia(key: string): Promise<MediaAsset | null>;
  objectStore?: ObjectStore;
  mediaDelivery?: "proxy" | "redirect";
  staticDir?: string;
  staticHtml?: string;
}
