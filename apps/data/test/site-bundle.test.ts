import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { type PublicSnapshot } from "@riftversus/contracts";
import { writeSnapshotData } from "../src/export-snapshot.js";
import {
  buildSiteBundle,
  downloadSiteBundle,
  getSiteImmutableFiles,
  publishSiteBundle,
  retainPreviousSite,
  type SiteBundle,
  type SiteBundleManifest,
} from "../src/site-bundle.js";
import type { CreateDraftInput, Release, ReleaseAsset, ReleaseStore, UploadAssetInput } from "../src/release-store.js";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function forgeCentralDirectoryUncompressedSizes(input: Uint8Array, declaredSize: number): Uint8Array {
  const result = new Uint8Array(input);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  let entries = 0;
  for (let offset = 0; offset + 46 <= result.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    view.setUint32(offset + 24, declaredSize, true);
    entries += 1;
  }
  if (entries === 0) throw new Error("ZIP fixture has no central directory entries.");
  return result;
}

const projection: Omit<PublicSnapshot, "snapshotId"> = {
  schemaVersion: 1,
  dataset: { version: "site-fixture", lastSuccessfulSyncAt: "2026-01-01T00:00:00.000Z", coverage: { from: "2024-01-01", to: "2025-12-31" } },
  coverageWarnings: [],
  entities: [{
    id: "00000000-0000-4000-8000-000000000001",
    kind: "player",
    displayName: "Fixture Player",
    realName: "Fixture Player",
    mediaUrl: `presentation/${digest(new TextEncoder().encode("<svg></svg>"))}.svg`,
    canonicalName: "fixture-player",
    slug: "fixture-player",
    aliases: ["fixture"],
    avatarLabel: "FP",
    retainedObjectKey: null,
  }],
  series: [],
  freshness: [],
  attribution: [],
};

class FakeReleaseStore implements ReleaseStore {
  readonly releases: Release[] = [];
  readonly assets = new Map<number, ReleaseAsset>();
  readonly assetBytes = new Map<number, Uint8Array>();
  corruptDownloads = false;
  private readonly releaseAssets = new Map<number, number[]>();
  private nextReleaseId = 1;
  private nextAssetId = 1;

  async listReleases(): Promise<Release[]> {
    return this.releases.map((release) => ({ ...release }));
  }

  async getRelease(tag: string): Promise<Release | null> {
    return this.releases.find((release) => release.tag_name === tag) ?? null;
  }

  async createDraft(input: CreateDraftInput): Promise<Release> {
    const release: Release = { id: this.nextReleaseId++, tag_name: input.tag, draft: true };
    this.releases.push(release);
    return release;
  }

  async listAssets(releaseId: number): Promise<ReleaseAsset[]> {
    return (this.releaseAssets.get(releaseId) ?? []).map((id) => this.assets.get(id)!).sort((left, right) => left.id - right.id);
  }

  async uploadAsset(releaseId: number, input: UploadAssetInput): Promise<ReleaseAsset> {
    const asset: ReleaseAsset = { id: this.nextAssetId++, name: input.name, size: input.bytes.byteLength, content_type: input.contentType };
    this.assets.set(asset.id, asset);
    this.assetBytes.set(asset.id, new Uint8Array(input.bytes));
    this.releaseAssets.set(releaseId, [...(this.releaseAssets.get(releaseId) ?? []), asset.id]);
    return asset;
  }

  async downloadAsset(assetId: number): Promise<Uint8Array> {
    const stored = this.assetBytes.get(assetId);
    if (stored === undefined) throw new Error(`missing asset ${assetId}`);
    if (this.corruptDownloads) return bytes("corrupt remote asset");
    return new Uint8Array(stored);
  }

  async publishDraft(releaseId: number): Promise<Release> {
    const release = this.releases.find((candidate) => candidate.id === releaseId);
    if (release === undefined) throw new Error(`missing release ${releaseId}`);
    release.draft = false;
    return { ...release };
  }

