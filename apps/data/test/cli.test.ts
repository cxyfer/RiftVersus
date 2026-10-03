import { join } from "node:path";
import { tmpdir } from "node:os";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDb, migrateToLatest } from "@riftversus/database";
import { executeLeaguepediaSync } from "../src/sync-service.js";
import { runDataCli } from "../src/cli.js";

vi.mock("../src/sync-service.js", () => ({ executeLeaguepediaSync: vi.fn() }));
vi.mock("@riftversus/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@riftversus/database")>();
  return { ...actual, createDb: vi.fn(), migrateToLatest: vi.fn() };
});

const environment = {
  DATABASE_URL: "postgresql://fixture.invalid/riftversus",
  LEAGUEPEDIA_ENDPOINT: "https://leaguepedia.acme.org/api.php",
  LEAGUEPEDIA_USER_AGENT: "RiftVersus/0.1 (+https://riftversus.acme.org; ops@acme.org)",
  LEAGUEPEDIA_MEDIA_HOSTS: "static.acme.org",
  LEAGUEPEDIA_SYNC_YEARS: "2026",
  LEAGUEPEDIA_SYNC_COMPETITIONS: "MSI",
  LEAGUEPEDIA_COMPETITION_MAP: '{"Worlds":{"2025":"Worlds 2025"},"MSI":{"2019":"MSI 2019","2026":"MSI 2026"}}',
  OBJECT_STORE_DIR: join(tmpdir(), "riftversus-cli-history-test"),
};

describe("data CLI execution", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockMigration(result: Partial<Awaited<ReturnType<typeof migrateToLatest>>> = {}) {
    const destroy = vi.fn(async () => undefined);
    vi.mocked(createDb).mockReturnValue({ destroy } as unknown as ReturnType<typeof createDb>);
    vi.mocked(migrateToLatest).mockResolvedValue({ results: [], ...result } as Awaited<ReturnType<typeof migrateToLatest>>);
    return { destroy };
  }

  it("runs migrations without opening object storage or sync services", async () => {
    const { destroy } = mockMigration({ results: [{ migrationName: "001_initial", direction: "Up", status: "Success" }] });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await expect(runDataCli(["migrate"], { DATABASE_URL: environment.DATABASE_URL })).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith(JSON.stringify([{ migrationName: "001_initial", direction: "Up", status: "Success" }]));
    } finally {
      log.mockRestore();
    }

    expect(createDb).toHaveBeenCalledWith({ databaseUrl: environment.DATABASE_URL });
    expect(migrateToLatest).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("propagates migration failure and still destroys the database", async () => {
    const migrationError = new Error("migration failed");
    const { destroy } = mockMigration();
    vi.mocked(migrateToLatest).mockRejectedValueOnce(migrationError);

    await expect(runDataCli(["migrate"], { DATABASE_URL: environment.DATABASE_URL })).rejects.toBe(migrationError);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("continues every bounded history scope after one failure", async () => {
    const execute = vi.mocked(executeLeaguepediaSync);
    execute
      .mockRejectedValueOnce(new Error("source unavailable"))
      .mockResolvedValueOnce({ status: "published", version: "fixture-v1" });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(runDataCli(["sync", "--history-once"], environment)).rejects.toMatchObject({
        name: "AggregateError",
        message: "Data synchronization failed; do not promote this candidate.",
      });
    } finally {
      log.mockRestore();
      error.mockRestore();
    }

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([input]) => input.request)).toEqual([
      { mode: "backfill", competitions: ["Worlds"], years: [2025] },
      { mode: "backfill", competitions: ["MSI"], years: [2019] },
    ]);
  });
});
