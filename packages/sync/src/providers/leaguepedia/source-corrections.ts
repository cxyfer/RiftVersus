import { createHash } from "node:crypto";
import type { LeaguepediaCargoTable, RawApiEvidence } from "./types.js";

/** 人工核實的來源修正；原始回應不變，修正檔 checksum 納入 publication provenance。 */
export interface SourceCorrection {
  table: "Players" | "Teams" | "TeamRedirects" | "MatchSchedule" | "ScoreboardPlayers" | "ScoreboardGames";
  key: string;
  value: string;
  sourceUrl: string;
  reviewedNote: string;
  sourceKind?: "reviewed-alternative";
  corroboratingUrls?: readonly string[];
  row?: Readonly<Record<string, unknown>>;
  field?: "BestOf" | "MatchId" | "Team1" | "Team2";
  expected?: unknown;
  replacement?: unknown;
}

export function parseSourceCorrections(value: unknown): readonly SourceCorrection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Source corrections must be an array.");
  const seen = new Set<string>();
  const aliasTargets = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid source correction.");
    const r = item as SourceCorrection;
    if (!["Players", "Teams", "TeamRedirects", "MatchSchedule", "ScoreboardPlayers", "ScoreboardGames"].includes(r.table)
      || typeof r.value !== "string" || !r.value.trim() || typeof r.reviewedNote !== "string" || !r.reviewedNote.trim()
      || typeof r.sourceUrl !== "string") throw new Error("Source correction requires an exact key and reviewed Leaguepedia source.");
    const source = new URL(r.sourceUrl);
    if (r.sourceKind === "reviewed-alternative") {
      if (!["ScoreboardGames", "ScoreboardPlayers"].includes(r.table) || r.row === undefined || r.field !== undefined
        || source.protocol !== "https:" || source.hostname !== "www.youtube.com" || source.pathname !== "/watch"
        || !/^[A-Za-z0-9_-]{11}$/.test(source.searchParams.get("v") ?? "")
        || !Array.isArray(r.corroboratingUrls) || r.corroboratingUrls.length === 0
        || r.corroboratingUrls.some((url) => typeof url !== "string" || new URL(url).protocol !== "https:" || url === r.sourceUrl)) throw new Error("Alternative game corrections require reviewed official video and corroborating sources.");
    } else if (r.sourceKind !== undefined || source.protocol !== "https:" || source.hostname !== "lol.fandom.com" || !source.pathname.startsWith("/wiki/")) throw new Error("Source correction requires an exact key and reviewed Leaguepedia wiki source.");
    const key = r.table === "ScoreboardPlayers" || r.table === "ScoreboardGames" ? "GameId" : r.table === "TeamRedirects" ? "AllName" : r.table === "MatchSchedule" ? r.key : "OverviewPage";
    if (r.table === "MatchSchedule" ? !(r.key === "MatchId" || (r.key === "OverviewPage" && r.field === "BestOf")) : r.key !== key) throw new Error("Source correction primary key is invalid.");
    if (r.row !== undefined) {
      if (r.table === "MatchSchedule" || !r.row || typeof r.row !== "object" || r.row[key] !== r.value || r.field !== undefined) throw new Error("Source correction row is invalid.");
      if (r.table === "ScoreboardPlayers" && (typeof r.row.PlayerName !== "string" || !r.row.PlayerName.trim() || typeof r.row.Team !== "string" || !r.row.Team.trim() || !["Yes", "No"].includes(r.row.PlayerWin as string))) throw new Error("Source correction roster row is invalid.");
      if (r.table === "ScoreboardGames" && (["MatchId", "Tournament", "DateTime_UTC", "Team1", "Team2"].some((field) => typeof r.row![field] !== "string" || !(r.row![field] as string).trim()) || ![1, 2, 3, 4, 5].includes(r.row.N_GameInMatch as number) || ![1, 2].includes(r.row.Winner as number))) throw new Error("Source correction game row is invalid.");
    } else if (r.table !== "MatchSchedule" || !["BestOf", "MatchId", "Team1", "Team2"].includes(r.field ?? "")
      || (r.field === "BestOf" && (r.expected !== null || ![1, 2, 3, 5].includes(r.replacement as number)))
      || (r.field === "MatchId" && (r.expected !== r.value || typeof r.replacement !== "string" || !r.replacement.trim()))
      || ((r.field === "Team1" || r.field === "Team2") && (typeof r.expected !== "string" || !r.expected.trim() || typeof r.replacement !== "string" || !r.replacement.trim()))) throw new Error("Source correction field is invalid.");
    const identity = `${r.table}:${r.key}:${r.value}:${r.field ?? "row"}:${r.table === "ScoreboardPlayers" ? r.row?.PlayerName : ""}`;
    if (seen.has(identity)) throw new Error(`Duplicate source correction ${identity}.`);
    seen.add(identity);
    if (r.field === "MatchId") {
      if (aliasTargets.has(r.replacement as string)) throw new Error(`Ambiguous schedule alias target ${r.replacement}.`);
      aliasTargets.add(r.replacement as string);
    }
    return r;
  });
}

