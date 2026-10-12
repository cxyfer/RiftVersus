import { mkdir, readFile, cp, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { CheckpointManifestSchema } from "./checkpoint.js";
import { resolveLatestCheckpoint } from "./checkpoint-release.js";
import { guardPublication, guardPrivateArchive, readDeployedSite } from "./publish-github.js";
import { parsePublishPlan, publicBuildEnvironment, requiredPublishValue, type PublishEnvironment, type PublishPlan } from "./publish-plan.js";
import { createReleaseStore } from "./release-store.js";
import { listAttemptSummaries, MAX_ATTEMPT_UNCOMPRESSED_BYTES } from "./attempt-archive.js";

export type DataRunner = (args: readonly string[], env: PublishEnvironment) => Promise<unknown>;
export interface PublishOperations {
  guard(env: PublishEnvironment): Promise<void>;
  privateArchive(env: PublishEnvironment): Promise<void>;
  deployed(baseUrl: string, allowMissing: boolean): Promise<{ siteId: string } | null>;
  failures(baselineId: string, env: PublishEnvironment): Promise<number>;
  build(plan: PublishPlan, site: string, exported: string, env: PublishEnvironment): Promise<void>;
  smoke(plan: PublishPlan, site: string, env: PublishEnvironment): Promise<void>;
}

function execute(command: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.once("error", () => reject(new Error("Publication subprocess could not start.")));
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("Publication subprocess failed.")));
  });
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No preview port available.");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

export const productionPublishOperations: PublishOperations = {
  guard: guardPublication,
  privateArchive: guardPrivateArchive,
  deployed: readDeployedSite,
  async failures(baselineId, env) {
    const store = createReleaseStore({ repository: requiredPublishValue(env, "DATA_REPOSITORY"), token: requiredPublishValue(env, "RIFTVERSUS_DATA_TOKEN") });
    const attempts = await listAttemptSummaries(store, baselineId);
    return attempts.filter(attempt => ["migrate", "mapping", "sync", "sqlite-export", "acceptance", "checkpoint-pack", "checkpoint-publish"].includes(attempt.failedStage)).length;
  },
  async build(plan, site, exported, env) {
    await execute("pnpm", ["--filter", "@riftversus/web", "exec", "vite", "build", `--base=${plan.basePath}`, "--outDir", site], publicBuildEnvironment(env));
    for (const directory of ["data", "presentation"]) await cp(join(exported, directory), join(site, directory), { recursive: true, errorOnExist: true, force: false });
  },
  async smoke(plan, site, env) {
    const port = await unusedPort();
    const url = `http://127.0.0.1:${port}${plan.basePath}`;
    const clean = { ...publicBuildEnvironment(env), VITE_BASE_PATH: plan.basePath };
    const server = spawn("pnpm", ["--filter", "@riftversus/web", "exec", "vite", "preview", "--outDir", site, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env: clean, stdio: "ignore", detached: true });
    let startupFailed = false;
    server.once("error", () => { startupFailed = true; });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 60 && !startupFailed && server.exitCode === null; attempt += 1) {
        try { ready = (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Preview may still be starting. */ }
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!ready) throw new Error("Static preview did not become ready.");
      await execute("node", ["scripts/measure-static-sqlite.mjs", url, join(plan.directory, "browser-evidence")], clean);
      if (plan.mode !== "rollback") {
        await execute("node", ["scripts/measure-static-sqlite.mjs", url, join(plan.directory, "browser-evidence", "controlled"), "--profile=controlled", "--runs=10", "--enforce-performance"], clean);
      }
    } finally {
      if (server.pid !== undefined) {
        try { process.kill(-server.pid, "SIGTERM"); } catch { /* Already stopped. */ }
      }
    }
  },
};

