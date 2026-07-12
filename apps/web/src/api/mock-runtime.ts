import type { ComparisonQuery, ComparisonResponse, EntityKind, ResolvedSubject } from "@riftversus/contracts";

import { SUBJECT_IDS } from "../model.js";
import type { ComparisonApi, EntityOption } from "./types.js";

const image = (label: string, background: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${background}"/><path d="M14 72 48 13l34 59H14Z" fill="none" stroke="#e6efe9" stroke-width="6"/><text x="48" y="83" fill="#e6efe9" font-family="sans-serif" font-size="14" font-weight="700" text-anchor="middle">${label}</text></svg>`)}`;

export const mockEntities: EntityOption[] = [
  { kind: "team", id: SUBJECT_IDS.t1, displayName: "T1", eraLabel: "2019 - 2026", subtitle: "Korea · Team", mediaUrl: image("T1", "#a72532") },
  { kind: "team", id: SUBJECT_IDS.geng, displayName: "Gen.G", eraLabel: "2022 - 2026", subtitle: "Korea · Team", mediaUrl: image("GEN", "#d4b354") },
  { kind: "team", id: SUBJECT_IDS.blg, displayName: "Bilibili Gaming", eraLabel: "2023 - 2026", subtitle: "China · Team", mediaUrl: image("BLG", "#2558a5") },
  { kind: "player", id: SUBJECT_IDS.faker, displayName: "Faker", subtitle: "T1 · Mid", mediaUrl: image("FKR", "#70323d") },
  { kind: "player", id: SUBJECT_IDS.knight, displayName: "knight", subtitle: "Bilibili Gaming · Mid", mediaUrl: image("KNT", "#1f4f91") },
  { kind: "region", id: SUBJECT_IDS.lck, displayName: "LCK", subtitle: "Korea · Region", mediaUrl: image("LCK", "#324f61") },
  { kind: "region", id: SUBJECT_IDS.lpl, displayName: "LPL", subtitle: "China · Region", mediaUrl: image("LPL", "#b74142") },
];

const byId = new Map(mockEntities.map((entity) => [entity.id, entity]));
const resolved = (id: string, fallback: "left" | "right"): ResolvedSubject => {
  const entity = byId.get(id) ?? mockEntities[fallback === "left" ? 0 : 1]!;
  return { kind: entity.kind, id: entity.id, displayName: entity.displayName, ...(entity.eraLabel ? { eraLabel: entity.eraLabel } : {}), ...(entity.mediaUrl ? { mediaUrl: entity.mediaUrl } : {}) };
};

export const mockApi: ComparisonApi = {
  async searchEntities(query: string, kinds: EntityKind[]) {
    await new Promise((resolve) => setTimeout(resolve, 220));
    const needle = query.toLowerCase();
    return mockEntities.filter((entity) => (kinds.length === 0 || kinds.includes(entity.kind)) && `${entity.displayName} ${entity.subtitle}`.toLowerCase().includes(needle));
  },
  async compare(query: ComparisonQuery): Promise<ComparisonResponse> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const left = resolved(query.left.id, "left");
    const right = resolved(query.right.id, "right");
    const allRows = [
      { id: "88888888-8888-4888-8888-888888888881", date: "2025-11-02", event: { id: "99999999-9999-4999-8999-999999999991", name: "World Championship", category: "worlds" as const }, league: "lpl", bestOf: 5 as const, leftName: left.displayName, rightName: right.displayName, leftScore: 3, rightScore: 1, winner: "left" as const },
      { id: "88888888-8888-4888-8888-888888888882", date: "2024-10-27", event: { id: "99999999-9999-4999-8999-999999999992", name: "World Championship", category: "worlds" as const }, league: "lpl", bestOf: 5 as const, leftName: left.displayName, rightName: right.displayName, leftScore: 3, rightScore: 0, winner: "left" as const },
      { id: "88888888-8888-4888-8888-888888888883", date: "2023-11-19", event: { id: "99999999-9999-4999-8999-999999999993", name: "World Championship", category: "worlds" as const }, league: "lpl", bestOf: 5 as const, leftName: left.displayName, rightName: right.displayName, leftScore: 3, rightScore: 2, winner: "left" as const },
    ].filter((row) => (query.eventCategories.length === 0 || query.eventCategories.includes(row.event.category)) && (query.leagues.length === 0 || query.leagues.includes(row.league as "lpl")) && (query.bestOf.length === 0 || query.bestOf.includes(row.bestOf)) && (query.from === undefined || row.date >= query.from) && (query.to === undefined || row.date <= query.to));
    const page = query.cursor ? allRows.slice(2) : allRows.slice(0, 2);
    return {
      subjects: { left, right }, query,
      seriesSummary: { wins: allRows.length, losses: 0, total: allRows.length, winRate: allRows.length === 0 ? 0 : 1 },
      gameSummary: { wins: allRows.length * 3, losses: allRows.length, total: allRows.length * 4, winRate: allRows.length === 0 ? 0 : 0.75 },
      rows: page.map((row) => ({ id: row.id, date: row.date, event: row.event, bestOf: row.bestOf, leftName: row.leftName, rightName: row.rightName, leftScore: row.leftScore, rightScore: row.rightScore, winner: row.winner })), ...(query.cursor || allRows.length <= 2 ? {} : { nextCursor: "mock-page-2" }),
      dataset: { version: "mock-2026.07", lastSuccessfulSyncAt: "2026-07-12T08:30:00.000Z", coverage: { from: "2015-01-01", to: "2026-07-12" } },
      coverageWarnings: [], mediaUrls: { left: left.mediaUrl ?? "/media-placeholder.svg", right: right.mediaUrl ?? "/media-placeholder.svg" },
    };
  },
};

export { mockApi as api };
