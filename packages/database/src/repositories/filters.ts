import type { Kysely } from "kysely";

import type { Database } from "../types.js";
import type { FilterOptions } from "./types.js";

export async function listAvailableFilters(db: Kysely<Database>): Promise<FilterOptions> {
  const [tournaments, series] = await Promise.all([
    db.selectFrom("tournaments").select(["id", "name", "category"]).orderBy("name").execute(),
    db.selectFrom("series_facts").select("best_of").distinct().orderBy("best_of").execute(),
  ]);
  return { eventCategories: [...new Set(tournaments.map((row) => row.category))], tournaments, bestOf: series.map((row) => row.best_of) };
}
