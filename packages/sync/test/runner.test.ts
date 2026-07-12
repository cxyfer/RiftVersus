import { describe, expect, it, vi } from "vitest";

import {
  mediaObjectKey,
  runSync,
  scheduleSync,
  sourceObjectKey,
  validateSyncRequest,
  type ObjectStore,
  type SyncDependencies,
  type SyncProvider,
} from "../src/index.js";

const sourceBytes = new TextEncoder().encode('{"page":1}');
const mediaBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function createHarness(overrides: Partial<SyncDependencies> = {}) {
  const events: string[] = [];
  const store: ObjectStore = {
    get: vi.fn(async () => null),
    signedGetUrl: vi.fn(async () => "https://storage.test/signed"),
    head: vi.fn(async () => null),
    putImmutable: vi.fn(async (object) => { events.push(`store:${object.key}`); return "inserted"; }),
  };
  const repository: SyncDependencies["repository"] = {
    acquireLock: vi.fn(async () => { events.push("lock"); return true; }),
    releaseLock: vi.fn(async () => { events.push("unlock"); }),
    beginRun: vi.fn(async () => { events.push("begin"); return { id: "run-1" }; }),
    failRun: vi.fn(async () => { events.push("fail"); }),
    recordSource: vi.fn(async (input) => { events.push(`source:${input.objectKey}`); return { id: "source-1" }; }),
    publish: vi.fn(async () => { events.push("publish"); return { version: "fixture-v1" }; }),
  };
  const dependencies: SyncDependencies = {
    objectStore: store,
    repository,
    downloadMedia: vi.fn(async (sourceUrl) => {
      events.push(`download:${sourceUrl}`);
      return { bytes: mediaBytes, contentType: "image/png", finalUrl: sourceUrl };
    }),
    validate: vi.fn(async () => { events.push("validate"); }),
    ...overrides,
  };
  const provider: SyncProvider = {
    id: "fixture",
    parserVersion: "fixture-1",
    stage: vi.fn(async () => ({
      version: "fixture-v1",
      source: {
        sourceKey: "page:1",
        sourceUrl: "https://wiki.example.test/page/1",
        bytes: sourceBytes,
        contentType: "application/json",
      },
      media: [{
        sourceUrl: "https://wiki.example.test/media/logo.png",
        attribution: "Fixture Wiki",
      }],
      coverage: [],
      facts: {},
      rosterGameIds: [],
    })),
  };
  return { dependencies, events, provider, repository, store };
}

describe("immutable object keys", () => {
  it("derives source and media keys from SHA-256 content", async () => {
    await expect(sourceObjectKey("leaguepedia", sourceBytes)).resolves.toMatch(/^sources\/leaguepedia\/[a-f0-9]{64}$/);
    await expect(mediaObjectKey(mediaBytes, "image/png")).resolves.toMatch(/^media\/[a-f0-9]{64}\.png$/);
    await expect(mediaObjectKey(mediaBytes, "text/html")).rejects.toThrow("Unsupported media content type");
  });
});