/** 手動覆核記錄有獨立 action，不偽裝成 Cargo 或 MediaWiki 回應。 */
export function alternativeReviewEvidence(rules: readonly SourceCorrection[], gameKeys: ReadonlySet<unknown>): RawApiEvidence[] {
  const applicable = rules.filter((rule) => rule.sourceKind === "reviewed-alternative" && gameKeys.has(rule.value));
  if (applicable.length === 0) return [];
  const response = { kind: "reviewed-alternative", corrections: applicable };
  const bytes = JSON.stringify(response);
  return [{ requestId: `manual-review:${createHash("sha256").update(bytes).digest("hex")}`, action: "review", sourceUrl: applicable[0]!.sourceUrl, response, responseBytes: Buffer.byteLength(bytes), revisionIds: [] }];
}

export function projectSourceRows(table: LeaguepediaCargoTable, rows: readonly Record<string, unknown>[], rules: readonly SourceCorrection[] = []): Record<string, unknown>[] {
  const result = rows.map((row) => ({ ...row }));
  // ID alias 最後套用，其他精確欄位修正仍以原始 MatchId 選取。
  for (const rule of rules.filter((r) => r.table === table).sort((a, b) => Number(a.field === "MatchId") - Number(b.field === "MatchId"))) {
    const matches = result.filter((_, index) => rows[index]?.[rule.key] === rule.value && (table !== "ScoreboardPlayers" || rows[index]?.PlayerName === rule.row?.PlayerName));
    if (rule.row) {
      // 單局補件只能附加到已觀測且同賽事的系列賽；未請求的其他範圍不匯入。
      if (table === "ScoreboardGames" && !rows.some((row) => row.MatchId === rule.row!.MatchId && row.Tournament === rule.row!.Tournament)) continue;
      // Cargo 修復後採用其原生 GameId，不重複加入以 RPGID 補回的同一局。
      if (table === "ScoreboardGames" && rows.some((row) => row.MatchId === rule.row!.MatchId && row.Tournament === rule.row!.Tournament && row.N_GameInMatch === rule.row!.N_GameInMatch)) continue;
      // 存在 upstream row 時仍由 upstream 擁有，只補明確缺少的來源紀錄。
      if (matches.length === 0) result.push({ ...rule.row });
    } else {
      for (const row of matches) {
        if (row[rule.field!] === rule.replacement) continue;
        if (row[rule.field!] !== rule.expected) throw new Error(`Reviewed source correction conflicts with upstream ${table} ${rule.value} ${rule.field}.`);
        row[rule.field!] = rule.replacement;
      }
    }
  }
  return result;
}

export function sourceScheduleIds(matchIds: readonly string[], rules: readonly SourceCorrection[] = []): string[] {
  return [...new Set(matchIds.map((id) => rules.find((r) => r.table === "MatchSchedule" && r.field === "MatchId" && r.replacement === id)?.value ?? id))];
}
