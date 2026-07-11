import { compareHeadToHead, createDb, destroyDb, getDatasetStatus, listAvailableFilters, searchEntities } from "@riftversus/database";
import { resolve } from "node:path";

import { buildApp } from "./app.js";
import type { Config } from "./config.js";
import type { AppDependencies } from "./types.js";

type DatabaseHandle = ReturnType<typeof createDb>;

export interface ServerApplication {
  addHook(name: "onClose", hook: () => Promise<void>): unknown;
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface ServerDependencies {
  createDb(options: { databaseUrl: string }): DatabaseHandle;
  destroyDb(db: DatabaseHandle): Promise<void>;
  buildApp(dependencies: AppDependencies): ServerApplication;
  cwd(): string;
}

const runtimeDependencies: ServerDependencies = {
  createDb,
  destroyDb,
  buildApp,
  cwd: () => process.cwd(),
};

export async function startServer(config: Config, dependencies: ServerDependencies = runtimeDependencies) {
  const db = dependencies.createDb({ databaseUrl: config.databaseUrl });
  const app = dependencies.buildApp({
    searchEntities: (query) => searchEntities(query, db),
    listFilters: () => listAvailableFilters(db),
    compare: (query) => compareHeadToHead(query, db),
    getDataset: async () => {
      const status = await getDatasetStatus(db);
      return status === null ? null : { version: status.version, lastSuccessfulSyncAt: status.lastSuccessfulSyncAt, coverage: status.coverage };
    },
    staticDir: resolve(dependencies.cwd(), "apps/web/dist"),
  });

  let released = false;
  const releaseDatabase = async () => {
    if (released) return;
    released = true;
    await dependencies.destroyDb(db);
  };
  app.addHook("onClose", releaseDatabase);

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    try {
      await app.close();
    } finally {
      await releaseDatabase();
    }
    throw error;
  }

  return app;
}
