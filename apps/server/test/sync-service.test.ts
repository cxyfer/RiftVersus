import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { ObjectStore, SyncPublicationInput, SyncRepository } from "@riftversus/sync";
import { loadConfig } from "../src/config.js";
import { buildLeaguepediaSlices, executeLeaguepediaSync } from "../src/sync-service.js";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));

function config() {
  return loadConfig({ DATABASE_URL: "postgresql://fixture.invalid/riftversus", LEAGUEPEDIA_SYNC_YEARS: "2023,2024" });
}

describe("Leaguepedia sync composition", () => {
  it("maps every logical competition and year to an exact source key and rejects gaps", () => {
    expect(buildLeaguepediaSlices(config(), { mode: "backfill", years: [2023, 2024], competitions: ["Worlds"] }).map((slice) => slice.sourceCompetition)).toEqual([
      "2023 Season World Championship", "2024 Season World Championship",
    ]);
    expect(() => buildLeaguepediaSlices(config(), { mode: "backfill", years: [2025], competitions: ["Worlds"] })).toThrow(/Worlds.*2025/);
  });

  it("replays the deployable fixture twice through runSync and publishes once", async () => {
    const publications = new Map<string, { version: string }>(); const retained: string[] = []; const published: SyncPublicationInput[] = []; let run = 0; let unchanged = 0;
    const repository: SyncRepository = {
      withLock: async (_provider, operation) => { await operation(); return "ran"; },
      beginRun: async () => ({ id: `run-${++run}` }), failRun: async () => undefined,
      recordSource: async (source) => { retained.push(source.objectKey); return { id: "source-1" }; },
      findPublication: async (version) => publications.get(version) ?? null,
      completeUnchanged: async () => { unchanged += 1; },
      publish: async (input) => { published.push(input); publications.set(input.version, { version: input.version }); return { version: input.version }; },
    };
    const objects: string[] = [];
    const objectStore: ObjectStore = {
      get: async () => Readable.from([]), signedGetUrl: async () => "https://fixture.invalid/object", head: async () => null,
      putImmutable: async (object) => { objects.push(object.key); return "inserted"; },
    };
    const loadLive = vi.fn(async () => { throw new Error("live loader must not run for leaguepedia-small"); });
    const input = { config: config(), objectStore, request: { mode: "sync-once" as const }, fixture: "leaguepedia-small" as const };
    const batchCounts: unknown[] = [];
    const dependencies = { rootDir, openRepository: async () => ({ repository, close: async () => undefined }), loadLive, observeBatch: (batch: { dimensions: { entities: readonly unknown[] }; facts: { series?: readonly unknown[]; games?: readonly unknown[]; gamePlayers?: readonly unknown[] }; coverage: readonly unknown[] }) => batchCounts.push({ entities: batch.dimensions.entities.length, series: batch.facts.series?.length, games: batch.facts.games?.length, players: batch.facts.gamePlayers?.length, coverage: batch.coverage.length }) };

    const first = await executeLeaguepediaSync(input, dependencies);
    const second = await executeLeaguepediaSync(input, dependencies);
    expect(first).toMatchObject({ status: "published" }); expect(second).toEqual({ status: "unchanged", version: first.version });

    expect(loadLive).not.toHaveBeenCalled(); expect(published).toHaveLength(1); expect(publications.size).toBe(1); expect(unchanged).toBe(1); expect(retained).toHaveLength(1); expect(objects).toHaveLength(2);
    expect(batchCounts).toHaveLength(2); expect(batchCounts[1]).toEqual(batchCounts[0]);
    expect(published[0]!.dimensions.entities.length).toBeGreaterThan(2);
    expect(published[0]!.facts.series).toHaveLength(1); expect(published[0]!.facts.games).toHaveLength(5); expect(published[0]!.facts.gamePlayers).toHaveLength(50);
    expect(published[0]!.media).toEqual([expect.objectContaining({ objectKey: expect.stringMatching(/^media\/[a-f0-9]{64}\.png$/), checksum: expect.stringMatching(/^[a-f0-9]{64}$/), contentType: "image/png", byteSize: "68" })]);
    expect(published[0]!.coverage).toEqual([expect.objectContaining({ competition: "Worlds", seasonYear: 2024, status: "complete" })]);
    expect(published[0]!.publicationScopes).toEqual([expect.objectContaining({ tournamentSourceKey: "2024 Season World Championship", status: "complete", unresolvedRows: 0 })]);
    expect(published[0]!.provenance.overrideFiles.map((item) => item.file)).toEqual(["data/overrides/identities.yaml", "data/overrides/tournaments.yaml"]);
  });

  it("rejects a missing year mapping before opening a sync run repository", async () => {
    const openRepository = vi.fn();
    await expect(executeLeaguepediaSync({ config: config(), objectStore: {} as ObjectStore, request: { mode: "backfill", years: [2025], competitions: ["Worlds"] }, fixture: null }, { rootDir, openRepository })).rejects.toThrow(/Worlds.*2025/);
    expect(openRepository).not.toHaveBeenCalled();
  });
});
