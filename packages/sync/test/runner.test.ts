import { describe, expect, it, vi } from "vitest";

import {
  mediaObjectKey,
  RetainableStageError,
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
    withLock: vi.fn(async (_provider, operation) => {
      events.push("lock");
      try { await operation(); }
      finally { events.push("unlock"); }
      return "ran";
    }),
    beginRun: vi.fn(async () => { events.push("begin"); return { id: "run-1" }; }),
    failRun: vi.fn(async () => { events.push("fail"); }),
    recordSource: vi.fn(async (input) => { events.push(`source:${input.objectKey}`); return { id: "source-1" }; }),
    findPublication: vi.fn(async () => { events.push("find-version"); return null; }),
    completeUnchanged: vi.fn(async () => { events.push("unchanged"); }),
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
    stage: vi.fn(async () => {
      events.push("stage");
      return {
        version: "fixture-v1",
        provenance: { sourceDigest: `sha256:${"a".repeat(64)}`, parserVersion: "fixture-1", overrideFiles: [] },
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
        dimensions: { entities: [], teamEras: [], regions: [], tournaments: [] },
        facts: {},
        rosterGameIds: [],
      };
    }),
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
      dimensions: { entities: [], teamEras: [], regions: [], tournaments: [] },
      provenance: expect.objectContaining({ parserVersion: "fixture-1" }),
      media: [expect.objectContaining({ objectKey: expect.stringMatching(/^media\/[a-f0-9]{64}\.png$/) })],
    }));
    expect(events).toEqual([
      "lock",
      "begin",
      "stage",
      "validate",
      "find-version",
      expect.stringMatching(/^store:sources\/fixture\/[a-f0-9]{64}$/),
      expect.stringMatching(/^source:sources\/fixture\/[a-f0-9]{64}$/),
      "download:https://wiki.example.test/media/logo.png",
      expect.stringMatching(/^store:media\/[a-f0-9]{64}\.png$/),
      "publish",
      "unlock",
    ]);
  });

  it("completes an unchanged run without retaining or publishing duplicate version state", async () => {
    const { dependencies, events, provider, repository, store } = createHarness();
    vi.mocked(repository.findPublication).mockImplementation(async () => { events.push("find-version"); return { version: "fixture-v1" }; });

    await expect(runSync(provider, { mode: "sync-once" }, dependencies)).resolves.toEqual({ status: "unchanged", version: "fixture-v1" });

    expect(repository.completeUnchanged).toHaveBeenCalledWith({ syncRunId: "run-1", version: "fixture-v1" });
    expect(store.putImmutable).not.toHaveBeenCalled();
    expect(repository.publish).not.toHaveBeenCalled();
    expect(events).toEqual(["lock", "begin", "stage", "validate", "find-version", "unchanged", "unlock"]);
  });

  it("does not begin a run when the provider lock is held", async () => {
    const { dependencies, provider, repository } = createHarness();
    vi.mocked(repository.withLock).mockResolvedValue("locked");
    await expect(runSync(provider, { mode: "sync" }, dependencies)).resolves.toEqual({ status: "locked" });
    expect(repository.beginRun).not.toHaveBeenCalled();
  });

  it("retains auditable raw evidence carried by a malformed provider stage error", async () => {
    const { dependencies, events, provider, repository } = createHarness();
    vi.mocked(provider.stage).mockImplementation(async () => {
      events.push("stage");
      throw new RetainableStageError("malformed row", { sourceKey: "failed:raw", sourceUrl: "https://wiki.example.test/api.php", bytes: sourceBytes, contentType: "application/json" });
    });

    await expect(runSync(provider, { mode: "sync-once" }, dependencies)).rejects.toThrow("malformed row");
    expect(repository.recordSource).toHaveBeenCalledOnce();
    expect(repository.failRun).toHaveBeenCalledWith({ syncRunId: "run-1", error: "malformed row" });
    expect(events).toEqual(["lock", "begin", "stage", expect.stringMatching(/^store:sources\/fixture\//), expect.stringMatching(/^source:sources\/fixture\//), "fail", "unlock"]);
  });

  it("preserves both the primary operation failure and lock-release failure", async () => {
    const { dependencies, provider, repository, events } = createHarness();
    const primary = new Error("provider failed");
    const release = new Error("unlock failed");
    vi.mocked(provider.stage).mockImplementation(async () => { events.push("stage"); throw primary; });
    vi.mocked(repository.withLock).mockImplementation(async (_provider, operation) => {
      events.push("lock");
      try {
        await operation();
      } catch (operationError) {
        events.push("unlock");
        throw new AggregateError([operationError, release], "Operation and lock release failed.", { cause: operationError });
      }
      return "ran";
    });

    const failure = await runSync(provider, { mode: "sync-once" }, dependencies).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([primary, release]);
    expect((failure as Error & { cause?: unknown }).cause).toBe(primary);
    expect(events).toEqual(["lock", "begin", "stage", "fail", "unlock"]);
  });

  it.each(["provider", "validation", "source-storage", "source-record", "download", "media-storage", "publication"] as const)("stops at the %s failure boundary, records failure, and releases last", async (failure) => {
    const { dependencies, provider, repository, store, events } = createHarness();
    const error = new Error(`${failure} failed`);
    if (failure === "provider") vi.mocked(provider.stage).mockImplementation(async () => { events.push("stage"); throw error; });
    if (failure === "validation") vi.mocked(dependencies.validate).mockImplementation(async () => { events.push("validate"); throw error; });
    if (failure === "source-storage" || failure === "media-storage") {
      vi.mocked(store.putImmutable).mockImplementation(async (object) => {
        events.push(`store:${object.key}`);
        if ((failure === "source-storage" && object.key.startsWith("sources/")) || (failure === "media-storage" && object.key.startsWith("media/"))) throw error;
        return "inserted";
      });
    }
    if (failure === "source-record") vi.mocked(repository.recordSource).mockImplementation(async (input) => { events.push(`source:${input.objectKey}`); throw error; });
    if (failure === "download") vi.mocked(dependencies.downloadMedia).mockImplementation(async (sourceUrl) => { events.push(`download:${sourceUrl}`); throw error; });
    if (failure === "publication") vi.mocked(repository.publish).mockImplementation(async () => { events.push("publish"); throw error; });

    await expect(runSync(provider, { mode: "sync-once" }, dependencies)).rejects.toBe(error);
    expect(repository.failRun).toHaveBeenCalledWith({ syncRunId: "run-1", error: `${failure} failed` });
    expect(repository.failRun).toHaveBeenCalledOnce();
    const normalizedEvents = events.map((event) => {
      if (event.startsWith("store:sources/")) return "store:source";
      if (event.startsWith("source:sources/")) return "record:source";
      if (event.startsWith("store:media/")) return "store:media";
      if (event.startsWith("download:")) return "download:media";
      return event;
    });
    const expectedEvents: Record<typeof failure, string[]> = {
      provider: ["lock", "begin", "stage", "fail", "unlock"],
      validation: ["lock", "begin", "stage", "validate", "fail", "unlock"],
      "source-storage": ["lock", "begin", "stage", "validate", "find-version", "store:source", "fail", "unlock"],
      "source-record": ["lock", "begin", "stage", "validate", "find-version", "store:source", "record:source", "fail", "unlock"],
      download: ["lock", "begin", "stage", "validate", "find-version", "store:source", "record:source", "download:media", "fail", "unlock"],
      "media-storage": ["lock", "begin", "stage", "validate", "find-version", "store:source", "record:source", "download:media", "store:media", "fail", "unlock"],
      publication: ["lock", "begin", "stage", "validate", "find-version", "store:source", "record:source", "download:media", "store:media", "publish", "fail", "unlock"],
    };
    expect(normalizedEvents).toEqual(expectedEvents[failure]);
    expect(repository.publish).toHaveBeenCalledTimes(failure === "publication" ? 1 : 0);
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
    expect(onError).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(handle.running).toBe(false));
    run.mockResolvedValueOnce(undefined);
    tick!();
    expect(run).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => expect(handle.running).toBe(false));
    expect(onError).toHaveBeenCalledOnce();
    handle.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("observes synchronous throws exactly once and permits the next tick", async () => {
    let tick: (() => void) | undefined;
    const run = vi.fn<() => Promise<void>>()
      .mockImplementationOnce(() => { throw new Error("sync throw"); })
      .mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const handle = scheduleSync({
      cron: "0 3 * * *",
      timezone: "UTC",
      run,
      onError,
      createSchedule: (_cron, _timezone, callback) => { tick = callback; return { stop: vi.fn() }; },
    });

    tick!();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "sync throw" }));
    expect(handle.running).toBe(false);
    tick!();
    expect(run).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(handle.running).toBe(false));
  });

  it("requires an error observer at construction", () => {
    expect(() => scheduleSync({
      cron: "0 3 * * *",
      timezone: "UTC",
      run: async () => undefined,
    } as Parameters<typeof scheduleSync>[0])).toThrow("onError");
  });

  it("validates cron and timezone before creating a schedule", () => {
    expect(() => scheduleSync({ cron: "not cron", timezone: "UTC", run: async () => undefined, onError: vi.fn() })).toThrow();
    expect(() => scheduleSync({ cron: "0 3 * * *", timezone: "Not/A_Zone", run: async () => undefined, onError: vi.fn() })).toThrow();
  });
});
