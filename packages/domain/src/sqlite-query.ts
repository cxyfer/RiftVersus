import {
  ComparisonQuerySchema,
  CoverageWarningSchema,
  DatasetSchema,
  UuidSchema,
  type BestOf,
  type ComparisonQuery,
  type ComparisonResponse,
  type EntityKind,
  type EventCategory,
  type ResolvedSubject,
  type SubjectRef,
} from "@riftversus/contracts";

type SqliteParam = string | number | null;
type Side = "a" | "b";
type SqlFragment = { text: string; params: SqliteParam[] };

/** Minimal async boundary implemented by sql.js/httpvfs and Node's DatabaseSync adapter. */
export interface SqliteExecutor {
  all<T extends Record<string, unknown>>(sql: string, params: readonly SqliteParam[]): Promise<T[]>;
}

interface CursorBoundary {
  snapshotId: string;
  playedAt: string;
  id: string;
}

type EntityRow = Record<string, unknown> & {
  kind: EntityKind;
  entity_id: string;
  team_era_id: string | null;
  display_name: string;
  real_name: string | null;
  era_label: string | null;
  media_url: string;
};

type PageRow = Record<string, unknown> & {
  id: string;
  played_at: string;
  date: string;
  tournament_id: string;
  tournament_name: string;
  category: EventCategory;
  best_of: BestOf;
  side_a_name: string;
  side_b_name: string;
  side_a_score: number;
  side_b_score: number;
  side_a_team_id: string;
  side_b_team_id: string;
  left_team_id: string;
  winner_team_id: string;
};

type SummaryRow = Record<string, unknown> & {
  series_wins: number;
  series_losses: number;
  series_total: number;
  game_wins: number;
  game_losses: number;
  game_total: number;
};

type MetadataRow = Record<string, unknown> & { key: string; value: string };

function sideColumn(side: Side, column: string): string {
  return `side_${side}_${column}`;
}

function sideMatch(subject: SubjectRef, alias: "s" | "g", side: Side): SqlFragment {
  const prefix = `${alias}.${sideColumn(side, "team_id")}`;
  if (subject.kind === "team") {
    return {
      text: subject.teamEraId === undefined ? `${prefix} = ?` : `(${prefix} = ? AND ${alias}.${sideColumn(side, "era_id")} = ?)`,
      params: subject.teamEraId === undefined ? [subject.id] : [subject.id, subject.teamEraId],
    };
  }
  if (subject.kind === "region") {
    return { text: `${alias}.${sideColumn(side, "region_id")} = ?`, params: [subject.id] };
  }
  return {
    text: `EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = ${alias}.id AND gp.side = ? AND gp.player_entity_id = ?)`,
    params: [side, subject.id],
  };
}

function assignment(left: SubjectRef, right: SubjectRef, alias: "s" | "g"): SqlFragment {
  const leftA = sideMatch(left, alias, "a");
  const leftB = sideMatch(left, alias, "b");
  const rightA = sideMatch(right, alias, "a");
  const rightB = sideMatch(right, alias, "b");
  return {
    text: `((${leftA.text} AND ${rightB.text}) OR (${leftB.text} AND ${rightA.text}))`,
    params: [...leftA.params, ...rightB.params, ...leftB.params, ...rightA.params],
  };
}

function and(parts: readonly SqlFragment[]): SqlFragment {
  return {
    text: parts.length === 0 ? "1 = 1" : parts.map((part) => `(${part.text})`).join(" AND "),
    params: parts.flatMap((part) => part.params),
  };
}

function inList(column: string, values: readonly (string | number)[]): SqlFragment | null {
  if (values.length === 0) return null;
  return { text: `${column} IN (${values.map(() => "?").join(", ")})`, params: [...values] };
}

function normalizeQuery(query: ComparisonQuery): ComparisonQuery {
  return ComparisonQuerySchema.parse(query);
}

function encodeCursor(cursor: CursorBoundary): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeCursor(value: string | undefined, snapshotId: string): CursorBoundary | null {
  if (value === undefined) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== "object" || parsed === null) throw new Error();
    const candidate = parsed as Record<string, unknown>;
    if (candidate.snapshotId !== snapshotId
      || typeof candidate.playedAt !== "string"
      || Number.isNaN(Date.parse(candidate.playedAt))
      || typeof candidate.id !== "string"
      || !UuidSchema.safeParse(candidate.id).success) throw new Error();
    return { snapshotId, playedAt: new Date(candidate.playedAt).toISOString(), id: candidate.id };
  } catch {
    throw new Error("Invalid comparison cursor.");
  }
}

