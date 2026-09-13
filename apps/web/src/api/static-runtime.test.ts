import { describe, expect, it, vi } from "vitest";

import type { SqliteManifest } from "@riftversus/contracts";
import type { SqliteExecutor } from "@riftversus/domain";

import { createStaticApi } from "./static-runtime.js";
import type { SqliteSnapshotClient } from "./snapshot-client.js";

const manifest: SqliteManifest = {
  schemaVersion: 2,
  snapshotId: `sha256:${"a".repeat(64)}`,
  dataset: { version: "fixture-v2", lastSuccessfulSyncAt: "2026-01-01T00:00:00.000Z", coverage: { from: "2024-01-01", to: "2025-12-31" } },
  coverageWarnings: [],
  database: { file: `${"b".repeat(64)}/database.sqlite`, checksum: "b".repeat(64), byteSize: 8192, pageSize: 4096, requestChunkSize: 4096 },
  freshness: [],
  attribution: [],
};

describe("static runtime", () => {
  it("routes search and comparison through the SQL.js executor and manifest snapshot ID", async () => {
    const allMock = vi.fn(async (sql: string, params: readonly (string | number | null)[]): Promise<Record<string, unknown>[]> => {
      if (sql.includes("search_terms")) {
        return [{ kind: "team", entity_id: "11111111-1111-4111-8111-111111111111", team_era_id: null, display_name: "Alpha", real_name: null, era_label: null, media_url: "/presentation/alpha.svg" }];
      }
      if (sql.startsWith("SELECT kind FROM entity_variants")) {
        return [{ kind: params[0] === "22222222-2222-4222-8222-222222222222" ? "region" : "team" }];
      }
      if (sql.includes("FROM entity_variants WHERE entity_id = ? AND kind = ?")) {
        const region = params[1] === "region";
        return [{ kind: region ? "region" : "team", entity_id: params[0], team_era_id: null, display_name: region ? "LPL" : "Alpha", real_name: null, era_label: null, media_url: region ? "/presentation/lpl.svg" : "/presentation/alpha.svg" }];
      }
      if (sql.includes("FROM metadata")) {
        return [{ key: "dataset", value: JSON.stringify(manifest.dataset) }, { key: "coverageWarnings", value: "[]" }];
      }
      return [];
    });
    const executor: SqliteExecutor = {
      all: allMock as unknown as SqliteExecutor["all"],
    };
    const client: SqliteSnapshotClient = { open: vi.fn(async () => ({ manifest, executor })) };
    const api = createStaticApi(client);

    await expect(api.searchEntities("alpha", [])).resolves.toEqual([
      expect.objectContaining({ displayName: "Alpha", subtitle: "戰隊" }),
    ]);
    await expect(api.compare({
      left: { kind: "team", id: "11111111-1111-4111-8111-111111111111" },
      right: { kind: "region", id: "22222222-2222-4222-8222-222222222222" },
      eventCategories: [], leagues: [], bestOf: [], tournamentIds: [], limit: 50,
    })).resolves.toMatchObject({ dataset: manifest.dataset, rows: [] });
    expect(client.open).toHaveBeenCalledTimes(2);
    expect(allMock).toHaveBeenCalled();
  });
});
