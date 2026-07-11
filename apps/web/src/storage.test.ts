import { describe, expect, it } from "vitest";

import { defaultRouteState } from "./model.js";
import { loadSavedComparisons, removeSavedComparison, saveComparison } from "./storage.js";

describe("saved comparisons", () => {
  it("saves, reloads, and removes versioned local results", () => {
    const storage = new Map<string, string>();
    const fakeStorage: Storage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: (key) => { storage.delete(key); },
      clear: () => { storage.clear(); },
      key: () => null,
      get length() { return storage.size; },
    };
    const items = saveComparison(defaultRouteState, fakeStorage);
    expect(loadSavedComparisons(fakeStorage)).toHaveLength(1);
    expect(removeSavedComparison(items[0]!.id, fakeStorage)).toEqual([]);
  });

  it("ignores broken local data", () => {
    const fakeStorage = { getItem: () => "{not json" } as unknown as Storage;
    expect(loadSavedComparisons(fakeStorage)).toEqual([]);
  });
});
