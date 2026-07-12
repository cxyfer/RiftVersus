import type { ComparisonQuery, ComparisonResponse, Dataset } from "@riftversus/contracts";
import type { EntitySearchQuery, EntitySearchResponse, FilterOptions, MediaAsset } from "@riftversus/database";

export interface AppDependencies {
  searchEntities(query: EntitySearchQuery): Promise<EntitySearchResponse>;
  listFilters(): Promise<FilterOptions>;
  compare(query: ComparisonQuery): Promise<ComparisonResponse | null>;
  getDataset(): Promise<Dataset | null>;
  getMedia(key: string): Promise<MediaAsset | null>;
  staticDir?: string;
  staticHtml?: string;
}
