import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
};

type Workflow = {
  name?: string;
  on?: {
    pull_request?: unknown;
    push?: { branches?: string[] };
  };
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    env?: Record<string, string>;
    services?: Record<string, {
      image?: string;
      env?: Record<string, string>;
    }>;
    steps?: Step[];
  }>;
};

async function loadWorkflow(): Promise<{ workflow: Workflow; source: string }> {
  const source = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  return { workflow: parse(source) as Workflow, source };
}

function steps(workflow: Workflow): Step[] {
  return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

function stepIndex(workflow: Workflow, name: string): number {
  return steps(workflow).findIndex((step) => step.name === name);
}

describe("GitHub CI workflow", () => {
  it("runs only with read access and a disposable local database", async () => {
    const { workflow, source } = await loadWorkflow();
    const job = workflow.jobs?.verify;

    expect(workflow.name).toBe("CI");
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on?.push?.branches).toEqual(["main"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job?.services?.postgres?.image).toBe("postgres:17");
    expect(job?.env?.TEST_DATABASE_URL).toBe(
      "postgresql://postgres:postgres@127.0.0.1:5432/riftversus_test",
    );
    expect(job?.env?.CHECKPOINT_TEST_SOURCE_DATABASE_URL).toBe(
      "postgresql://postgres:postgres@127.0.0.1:5432/riftversus_checkpoint_source",
    );
    expect(job?.env?.CHECKPOINT_TEST_TARGET_DATABASE_URL).toBe(
      "postgresql://postgres:postgres@127.0.0.1:5432/riftversus_checkpoint_target",
    );

    expect(source).not.toMatch(/pull_request_target|workflow_run|secrets\.|RIFTVERSUS_DATA_TOKEN|DATA_REPOSITORY/u);
    expect(source).not.toMatch(/docker compose|docker run|test:e2e:release/u);
  });

  it("pins every third-party action to an official commit", async () => {
    const { workflow } = await loadWorkflow();
    const actionRefs = steps(workflow)
      .map((step) => step.uses)
      .filter((value): value is string => value !== undefined);

    expect(actionRefs).toEqual(expect.arrayContaining([
      "actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd",
      "pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa",
      "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
    ]));
    expect(actionRefs.every((ref) => /^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/u.test(ref))).toBe(true);
    expect(actionRefs.every((ref) => /^(?:actions\/checkout|actions\/setup-node|pnpm\/action-setup)@/u.test(ref))).toBe(true);
  });

  it("keeps the required locked build, verification, integration, and E2E gates", async () => {
    const { workflow } = await loadWorkflow();
    const job = workflow.jobs?.verify;
    const commands = steps(workflow).map((step) => step.run ?? "").join("\n");

    expect(job).toMatchObject({
      env: { TEST_DATABASE_URL: expect.any(String) },
    });
    expect(commands).toContain("pnpm install --frozen-lockfile");
    expect(commands).toContain("postgresql-client-17");
    expect(commands).toContain("https://apt.postgresql.org/pub/repos/apt");
    expect(commands).toContain("https://www.postgresql.org/media/keys/ACCC4CF8.asc");
    expect(commands).toContain('echo "/usr/lib/postgresql/17/bin" >> "$GITHUB_PATH"');
    expect(commands).toContain("pg_dump --version");
    expect(commands).toContain("pg_restore --version");
    expect(commands).toContain("PostgreSQL\\) 17\\.");
    expect(commands).toContain("pnpm build");
    expect(commands).toContain("pnpm typecheck");
    expect(commands).toContain("pnpm lint");
    expect(commands).toContain("pnpm test");
    expect(commands).toContain("pnpm --filter @riftversus/web exec playwright install --with-deps chromium");
    expect(commands).toContain("CREATE DATABASE riftversus_checkpoint_source");
    expect(commands).toContain("CREATE DATABASE riftversus_checkpoint_target");
    expect(commands).toContain("pnpm exec vitest run --config vitest.integration.config.ts");
    expect(commands).toContain("pnpm --filter @riftversus/web build");
    expect(commands).toContain("pnpm test:e2e");
    expect(stepIndex(workflow, "Install PostgreSQL 17 client tools")).toBeGreaterThanOrEqual(0);
    expect(stepIndex(workflow, "Install PostgreSQL 17 client tools")).toBeLessThan(
      stepIndex(workflow, "Run PostgreSQL 17 integration suites"),
    );
  });

  it("runs production Playwright against the explicit synthetic SQLite fixture", async () => {
    const { source: workflowSource } = await loadWorkflow();
    const playwrightSource = await readFile(new URL("../apps/web/playwright.config.ts", import.meta.url), "utf8");

    expect(workflowSource).toContain("Run production static SQLite E2E with synthetic fixture");
    expect(workflowSource).toContain("VITE_BASE_PATH: /RiftVersus/");
    expect(workflowSource).not.toContain("RIFTVERSUS_PREVIEW");
    expect(playwrightSource).toContain('testDir: "./e2e"');
    expect(playwrightSource).toContain("node ../../scripts/build-static-fixture.mjs");
    expect(playwrightSource).toContain("VITE_BASE_PATH=/RiftVersus/ pnpm vite build");
    expect(playwrightSource).toContain("VITE_BASE_PATH=/RiftVersus/ pnpm vite preview");
    expect(playwrightSource).not.toContain("RIFTVERSUS_PREVIEW");
    expect(playwrightSource).not.toContain("playwright.release.config.ts");
  });
});
