import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PublicSnapshot } from "@riftversus/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeSnapshotData } from "../src/export-snapshot.js";
import type { CreateDraftInput, Release, ReleaseAsset, ReleaseStore, UploadAssetInput } from "../src/release-store.js";

const createReleaseStore = vi.hoisted(() => vi.fn());
vi.mock("../src/release-store.js", () => ({ createReleaseStore }));

import { runSiteCommand } from "../src/site-commands.js";

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const avatar = "<svg></svg>";
const avatarDigest = digest(avatar);

const projection: Omit<PublicSnapshot, "snapshotId"> = {
  schemaVersion: 1,
  dataset: { version: "site-command", lastSuccessfulSyncAt: "2026-01-01T00:00:00.000Z", coverage: { from: "2024-01-01", to: "2025-12-31" } },
  coverageWarnings: [],
  entities: [{ id: uuid(1), kind: "player", displayName: "Fixture Player", realName: "Fixture Player", mediaUrl: `/presentation/${avatarDigest}.svg`, canonicalName: "fixture-player", slug: "fixture-player", aliases: ["fixture"], avatarLabel: "FP", retainedObjectKey: null }],
  series: [],
  freshness: [],
  attribution: [],
};

class FakeReleaseStore implements ReleaseStore {
  readonly releases: Release[] = [];
  readonly assets = new Map<number, ReleaseAsset>();
  readonly bytes = new Map<number, Uint8Array>();
  private readonly releaseAssets = new Map<number, number[]>();
  private nextReleaseId = 1;
  private nextAssetId = 1;

  async listReleases(): Promise<Release[]> { return this.releases.map((release) => ({ ...release })); }
  async getRelease(tag: string): Promise<Release | null> { return this.releases.find((release) => release.tag_name === tag) ?? null; }
  async createDraft(input: CreateDraftInput): Promise<Release> {
    const release = { id: this.nextReleaseId++, tag_name: input.tag, draft: true };
    this.releases.push(release);
    return release;
  }
  async listAssets(releaseId: number): Promise<ReleaseAsset[]> {
    return (this.releaseAssets.get(releaseId) ?? []).map((id) => this.assets.get(id)!).sort((left, right) => left.id - right.id);
  }
  async uploadAsset(releaseId: number, input: UploadAssetInput): Promise<ReleaseAsset> {
    const asset = { id: this.nextAssetId++, name: input.name, size: input.bytes.byteLength, content_type: input.contentType };
    this.assets.set(asset.id, asset);
    this.bytes.set(asset.id, new Uint8Array(input.bytes));
    this.releaseAssets.set(releaseId, [...(this.releaseAssets.get(releaseId) ?? []), asset.id]);
    return asset;
  }
  async downloadAsset(assetId: number): Promise<Uint8Array> {
    const value = this.bytes.get(assetId);
    if (value === undefined) throw new Error(`Missing asset ${assetId}`);
    return new Uint8Array(value);
  }
  async publishDraft(releaseId: number): Promise<Release> {
    const release = this.releases.find((candidate) => candidate.id === releaseId);
    if (release === undefined) throw new Error(`Missing release ${releaseId}`);
    release.draft = false;
    return { ...release };
  }
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "riftversus-site-command-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function createSite(root: string): Promise<string> {
  const directory = join(root, "site");
  await mkdir(join(directory, "assets"), { recursive: true });
  await mkdir(join(directory, "presentation"), { recursive: true });
  await writeFile(join(directory, "index.html"), "<!doctype html><title>RiftVersus</title>");
  await writeFile(join(directory, "404.html"), "not found");
  await writeFile(join(directory, "media-placeholder.svg"), avatar);
  await writeFile(join(directory, "assets", "app.js"), "console.log('fixture');");
  await writeFile(join(directory, "presentation", `${avatarDigest}.svg`), avatar);
  await writeSnapshotData(directory, projection);
  return directory;
}

const publishEnvironment = {
  DATA_REPOSITORY: "owner/data",
  RIFTVERSUS_DATA_TOKEN: "token",
  SITE_ID: "site-command-1",
  CODE_SHA: "website-sha",
  CHECKPOINT_ID: "checkpoint-1",
  ARCHIVE_TARGET_COMMITISH: "main",
};

afterEach(() => {
  createReleaseStore.mockReset();
  vi.restoreAllMocks();
});

describe("site commands", () => {
  it("verifies SQLite, derives snapshotId, and publishes through GitHub release storage", async () => {
    await withRoot(async (root) => {
      const store = new FakeReleaseStore();
      createReleaseStore.mockReturnValue(store);
      const directory = await createSite(root);
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await runSiteCommand("publish", directory, publishEnvironment);

      expect(createReleaseStore).toHaveBeenCalledWith({ repository: "owner/data", token: "token" });
      expect(store.releases).toEqual([{ id: 1, tag_name: "site-command-1", draft: false }]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"status":"published"'));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"snapshotId":"sha256:'));
    });
  });

  it("downloads and verifies a previously published bundle", async () => {
    await withRoot(async (root) => {
      const store = new FakeReleaseStore();
      createReleaseStore.mockReturnValue(store);
      const source = await createSite(join(root, "source"));
      await runSiteCommand("publish", source, publishEnvironment);
      const restored = join(root, "restored");
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await runSiteCommand("download", restored, { DATA_REPOSITORY: "owner/data", RIFTVERSUS_DATA_TOKEN: "token", SITE_ID: "site-command-1" });

      const manifest = JSON.parse(await readFile(join(restored, "site-manifest.json"), "utf8")) as { snapshotId: string };
      expect(manifest.snapshotId).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"status":"downloaded"'));
    });
  });

  it("rejects missing mode-specific configuration before creating the release store", async () => {
    await withRoot(async (root) => {
      const directory = await createSite(root);
      await expect(runSiteCommand("publish", directory, { DATA_REPOSITORY: "owner/data", RIFTVERSUS_DATA_TOKEN: "token", SITE_ID: "site-command-1", CODE_SHA: "sha", CHECKPOINT_ID: "checkpoint" })).rejects.toThrow("ARCHIVE_TARGET_COMMITISH is required");
      expect(createReleaseStore).not.toHaveBeenCalled();
      await expect(runSiteCommand("download", join(root, "missing"), { DATA_REPOSITORY: "owner/data", RIFTVERSUS_DATA_TOKEN: "token" })).rejects.toThrow("SITE_ID is required");
      expect(createReleaseStore).not.toHaveBeenCalled();
    });
  });

  it("carries the previous immutable site files when publishing a new site", async () => {
    await withRoot(async (root) => {
      const store = new FakeReleaseStore();
      createReleaseStore.mockReturnValue(store);
      const previous = await createSite(join(root, "previous"));
      await runSiteCommand("publish", previous, publishEnvironment);
      const previousDownloaded = join(root, "previous-downloaded");
      await runSiteCommand("download", previousDownloaded, { DATA_REPOSITORY: "owner/data", RIFTVERSUS_DATA_TOKEN: "token", SITE_ID: "site-command-1" });

      const current = await createSite(join(root, "current"));
      await runSiteCommand("publish", current, { ...publishEnvironment, SITE_ID: "site-command-2", PREVIOUS_SITE_DIR: previousDownloaded });

      expect(store.releases.map((release) => release.tag_name)).toEqual(["site-command-1", "site-command-2"]);
    });
  });
});
