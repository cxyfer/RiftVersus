import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

import {
  beginSyncRun, completeUnchangedSyncRun, createDb, failSyncRun, findDatasetVersion, publishDataset,
  recordSourceObjectWithId, withSyncAdvisoryLock,
} from "@riftversus/database";
import {
  LeaguepediaClient, createLeaguepediaProvider, downloadBounded, fetchLeaguepediaRawInput, loadOverrides, runSync,
  type LeaguepediaRawInput, type LeaguepediaReadClient, type ObjectStore, type SnapshotRequest, type StagedSyncBatch, type SyncRepository, type SyncRequest,
} from "@riftversus/sync";
import type { SyncConfig as Config } from "@riftversus/sync";

export function createDatabaseSyncRepository(db: ReturnType<typeof createDb>): SyncRepository {
  return {
    withLock: (provider, operation) => withSyncAdvisoryLock(provider, operation, db),
    beginRun: (input) => beginSyncRun(input, db),
    failRun: (input) => failSyncRun(input, db),
    recordSource: async (input) => ({ id: (await recordSourceObjectWithId(input, db)).id }),
    findPublication: async (version) => {
      const found = await findDatasetVersion(version, db);
      return found === null ? null : { version: found.version };
    },
    completeUnchanged: (input) => completeUnchangedSyncRun(input, db),
    publish: (input) => publishDataset({
      syncRunId: input.syncRunId,
      version: input.version,
      sourceObjectId: input.sourceObjectId,
      coverage: input.coverage,
      dimensions: input.dimensions,
      media: input.media,
      facts: input.facts,
      rosterGameIds: input.rosterGameIds,
      publicationScopes: input.publicationScopes,
      overrideApplications: input.provenance.overrideFiles.map(({ file, checksum }) => ({ overrideFile: file, checksum })),
    }, db),
  };
}

export function buildLeaguepediaSlices(config: Config, request: SyncRequest) {
  const years = request.mode === "backfill" ? request.years : config.leaguepedia.syncYears;
  const competitions = request.mode === "backfill" ? request.competitions : config.leaguepedia.syncCompetitions;
  return competitions.flatMap((competition) => years.flatMap((year) => {
    const mapped = config.leaguepedia.competitionMap[competition]?.[String(year)];
    if (mapped === undefined) throw new Error(`No exact Leaguepedia source mapping exists for ${competition} ${year}.`);
    const sourceCompetitions = Array.isArray(mapped) ? mapped : [mapped];
    return sourceCompetitions.map((sourceCompetition) => ({ competition, sourceCompetition, seasonYear: year, from: `${year}-01-01`, to: `${year + 1}-01-01` }));
  }));
}

async function loadFixture(config: Config, rootDir: string): Promise<LeaguepediaRawInput> {
  const input = JSON.parse(await readFile(resolve(rootDir, config.leaguepedia.fixturePath), "utf8")) as LeaguepediaRawInput;
  if (input.provenance?.kind !== "synthetic-fixture" || input.provenance.name !== "leaguepedia-small") throw new Error("Leaguepedia fixture path must contain leaguepedia-small synthetic fixture provenance.");
  return input;
}

interface OpenRepository { repository: SyncRepository; close(): Promise<void> }
export interface LeaguepediaSyncCompositionDependencies {
  rootDir?: string;
  openRepository?(databaseUrl: string): Promise<OpenRepository>;
  loadLive?(client: LeaguepediaReadClient, request: SnapshotRequest): Promise<LeaguepediaRawInput>;
  observeBatch?(batch: StagedSyncBatch): void;
}

async function openDatabaseRepository(databaseUrl: string): Promise<OpenRepository> {
  const db = createDb({ databaseUrl });
  return { repository: createDatabaseSyncRepository(db), close: () => db.destroy() };
}

export async function executeLeaguepediaSync(input: {
  config: Config;
  objectStore: ObjectStore;
  request: SyncRequest;
  fixture: "leaguepedia-small" | null;
}, dependencies: LeaguepediaSyncCompositionDependencies = {}): Promise<{ status: "locked" | "published" | "unchanged"; version?: string }> {
  const rootDir = dependencies.rootDir ?? process.cwd();
  // Build and validate every live slice before a sync run is opened.
  const liveRequest = input.fixture === null ? { sourceUrl: input.config.leaguepedia.endpoint, slices: buildLeaguepediaSlices(input.config, input.request), resourceLimits: input.config.leaguepedia.resourceLimits } : null;
  const opened = await (dependencies.openRepository ?? openDatabaseRepository)(input.config.databaseUrl);
  try {
    const overridesDir = resolve(rootDir, input.config.leaguepedia.overridesDir);
    const overrides = await loadOverrides({
      identities: resolve(overridesDir, "identities.yaml"), tournaments: resolve(overridesDir, "tournaments.yaml"),
      regions: resolve(overridesDir, "regions.yaml"),
      logicalFiles: { identities: "data/overrides/identities.yaml", tournaments: "data/overrides/tournaments.yaml", regions: "data/overrides/regions.yaml" },
    });
    const client = new LeaguepediaClient({ endpoint: input.config.leaguepedia.endpoint, userAgent: input.config.leaguepedia.userAgent, requestIntervalMs: input.config.leaguepedia.requestIntervalMs });
    const provider = createLeaguepediaProvider({
      overrides,
      loadRawInput: input.fixture === "leaguepedia-small"
        ? () => loadFixture(input.config, rootDir)
        : async () => {
          const loaded = await (dependencies.loadLive ?? fetchLeaguepediaRawInput)(client, liveRequest!);
          if (loaded.provenance?.kind !== "live") throw new Error("Leaguepedia live loader must return live provenance.");
          return loaded;
        },
    });
    return await runSync(provider, input.request, {
      objectStore: input.objectStore,
      repository: opened.repository,
      validate(batch) {
        dependencies.observeBatch?.(batch);
        if (batch.coverage.length === 0) throw new Error("Leaguepedia publication requires explicit bounded coverage evidence.");
        if (batch.coverage.some((item) => item.status === "complete" && item.earliestDate === null && item.latestDate === null)) throw new Error("Zero-row coverage cannot be complete.");
      },
      downloadMedia: input.fixture === "leaguepedia-small"
        ? async () => ({ bytes: new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")), contentType: "image/png", finalUrl: "https://fixture.riftversus.invalid/media/t1.png" })
        : (sourceUrl) => downloadBounded({ url: sourceUrl, allowedHosts: input.config.leaguepedia.mediaHosts, allowedContentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"], maxBytes: 10_000_000, timeoutMs: 20_000 }),
    });
  } finally {
    await opened.close();
  }
}
