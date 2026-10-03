import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePublishPlan, publicBuildEnvironment } from "../src/publish-plan.js";
import { guardPrivateArchive, guardPublication, readDeployedSite } from "../src/publish-github.js";
import { runPublication, recordDeploymentFailure, type PublishOperations } from "../src/publish-run.js";
import { requireCompleteCoverage } from "../src/sync-service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const sha = "a".repeat(40);
const defaults = { PUBLISH_MODE: "current", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: sha,
  GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "owner/site", GITHUB_TOKEN: "website-secret",
  DATA_REPOSITORY: "owner/archive", RIFTVERSUS_DATA_TOKEN: "archive-secret", PAGES_BASE_URL: "https://owner.github.io/site",
  LEAGUEPEDIA_SYNC_YEARS: String(new Date().getUTCFullYear()),
  DATABASE_URL: "postgresql://localhost/candidate", CHECKPOINT_RESTORE_DATABASE_URL: "postgresql://localhost/validation",
  PUBLISH_WORKDIR: "/tmp/not-created" };

async function harness(fail?: string, mode = "current") {
  const root = await mkdtemp(join(tmpdir(), "publication-test-")); roots.push(root);
  const events: string[] = [];
  const calls: Array<{ args: readonly string[]; env: Record<string, string | undefined> }> = [];
  const env = { ...defaults, PUBLISH_MODE: mode, PUBLISH_WORKDIR: join(root, "work"),
    GITHUB_OUTPUT: join(root, "output"), GITHUB_STEP_SUMMARY: join(root, "summary") };
  const operations: PublishOperations = {
    guard: vi.fn(async () => { events.push("guard"); }),
    privateArchive: vi.fn(async () => { events.push("private"); }),
    deployed: vi.fn(async () => ({ siteId: "site-previous" })),
    failures: vi.fn(async () => 0),
    build: vi.fn(async () => { events.push("build"); if (fail === "build") throw new Error("private-secret"); }),
    smoke: vi.fn(async () => { events.push("smoke"); if (fail === "smoke") throw new Error("private-secret"); }),
  };
  const run = vi.fn(async (args: readonly string[], local: Record<string, string | undefined>) => {
    const label = args.slice(0, 2).join(" "); events.push(label); calls.push({ args, env: { ...local } });
    if (label === fail) throw new Error("private-secret");
    if (label === "archive resolve") {
      await mkdir(args[2]!);
      await writeFile(join(args[2]!, "manifest.json"), JSON.stringify({ checkpointSchemaVersion: 1, id: "checkpoint-7", parent: "checkpoint-6", sequence: 7,
        codeSha: sha, postgresMajor: 17, databaseDump: { file: "database.dump", checksum: "b".repeat(64), byteSize: 1 }, objects: [] }));
    }
  });
  return { root, events, calls, env, operations, run };
}

