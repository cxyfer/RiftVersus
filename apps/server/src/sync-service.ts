import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

import {
  beginSyncRun, completeUnchangedSyncRun, createDb, failSyncRun, findDatasetVersion, publishDataset,
  recordSourceObjectWithId, withSyncAdvisoryLock,
} from "@riftversus/database";
import {
  LeaguepediaClient, createLeaguepediaProvider, downloadBounded, fetchLeaguepediaRawInput, loadOverrides, runSync,
  type LeaguepediaRawInput, type ObjectStore, type SyncRepository, type SyncRequest,
} from "@riftversus/sync";
import type { Config } from "./config.js";

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
      overrideApplications: input.provenance.overrideChecksums.map((checksum, index) => ({ overrideFile: `leaguepedia:reviewed-override-${index + 1}`, checksum })),
    }, db),
  };
}

function slices(config: Config, request: SyncRequest) {
  const years = request.mode === "backfill" ? request.years : config.leaguepedia.syncYears;
  const competitions = request.mode === "backfill" ? request.competitions : config.leaguepedia.syncCompetitions;
  return competitions.flatMap((competition) => years.map((year) => ({
    competition,
    sourceCompetition: config.leaguepedia.competitionMap[competition] ?? competition,
    seasonYear: year,
    from: `${year}-01-01`,
    to: `${year + 1}-01-01`,
  })));
}

async function loadFixture(config: Config): Promise<LeaguepediaRawInput> {
  return JSON.parse(await readFile(resolve(process.cwd(), config.leaguepedia.fixturePath), "utf8")) as LeaguepediaRawInput;
}

export async function executeLeaguepediaSync(input: {
  config: Config;
  objectStore: ObjectStore;
  request: SyncRequest;
  fixture: "leaguepedia-small" | null;
}): Promise<{ status: "locked" | "published" | "unchanged"; version?: string }> {
  const db = createDb({ databaseUrl: input.config.databaseUrl });
  try {
    const overridesDir = resolve(process.cwd(), input.config.leaguepedia.overridesDir);
    const overrides = await loadOverrides({ identities: resolve(overridesDir, "identities.yaml"), tournaments: resolve(overridesDir, "tournaments.yaml") });
    const client = new LeaguepediaClient({ endpoint: input.config.leaguepedia.endpoint, userAgent: input.config.leaguepedia.userAgent });
    const provider = createLeaguepediaProvider({
      overrides,
      loadRawInput: input.fixture === "leaguepedia-small"
        ? () => loadFixture(input.config)
        : (request) => fetchLeaguepediaRawInput(client, { sourceUrl: input.config.leaguepedia.endpoint, slices: slices(input.config, request), resourceLimits: input.config.leaguepedia.resourceLimits }),
    });
    return await runSync(provider, input.request, {
      objectStore: input.objectStore,
      repository: createDatabaseSyncRepository(db),
      validate(batch) {
        if (batch.coverage.length === 0) throw new Error("Leaguepedia publication requires explicit bounded coverage evidence.");
        if (batch.coverage.some((item) => item.status === "complete" && item.earliestDate === null && item.latestDate === null)) throw new Error("Zero-row coverage cannot be complete.");
      },
      downloadMedia: input.fixture === "leaguepedia-small"
        ? async () => ({ bytes: new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")), contentType: "image/png", finalUrl: "fixture://leaguepedia-small/media.png" })
        : (sourceUrl) => downloadBounded({ url: sourceUrl, allowedHosts: input.config.leaguepedia.mediaHosts, allowedContentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"], maxBytes: 10_000_000, timeoutMs: 20_000 }),
    });
  } finally {
    await db.destroy();
  }
}
