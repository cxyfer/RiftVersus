import type { ComparisonRouteState } from "./model.js";

const key = "riftversus.saved-comparisons";
const version = 1;

export interface SavedComparison {
  id: string;
  createdAt: string;
  state: ComparisonRouteState;
}

function isSavedComparison(value: unknown): value is SavedComparison {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavedComparison>;
  return typeof item.id === "string" && typeof item.createdAt === "string" && !!item.state && typeof item.state === "object";
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
