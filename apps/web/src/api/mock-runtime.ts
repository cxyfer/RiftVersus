import type { ComparisonQuery, ComparisonResponse, EntityKind, ResolvedSubject, SubjectRef } from "@riftversus/contracts";

import { SUBJECT_IDS } from "../model.js";
import type { ComparisonApi, EntityOption } from "./types.js";

const image = (label: string, background: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${background}"/><path d="M14 72 48 13l34 59H14Z" fill="none" stroke="#e6efe9" stroke-width="6"/><text x="48" y="83" fill="#e6efe9" font-family="sans-serif" font-size="14" font-weight="700" text-anchor="middle">${label}</text></svg>`)}`;

export const mockEntities: EntityOption[] = [
  { kind: "team", id: SUBJECT_IDS.t1, publicId: "t1", displayName: "T1", eraLabel: "2019 - 2026", subtitle: "Korea · Team", mediaUrl: image("T1", "#a72532") },
  { kind: "team", id: SUBJECT_IDS.geng, displayName: "Gen.G", eraLabel: "2022 - 2026", subtitle: "Korea · Team", mediaUrl: image("GEN", "#d4b354") },
  { kind: "team", id: SUBJECT_IDS.blg, displayName: "Bilibili Gaming", eraLabel: "2023 - 2026", subtitle: "China · Team", mediaUrl: image("BLG", "#2558a5") },
  { kind: "player", id: SUBJECT_IDS.faker, displayName: "Faker", realName: "Lee Sang-hyeok", subtitle: "T1 · Mid", mediaUrl: image("FKR", "#70323d") },
  { kind: "player", id: SUBJECT_IDS.knight, displayName: "knight", subtitle: "Bilibili Gaming · Mid", mediaUrl: image("KNT", "#1f4f91") },
  { kind: "region", id: SUBJECT_IDS.lck, displayName: "LCK", subtitle: "Korea · Region", mediaUrl: image("LCK", "#324f61") },
  { kind: "region", id: SUBJECT_IDS.lpl, publicId: "lpl", displayName: "LPL", subtitle: "China · Region", mediaUrl: image("LPL", "#b74142") },
];

const byId = new Map(mockEntities.map((entity) => [entity.id, entity]));
const resolved = (subject: SubjectRef): ResolvedSubject => {
  const entity = byId.get(subject.id);
  if (entity === undefined || entity.kind !== subject.kind) throw new Error(`Unknown ${subject.kind} subject: ${subject.id}`);
  if (subject.teamEraId !== undefined) throw new Error(`Unknown team era subject: ${subject.teamEraId}`);
  return { kind: entity.kind, id: entity.id, displayName: entity.displayName, ...(entity.publicId ? { publicId: entity.publicId } : {}), ...(entity.realName ? { realName: entity.realName } : {}), ...(entity.eraLabel ? { eraLabel: entity.eraLabel } : {}), ...(entity.mediaUrl ? { mediaUrl: entity.mediaUrl } : {}) };
};

const rowCursor = (row: { date: string; id: string }) => `${row.date}|${row.id}`;

export const mockApi: ComparisonApi = {
  async resolveSubject(subject) {
    const entity = mockEntities.find(item => item.kind === subject.kind && (item.id === subject.id || item.publicId === subject.id));
    if (!entity) throw new Error("Unknown comparison subject.");
    return resolved({ ...subject, id: entity.id });
  },
  async searchEntities(query: string, kinds: EntityKind[]) {
    await new Promise((resolve) => setTimeout(resolve, 220));
    const needle = query.toLowerCase();
    return mockEntities.filter((entity) => (kinds.length === 0 || kinds.includes(entity.kind)) && `${entity.displayName} ${entity.realName ?? ""} ${entity.subtitle}`.toLowerCase().includes(needle));
  },
  async compare(query: ComparisonQuery): Promise<ComparisonResponse> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const left = resolved(query.left);
    const right = resolved(query.right);
    const baseRows = [
      { id: "88888888-8888-4888-8888-888888888881", date: "2025-11-02", event: { id: "99999999-9999-4999-8999-999999999991", name: "World Championship", category: "worlds" as const }, league: "lpl", bestOf: 5 as const, leftName: "T1", rightName: "Weibo Gaming", leftScore: 3, rightScore: 1, winner: "left" as const },
      { id: "88888888-8888-4888-8888-888888888882", date: "2024-10-27", event: { id: "99999999-9999-4999-8999-999999999992", name: "World Championship", category: "worlds" as const }, league: "lpl", bestOf: 5 as const, leftName: "T1", rightName: "Bilibili Gaming", leftScore: 3, rightScore: 0, winner: "left" as const },
      { id: "88888888-8888-4888-8888-888888888883", date: "2023-11-19", event: { id: "99999999-9999-4999-8999-999999999993", name: "World Championship", category: "worlds" as const }, league: "lpl", bestOf: 5 as const, leftName: "SK Telecom T1", rightName: "Weibo Gaming", leftScore: 3, rightScore: 2, winner: "left" as const },
    ];
    const longFixture = typeof window !== "undefined" && window.localStorage.getItem("riftversus.playwright-fixture") === "long";
    const fixtureRows = longFixture ? Array.from({ length: 101 }, (_, index) => ({ ...baseRows[index % baseRows.length]!, id: `88888888-8888-4888-8888-${String(index + 1).padStart(12, "0")}`, event: { ...baseRows[index % baseRows.length]!.event, id: `99999999-9999-4999-8999-${String(index + 1).padStart(12, "0")}`, name: `World Championship ${index + 1}` }, date: new Date(Date.UTC(2025, 10, 9 - index)).toISOString().slice(0, 10) })) : baseRows;
    const allRows = fixtureRows.filter((row) => (query.eventCategories.length === 0 || query.eventCategories.includes(row.event.category)) && (query.leagues.length === 0 || query.leagues.includes(row.league as "lpl")) && (query.bestOf.length === 0 || query.bestOf.includes(row.bestOf)) && (query.from === undefined || row.date >= query.from) && (query.to === undefined || row.date <= query.to))
      .sort((first, second) => second.date.localeCompare(first.date) || second.id.localeCompare(first.id));
    const cursorIndex = query.cursor === undefined ? -1 : allRows.findIndex((row) => rowCursor(row) === query.cursor);
    if (query.cursor !== undefined && cursorIndex === -1) throw new Error("Invalid mock comparison cursor.");
    const start = cursorIndex + 1;
    const page = allRows.slice(start, start + query.limit);
    const nextCursor = start + page.length < allRows.length ? rowCursor(page.at(-1)!) : undefined;
    return {
      subjects: { left, right }, query,
      seriesSummary: { wins: allRows.length, losses: 0, total: allRows.length, winRate: allRows.length === 0 ? 0 : 1 },
      gameSummary: { wins: allRows.length * 3, losses: allRows.length, total: allRows.length * 4, winRate: allRows.length === 0 ? 0 : 0.75 },
      rows: page.map((row) => ({ id: row.id, date: row.date, event: row.event, bestOf: row.bestOf, leftName: row.leftName, rightName: row.rightName, leftScore: row.leftScore, rightScore: row.rightScore, winner: row.winner })), ...(nextCursor === undefined ? {} : { nextCursor }),
      dataset: { version: "mock-2026.07", lastSuccessfulSyncAt: "2026-07-12T08:30:00.000Z", coverage: { from: "2015-01-01", to: "2026-07-12" } },
      coverageWarnings: [], mediaUrls: { left: left.mediaUrl ?? "/media-placeholder.svg", right: right.mediaUrl ?? "/media-placeholder.svg" },
    };
  },
};

export { mockApi as api };
