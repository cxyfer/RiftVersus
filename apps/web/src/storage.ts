import { toContractQuery, type ComparisonRouteState } from "./model.js";

const key = "riftversus.saved-comparisons";
const version = 2;

export interface SavedComparison {
  id: string;
  createdAt: string;
  state: ComparisonRouteState;
}

function isRouteState(value: unknown): value is ComparisonRouteState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  if (typeof state.leftKind !== "string" || typeof state.leftId !== "string" || typeof state.rightKind !== "string" || typeof state.rightId !== "string") return false;
  if (![state.events, state.leagues, state.bestOf].every(Array.isArray)) return false;
  if ([state.leftEraId, state.rightEraId, state.from, state.to].some((item) => item !== undefined && typeof item !== "string")) return false;
  try { toContractQuery(state as unknown as ComparisonRouteState); return true; } catch { return false; }
}

function isSavedComparison(value: unknown): value is SavedComparison {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavedComparison>;
  return typeof item.id === "string" && typeof item.createdAt === "string" && isRouteState(item.state);
}

export function loadSavedComparisons(storage: Storage = localStorage): SavedComparison[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object") return [];
    const record = parsed as { version?: unknown; items?: unknown };
    return record.version === version && Array.isArray(record.items) ? record.items.filter(isSavedComparison) : [];
  } catch {
    return [];
  }
}

function persist(items: SavedComparison[], storage: Storage = localStorage) {
  storage.setItem(key, JSON.stringify({ version, items }));
}

export function saveComparison(state: ComparisonRouteState, storage: Storage = localStorage): SavedComparison[] {
  const item: SavedComparison = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), state };
  const items = [item, ...loadSavedComparisons(storage)].slice(0, 20);
  persist(items, storage);
  return items;
}

export function removeSavedComparison(id: string, storage: Storage = localStorage): SavedComparison[] {
  const items = loadSavedComparisons(storage).filter((item) => item.id !== id);
  persist(items, storage);
  return items;
}