function subjectFromRow(row: EntityRow): ResolvedSubject {
  return {
    kind: row.kind,
    id: row.entity_id,
    displayName: row.display_name,
    ...(row.real_name === null ? {} : { realName: row.real_name }),
    ...(row.era_label === null ? {} : { eraLabel: row.era_label }),
    ...(row.team_era_id === null ? {} : { teamEraId: row.team_era_id }),
    mediaUrl: row.media_url,
  };
}

async function resolveSubject(executor: SqliteExecutor, subject: SubjectRef): Promise<ResolvedSubject> {
  const entityRows = await executor.all<Record<string, unknown> & { kind: EntityKind }>(
    "SELECT kind FROM entity_variants WHERE entity_id = ? ORDER BY variant_id LIMIT 1",
    [subject.id],
  );
  const entity = entityRows[0];
  if (entity === undefined || entity.kind !== subject.kind) throw new Error(`Unknown ${subject.kind} subject: ${subject.id}`);

  const params: SqliteParam[] = [subject.id, subject.kind];
  let variantSql = "SELECT kind, entity_id, team_era_id, display_name, real_name, era_label, media_url FROM entity_variants WHERE entity_id = ? AND kind = ?";
  if (subject.teamEraId !== undefined) {
    variantSql += " AND team_era_id = ?";
    params.push(subject.teamEraId);
  } else {
    variantSql += " ORDER BY team_era_id IS NOT NULL, variant_id LIMIT 1";
  }
  const variants = await executor.all<EntityRow>(variantSql, params);
  const row = variants[0];
  if (row === undefined) {
    if (subject.teamEraId !== undefined) throw new Error("Team era does not belong to the selected team.");
    throw new Error(`Unknown ${subject.kind} subject: ${subject.id}`);
  }
  return subjectFromRow(row);
}

function seriesFilters(query: ComparisonQuery): SqlFragment {
  const parts: SqlFragment[] = [];
  const requiresDirectGame = query.left.kind === "player" || query.right.kind === "player";
  if (!requiresDirectGame) {
    parts.push(assignment(query.left, query.right, "s"));
  }
  if (query.from !== undefined) parts.push({ text: "s.date >= ?", params: [query.from] });
  if (query.to !== undefined) parts.push({ text: "s.date <= ?", params: [query.to] });
  const categories = inList("t.category", query.eventCategories);
  if (categories !== null) parts.push(categories);
  const leagues = inList("t.league_slug", query.leagues);
  if (leagues !== null) parts.push(leagues);
  const bestOf = inList("s.best_of", query.bestOf);
  if (bestOf !== null) parts.push(bestOf);
  const tournaments = inList("s.tournament_id", query.tournamentIds);
  if (tournaments !== null) parts.push(tournaments);
  return and(parts);
}

function candidateCtes(query: ComparisonQuery): SqlFragment {
  const player = [query.left, query.right].find(subject => subject.kind === "player");
  if (player !== undefined) {
    const direct = assignment(query.left, query.right, "g");
    return {
      text: `candidate_games AS (SELECT DISTINCT game_id AS id FROM game_players WHERE player_entity_id = ?),
        candidate_series AS (SELECT DISTINCT g.series_id AS id FROM candidate_games cg
          CROSS JOIN game_facts g ON g.id = cg.id WHERE ${direct.text})`,
      params: [player.id, ...direct.params],
    };
  }
  const anchor = [query.left, query.right].find(subject => subject.kind === "team") ?? query.left;
  const opponent = anchor === query.left ? query.right : query.left;
  const branches = (["a", "b"] as const).map(side => {
    const filters = [sideMatch(anchor, "s", side), sideMatch(opponent, "s", side === "a" ? "b" : "a")];
    if (query.from !== undefined) filters.push({ text: "s.date >= ?", params: [query.from] });
    if (query.to !== undefined) filters.push({ text: "s.date <= ?", params: [query.to] });
    const filter = and(filters);
    return { text: `SELECT s.id FROM series_facts s WHERE ${filter.text}`, params: filter.params };
  });
  return { text: `candidate_series AS (${branches.map(branch => branch.text).join(" UNION ")})`, params: branches.flatMap(branch => branch.params) };
}