  async seedPublished(manifest: SiteBundleManifest, zipBytes: Uint8Array): Promise<Release> {
    const release: Release = { id: this.nextReleaseId++, tag_name: manifest.siteId, draft: false };
    this.releases.push(release);
    await this.uploadAsset(release.id, { name: `site-bundle-${manifest.zip.checksum}.zip`, bytes: zipBytes, contentType: "application/zip" });
    await this.uploadAsset(release.id, { name: `site-manifest-${digest(new TextEncoder().encode(`${JSON.stringify(manifest)}\n`))}.json`, bytes: new TextEncoder().encode(`${JSON.stringify(manifest)}\n`), contentType: "application/json" });
    return release;
  }
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "riftversus-site-bundle-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createSite(root: string, variant = "fixture"): Promise<{ directory: string; snapshot: PublicSnapshot }> {
  const directory = join(root, "site");
  await mkdir(join(directory, "assets"), { recursive: true });
  await writeFile(join(directory, "index.html"), "<!doctype html><title>RiftVersus</title>");
  await writeFile(join(directory, "404.html"), "not found");
  await writeFile(join(directory, "media-placeholder.svg"), "<svg></svg>");
  await writeFile(join(directory, "assets", `app-${variant}.js`), `console.log('${variant}');`);
  await mkdir(join(directory, "presentation"), { recursive: true });
  await writeFile(join(directory, "presentation", `${digest(new TextEncoder().encode("<svg></svg>"))}.svg`), "<svg></svg>");
  const variantProjection = variant === "fixture" ? projection : { ...projection, dataset: { ...projection.dataset, version: `site-${variant}` } };
  const snapshot = await writeSnapshotData(directory, variantProjection);
  return { directory, snapshot };
}

async function buildFixture(root: string): Promise<{ site: { directory: string; snapshot: PublicSnapshot }; bundle: SiteBundle }> {
  const site = await createSite(root);
  const bundle = await buildSiteBundle({
    directory: site.directory,
    siteId: "site-fixture-1",
    codeSha: "0123456789abcdef0123456789abcdef01234567",
    checkpointId: "checkpoint-fixture-1",
    snapshotId: site.snapshot.snapshotId,
  });
  return { site, bundle };
}