export async function runPublication(env: PublishEnvironment, run: DataRunner, operations: PublishOperations = productionPublishOperations) {
  const plan = parsePublishPlan(env);
  await operations.guard(env);
  await operations.privateArchive(env);
  await mkdir(plan.directory, { recursive: false });
  const site = join(plan.directory, "site");
  const artifact = join(plan.directory, "deploy");
  const baseline = join(plan.directory, "baseline");
  const exported = join(plan.directory, "public");
  const previous = join(plan.directory, "previous-site");
  const candidate = join(plan.directory, "checkpoint");
  const local: PublishEnvironment = { ...env, CODE_SHA: plan.codeSha, PUBLIC_BASE_PATH: plan.basePath,
    OBJECT_STORE_DIR: join(plan.directory, "objects"), PUBLIC_SNAPSHOT_DIR: exported,
    PUBLISH_PRIVATE_DIAGNOSTICS: "true", PUBLISH_REQUIRE_COMPLETE: "true", SITE_ID: plan.siteId };
  let stage = "resolve-baseline";
  let restored = false;
  let baselineId: string | undefined;
  let checkpointPublished = false;
  try {
    if (plan.mode === "rollback") {
      stage = "download-site";
      await run(["site", "download", artifact], local);
      await operations.smoke(plan, artifact, local);
      await operations.guard(env);
    } else {
      const databaseUrl = requiredPublishValue(env, "DATABASE_URL");
      const restoreUrl = requiredPublishValue(env, "CHECKPOINT_RESTORE_DATABASE_URL");
      if (databaseUrl === restoreUrl) throw new Error("Checkpoint validation needs a separate empty database.");
      await run(["archive", "resolve", baseline], local);
      const manifest = CheckpointManifestSchema.parse(JSON.parse(await readFile(join(baseline, "manifest.json"), "utf8")));
      baselineId = manifest.id;
      const failures = await operations.failures(baselineId, env);
      const threshold = Number(env.SYNC_FAILURE_THRESHOLD || "3");
      if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 100) throw new Error("Invalid failure threshold.");
      if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,
        `Verified data attempts since ${baselineId}: ${failures}. Failure threshold: ${threshold}. ${failures >= threshold ? "Attention required; retry remains available." : "Below threshold."}\n`);
      local.CHECKPOINT_ID = `checkpoint-${manifest.sequence + 1}-${plan.runId}-${plan.runAttempt}`;
      local.CHECKPOINT_SEQUENCE = String(manifest.sequence + 1);
      local.CHECKPOINT_PARENT_ID = manifest.id;
      stage = "restore";
      await run(["checkpoint", "restore", baseline], local);
      restored = true;
      stage = "resolve-previous-site";
      const deployed = await operations.deployed(plan.baseUrl, plan.allowInitialSite);
      if (deployed !== null) {
        await run(["site", "download", previous], { ...local, SITE_ID: deployed.siteId });
        local.PREVIOUS_SITE_DIR = previous;
      }
      stage = "migrate";
      await run(["migrate"], local);
      if (plan.syncArgs !== null) {
        if (plan.mode !== "media") {
          stage = "mapping";
          await run(["sync-map-check"], local);
        }
        stage = "sync";
        await run(plan.syncArgs, local);
      }
      stage = "sqlite-export";
      await run(["snapshot", "export", exported], local);
      stage = "acceptance";
      await run(["acceptance"], local);
      if (plan.updatesCheckpoint) {
        stage = "checkpoint-pack";
        await run(["checkpoint", "pack", candidate], local);
        stage = "checkpoint-publish";
        await operations.guard(env);
        await run(["archive", "publish", candidate], local);
        checkpointPublished = true;
      } else local.CHECKPOINT_ID = baselineId;
      stage = "site-build";
      await operations.build(plan, site, exported, local);
      stage = "site-smoke";
      await operations.smoke(plan, site, local);
      stage = "site-publish";
      await operations.guard(env);
      await run(["site", "publish", site], local);
      stage = "site-download";
      await run(["site", "download", artifact], local);
      await operations.guard(env);
    }
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `artifact_dir=${artifact}\nsite_id=${plan.siteId}\nbase_url=${plan.baseUrl}\n`);
    return { artifact, siteId: plan.siteId, checkpointPublished };
  } catch {
    let evidence = "unavailable";
    if (restored) {
      try {
        const failureDirectory = join(plan.directory, "failed-checkpoint");
        const failureEnv = { ...local, CHECKPOINT_ID: `${local.CHECKPOINT_ID}-failed`, ATTEMPT_ID: `attempt-${plan.runId}-${plan.runAttempt}`,
          ATTEMPT_BASELINE_ID: baselineId, FAILED_STAGE: stage };
        await run(["checkpoint", "pack", failureDirectory], failureEnv);
        await run(["attempt", "publish", failureDirectory], failureEnv);
        evidence = "archived";
      } catch { /* Archive outages must not hide the original failed stage. */ }
    }
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `Publication failed at ${stage}. Attempt evidence: ${evidence}. Checkpoint published: ${checkpointPublished}.\n`);
    throw new Error(`Publication failed at ${stage}; attempt evidence ${evidence}; existing Pages deployment unchanged.`);
  }
}

export async function recordDeploymentFailure(env: PublishEnvironment, run: DataRunner, operations: PublishOperations = productionPublishOperations): Promise<void> {
  const plan = parsePublishPlan({ ...env, PUBLISH_MODE: "rebuild" });
  const stage = requiredPublishValue(env, "FAILED_STAGE");
  if (!["pages-upload", "pages-deploy", "pages-smoke"].includes(stage)) throw new Error("Invalid deployment failure stage.");
  await operations.privateArchive(env);
  if (env.ATTEMPT_PREFLIGHT_ONLY === "true") {
    const store = createReleaseStore({ repository: requiredPublishValue(env, "DATA_REPOSITORY"), token: requiredPublishValue(env, "RIFTVERSUS_DATA_TOKEN") });
    const latest = await resolveLatestCheckpoint(store);
    if (latest === null) throw new Error("No published checkpoint exists; explicit bootstrap is required.");
    const files = new Map<string, number>([["database.dump", latest.index.manifest.databaseDump.byteSize]]);
    for (const object of latest.index.manifest.objects) files.set(object.file, object.byteSize);
    const totalBytes = [...files.values()].reduce((total, value) => total + value, 0);
    if (totalBytes > MAX_ATTEMPT_UNCOMPRESSED_BYTES) {
      console.log(JSON.stringify({ status: "skipped", reason: "baseline checkpoint exceeds attempt archive limit", baselineCheckpointId: latest.index.manifest.id, totalBytes, limit: MAX_ATTEMPT_UNCOMPRESSED_BYTES, failedStage: stage }));
      return;
    }
  }
  await mkdir(plan.directory, { recursive: false });
  const baseline = join(plan.directory, "baseline");
  await run(["archive", "resolve", baseline], env);
  const manifest = CheckpointManifestSchema.parse(JSON.parse(await readFile(join(baseline, "manifest.json"), "utf8")));
  await run(["attempt", "publish", baseline], { ...env, CODE_SHA: plan.codeSha,
    ATTEMPT_ID: `attempt-${plan.runId}-${plan.runAttempt}`, ATTEMPT_BASELINE_ID: manifest.id, FAILED_STAGE: stage });
}
