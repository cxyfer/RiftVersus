import type { Config } from "./config.js";

export interface ServerApplication {
  addHook(name: "onClose", hook: () => Promise<void>): unknown;
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface ListeningServerDependencies<Database> {
  createDb(): Database;
  buildApp(db: Database): ServerApplication;
  destroyDb(db: Database): Promise<void>;
}

export async function startListeningServer<Database>(config: Config, dependencies: ListeningServerDependencies<Database>) {
  const db = dependencies.createDb();
  let app: ServerApplication;
  try {
    app = dependencies.buildApp(db);
  } catch (error) {
    await dependencies.destroyDb(db);
    throw error;
  }
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
