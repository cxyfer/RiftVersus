import { access, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const workspacePackages = ["contracts", "database", "domain", "sync"];
const declarationFile = (name) => name.endsWith(".d.ts") || name.endsWith(".d.cts") || name.endsWith(".d.mts");
const forbiddenFiles = (name) => declarationFile(name) || name.endsWith(".map") || name.endsWith(".tsbuildinfo") || /^tsconfig.*\.json$/u.test(name);

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function workspaceTargets(root) {
  const targets = [root];
  for (const name of workspacePackages) {
    const path = join(root, "node_modules", "@riftversus", name);
    if (await exists(path)) targets.push(await realpath(path));
  }
  return [...new Set(targets)];
}

async function walkFiles(root, visit) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await walkFiles(path, visit);
    else if (entry.isFile()) await visit(path, entry.name);
  }
}

export async function pruneRuntimeArtifact(root) {
  for (const target of await workspaceTargets(root)) {
    for (const directory of ["src", "test", "tests"]) await rm(join(target, directory), { recursive: true, force: true });
  }
  await walkFiles(root, async (path, name) => { if (forbiddenFiles(name)) await rm(path, { force: true }); });
  for (const target of (await workspaceTargets(root)).slice(1)) {
    await walkFiles(target, async (path, name) => { if (forbiddenFiles(name)) await rm(path, { force: true }); });
  }
}

export async function inspectRuntimeArtifact(root) {
  const blockers = [];
  const required = [
    [join(root, "dist", "cli.js"), "compiled server CLI"],
    [join(root, "dist", "acceptance-cli.js"), "compiled acceptance CLI"],
    [join(root, "node_modules", "@riftversus", "database", "dist", "migrations", "001_initial.js"), "compiled database migrations"],
  ];
  for (const [path, label] of required) if (!(await exists(path))) blockers.push(`Runtime artifact is missing ${label}.`);
  for (const target of await workspaceTargets(root)) {
    if (await exists(join(target, "src"))) blockers.push(`Runtime artifact retains source directory: ${target}/src.`);
    if (await exists(join(target, "test")) || await exists(join(target, "tests"))) blockers.push(`Runtime artifact retains test directory: ${target}.`);
  }
  const inspectFiles = async (target) => walkFiles(target, async (path, name) => {
    if (declarationFile(name)) blockers.push(`Runtime artifact retains declaration file: ${path}.`);
    else if (name.endsWith(".map")) blockers.push(`Runtime artifact retains source map: ${path}.`);
    else if (name.endsWith(".tsbuildinfo")) blockers.push(`Runtime artifact retains tsbuildinfo: ${path}.`);
    else if (/^tsconfig.*\.json$/u.test(name)) blockers.push(`Runtime artifact retains tsconfig: ${path}.`);
  });
  await inspectFiles(root);
  for (const target of (await workspaceTargets(root)).slice(1)) await inspectFiles(target);
  for (const dependency of ["typescript", "vitest", "eslint", "prettier"]) {
    if (await exists(join(root, "node_modules", dependency))) blockers.push(`Runtime artifact retains dev dependency ${dependency}.`);
  }
  return { blockers };
}

async function main() {
  const [command, root] = process.argv.slice(2);
  if (command !== "prune-and-check" || root === undefined) throw new Error("Usage: runtime-artifact.mjs prune-and-check PATH");
  await pruneRuntimeArtifact(root);
  const result = await inspectRuntimeArtifact(root);
  if (result.blockers.length > 0) throw new Error(result.blockers.join("\n"));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
}
