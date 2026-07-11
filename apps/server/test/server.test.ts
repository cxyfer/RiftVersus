import { describe, expect, it, vi } from "vitest";

import type { Config } from "../src/config.js";
import { startServer } from "../src/server.js";

const config: Config = {
  databaseUrl: "postgresql://riftversus:password@localhost:5432/riftversus",
  host: "127.0.0.1",
  port: 3000,
  logLevel: "info",
  syncCron: "0 3 * * *",
  syncTimezone: "UTC",
  mediaDelivery: "proxy",
  s3: undefined,
};

function createDependencies(listen: () => Promise<unknown>) {
  const close = vi.fn(async () => undefined);
  let onClose: (() => Promise<void>) | undefined;
  const app = {
    addHook: vi.fn((_name: "onClose", hook: () => Promise<void>) => { onClose = hook; }),
    listen: vi.fn(listen),
    close,
  };
  const destroyDb = vi.fn(async () => undefined);
  return {
    dependencies: {
      createDb: vi.fn(() => ({ connection: "db" })),
      destroyDb,
      buildApp: vi.fn(() => app),
      cwd: () => "/workspace",
    },
    app,
    destroyDb,
    triggerClose: async () => onClose?.(),
  };
}

describe("startServer", () => {
  it("closes the app and database when listen fails", async () => {
    const setup = createDependencies(async () => { throw new Error("address in use"); });

    await expect(startServer(config, setup.dependencies)).rejects.toThrow("address in use");

    expect(setup.app.close).toHaveBeenCalledOnce();
    expect(setup.destroyDb).toHaveBeenCalledOnce();
  });

  it("releases the database when the started app closes", async () => {
    const setup = createDependencies(async () => undefined);

    const app = await startServer(config, setup.dependencies);
    await setup.triggerClose();

    expect(app).toBe(setup.app);
    expect(setup.app.close).not.toHaveBeenCalled();
    expect(setup.destroyDb).toHaveBeenCalledOnce();
  });
});
