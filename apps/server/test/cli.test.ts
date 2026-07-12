import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { ObjectStore } from "@riftversus/sync";
import { executeCommand, type CommandDependencies } from "../src/cli.js";
import { loadConfig } from "../src/config.js";

const store: ObjectStore = { get: async () => Readable.from([]), signedGetUrl: async () => "https://example.test", head: async () => null, putImmutable: async () => "inserted" };
const config = loadConfig({ DATABASE_URL: "postgresql://example.test/db" });

function dependencies(): CommandDependencies {
  return {
    startServer: vi.fn(async () => undefined), migrate: vi.fn(async () => undefined), objectStore: vi.fn(() => store),
    execute: vi.fn(async () => ({ status: "published" as const, version: "fixture-v1" })),
    schedule: vi.fn((options) => { void options.run(); return { running: false, stop: vi.fn() }; }),
    waitForShutdown: vi.fn(async () => undefined), log: vi.fn(), error: vi.fn(),
  };
}

describe("executeCommand", () => {
  it("keeps serve isolated from sync scheduling", async () => {
    const deps = dependencies();
    await executeCommand({ kind: "serve" }, config, deps);
    expect(deps.startServer).toHaveBeenCalledOnce();
    expect(deps.schedule).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("routes the reviewed fixture through the shared runSync composition", async () => {
    const deps = dependencies();
    await executeCommand({ kind: "sync-once", fixture: "leaguepedia-small" }, config, deps);
    expect(deps.execute).toHaveBeenCalledWith({ config, objectStore: store, request: { mode: "sync-once" }, fixture: "leaguepedia-small" });
    expect(deps.log).toHaveBeenCalledWith(JSON.stringify({ status: "published", version: "fixture-v1" }));
  });

  it("stops the scheduled non-overlapping owner during graceful shutdown", async () => {
    const deps = dependencies();
    await executeCommand({ kind: "sync-scheduled" }, config, deps);
    const handle = (deps.schedule as ReturnType<typeof vi.fn>).mock.results[0]!.value as { stop: ReturnType<typeof vi.fn> };
    expect(deps.execute).toHaveBeenCalledWith({ config, objectStore: store, request: { mode: "sync" }, fixture: null });
    expect(handle.stop).toHaveBeenCalledOnce();
  });
});
