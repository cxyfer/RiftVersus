import { sql } from "kysely";

/** Latest committed visibility generation; -1 deliberately exposes no staged facts. */
export const latestPublicationGeneration = sql<string>`coalesce((select max(generation) from dataset_versions), -1)`;
