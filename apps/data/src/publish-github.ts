import { SiteManifestSchema } from "./site-bundle.js";
import { requiredPublishValue, type PublishEnvironment } from "./publish-plan.js";

function validRepository(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every(part => /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/u.test(part));
}
async function githubJson(path: string, token: string, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  const response = await fetcher(`https://api.github.com/repos/${path}`, { redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (!response.ok) throw new Error(`GitHub publication preflight failed (${response.status}).`);
  return await response.json() as Record<string, unknown>;
}

export async function guardPublication(env: PublishEnvironment, fetcher: typeof fetch = fetch): Promise<void> {
  const repository = requiredPublishValue(env, "GITHUB_REPOSITORY");
  const token = requiredPublishValue(env, "GITHUB_TOKEN");
  if (!validRepository(repository)) throw new Error("Invalid website repository.");
  const metadata = await githubJson(repository, token, fetcher);
  const branch = metadata.default_branch;
  if (typeof branch !== "string" || env.GITHUB_REF !== `refs/heads/${branch}`) throw new Error("Publication must run on the default branch.");
  const head = await githubJson(`${repository}/commits/${encodeURIComponent(branch)}`, token, fetcher);
  if (head.sha !== requiredPublishValue(env, "GITHUB_SHA")) throw new Error("Stale code revision cannot promote a publication.");
}

export async function guardPrivateArchive(env: PublishEnvironment, fetcher: typeof fetch = fetch): Promise<void> {
  const repository = requiredPublishValue(env, "DATA_REPOSITORY");
  if (!validRepository(repository) || repository.toLowerCase() === env.GITHUB_REPOSITORY?.toLowerCase()) throw new Error("A separate private archive repository is required.");
  const metadata = await githubJson(repository, requiredPublishValue(env, "RIFTVERSUS_DATA_TOKEN"), fetcher);
  if (metadata.private !== true) throw new Error("Raw checkpoints and attempts require a private archive repository.");
}

export async function readDeployedSite(baseUrl: string, allowMissing: boolean, fetcher: typeof fetch = fetch) {
  const response = await fetcher(new URL("site-manifest.json", baseUrl), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (response.status === 404 && allowMissing) return null;
  if (!response.ok) throw new Error(`Deployed site manifest unavailable (${response.status}); initial deployment must be explicit.`);
  return SiteManifestSchema.parse(await response.json());
}
