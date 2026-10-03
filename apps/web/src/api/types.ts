import type { ComparisonQuery, ComparisonResponse, EntityKind, ResolvedSubject, RouteSubjectRef } from "@riftversus/contracts";

export interface EntityOption extends ResolvedSubject {
  subtitle: string;
}

export interface ComparisonApi {
  resolveSubject(subject: RouteSubjectRef): Promise<ResolvedSubject>;
  searchEntities(query: string, kinds: EntityKind[]): Promise<EntityOption[]>;
  compare(query: ComparisonQuery): Promise<ComparisonResponse>;
}
