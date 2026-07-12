import type { ComparisonQuery, ComparisonResponse, EntityKind, ResolvedSubject } from "@riftversus/contracts";

export interface EntityOption extends ResolvedSubject {
  subtitle: string;
}

export interface ComparisonApi {
  searchEntities(query: string, kinds: EntityKind[]): Promise<EntityOption[]>;
  compare(query: ComparisonQuery): Promise<ComparisonResponse>;
}