describe("runSync", () => {
  it("retains immutable provenance before exactly one publication", async () => {
    const { dependencies, events, provider, repository } = createHarness();

    await expect(runSync(provider, { mode: "sync-once" }, dependencies)).resolves.toMatchObject({ status: "published", version: "fixture-v1" });

    expect(repository.publish).toHaveBeenCalledOnce();
    expect(repository.publish).toHaveBeenCalledWith(expect.objectContaining({
      sourceObjectId: "source-1",
      media: [expect.objectContaining({ objectKey: expect.stringMatching(/^media\/[a-f0-9]{64}\.png$/) })],
    }));
    expect(events.indexOf("validate")).toBeLessThan(events.findIndex((event) => event.startsWith("store:sources/")));
    expect(events.findIndex((event) => event.startsWith("source:sources/"))).toBeLessThan(events.indexOf("publish"));
    expect(events.at(-1)).toBe("unlock");
  });

  it("does not begin a run when the provider lock is held", async () => {
    const { dependencies, provider, repository } = createHarness();
    vi.mocked(repository.acquireLock).mockResolvedValue(false);
    await expect(runSync(provider, { mode: "sync" }, dependencies)).resolves.toEqual({ status: "locked" });
    expect(repository.beginRun).not.toHaveBeenCalled();
    expect(repository.releaseLock).not.toHaveBeenCalled();
  });

  it.each(["provider", "validation", "download", "storage", "publication"] as const)("records a failed run and releases the lock after %s failure", async (failure) => {
    const { dependencies, provider, repository, store, events } = createHarness();
    const error = new Error(`${failure} failed`);
    if (failure === "provider") vi.mocked(provider.stage).mockRejectedValue(error);
    if (failure === "validation") vi.mocked(dependencies.validate).mockRejectedValue(error);
    if (failure === "download") vi.mocked(dependencies.downloadMedia).mockRejectedValue(error);
    if (failure === "storage") vi.mocked(store.putImmutable).mockRejectedValue(error);
    if (failure === "publication") vi.mocked(repository.publish).mockRejectedValue(error);

    await expect(runSync(provider, { mode: "sync-once" }, dependencies)).rejects.toBe(error);
    expect(repository.failRun).toHaveBeenCalledWith({ syncRunId: "run-1", error: `${failure} failed` });
    expect(repository.releaseLock).toHaveBeenCalledOnce();
    expect(events.at(-1)).toBe("unlock");
    if (failure !== "publication") expect(repository.publish).not.toHaveBeenCalled();
  });
});

describe("sync request validation", () => {
  it("accepts typed sync modes and bounded backfills", () => {
    expect(validateSyncRequest({ mode: "sync" })).toEqual({ mode: "sync" });
    expect(validateSyncRequest({ mode: "sync-once" })).toEqual({ mode: "sync-once" });
    expect(validateSyncRequest({ mode: "backfill", years: [2023, 2024], competitions: ["Worlds"] })).toEqual({ mode: "backfill", years: [2023, 2024], competitions: ["Worlds"] });
  });

  it("rejects unbounded, duplicate, or malformed backfills", () => {
    expect(() => validateSyncRequest({ mode: "backfill", years: [], competitions: ["Worlds"] })).toThrow();
    expect(() => validateSyncRequest({ mode: "backfill", years: Array.from({ length: 21 }, (_, index) => 2000 + index), competitions: ["Worlds"] })).toThrow();
    expect(() => validateSyncRequest({ mode: "backfill", years: [2024, 2024], competitions: ["Worlds"] })).toThrow();
    expect(() => validateSyncRequest({ mode: "backfill", years: [2024], competitions: [] })).toThrow();
  });
});

describe("scheduleSync", () => {
  it("does not overlap ticks and observes rejected runs", async () => {
    let tick: (() => void) | undefined;
    let resolveRun: (() => void) | undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => { resolveRun = resolve; }));
    const onError = vi.fn();
    const stop = vi.fn();
    const handle = scheduleSync({
      cron: "0 3 * * *",
      timezone: "UTC",
      run,
      onError,
      createSchedule: (_cron, _timezone, callback) => { tick = callback; return { stop }; },
    });

    tick!();
    tick!();
    expect(run).toHaveBeenCalledOnce();
    resolveRun!();
    await vi.waitFor(() => expect(handle.running).toBe(false));
    run.mockRejectedValueOnce(new Error("sync rejected"));
    tick!();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "sync rejected" })));
    handle.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("validates cron and timezone before creating a schedule", () => {
    expect(() => scheduleSync({ cron: "not cron", timezone: "UTC", run: async () => undefined })).toThrow();
    expect(() => scheduleSync({ cron: "0 3 * * *", timezone: "Not/A_Zone", run: async () => undefined })).toThrow();
  });
});