describe("publication policy", () => {
  it("validates modes, paths, explicit rollback, and bounded backfill", () => {
    expect(parsePublishPlan(defaults)).toMatchObject({ mode: "current", siteId: "site-123-1", syncArgs: ["sync", "--once"], basePath: "/site/" });
    expect(parsePublishPlan({ ...defaults, PUBLISH_MODE: "history" }).syncArgs).toEqual(["sync", "--history-once"]);
    expect(parsePublishPlan({ ...defaults, PUBLISH_MODE: "backfill", BACKFILL_YEAR: "2024", BACKFILL_COMPETITION: "Worlds" }).syncArgs).toEqual(["backfill", "--year", "2024", "--competition", "Worlds"]);
    for (const change of [{ PUBLISH_MODE: "delete" }, { PUBLISH_MODE: "rollback" }, { PUBLISH_MODE: "backfill", BACKFILL_YEAR: "2024;echo", BACKFILL_COMPETITION: "Worlds" },
      { PUBLISH_WORKDIR: "/tmp/foo\ninjected=output" }, { PAGES_BASE_URL: "https://secret@example.com/" }, { GITHUB_SHA: "main" }, { GITHUB_RUN_ATTEMPT: "0" }]) {
      expect(() => parsePublishPlan({ ...defaults, ...change })).toThrow();
    }
    expect(() => parsePublishPlan({ ...defaults, LEAGUEPEDIA_SYNC_YEARS: "2023,2024" })).toThrow("current UTC year");
  });

  it("does not pass secrets, DB, npm tokens or NODE_OPTIONS to public subprocesses", () => {
    expect(publicBuildEnvironment({ ...defaults, PATH: "/bin", HOME: "/home/runner", NODE_OPTIONS: "--require malicious", NPM_TOKEN: "secret", VITE_TOKEN: "secret" }))
      .toEqual({ PATH: "/bin", HOME: "/home/runner" });
  });

  it("rejects partial requested coverage instead of promoting a partial run", () => {
    expect(() => requireCompleteCoverage([{ status: "complete" }])).not.toThrow();
    for (const coverage of [[], [{ status: "partial" }], [{ status: "complete" }, { status: "missing" }]]) expect(() => requireCompleteCoverage(coverage)).toThrow();
  });

  it("checks current branch SHA and private archive without following redirects", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { void url; void init; return Response.json({ default_branch: "main", sha, private: true }); });
    await guardPublication(defaults, fetcher);
    await guardPrivateArchive(defaults, fetcher);
    expect(fetcher.mock.calls.every(call => call[1]?.redirect === "error")).toBe(true);
    await expect(guardPublication({ ...defaults, GITHUB_REF: "refs/heads/topic" }, fetcher)).rejects.toThrow("default branch");
    await expect(guardPublication({ ...defaults, GITHUB_SHA: "b".repeat(40) }, fetcher)).rejects.toThrow("Stale");
    await expect(guardPrivateArchive(defaults, async () => Response.json({ private: false }))).rejects.toThrow("private");
    await expect(guardPrivateArchive({ ...defaults, DATA_REPOSITORY: "OWNER/SITE" }, fetcher)).rejects.toThrow("separate");
    await expect(guardPrivateArchive({ ...defaults, DATA_REPOSITORY: "../archive" }, fetcher)).rejects.toThrow("separate");
  });

  it("requires explicit initial site deployment and does not hide server failures", async () => {
    const missing = async () => new Response(null, { status: 404 });
    await expect(readDeployedSite(defaults.PAGES_BASE_URL, true, missing)).resolves.toBeNull();
    await expect(readDeployedSite(defaults.PAGES_BASE_URL, false, missing)).rejects.toThrow();
    await expect(readDeployedSite(defaults.PAGES_BASE_URL, true, async () => new Response(null, { status: 500 }))).rejects.toThrow();
  });
});