function matchedSeriesCte(query: ComparisonQuery): SqlFragment {
  const selectParts = [
    "s.id",
    "s.played_at",
    "s.date",
    "s.tournament_id",
    "t.name AS tournament_name",
    "t.category",
    "s.best_of",
    "s.side_a_team_id",
    "s.side_b_team_id",
    "s.side_a_era_id",
    "s.side_b_era_id",
    "s.side_a_region_id",
    "s.side_b_region_id",
    "s.side_a_name",
    "s.side_b_name",
    "s.side_a_score",
    "s.side_b_score",
    "s.winner_team_id",
  ];
  const selectParams: SqliteParam[] = [];
  if (query.left.kind !== "player") {
    const leftA = sideMatch(query.left, "s", "a");
    selectParts.push(`CASE WHEN ${leftA.text} THEN s.side_a_team_id ELSE s.side_b_team_id END AS series_left_team_id`);
    selectParams.push(...leftA.params);
  } else {
    selectParts.push("NULL AS series_left_team_id");
  }
  const filters = seriesFilters(query);
  // 固定從候選 IDs 開始，避免 WASM planner 在遊戲統計中展開 CTE 後改掃全部賽事。
  return {
    text: `matched_series AS (SELECT ${selectParts.join(", ")} FROM candidate_series cs CROSS JOIN series_facts s ON s.id = cs.id CROSS JOIN tournaments t ON t.id = s.tournament_id WHERE ${filters.text})`,
    params: [...selectParams, ...filters.params],
  };
}

function directGamesCte(query: ComparisonQuery): SqlFragment {
  const leftA = sideMatch(query.left, "g", "a");
  const assignmentPart = assignment(query.left, query.right, "g");
  return {
    text: `direct_games AS (SELECT g.id, g.series_id, g.played_at, g.winner_team_id,
      CASE WHEN ${leftA.text} THEN g.side_a_team_id ELSE g.side_b_team_id END AS left_team_id
      FROM matched_series ms CROSS JOIN game_facts g ON g.series_id = ms.id
      WHERE ${assignmentPart.text})`,
    params: [...leftA.params, ...assignmentPart.params],
  };
}

function queryCtes(query: ComparisonQuery): { text: string; params: SqliteParam[] } {
  const candidates = candidateCtes(query);
  const matched = matchedSeriesCte(query);
  const direct = directGamesCte(query);
  return {
      text: `WITH ${candidates.text}, ${matched.text}, ${direct.text},
      ${query.left.kind === "player" ? `
      first_direct AS (
        SELECT current.id, current.series_id, current.left_team_id
        FROM direct_games current
        WHERE NOT EXISTS (
          SELECT 1 FROM direct_games earlier
          WHERE earlier.series_id = current.series_id
            AND (earlier.played_at < current.played_at
              OR (earlier.played_at = current.played_at AND earlier.id < current.id))
        )
      ),` : ""}
      oriented_matches AS (
        SELECT ms.*,
          ${query.left.kind === "player" ? "fd.left_team_id" : "ms.series_left_team_id"} AS left_team_id
        FROM matched_series ms
        ${query.left.kind === "player" ? "LEFT JOIN first_direct fd ON fd.series_id = ms.id" : ""}
      )`,
    params: [...candidates.params, ...matched.params, ...direct.params],
  };
}

function record(wins: number, losses: number, total: number): { wins: number; losses: number; total: number; winRate: number } {
  return { wins, losses, total, winRate: total === 0 ? 0 : wins / total };
}

async function readMetadata(executor: SqliteExecutor): Promise<{ dataset: ReturnType<typeof DatasetSchema.parse>; coverageWarnings: ReturnType<typeof CoverageWarningSchema.parse>[] }> {
  const rows = await executor.all<MetadataRow>("SELECT key, value FROM metadata WHERE key IN (?, ?)", ["dataset", "coverageWarnings"]);
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const datasetValue = values.get("dataset");
  const warningsValue = values.get("coverageWarnings");
  if (datasetValue === undefined || warningsValue === undefined) throw new Error("SQLite metadata is missing dataset or coverageWarnings.");
  return {
    dataset: DatasetSchema.parse(JSON.parse(datasetValue)),
    coverageWarnings: CoverageWarningSchema.array().parse(JSON.parse(warningsValue)),
  };
}

export async function searchSqlite(
  executor: SqliteExecutor,
  query: string,
  kinds?: readonly EntityKind[],
  limit = 20,
): Promise<ResolvedSubject[]> {
  const normalizedTerm = query.trim().toLowerCase();
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const params: SqliteParam[] = [normalizedTerm];
  const kindFilter = kinds === undefined || kinds.length === 0 ? "" : ` AND ev.kind IN (${kinds.map(() => "?").join(", ")})`;
  if (kinds !== undefined && kinds.length > 0) params.push(...kinds);
  params.push(normalizedLimit);
  const rows = await executor.all<EntityRow>(
    `WITH matched_entities AS (
       SELECT DISTINCT entity_id FROM search_terms WHERE instr(term, ?) > 0
     ), variants AS (
       SELECT ev.*,
         EXISTS (SELECT 1 FROM entity_variants era WHERE era.entity_id = ev.entity_id AND era.team_era_id IS NOT NULL) AS has_eras
       FROM entity_variants ev JOIN matched_entities me ON me.entity_id = ev.entity_id
       WHERE 1 = 1${kindFilter}
     )
     SELECT kind, entity_id, team_era_id, display_name, real_name, era_label, media_url
     FROM variants
     WHERE (has_eras = 1 AND team_era_id IS NOT NULL) OR (has_eras = 0 AND team_era_id IS NULL)
     ORDER BY canonical_name ASC, entity_id ASC, team_era_id IS NOT NULL ASC, team_era_id ASC
     LIMIT ?`,
    params,
  );
  return rows.map(subjectFromRow);
}

