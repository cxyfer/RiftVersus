import { isAbsolute, resolve } from "node:path";

export type PublishMode = "current" | "history" | "backfill" | "reexport" | "rebuild" | "rollback";
export type PublishEnvironment = Record<string, string | undefined>;
export function requiredPublishValue(env: PublishEnvironment, name: string): string {
  const value = env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value;
}

export function parsePublishPlan(env: PublishEnvironment) {
  const mode = requiredPublishValue(env, "PUBLISH_MODE") as PublishMode;
  if (!["current", "history", "backfill", "reexport", "rebuild", "rollback"].includes(mode)) throw new Error("Unsupported publication mode.");
  const runId = requiredPublishValue(env, "GITHUB_RUN_ID");
  const runAttempt = requiredPublishValue(env, "GITHUB_RUN_ATTEMPT");
  if (!/^\d+$/u.test(runId) || !/^[1-9]\d*$/u.test(runAttempt)) throw new Error("Publication requires numeric GitHub run identity.");
  const codeSha = requiredPublishValue(env, "GITHUB_SHA");
  if (!/^[a-f0-9]{40}$/u.test(codeSha)) throw new Error("Publication requires a full code SHA.");
  const baseUrl = new URL(requiredPublishValue(env, "PAGES_BASE_URL"));
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash
    || !/^\/(?:[A-Za-z0-9_-]+\/?)?$/u.test(baseUrl.pathname)) throw new Error("Pages URL must be a clean HTTPS root or project path.");
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/u, "")}/`;
  const directory = requiredPublishValue(env, "PUBLISH_WORKDIR");
  if (!isAbsolute(directory) || /[\r\n]/u.test(directory)) throw new Error("PUBLISH_WORKDIR must be absolute and not already exist.");
  const siteId = mode === "rollback" ? requiredPublishValue(env, "ROLLBACK_SITE_ID") : `site-${runId}-${runAttempt}`;
  if (!/^site-[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(siteId)) throw new Error("Invalid explicit site ID.");
  let syncArgs: string[] | null = null;
  if (mode === "current") {
    if (requiredPublishValue(env, "LEAGUEPEDIA_SYNC_YEARS") !== String(new Date().getUTCFullYear())) throw new Error("Current mode requires the explicitly reviewed current UTC year.");
    syncArgs = ["sync", "--once"];
  }
  if (mode === "history") syncArgs = ["sync", "--history-once"];
  if (mode === "backfill") {
    const year = requiredPublishValue(env, "BACKFILL_YEAR");
    const competition = requiredPublishValue(env, "BACKFILL_COMPETITION");
    if (!/^\d{4}$/u.test(year) || Number(year) < 2011 || Number(year) > 2100 || !/^[A-Za-z0-9 _-]{1,80}$/u.test(competition)) throw new Error("Backfill requires one bounded year and competition.");
    syncArgs = ["backfill", "--year", year, "--competition", competition];
  }
  if (![undefined, "", "true", "false"].includes(env.ALLOW_INITIAL_SITE)) throw new Error("ALLOW_INITIAL_SITE must be boolean.");
  return { mode, codeSha, runId, runAttempt, siteId, syncArgs, directory: resolve(directory),
    baseUrl: baseUrl.toString(), basePath: baseUrl.pathname, allowInitialSite: env.ALLOW_INITIAL_SITE === "true",
    updatesCheckpoint: mode !== "rebuild" && mode !== "rollback" };
}
export type PublishPlan = ReturnType<typeof parsePublishPlan>;

export function publicBuildEnvironment(env: PublishEnvironment): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "CI", "LANG", "LC_ALL", "PNPM_HOME", "COREPACK_HOME", "PLAYWRIGHT_BROWSERS_PATH"]) {
    if (env[name] !== undefined) result[name] = env[name]!;
  }
  return result;
}
