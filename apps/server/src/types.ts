import type { ComparisonQuery, ComparisonResponse, Dataset } from "@riftversus/contracts";
import type { EntitySearchQuery, EntitySearchResponse, FilterOptions } from "@riftversus/database";

export interface AppDependencies {
  searchEntities(query: EntitySearchQuery): Promise<EntitySearchResponse>;
  listFilters(): Promise<FilterOptions>;
  compare(query: ComparisonQuery): Promise<ComparisonResponse | null>;
  getDataset(): Promise<Dataset | null>;
  staticDir?: string;
  staticHtml?: string;
}