export async function compareSqlite(
  executor: SqliteExecutor,
  input: ComparisonQuery,
  snapshotId: string,
): Promise<ComparisonResponse> {
  const query = normalizeQuery(input);
  const cursor = decodeCursor(query.cursor, snapshotId);
  const [left, right, metadata] = await Promise.all([
    resolveSubject(executor, query.left),
    resolveSubject(executor, query.right),
    readMetadata(executor),
  ]);
  const ctes = queryCtes(query);
  const summary = await executor.all<SummaryRow>(
    `${ctes.text}
     SELECT
       COALESCE(SUM(CASE WHEN winner_team_id = left_team_id THEN 1 ELSE 0 END), 0) AS series_wins,
       COALESCE(SUM(CASE WHEN winner_team_id <> left_team_id THEN 1 ELSE 0 END), 0) AS series_losses,
       COUNT(*) AS series_total,
       (SELECT COALESCE(SUM(CASE WHEN winner_team_id = left_team_id THEN 1 ELSE 0 END), 0) FROM direct_games) AS game_wins,
       (SELECT COALESCE(SUM(CASE WHEN winner_team_id IS NOT NULL AND winner_team_id <> left_team_id THEN 1 ELSE 0 END), 0) FROM direct_games) AS game_losses,
       (SELECT COUNT(winner_team_id) FROM direct_games) AS game_total
     FROM oriented_matches`,
    ctes.params,
  );
  const summaryRow = summary[0] ?? { series_wins: 0, series_losses: 0, series_total: 0, game_wins: 0, game_losses: 0, game_total: 0 };

  const pageParams: SqliteParam[] = [...ctes.params];
  const cursorFilter = cursor === null ? "1 = 1" : "(played_at < ? OR (played_at = ? AND id < ?))";
  if (cursor !== null) pageParams.push(cursor.playedAt, cursor.playedAt, cursor.id);
  pageParams.push(query.limit + 1);
  const page = await executor.all<PageRow>(
    `${ctes.text}
     SELECT id, played_at, date, tournament_id, tournament_name, category, best_of,
       side_a_name, side_b_name, side_a_score, side_b_score,
       side_a_team_id, side_b_team_id, left_team_id, winner_team_id
     FROM oriented_matches
     WHERE ${cursorFilter}
     ORDER BY played_at DESC, id DESC
     LIMIT ?`,
    pageParams,
  );
  const pageRows = page.slice(0, query.limit);
  const last = pageRows.at(-1);
  const rows = pageRows.map((row) => {
    const leftOnA = row.left_team_id === row.side_a_team_id;
    return {
      id: row.id,
      date: row.date,
      event: { id: row.tournament_id, name: row.tournament_name, category: row.category },
      bestOf: Number(row.best_of) as BestOf,
      leftName: leftOnA ? row.side_a_name : row.side_b_name,
      rightName: leftOnA ? row.side_b_name : row.side_a_name,
      leftScore: leftOnA ? Number(row.side_a_score) : Number(row.side_b_score),
      rightScore: leftOnA ? Number(row.side_b_score) : Number(row.side_a_score),
      winner: row.winner_team_id === row.left_team_id ? "left" as const : "right" as const,
    };
  });
  return {
    subjects: { left, right },
    query,
    seriesSummary: record(Number(summaryRow.series_wins), Number(summaryRow.series_losses), Number(summaryRow.series_total)),
    gameSummary: record(Number(summaryRow.game_wins), Number(summaryRow.game_losses), Number(summaryRow.game_total)),
    rows,
    ...(page.length > query.limit && last !== undefined ? { nextCursor: encodeCursor({ snapshotId, playedAt: last.played_at, id: last.id }) } : {}),
    dataset: metadata.dataset,
    coverageWarnings: metadata.coverageWarnings,
    mediaUrls: { left: left.mediaUrl!, right: right.mediaUrl! },
  };
}
