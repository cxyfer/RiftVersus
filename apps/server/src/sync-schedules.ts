import { scheduleSync, type ObjectStore } from "@riftversus/sync";
import type { CommandDependencies } from "./cli.js";
import type { Config } from "./config.js";
import { historyRequests } from "./sync-plan.js";
import { buildLeaguepediaSlices } from "./sync-service.js";

export async function runHistory(config: Config, objectStore: ObjectStore, dependencies: CommandDependencies, stopping = () => false) {
  const errors: unknown[] = [];
  for (const request of historyRequests(config)) {
    if (stopping()) break;
    const started = Date.now();
    try {
      const result = await dependencies.execute({ config, objectStore, request, fixture: null });
      dependencies.log(JSON.stringify({ event: "sync_result", ...request, ...result, durationMs: Date.now() - started }));
      if (result.status === "locked") throw new Error("Historical sync skipped because the provider is locked.");
    } catch (error) {
      dependencies.log(JSON.stringify({ event: "sync_failed", ...request, durationMs: Date.now() - started }));
      dependencies.error(error);
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, `${errors.length} historical sync group(s) failed.`);
}

export async function runSchedules(config: Config, objectStore: ObjectStore, dependencies: CommandDependencies) {
  buildLeaguepediaSlices(config, { mode: "sync" });
  let running = false;
  let stopping = false;
  const guarded = async (mode: string, run: () => Promise<unknown>) => {
    if (running || stopping) {
      dependencies.log(JSON.stringify({ event: "sync_skipped", mode, reason: "busy" }));
      return;
    }
    running = true;
    const started = Date.now();
    dependencies.log(JSON.stringify({ event: "sync_started", mode }));
    try { await run(); }
    catch (error) {
      dependencies.log(JSON.stringify({ event: "sync_failed", mode, durationMs: Date.now() - started }));
      throw error;
    }
    finally { running = false; }
  };
  const handles: ReturnType<typeof scheduleSync>[] = [];
  try {
    // Validate and register history before the optional immediate current run.
    if (config.syncHistoryCron !== undefined) handles.push(dependencies.schedule({
      cron: config.syncHistoryCron, timezone: config.syncTimezone, onError: dependencies.error,
      run: () => guarded("backfill", () => runHistory(config, objectStore, dependencies, () => stopping)),
    }));
    handles.push(dependencies.schedule({
      cron: config.syncCron, timezone: config.syncTimezone, onError: dependencies.error, runOnStart: config.syncRunOnStart,
      run: () => guarded("sync", async () => {
        const started = Date.now();
        const result = await dependencies.execute({ config, objectStore, request: { mode: "sync" }, fixture: null });
        dependencies.log(JSON.stringify({ event: "sync_result", mode: "sync", ...result, durationMs: Date.now() - started }));
      }),
    }));
    dependencies.log(JSON.stringify({ event: "sync_scheduled", cron: config.syncCron, historyCron: config.syncHistoryCron ?? null, timezone: config.syncTimezone }));
    await dependencies.waitForShutdown();
  } finally {
    stopping = true;
    for (const handle of handles) handle.stop();
    while (running || handles.some((handle) => handle.running)) await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
