import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";
import type { PublicSnapshot, SnapshotEntity } from "@riftversus/contracts";
import type { ObjectStore } from "@riftversus/sync";

import { generateCanonicalAvatar } from "../src/avatar.js";
import {
  compareSnapshotProjection,
  verifyCurrentSnapshot,
  verifyFactProvenanceRecords,
  verifyHistoricalInvariant,
  type CurrentFactAudit,
  type CurrentFactRecord,
  type CurrentReviewedSnapshot,
  type CurrentSourceRecord,
} from "../src/current-snapshot-acceptance.js";
import { writeSnapshotData } from "../src/export-snapshot.js";

const IDS = {
  left: "00000000-0000-4000-8000-000000000001",
  right: "00000000-0000-4000-8000-000000000002",
  series: "00000000-0000-4000-8000-000000000003",
  game: "00000000-0000-4000-8000-000000000004",
  tournament: "00000000-0000-4000-8000-000000000005",
};

const dataset = {
  version: "leaguepedia-current",
  lastSuccessfulSyncAt: "2026-09-13T15:09:40.071Z",
  coverage: { from: "2025-01-01", to: "2026-09-13" },
} as const;

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fakeStore(objects: ReadonlyMap<string, Buffer>): ObjectStore & { headCalls: string[]; getCalls: string[] } {
  const headCalls: string[] = [];
  const getCalls: string[] = [];
  return {
    headCalls,
    getCalls,
    async head(key) {
      headCalls.push(key);
      const bytes = objects.get(key);
      return bytes === undefined ? null : { checksum: checksum(bytes), contentType: "application/json", byteSize: bytes.byteLength };
    },
    async get(key) {
      getCalls.push(key);
      const bytes = objects.get(key);
      return bytes === undefined ? null : Readable.from([bytes]);
    },
    async putImmutable() {
      return "existing";
    },
  };
}

function entity(input: Pick<SnapshotEntity, "id" | "kind" | "displayName" | "mediaUrl">): SnapshotEntity {
  return {
    ...input,
    canonicalName: input.displayName,
    slug: input.displayName.toLowerCase().replaceAll(" ", "-"),
    aliases: [],
    avatarLabel: input.displayName,
    retainedObjectKey: null,
  };
}

function projection(mediaUrl: string): Omit<PublicSnapshot, "snapshotId"> {
  return {
    schemaVersion: 1,
    dataset,
    coverageWarnings: [],
    entities: [entity({ id: IDS.left, kind: "team", displayName: "Left Team", mediaUrl })],
    series: [],
    freshness: [],
    attribution: [],
  };
}

function historicalSnapshot(leftMediaUrl: string, rightMediaUrl: string): PublicSnapshot {
  const leftSide = { teamId: IDS.left, eraId: null, regionId: null, playerIds: [], teamName: "Left Team" } as const;
  const rightSide = { teamId: IDS.right, eraId: null, regionId: null, playerIds: [], teamName: "Right Team" } as const;
  return {
    schemaVersion: 1,
    snapshotId: `sha256:${"1".repeat(64)}`,
    dataset,
    coverageWarnings: [],
    entities: [
      entity({ id: IDS.left, kind: "team", displayName: "Left Team", mediaUrl: leftMediaUrl }),
      entity({ id: IDS.right, kind: "team", displayName: "Right Team", mediaUrl: rightMediaUrl }),
    ],
    series: [{
      id: IDS.series,
      date: "2025-11-09",
      playedAt: "2025-11-09T12:00:00.000Z",
      tournament: { id: IDS.tournament, name: "Worlds", category: "worlds", league: "lck" },
      bestOf: 5,
      sides: [leftSide, rightSide],
      games: [{
        id: IDS.game,
        seriesId: IDS.series,
        playedAt: "2025-11-09T12:30:00.000Z",
        gameNumber: 1,
        sides: [leftSide, rightSide],
        winnerSide: "a",
      }],
      completed: true,
      winnerSide: "a",
      score: { a: 3, b: 0 },
    }],
    freshness: [],
    attribution: [],
  };
}

function reviewedSnapshot(leftAvatar: ReturnType<typeof generateCanonicalAvatar>, rightAvatar: ReturnType<typeof generateCanonicalAvatar>, seriesWins = 1): CurrentReviewedSnapshot {
  return {
    schemaVersion: 2,
    status: "reviewed",
    comparison: {
      left: { kind: "team", id: IDS.left },
      right: { kind: "team", id: IDS.right },
    },
    coverage: { from: "2025-01-01", to: "2025-12-31" },
    expected: {
      leftDisplayName: "Left Team",
      rightDisplayName: "Right Team",
      seriesWins,
      seriesLosses: 0,
      gameWins: 1,
      gameLosses: 0,
      media: {
        left: {
          kind: "generated-avatar",
          entityKind: "team",
          entityId: IDS.left,
          label: "Left Team",
          abbreviation: leftAvatar.abbreviation,
          algorithm: leftAvatar.algorithm,
          checksum: leftAvatar.checksum,
          contentType: leftAvatar.contentType,
        },
        right: {
          kind: "generated-avatar",
          entityKind: "team",
          entityId: IDS.right,
          label: "Right Team",
          abbreviation: rightAvatar.abbreviation,
          algorithm: rightAvatar.algorithm,
          checksum: rightAvatar.checksum,
          contentType: rightAvatar.contentType,
        },
      },
      rows: [{
        id: IDS.series,
        gameIds: [IDS.game],
        date: "2025-11-09",
        leftName: "Left Team",
        rightName: "Right Team",
        leftScore: 3,
        rightScore: 0,
        winner: "left",
      }],
    },
  };
}

