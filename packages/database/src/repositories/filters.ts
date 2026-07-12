import type { Kysely } from "kysely";

import type { Database } from "../types.js";
import type { FilterOptions } from "./types.js";
import { latestPublicationGeneration } from "./publication.js";

export async function listAvailableFilters(db: Kysely<Database>): Promise<FilterOptions> {
  const [tournaments, series] = await Promise.all([
    db.selectFrom("tournaments as tournament").innerJoin("series_facts as series", "series.tournament_id", "tournament.id")
      .select(["tournament.id", "tournament.name", "tournament.category"]).where("series.publication_generation", "<=", latestPublicationGeneration)
      .where((eb) => eb.or([eb("series.retired_generation", "is", null), eb("series.retired_generation", ">", latestPublicationGeneration)]))
      .distinct().orderBy("tournament.name").execute(),
    db.selectFrom("series_facts").select("best_of").where("publication_generation", "<=", latestPublicationGeneration)
      .where((eb) => eb.or([eb("retired_generation", "is", null), eb("retired_generation", ">", latestPublicationGeneration)]))
      .distinct().orderBy("best_of").execute(),
  ]);
  return { eventCategories: [...new Set(tournaments.map((row) => row.category))], tournaments, bestOf: series.map((row) => row.best_of) };
}
