/* global process, Response, console, URL */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDb, exportSnapshotFacts } from "../packages/database/dist/index.js";
import { LeaguepediaClient, selectPlayerProfiles } from "../packages/sync/dist/providers/leaguepedia/index.js";

const execute = promisify(execFile);
const directory = resolve(process.argv[2] ?? "");
if (!process.argv[2] || !process.env.DATABASE_URL) throw new Error("Usage: DATABASE_URL=... node scripts/audit-leaguepedia-media.mjs OUTPUT_DIRECTORY");
await mkdir(directory, { recursive: true });
const sha = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const doh = process.env.MEDIA_AUDIT_DOH_URL;
const curl = ["--silent", "--show-error", "--fail", "--connect-timeout", "10", "--max-time", "40", ...(doh ? ["--doh-url", doh] : [])];
const userAgent = "RiftVersus/1.0 media-review (+https://github.com/cxyfer/RiftVersus)";
async function cachedFetch(url) {
  const path = join(directory, `api-${sha(String(url))}.json`);
  let body;
  try { body = await readFile(path, "utf8"); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    body = (await execute("curl", [...curl, "--user-agent", userAgent, String(url)], { maxBuffer: 5_000_000 })).stdout;
    JSON.parse(body);
    await writeFile(path, body);
  }
  return new Response(body, { headers: { "content-type": "application/json" } });
}
const client = new LeaguepediaClient({ endpoint: "https://lol.fandom.com/api.php", userAgent, fetch: cachedFetch });
const db = createDb({ databaseUrl: process.env.DATABASE_URL });
const candidates = [];
const issues = [];
try {
  const projection = await exportSnapshotFacts(db);
  const published = new Map(projection.entities.filter(item => item.teamEraId === undefined && item.kind !== "region").map(item => [item.id, item]));
  const aliases = await db.selectFrom("entity_aliases").select(["entity_id", "source_key"]).where("provider", "=", "leaguepedia").execute();
  const playerSources = aliases.filter(item => published.get(item.entity_id)?.kind === "player" && !item.source_key.includes(":alias:"));
  const uniquePages = [...new Set(playerSources.map(item => item.source_key))].sort();
  const rows = [];
  for (let start = 0; start < uniquePages.length; start += 50) {
    for (let offset = 0, page = 0; page < 100; page++) {
      const result = await client.fetchPlayerImagesPage({ playerPages: uniquePages.slice(start, start + 50), offset });
      rows.push(...result.rows);
      if (result.rows.length < 500) break;
      offset += result.rows.length;
      if (page === 99) throw new Error("Player media audit traversal exceeded its bound.");
    }
    console.log(`Player source audit: ${Math.min(start + 50, uniquePages.length)}/${uniquePages.length}`);
  }
  const redirects = [...new Map(rows.map(item => [JSON.stringify([item.PlayerPage, item.PlayerRedirect]), { OverviewPage: item.PlayerPage, AllName: item.PlayerRedirect }])).values()];
  const profiles = selectPlayerProfiles(rows, redirects);
  for (const [id, entity] of published) if (entity.kind === "player") {
    const matches = playerSources.filter(item => item.entity_id === id).flatMap(item => profiles.has(item.source_key) ? [{ title: profiles.get(item.source_key), sourceKey: item.source_key }] : []);
    if (matches.length !== 1) { issues.push({ kind: "player", id, name: entity.displayName, reason: matches.length ? "ambiguous source pages" : "no profile image" }); continue; }
    candidates.push({ title: matches[0].title, owner: { id, kind: "player", sourceKey: matches[0].sourceKey } });
  }
  const teams = [];
  for (let offset = 0, page = 0; page < 100; page++) {
    const result = await client.fetchTeamsPage({ offset });
    teams.push(...result.rows);
    if (result.rows.length < 500) break;
    offset += result.rows.length;
    if (page === 99) throw new Error("Team media audit traversal exceeded its bound.");
  }
  for (const entity of projection.entities.filter(item => item.kind === "team")) {
    const name = entity.teamEraId === undefined ? entity.canonicalName : entity.eraLabel;
    const matches = teams.filter(item => (item.OverviewPage === name || item.Name === name) && typeof item.Image === "string" && item.Image.trim()
      && aliases.some(alias => alias.entity_id === entity.id && alias.source_key === item.OverviewPage));
    if (matches.length !== 1) { issues.push({ kind: entity.teamEraId ? "team-era" : "team", id: entity.teamEraId ?? entity.id, name, reason: "missing or ambiguous exact team source" }); continue; }
    candidates.push({ title: matches[0].Image, owner: { id: entity.teamEraId ?? entity.id, kind: entity.teamEraId ? "team-era" : "team", sourceKey: name, ...(matches[0].OverviewPage === name ? {} : { sourcePage: matches[0].OverviewPage }) } });
  }
  const files = new Map();
  const titles = [...new Set(candidates.map(item => item.title))].sort();
  for (let start = 0; start < titles.length; start += 50) {
    const result = await client.fetchMediaReviewWithEvidence(titles.slice(start, start + 50));
    for (const page of result.data.query?.pages ?? []) files.set(page.title?.replace(/^File:/, "").replaceAll("_", " "), page);
  }
  const assets = new Map();
  const grouped = new Map();
  for (const candidate of candidates) {
    const title = candidate.title.replace(/^File:/, "").replaceAll("_", " ");
    grouped.set(title, [...(grouped.get(title) ?? []), candidate.owner]);
  }
  async function pinImage([title, owners]) {
    const file = files.get(title);
    const info = file?.imageinfo?.[0];
    const revision = file?.revisions?.[0];
    if (!info || !revision?.revid || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(info.mime) || new URL(info.url).origin !== "https://static.wikia.nocookie.net") {
      issues.push(...owners.map(owner => ({ ...owner, reason: "file evidence unavailable" }))); return;
    }
    const requestedVariant = info.thumburl && info.thumburl !== info.url ? "thumbnail" : "original";
    const original = new URL(info.thumburl ?? info.url);
    if (original.origin !== "https://static.wikia.nocookie.net") throw new Error("Unexpected thumbnail origin.");
    original.searchParams.set("format", "original");
    const sourceUrl = original.toString();
    const path = join(directory, `image-${sha(sourceUrl)}.bin`);
    try {
      let bytes;
      try { bytes = await readFile(path); } catch (error) {
        if (error.code !== "ENOENT") throw new Error("Cannot read the cached image.", { cause: error });
        const result = await execute("curl", [...curl, "--max-filesize", "10000000", "--output", path, "--write-out", "%{content_type}", sourceUrl], { maxBuffer: 100_000 });
        if (result.stdout.trim().split(";")[0] !== info.mime) throw new Error("Downloaded image MIME does not match source evidence.", { cause: error });
        bytes = await readFile(path);
      }
      if (!bytes.length || bytes.length > 10_000_000) throw new Error("Downloaded image exceeds byte bounds.");
      const variant = requestedVariant === "original" && sha(bytes, "sha1") !== info.sha1 ? "cdn-render" : requestedVariant;
      const content = revision.slots?.main?.content ?? "";
      const terms = info.extmetadata?.LicenseShortName?.value ?? info.extmetadata?.UsageTerms?.value;
      const statement = terms ? `Upstream file terms: ${terms}. Editorial-use review does not assert a separate redistribution license.` : content.includes("{{Copyright game}}") ? "The file page carries the Copyright game fair-use statement; no redistribution license is asserted." : "The source file page supplies no explicit per-file redistribution license. Copyright and trademarks remain with their respective holders.";
      assets.set(title, { sourceUrl, attribution: `Image source: Leaguepedia, ${file.title}. ${info.extmetadata?.Artist?.value ?? info.extmetadata?.Credit?.value ?? "No individual photographer/artist is credited on the file page; rights remain with the respective holders."}`,
        rightsBasis: { kind: "editorial-use", policy: "leaguepedia-editorial-v1", sourcePageUrl: info.descriptionurl, revisionId: revision.revid, fileChecksum: sha(bytes), sourceFileSha1: info.sha1, variant, statement,
          reviewedNote: "Exact published subject/era binding and upstream profile/logo discovery reviewed under the user-approved noncommercial esports identification policy; source revision and image bytes are pinned." }, owners });
      console.log(`Pinned image: ${assets.size}/${titles.length} ${title}`);
    } catch (error) { issues.push(...owners.map(owner => ({ ...owner, reason: String(error.message) }))); console.warn(`Image not pinned: ${title}: ${error.message}`); }
  }
  const jobs = [...grouped.entries()];
  for (let start = 0; start < jobs.length; start += 4) {
    await Promise.all(jobs.slice(start, start + 4).map(pinImage));
  }
  const manifest = { version: 1, status: "draft", assets: [...assets.values()].sort((a, b) => a.rightsBasis.sourcePageUrl.localeCompare(b.rightsBasis.sourcePageUrl)) };
  await writeFile(join(directory, "media-draft.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(directory, "inventory.json"), `${JSON.stringify({ publishedPlayers: [...published.values()].filter(item => item.kind === "player").length, publishedTeamVariants: projection.entities.filter(item => item.kind === "team").length, candidates: candidates.length, assets: assets.size, owners: manifest.assets.reduce((sum, item) => sum + item.owners.length, 0), issues }, null, 2)}\n`);
  console.log(JSON.stringify({ assets: assets.size, owners: manifest.assets.reduce((sum, item) => sum + item.owners.length, 0), missing: issues.length }));
} finally { await db.destroy(); }
