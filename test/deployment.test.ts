import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

async function text(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8").catch(
    () => "",
  );
}

describe("container deployment contract", () => {
  it("builds one production-only non-root image with every runtime artifact", async () => {
    const dockerfile = await text("Dockerfile");

    expect(dockerfile).toContain("AS dependencies");
    expect(dockerfile).toContain("AS build");
    expect(dockerfile).toContain("AS production");
    expect(dockerfile).toMatch(/pnpm .*deploy .*--prod/u);
    expect(dockerfile).toMatch(/pnpm .*deploy .*--legacy/u);
    expect(dockerfile).toContain("runtime-artifact.mjs prune-and-check");
    expect(dockerfile).toContain("apps/web/dist");
    expect(dockerfile).toContain("data/acceptance");
    expect(dockerfile).toContain("data/fixtures");
    expect(dockerfile).toContain("data/overrides");
    expect(dockerfile).toContain("docs");
    expect(dockerfile).toContain("NODE_ENV=production");
    expect(dockerfile).toMatch(/USER (?:node|riftversus)/u);
    expect(dockerfile).not.toContain("packages/database/src/migrations");
    expect(dockerfile).not.toContain("packages/database/test");
    expect(dockerfile).not.toMatch(
      /(?:ARG|ENV)\s+(?:DATABASE_URL|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY)/u,
    );
  });

  it("keeps the static runtime deploy offline and bounded", async () => {
    const preflight = await text("scripts/static-runtime-preflight.mjs");
    expect(preflight).toMatch(/deploy[\s\S]*"--offline"/u);
    expect(preflight).toMatch(/timeoutMs/u);
    expect(preflight).toMatch(/SIGTERM/u);
  });

  it("uses the exact CLI exec entrypoint", async () => {
    const entrypoint = await text("docker/entrypoint.sh");
    expect(entrypoint).toBe(
      '#!/bin/sh\nset -eu\n\nexec node /app/apps/server/dist/cli.js "$@"\n',
    );
  });

  it("defines isolated app, sync, migrate, PostgreSQL, and MinIO services", async () => {
    const compose = parse(await text("compose.yaml")) as {
      services?: Record<string, Record<string, unknown>>;
      volumes?: Record<string, unknown>;
    } | null;
    const services = compose?.services ?? {};
    expect(Object.keys(services).sort()).toEqual([
      "app",
      "migrate",
      "minio",
      "postgres",
      "sync",
    ]);

    for (const name of ["app", "sync", "migrate"]) {
      expect(services[name]?.image).toBe(
        "${RIFTVERSUS_IMAGE:-riftversus:local}",
      );
      expect(services[name]).toHaveProperty("env_file");
      expect(services[name]).not.toHaveProperty("build.args");
    }
    expect(services.app?.command).toEqual(["serve"]);
    expect(services.sync?.command).toEqual(["sync"]);
    expect(services.migrate?.command).toEqual(["migrate"]);
    expect(services.app).toHaveProperty("healthcheck");
    expect(services.postgres).toHaveProperty("healthcheck");
    expect(services.minio).toHaveProperty("healthcheck");
    expect(services.app).toHaveProperty(
      "depends_on.migrate.condition",
      "service_completed_successfully",
    );
    expect(services.sync).toHaveProperty(
      "depends_on.postgres.condition",
      "service_healthy",
    );
    expect(services.sync).toHaveProperty(
      "depends_on.minio.condition",
      "service_healthy",
    );
    expect(services.sync).toHaveProperty(
      "depends_on.migrate.condition",
      "service_completed_successfully",
    );
    expect(services.postgres).not.toHaveProperty("ports");
    expect(services.minio).not.toHaveProperty("ports");
    expect(Object.keys(compose?.volumes ?? {}).sort()).toEqual([
      "minio-data",
      "postgres-data",
    ]);
  });

  it("keeps credentials and local build state out of the build context", async () => {
    const ignored = await text(".dockerignore");
    expect(ignored).toContain(".env");
    expect(ignored).toContain("node_modules");
    expect(ignored).toContain(".git");
    expect(ignored).toContain(".worktrees");
  });

  it("documents executable fixture and container-scoped backup commands", async () => {
    const operations = await text("docs/operations.md");
    expect(operations).toContain("docker compose run --rm sync sync --once --fixture leaguepedia-small");
    expect(operations).toContain("docker compose exec -T postgres sh -c 'pg_dump -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -Fc' > riftversus.dump");
    expect(operations).toContain("docker compose exec -T postgres sh -c 'pg_restore -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" --clean --if-exists' < riftversus.dump");
  });

  it("measures the unique Node app process behind the Compose init shim", async () => {
    const compose = parse(await text("compose.yaml")) as {
      services?: Record<string, Record<string, unknown>>;
    } | null;
    const operations = await text("docs/operations.md");

    expect(compose?.services?.app?.init).toBe(true);
    expect(operations).toContain("/proc/[0-9]*/cmdline");
    expect(operations).toContain(
      '"node /app/apps/server/dist/cli.js serve "*',
    );
    expect(operations).toContain('test "$found" -eq 1');
    expect(operations).not.toContain("/proc/1/status");
  });
});