describe("publication stage ordering", () => {
  it("archives post-deploy diagnostics from the durable baseline without restoring a database", async () => {
    const h = await harness();
    await recordDeploymentFailure({ ...h.env, FAILED_STAGE: "pages-smoke" }, h.run, h.operations);
    expect(h.events).toEqual(["private", "archive resolve", "attempt publish"]);
    expect(h.calls.at(-1)?.env).toMatchObject({ FAILED_STAGE: "pages-smoke", ATTEMPT_BASELINE_ID: "checkpoint-7" });
  });

  it("reports persisted data failures while leaving a successful retry available", async () => {
    const h = await harness();
    h.operations.failures = vi.fn(async () => 3);
    await runPublication(h.env, h.run, h.operations);
    expect(await readFile(h.env.GITHUB_STEP_SUMMARY, "utf8")).toContain("Attention required; retry remains available.");
  });
  it("restores, validates SQLite, archives data, tests site, then downloads the verified artifact", async () => {
    const h = await harness();
    const result = await runPublication(h.env, h.run, h.operations);
    expect(h.events).toEqual(["guard", "private", "archive resolve", "checkpoint restore", "site download", "migrate", "sync-map-check", "sync --once",
      "snapshot export", "acceptance", "checkpoint pack", "guard", "archive publish", "build", "smoke", "guard", "site publish", "site download", "guard"]);
    expect(result.checkpointPublished).toBe(true);
    const archived = h.calls.find(call => call.args[0] === "archive" && call.args[1] === "publish")!;
    expect(archived.env).toMatchObject({ CHECKPOINT_ID: "checkpoint-8-123-1", CHECKPOINT_SEQUENCE: "8", CHECKPOINT_PARENT_ID: "checkpoint-7", PUBLISH_REQUIRE_COMPLETE: "true" });
    expect(await readFile(h.env.GITHUB_OUTPUT, "utf8")).toContain("site_id=site-123-1");
  });

  it.each(["sync --once", "acceptance", "archive publish", "build", "smoke", "site publish"])("archives forensic evidence when %s fails without deploying", async fail => {
    const h = await harness(fail);
    await expect(runPublication(h.env, h.run, h.operations)).rejects.toThrow(/attempt evidence archived/);
    expect(h.events.at(-1)).toBe("attempt publish");
    expect(h.calls.at(-1)?.env).toMatchObject({ ATTEMPT_ID: "attempt-123-1", ATTEMPT_BASELINE_ID: "checkpoint-7" });
    expect(await readFile(h.env.GITHUB_STEP_SUMMARY, "utf8")).not.toContain("private-secret");
    await expect(readFile(h.env.GITHUB_OUTPUT)).rejects.toThrow();
    if (["sync --once", "acceptance"].includes(fail)) expect(h.events).not.toContain("archive publish");
  });

  it("reports unavailable evidence when archive transport also fails", async () => {
    const h = await harness("sync --once");
    const runner = async (args: readonly string[], env: Record<string, string | undefined>) => {
      if (args[0] === "attempt") throw new Error("secret-token");
      return h.run(args, env);
    };
    await expect(runPublication(h.env, runner, h.operations)).rejects.toThrow("attempt evidence unavailable");
  });

  it("migrates restored tooling before rebuilding without changing checkpoint lineage", async () => {
    const h = await harness(undefined, "rebuild");
    await runPublication(h.env, h.run, h.operations);
    expect(h.events.indexOf("migrate")).toBeLessThan(h.events.indexOf("snapshot export"));
    expect(h.events).not.toContain("archive publish");
    expect(h.calls.find(call => call.args[0] === "site" && call.args[1] === "publish")?.env.CHECKPOINT_ID).toBe("checkpoint-7");
  });

  it("archives a rejected rebuild without publishing a site or advancing its checkpoint", async () => {
    const h = await harness("smoke", "rebuild");
    await expect(runPublication(h.env, h.run, h.operations)).rejects.toThrow("site-smoke");
    expect(h.events).not.toContain("archive publish");
    expect(h.events).not.toContain("site publish");
    expect(h.calls.at(-1)?.env).toMatchObject({ FAILED_STAGE: "site-smoke", ATTEMPT_BASELINE_ID: "checkpoint-7" });
    await expect(readFile(h.env.GITHUB_OUTPUT)).rejects.toThrow();
  });

  it("rolls back only the explicit site, never restoring or rewriting the database", async () => {
    const h = await harness(undefined, "rollback");
    await runPublication({ ...h.env, ROLLBACK_SITE_ID: "site-old" }, h.run, h.operations);
    expect(h.events).toEqual(["guard", "private", "site download", "smoke", "guard"]);
    expect(h.calls[0]?.env.SITE_ID).toBe("site-old");
  });

  it("stops stale revision promotion and leaves the validated data unpublished", async () => {
    const h = await harness();
    let checks = 0;
    h.operations.guard = async () => { if (++checks > 1) throw new Error("Stale revision"); };
    await expect(runPublication(h.env, h.run, h.operations)).rejects.toThrow();
    expect(h.events).not.toContain("archive publish");
    expect(h.events).not.toContain("site publish");
  });
});