describe("site bundle protocol", () => {
  it("builds, publishes, and restores a verified static site", async () => {
    await withRoot(async (root) => {
      const { site, bundle } = await buildFixture(root);
      expect(bundle.manifest.siteId).toBe("site-fixture-1");
      expect(bundle.manifest.zip.byteSize).toBe(bundle.bytes.byteLength);
      expect(bundle.manifest.files.map((entry) => entry.file)).toContain("site-manifest.json");
      expect(bundle.manifest.files.some((entry) => /^data\/[a-f0-9]{64}\/database\.sqlite$/u.test(entry.file))).toBe(true);

      const releaseStore = new FakeReleaseStore();
      const published = await publishSiteBundle({ bundle, releaseStore, targetCommitish: "website-sha" });
      expect(published).toMatchObject({ tag_name: "site-fixture-1", draft: false });
      expect(await releaseStore.listAssets(published.id)).toHaveLength(2);

      const restored = join(root, "restored");
      const manifest = await downloadSiteBundle({ tag: "site-fixture-1", releaseStore, directory: restored });
      expect(manifest.snapshotId).toBe(site.snapshot.snapshotId);
      const restoredSnapshot = JSON.parse(await readFile(join(restored, "data", "manifest.json"), "utf8")) as { snapshotId: string };
      expect(restoredSnapshot.snapshotId).toBe(site.snapshot.snapshotId);
      await expect(downloadSiteBundle({ tag: "site-fixture-1", releaseStore, directory: restored })).rejects.toThrow("already exists");
    });
  });

  it("keeps the draft unpublished when a remote archive is corrupt", async () => {
    await withRoot(async (root) => {
      const { bundle } = await buildFixture(root);
      const releaseStore = new FakeReleaseStore();
      releaseStore.corruptDownloads = true;
      await expect(publishSiteBundle({ bundle, releaseStore, targetCommitish: "website-sha" })).rejects.toThrow();
      expect(releaseStore.releases).toHaveLength(1);
      expect(releaseStore.releases[0]!.draft).toBe(true);
    });
  });

  it("rejects unexpected source files and unsafe ZIP paths", async () => {
    await withRoot(async (root) => {
      const site = await createSite(root);
      await writeFile(join(site.directory, ".env"), "TOKEN=secret");
      await expect(buildSiteBundle({ directory: site.directory, siteId: "site-unsafe", codeSha: "sha", checkpointId: "checkpoint-1", snapshotId: site.snapshot.snapshotId })).rejects.toThrow(/unsafe|unexpected/);
      await rm(join(site.directory, ".env"));
      await writeFile(join(site.directory, "data", "facts.json"), "{}");
      await expect(buildSiteBundle({ directory: site.directory, siteId: "site-json", codeSha: "sha", checkpointId: "checkpoint-1", snapshotId: site.snapshot.snapshotId })).rejects.toThrow(/unexpected/);
      await rm(join(site.directory, "data", "facts.json"));
      await writeFile(join(site.directory, "data", "database.dump"), "dump");
      await expect(buildSiteBundle({ directory: site.directory, siteId: "site-dump", codeSha: "sha", checkpointId: "checkpoint-1", snapshotId: site.snapshot.snapshotId })).rejects.toThrow(/unexpected/);
      await rm(join(site.directory, "data", "database.dump"));

      const clean = await buildFixture(join(root, "clean"));
      const zip = await JSZip.loadAsync(clean.bundle.bytes);
      zip.file("../private.txt", bytes("private"));
      const maliciousBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
      const maliciousManifest: SiteBundleManifest = { ...clean.bundle.manifest, zip: { checksum: digest(maliciousBytes), byteSize: maliciousBytes.byteLength } };
      const releaseStore = new FakeReleaseStore();
      await releaseStore.seedPublished(maliciousManifest, maliciousBytes);
      await expect(downloadSiteBundle({ tag: maliciousManifest.siteId, releaseStore, directory: join(root, "malicious-restore") })).rejects.toThrow(/directory|unsafe|unindexed/i);
    });
  });

  it("does not trust forged central-directory uncompressed sizes", async () => {
    await withRoot(async (root) => {
      const { bundle } = await buildFixture(root);
      const forgedBytes = forgeCentralDirectoryUncompressedSizes(bundle.bytes, 1);
      const forgedManifest: SiteBundleManifest = { ...bundle.manifest, zip: { checksum: digest(forgedBytes), byteSize: forgedBytes.byteLength } };
      const releaseStore = new FakeReleaseStore();
      await releaseStore.seedPublished(forgedManifest, forgedBytes);
      await expect(downloadSiteBundle({ tag: forgedManifest.siteId, releaseStore, directory: join(root, "forged-restore") })).rejects.toThrow(/uncompressed data size mismatch|indexed byte size/);
    });
  });

  it("bounds actual ZIP extraction by indexed bytes", async () => {
    await withRoot(async (root) => {
      const { bundle } = await buildFixture(root);
      const forgedBytes = forgeCentralDirectoryUncompressedSizes(bundle.bytes, 1);
      const oversizedEntry = bundle.manifest.files.find((entry) => entry.byteSize > 1)!;
      const boundedManifest: SiteBundleManifest = {
        ...bundle.manifest,
        zip: { checksum: digest(forgedBytes), byteSize: forgedBytes.byteLength },
        files: bundle.manifest.files.map((entry) => entry.file === oversizedEntry.file ? { ...entry, byteSize: 1, checksum: digest(bytes("x")) } : entry),
      };
      const releaseStore = new FakeReleaseStore();
      await releaseStore.seedPublished(boundedManifest, forgedBytes);
      await expect(downloadSiteBundle({ tag: boundedManifest.siteId, releaseStore, directory: join(root, "bounded-restore") })).rejects.toThrow("exceeds the indexed byte size");
    });
  });

  it("rejects draft releases and mismatched snapshot IDs", async () => {
    await withRoot(async (root) => {
      const site = await createSite(root);
      await expect(buildSiteBundle({ directory: site.directory, siteId: "site-wrong-snapshot", codeSha: "sha", checkpointId: "checkpoint-1", snapshotId: `sha256:${"f".repeat(64)}` })).rejects.toThrow("snapshot ID mismatch");

      const { bundle } = await buildFixture(join(root, "published"));
      const releaseStore = new FakeReleaseStore();
      const draft = await releaseStore.createDraft({ tag: bundle.manifest.siteId, targetCommitish: "website-sha", body: "draft" });
      expect(draft.draft).toBe(true);
      await expect(downloadSiteBundle({ tag: bundle.manifest.siteId, releaseStore, directory: join(root, "draft-restore") })).rejects.toThrow("draft");
    });
  });

  it("does not accept a source site manifest that could shadow generated metadata", async () => {
    await withRoot(async (root) => {
      const site = await createSite(root);
      await writeFile(join(site.directory, "site-manifest.json"), "{}");
      await expect(buildSiteBundle({ directory: site.directory, siteId: "site-shadow", codeSha: "sha", checkpointId: "checkpoint-1", snapshotId: site.snapshot.snapshotId })).rejects.toThrow("reserved");
    });
  });

  it("retains only the previous deployment inventory across three deployments", async () => {
    await withRoot(async (root) => {
      const releaseStore = new FakeReleaseStore();
      const first = await createSite(join(root, "first"), "one");
      const firstBundle = await buildSiteBundle({ directory: first.directory, siteId: "site-one", codeSha: "sha-one", checkpointId: "checkpoint-one", snapshotId: first.snapshot.snapshotId });
      await publishSiteBundle({ bundle: firstBundle, releaseStore, targetCommitish: "website-sha" });
      const firstDownloaded = join(root, "first-downloaded");
      await downloadSiteBundle({ tag: "site-one", releaseStore, directory: firstDownloaded });

      const second = await createSite(join(root, "second"), "two");
      const secondOwned = await getSiteImmutableFiles(second.directory);
      await retainPreviousSite(second.directory, firstDownloaded);
      const secondBundle = await buildSiteBundle({ directory: second.directory, siteId: "site-two", codeSha: "sha-two", checkpointId: "checkpoint-two", snapshotId: second.snapshot.snapshotId, immutableFiles: secondOwned });
      await publishSiteBundle({ bundle: secondBundle, releaseStore, targetCommitish: "website-sha" });
      const secondDownloaded = join(root, "second-downloaded");
      await downloadSiteBundle({ tag: "site-two", releaseStore, directory: secondDownloaded });

      const third = await createSite(join(root, "third"), "three");
      const thirdOwned = await getSiteImmutableFiles(third.directory);
      await retainPreviousSite(third.directory, secondDownloaded);
      const thirdBundle = await buildSiteBundle({ directory: third.directory, siteId: "site-three", codeSha: "sha-three", checkpointId: "checkpoint-three", snapshotId: third.snapshot.snapshotId, immutableFiles: thirdOwned });
      const thirdFiles = thirdBundle.manifest.files.map((entry) => entry.file);
      const firstDatabase = firstBundle.manifest.files.find((entry) => /^data\/[a-f0-9]{64}\/database\.sqlite$/u.test(entry.file))!.file;
      const secondDatabase = secondOwned.find((file) => /^data\/[a-f0-9]{64}\/database\.sqlite$/u.test(file))!;
      const thirdDatabase = thirdOwned.find((file) => /^data\/[a-f0-9]{64}\/database\.sqlite$/u.test(file))!;
      expect(thirdFiles).not.toContain(firstDatabase);
      expect(thirdFiles).toContain(secondDatabase);
      expect(thirdFiles).toContain(thirdDatabase);
      expect(thirdFiles).not.toContain("assets/app-one.js");
      expect(thirdFiles).toContain("assets/app-two.js");
      expect(thirdFiles).toContain("assets/app-three.js");

      const zip = await JSZip.loadAsync(thirdBundle.bytes);
      const siteManifest = JSON.parse(await zip.file("site-manifest.json")!.async("string")) as { immutableFiles: string[] };
      expect(siteManifest.immutableFiles).not.toContain(firstDatabase);
      expect(siteManifest.immutableFiles).not.toContain("assets/app-one.js");
      expect(siteManifest.immutableFiles).toContain(thirdDatabase);
      expect(siteManifest.immutableFiles).toContain("assets/app-three.js");
    });
  });

  it("rejects previous site checksum and immutable-file conflicts", async () => {
    await withRoot(async (root) => {
      const first = await createSite(join(root, "previous"), "previous");
      const bundle = await buildSiteBundle({ directory: first.directory, siteId: "site-previous", codeSha: "sha", checkpointId: "checkpoint", snapshotId: first.snapshot.snapshotId });
      const releaseStore = new FakeReleaseStore();
      await publishSiteBundle({ bundle, releaseStore, targetCommitish: "website-sha" });
      const previous = join(root, "downloaded");
      await downloadSiteBundle({ tag: "site-previous", releaseStore, directory: previous });

      const current = await createSite(join(root, "current"), "current");
      await writeFile(join(previous, "assets", "app-previous.js"), "tampered");
      await expect(retainPreviousSite(current.directory, previous)).rejects.toThrow(/checksum|conflict/iu);

      const cleanPrevious = join(root, "clean-previous");
      await downloadSiteBundle({ tag: "site-previous", releaseStore, directory: cleanPrevious });
      await writeFile(join(current.directory, "assets", "app-previous.js"), "different");
      await expect(retainPreviousSite(current.directory, cleanPrevious)).rejects.toThrow("conflicts");
    });
  });
});
