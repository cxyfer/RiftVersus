import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

import { inspectRuntimeArtifact, pruneRuntimeArtifact } from "./runtime-artifact.mjs";

function run(command, args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit" });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} exceeded the ${timeoutMs}ms preflight timeout.`));
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? "unknown"}.`));
    });
  });
}

const root = await mkdtemp(join(tmpdir(), "riftversus-runtime-preflight-"));
try {
  await run("pnpm", ["build"]);
  await run("pnpm", ["--filter", "@riftversus/server", "deploy", "--prod", "--legacy", "--offline", root]);
  await pruneRuntimeArtifact(root);
  const result = await inspectRuntimeArtifact(root);
  if (result.blockers.length > 0) throw new Error(result.blockers.join("\n"));
  process.stdout.write("Static runtime artifact preflight passed. This does not replace Docker/container smoke tests or image-size evidence.\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
