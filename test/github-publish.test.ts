import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string>; if?: string; with?: Record<string, unknown> };
type Job = { if?: string; needs?: string; permissions?: Record<string, string>; steps: Step[]; environment?: { name: string } };
type Workflow = { on: { schedule: Array<{ cron: string }>; workflow_dispatch: { inputs: Record<string, unknown> } }; concurrency: { group: string; "cancel-in-progress": boolean }; jobs: Record<string, Job> };

async function workflow() {
  const source = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
  return { source, workflow: parse(source) as Workflow };
}

describe("single-writer SQLite publishing workflow", () => {
  it("uses one workflow lock across preparation, deployment and rollback with opt-in activation", async () => {
    const { workflow: w, source } = await workflow();
    expect(w.concurrency["cancel-in-progress"]).toBe(false);
    expect(w.concurrency.group).toContain("github.event.repository.default_branch");
    expect(w.concurrency.group).toContain("'riftversus-publication'");
    expect(w.concurrency.group).toContain("'riftversus-nonpublication-{0}'");
    expect(w.jobs.prepare!.if).toContain("vars.PUBLISH_ENABLED == 'true'");
    expect(w.jobs.prepare!.if).toContain("github.event.repository.default_branch");
    expect(w.jobs.deploy!.needs).toBe("prepare");
    expect(w.on.schedule.map(schedule => schedule.cron)).toEqual(["17 19 * * *", "47 20 * * 6"]);
    expect(Object.keys(w.on.workflow_dispatch.inputs)).toEqual(["mode", "year", "competition", "site_id", "initial_site"]);
    expect(source).not.toMatch(/pull_request_target|workflow_run|cancel-in-progress: true/u);
  });

  it("restricts archive secrets to trusted publication/failure steps and pins actions", async () => {
    const { workflow: w } = await workflow();
    expect(w.jobs.prepare!.permissions).toEqual({ contents: "read", pages: "read" });
    expect(w.jobs.deploy!.permissions).toEqual({ contents: "read", pages: "write", "id-token": "write" });
    expect(w.jobs.deploy!.environment?.name).toBe("github-pages");
    for (const job of Object.values(w.jobs)) for (const step of job.steps) {
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/u);
      if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"]).toBe(false);
      if (step.env?.RIFTVERSUS_DATA_TOKEN) expect(step.run).toMatch(/^pnpm data publish (prepare|record-deploy-failure)$/u);
      expect(step.run ?? "").not.toMatch(/\$\{\{\s*(?:inputs|github\.event\.inputs)\./u);
    }
  });

  it("deploys only the verified downloaded artifact and rechecks SHA immediately before deployment", async () => {
    const { workflow: w } = await workflow();
    const upload = w.jobs.prepare!.steps.find(step => step.uses?.startsWith("actions/upload-pages-artifact@"));
    expect(upload?.with?.path).toBe("${{ steps.prepare.outputs.artifact_dir }}");
    const deployIndex = w.jobs.deploy!.steps.findIndex(step => step.uses?.startsWith("actions/deploy-pages@"));
    expect(w.jobs.deploy!.steps[deployIndex - 1]?.run).toBe("pnpm data publish guard");
    expect(w.jobs.deploy!.steps[deployIndex + 1]?.run).toContain("pnpm data publish verify-deployed");
    expect(w.jobs.deploy!.steps[deployIndex + 1]?.run).toContain("scripts/measure-static-sqlite.mjs");
  });

  it("records upload, deployment and post-deploy smoke failures without checkpoint rewind", async () => {
    const { workflow: w, source } = await workflow();
    const uploadFailure = w.jobs.prepare!.steps.find(step => step.env?.FAILED_STAGE === "pages-upload");
    expect(uploadFailure?.if).toBe("failure() && steps.prepare.outcome == 'success'");
    const failure = w.jobs.deploy!.steps.at(-1)!;
    expect(failure.if).toBe("failure()");
    expect(failure.env?.FAILED_STAGE).toContain("'pages-smoke' || 'pages-deploy'");
    expect(failure.run).toBe("pnpm data publish record-deploy-failure");
    expect(source).not.toMatch(/release delete|git reset|docker compose down|--volumes/u);
  });
});