describe("compareSnapshotProjection", () => {
  it("allows only the public media URL to differ from the database projection", () => {
    const dbProjection = projection("/media/internal-avatar.svg");
    const snapshot = { ...dbProjection, snapshotId: `sha256:${"2".repeat(64)}`, entities: [{ ...dbProjection.entities[0]!, mediaUrl: "/presentation/avatar.svg" }] };

    expect(compareSnapshotProjection(dbProjection, snapshot)).toEqual([]);
    expect(compareSnapshotProjection(dbProjection, {
      ...snapshot,
      entities: [{ ...snapshot.entities[0]!, displayName: "Changed Team" }],
    })).toContain("Public snapshot does not exactly match the current database projection after media URL normalization.");
  });
});

describe("verifyFactProvenanceRecords", () => {
  const sourceBytes = Buffer.from('{"source":"leaguepedia"}', "utf8");
  const sourceChecksum = checksum(sourceBytes);
  const source = (id: string): CurrentSourceRecord => ({
    id,
    provider: "leaguepedia",
    sourceUrl: "https://example.test/leaguepedia/export.json",
    objectKey: "raw/leaguepedia/export.json",
    checksum: sourceChecksum,
    contentType: "application/json",
    byteSize: String(sourceBytes.byteLength),
  });
  const seriesFact: CurrentFactRecord = { kind: "series", id: IDS.series, provider: "leaguepedia", publicationGeneration: "2", retiredGeneration: null };
  const gameFact: CurrentFactRecord = { kind: "game", id: IDS.game, provider: "leaguepedia", publicationGeneration: "2", retiredGeneration: null, seriesId: IDS.series };
  const audits: CurrentFactAudit[] = [
    { factTable: "series_facts", factId: IDS.series, sourceObjectId: "source-series" },
    { factTable: "game_facts", factId: IDS.game, sourceObjectId: "source-game" },
  ];

  it("deduplicates raw object reads shared by multiple audited facts", async () => {
    const store = fakeStore(new Map([["raw/leaguepedia/export.json", sourceBytes]]));
    const blockers = await verifyFactProvenanceRecords({
      seriesIds: [IDS.series],
      gameIds: [IDS.game],
      gameToSeries: new Map([[IDS.game, IDS.series]]),
      seriesFacts: [seriesFact],
      gameFacts: [gameFact],
      audits,
      sources: [source("source-series"), source("source-game")],
      latestGeneration: 3n,
      approvedLeaguepediaEndpoint: "https://example.test/leaguepedia/export.json",
      store,
    });

    expect(blockers).toEqual([]);
    expect(store.headCalls).toEqual(["raw/leaguepedia/export.json"]);
    expect(store.getCalls).toEqual(["raw/leaguepedia/export.json"]);
  });

  it("blocks missing audits and source bytes that do not match metadata", async () => {
    const store = fakeStore(new Map([["raw/leaguepedia/export.json", Buffer.from("different", "utf8")]]));
    const blockers = await verifyFactProvenanceRecords({
      seriesIds: [IDS.series],
      gameIds: [IDS.game],
      gameToSeries: new Map([[IDS.game, IDS.series]]),
      seriesFacts: [seriesFact],
      gameFacts: [gameFact],
      audits: [{ ...audits[0]!, sourceObjectId: null }, audits[1]!],
      sources: [source("source-series"), { ...source("source-game"), sourceUrl: "https://example.test/other.json" }],
      latestGeneration: 3n,
      approvedLeaguepediaEndpoint: "https://example.test/leaguepedia/export.json",
      store,
    });

    expect(blockers).toContain(`Series fact ${IDS.series} has no source-object audit.`);
    expect(blockers).toContain(`Source object source-game is not tied to the approved Leaguepedia endpoint.`);
    expect(blockers).toContain(`Source object raw/leaguepedia/export.json does not match PostgreSQL checksum, size, or content type.`);
  });
});

describe("current snapshot acceptance", () => {
  it("blocks a corrupt public snapshot before opening the database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftversus-current-acceptance-"));
    try {
      await writeSnapshotData(directory, projection("/presentation/avatar.svg"));
      const manifestPath = join(directory, "data", "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
      manifest.snapshotId = `sha256:${"0".repeat(64)}`;
      await writeFile(manifestPath, JSON.stringify(manifest));

      const result = await verifyCurrentSnapshot({
        databaseUrl: "postgres://invalid/current-acceptance",
        directory,
        store: fakeStore(new Map()),
        reviewedPath: join(directory, "missing-reviewed.json"),
        approvedLeaguepediaEndpoint: "https://example.test/leaguepedia/export.json",
      });

      expect(result.status).toBe("blocked");
      expect(result.blockers[0]).toContain("Public snapshot verification failed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("blocks a historical summary mismatch without changing the reviewed baseline", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftversus-current-acceptance-"));
    try {
      await mkdir(join(directory, "presentation"), { recursive: true });
      const leftAvatar = generateCanonicalAvatar({ kind: "team", id: IDS.left, label: "Left Team" });
      const rightAvatar = generateCanonicalAvatar({ kind: "team", id: IDS.right, label: "Right Team" });
      await writeFile(join(directory, "presentation", `${leftAvatar.checksum}.svg`), leftAvatar.body);
      await writeFile(join(directory, "presentation", `${rightAvatar.checksum}.svg`), rightAvatar.body);
      const snapshot = await writeSnapshotData(directory, historicalSnapshot(`/presentation/${leftAvatar.checksum}.svg`, `/presentation/${rightAvatar.checksum}.svg`));
      const blockers: string[] = [];

      await verifyHistoricalInvariant(snapshot, reviewedSnapshot(leftAvatar, rightAvatar, 0), directory, blockers);

      expect(blockers).toEqual(["Current snapshot historical summaries do not match the reviewed comparison."]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
