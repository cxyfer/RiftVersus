import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";

import type { ComparisonQuery, ComparisonResponse } from "@riftversus/contracts";
import { encodeLeaguepediaRawInput, type LeaguepediaRawInput } from "@riftversus/sync";
import { describe, expect, it, type Mocked, vi } from "vitest";

import type { AcceptanceVerificationDependencies } from "../../data/src/acceptance.js";
import { generateCanonicalAvatar } from "../../data/src/avatar.js";

const endpoint = "https://leaguepedia.acme.org/api.php";
const leftId = "11111111-1111-4111-8111-111111111111";
const rightId = "22222222-2222-4222-8222-222222222222";
const seriesId = "33333333-3333-4333-8333-333333333333";
const gameId = "66666666-6666-4666-8666-666666666666";
const gameId2 = "66666666-6666-4666-8666-666666666667";
const gameId3 = "66666666-6666-4666-8666-666666666668";
const tournamentId = "44444444-4444-4444-8444-444444444444";
const sourceObjectId = "55555555-5555-4555-8555-555555555555";
const leftMediaBytes = Buffer.from("left-media");
const rightMediaBytes = Buffer.from("right-media");
const leftMediaChecksum = createHash("sha256").update(leftMediaBytes).digest("hex");
const rightMediaChecksum = createHash("sha256").update(rightMediaBytes).digest("hex");
const leftIdentity = { kind: "team", id: leftId, label: "T1" } as const;
const rightIdentity = { kind: "region", id: rightId, label: "LPL" } as const;
const leftAvatar = generateCanonicalAvatar(leftIdentity);
const rightAvatar = generateCanonicalAvatar(rightIdentity);
const requestId = "query:mediawiki:0:acceptance";
const requestUrl = `${endpoint}?action=query&prop=info%7Crevisions&rvprop=ids%7Ctimestamp&titles=T1&format=json&formatversion=2`;
const rawInput: LeaguepediaRawInput = {
  provenance: { kind: "live" },
  sourceUrl: endpoint,
  slices: [],
  rawEvidence: [{
    requestId,
    action: "query",
    sourceUrl: requestUrl,
    revisionIds: [2],
    response: { query: { pages: [{ pageid: 1, title: "T1", revisions: [{ revid: 2 }] }] } },
  }],
};
const rawBytes = Buffer.from(encodeLeaguepediaRawInput(rawInput));
const checksum = createHash("sha256").update(rawBytes).digest("hex");
const reviewedCoverageRows = [
  [2013, "2013-09-15", "2013-10-05"], [2014, "2014-09-18", "2014-10-19"],
  [2015, "2015-10-01", "2015-10-31"], [2016, "2016-09-29", "2016-10-30"],
  [2017, "2017-10-05", "2017-11-04"], [2018, "2018-10-10", "2018-11-03"],
  [2019, "2019-10-12", "2019-11-10"], [2020, "2020-10-03", "2020-10-31"],
  [2021, "2021-10-11", "2021-11-06"], [2022, "2022-10-07", "2022-11-06"],
  [2023, "2023-10-19", "2023-11-19"], [2024, "2024-10-03", "2024-11-02"],
  [2025, "2025-10-15", "2025-11-09"],
].map(([seasonYear, earliestDate, latestDate]) => ({
  provider: "leaguepedia" as const, competition: "Worlds" as const, seasonYear: seasonYear as number,
  earliestDate: earliestDate as string, latestDate: latestDate as string, status: "complete" as const,
}));

function canonicalResponse(): ComparisonResponse {
  const query: ComparisonQuery = {
    left: { kind: "team", id: leftId }, right: { kind: "region", id: rightId },
    eventCategories: ["worlds"], leagues: [], bestOf: [5], tournamentIds: [], limit: 100,
  };
  return {
    subjects: {
      left: { kind: "team", id: leftId, displayName: "T1", mediaUrl: "/media/media/t1.png" },
      right: { kind: "region", id: rightId, displayName: "LPL", mediaUrl: "/media/media/lpl.png" },
    },
    query,
    seriesSummary: { wins: 1, losses: 0, total: 1, winRate: 1 },
    gameSummary: { wins: 3, losses: 0, total: 3, winRate: 1 },
    rows: [{
      id: seriesId, date: "2024-11-02", event: { id: tournamentId, name: "World Championship", category: "worlds" },
      bestOf: 5, leftName: "T1", rightName: "LPL", leftScore: 3, rightScore: 0, winner: "left",
    }],
    dataset: { version: "leaguepedia-reviewed-v1", lastSuccessfulSyncAt: "2026-07-13T00:00:00.000Z", coverage: { from: "2013-09-15", to: "2025-11-09" } },
    coverageWarnings: [], mediaUrls: { left: "/media/media/t1.png", right: "/media/media/lpl.png" },
  };
}

function generatedResponse(): ComparisonResponse {
  const response = canonicalResponse();
  response.subjects.left.mediaUrl = `/avatars/v2/team/${leftId}.svg`;
  response.subjects.right.mediaUrl = `/avatars/v2/region/${rightId}.svg`;
  response.mediaUrls.left = response.subjects.left.mediaUrl;
  response.mediaUrls.right = response.subjects.right.mediaUrl;
  return response;
}

const retainedLeft = { kind: "retained-media", checksum: leftMediaChecksum, contentType: "image/png" } as const;
const retainedRight = { kind: "retained-media", checksum: rightMediaChecksum, contentType: "image/png" } as const;
const generatedLeft = {
  kind: "generated-avatar", entityKind: "team", entityId: leftId,
  label: "T1", abbreviation: "T1",
  algorithm: "canonical-avatar-v2", checksum: leftAvatar.checksum, contentType: "image/svg+xml",
} as const;
const generatedRight = {
  kind: "generated-avatar", entityKind: "region", entityId: rightId,
  label: "LPL", abbreviation: "LPL",
  algorithm: "canonical-avatar-v2", checksum: rightAvatar.checksum, contentType: "image/svg+xml",
} as const;

function reviewedSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2, status: "reviewed",
    comparison: { left: { kind: "team", id: leftId }, right: { kind: "region", id: rightId } },
    datasetVersion: "leaguepedia-reviewed-v1",
    attribution: { provider: "Leaguepedia", url: "https://leaguepedia.acme.org/wiki/Leaguepedia:Copyrights" },
    sources: [{
      pageId: 1, revisionId: 2, title: "T1", retrievedAt: "2026-07-13T00:00:00.0000Z",
      objectKey: "sources/leaguepedia/raw.json", rawObjectChecksum: checksum,
      requestId, requestUrl,
    }],
    coverage: {
      status: "complete", unresolvedSeries: 0, from: "2013-09-15", to: "2025-11-09", note: "Every included series was reviewed.",
      rows: reviewedCoverageRows,
    },
    expected: {
      leftDisplayName: "T1", rightDisplayName: "LPL",
      seriesWins: 1, seriesLosses: 0, gameWins: 3, gameLosses: 0,
      media: {
        left: retainedLeft,
        right: retainedRight,
      },
      rows: [{
        id: seriesId, gameIds: [gameId, gameId2, gameId3], date: "2024-11-02",
        leftName: "T1", rightName: "LPL", leftScore: 3, rightScore: 0, winner: "left",
      }],
    },
    review: { reviewedAt: "2026-07-13T00:00:00.000Z", reviewer: "independent-reviewer" },
    ...overrides,
  };
}

function dependencies(response: ComparisonResponse = canonicalResponse()): Mocked<AcceptanceVerificationDependencies> {
  return {
    approvedLeaguepediaEndpoint: endpoint,
    maxRawObjectBytes: 1_000_000,
    maxMediaObjectBytes: 10_000_000,
    compare: vi.fn(async () => response),
    getRawObject: vi.fn(async (key: string) => Readable.from([key === "media/t1.png" ? leftMediaBytes : key === "media/lpl.png" ? rightMediaBytes : rawBytes])),
    getSourceMetadata: vi.fn(async () => [{ id: sourceObjectId, provider: "leaguepedia", sourceUrl: endpoint, objectKey: "sources/leaguepedia/raw.json", checksum, contentType: "application/json", byteSize: String(rawBytes.byteLength), retrievedAt: "2026-07-13T00:00:00.000Z", parserVersion: "leaguepedia-v1" }]),
    getDatasetEvidence: vi.fn(async () => ({
      dataset: { generation: "9", publishedAt: "2026-07-13T01:00:00.000Z" },
      facts: [
        { kind: "series" as const, id: seriesId, provider: "leaguepedia", publicationGeneration: "9", retiredGeneration: null, sourceObjectId },
        { kind: "game" as const, id: gameId, seriesId, provider: "leaguepedia", publicationGeneration: "9", retiredGeneration: null, sourceObjectId },
        { kind: "game" as const, id: gameId2, seriesId, provider: "leaguepedia", publicationGeneration: "9", retiredGeneration: null, sourceObjectId },
        { kind: "game" as const, id: gameId3, seriesId, provider: "leaguepedia", publicationGeneration: "9", retiredGeneration: null, sourceObjectId },
      ],
      coverage: reviewedCoverageRows,
    })),
    getMediaMetadata: vi.fn(async (key: string) => key === "media/t1.png"
      ? { objectKey: key, checksum: leftMediaChecksum, contentType: "image/png", byteSize: String(leftMediaBytes.byteLength) }
      : key === "media/lpl.png" ? { objectKey: key, checksum: rightMediaChecksum, contentType: "image/png", byteSize: String(rightMediaBytes.byteLength) } : null),
    getAvatarIdentity: vi.fn(async (kind, id) => kind === "team" && id === leftId
      ? leftIdentity
      : kind === "region" && id === rightId ? rightIdentity : null),
    generateAvatar: vi.fn((identity) => generateCanonicalAvatar(identity)),
  };
}

describe("historical acceptance evidence gate", () => {
  it("keeps the checked-in official candidate structurally reviewed without replacing the production gate", async () => {
    const snapshot = JSON.parse(await readFile(new URL("../../../data/acceptance/leaguepedia-t1-lpl-worlds-bo5.json", import.meta.url), "utf8")) as Record<string, unknown>;

    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      status: "reviewed",
      datasetVersion: "leaguepedia-a9277cebd9d2be1006b8e35d41d41af06d599507741c0770615a76489d33c7a2",
      attribution: {
        provider: "Leaguepedia",
        url: "https://lol.fandom.com/wiki/Leaguepedia%3ACopyrights",
      },
      expected: {
        seriesWins: 12,
        seriesLosses: 0,
        gameWins: 36,
        gameLosses: 9,
        media: {
          left: {
            kind: "generated-avatar", entityKind: "team", entityId: "11111111-1111-5111-8111-111111111111",
            label: "T1", abbreviation: "T1", algorithm: "canonical-avatar-v2",
            checksum: "d5b14ff6984ca747067f2e650adeb74e823d12d8b1a111e3f47dc3c96f959da5",
            contentType: "image/svg+xml",
          },
          right: {
            kind: "generated-avatar", entityKind: "region", entityId: "33333333-3333-5333-8333-333333333333",
            label: "LPL", abbreviation: "LPL", algorithm: "canonical-avatar-v2",
            checksum: "b133e02a7168778e265c2df168efb2f326729a3a4183ff9c350a2bba6aa90d43",
            contentType: "image/svg+xml",
          },
        },
      },
      review: {
        reviewedAt: "2026-07-18T09:54:06Z",
        reviewer: "codex-task7-gen4-independent-spec-review",
      },
    });
    expect(snapshot.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ pageId: 294322, revisionId: 4486594, title: "T1" }),
      expect.objectContaining({ pageId: 196774, revisionId: 4436217, title: "SK Telecom T1" }),
    ]));
    expect(snapshot.coverage).toMatchObject({
      from: "2013-09-15", to: "2025-11-09", rows: reviewedCoverageRows,
    });
    expect((snapshot.expected as { rows: Array<{ leftName?: string; rightName?: string }> }).rows)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ leftName: "T1", rightName: "Top Esports" }),
        expect.objectContaining({ leftName: "SK Telecom T1", rightName: "Royal Club" }),
      ]));
    expect((snapshot.expected as { rows: Array<{ leftName?: string; rightName?: string }> }).rows
      .every((row) => Boolean(row.leftName?.trim()) && Boolean(row.rightName?.trim()))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/synthetic|leaguepedia-small/iu);
  });

  it("rejects the retired version 1 acceptance schema instead of adapting it", async () => {
    const module = await import("../../data/src/acceptance.js");
    const legacy = { ...reviewedSnapshot(), schemaVersion: 1 };
    await expect(module.verifyAcceptanceSnapshot(legacy, dependencies())).resolves.toMatchObject({
      status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/schemaVersion/i)]),
    });
  });

  it("becomes ready only after canonical comparison and immutable raw verification", async () => {
    const module = await import("../../data/src/acceptance.js");
    const deps = dependencies();
    await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), deps)).resolves.toMatchObject({ status: "ready", blockers: [] });
    expect(deps.compare).toHaveBeenCalledWith(expect.objectContaining({ eventCategories: ["worlds"], bestOf: [5], limit: 100 }));
    expect(deps.getRawObject).toHaveBeenCalledWith("sources/leaguepedia/raw.json");
  });

  it("blocks a reviewed row when either historical team name differs from PostgreSQL", async () => {
    const module = await import("../../data/src/acceptance.js");
    const base = reviewedSnapshot();
    for (const row of [
      { ...base.expected.rows[0]!, leftName: "SK Telecom T1" },
      { ...base.expected.rows[0]!, rightName: "Top Esports" },
    ]) {
      const snapshot = reviewedSnapshot({ expected: { ...base.expected, rows: [row] } });
      await expect(module.verifyAcceptanceSnapshot(snapshot, dependencies())).resolves.toMatchObject({
        status: "blocked",
        blockers: expect.arrayContaining([expect.stringMatching(/chronological series rows/i)]),
      });
    }
  });

  it("rejects duplicate reviewed series and game IDs before invoking runtime dependencies", async () => {
    const module = await import("../../data/src/acceptance.js");
    const base = reviewedSnapshot();
    const row = base.expected.rows[0]!;
    const cases = [
      {
        rows: [row, { ...row, gameIds: [tournamentId] }],
        blocker: /expected\.rows\.1\.id: Duplicate reviewed series ID/u,
      },
      {
        rows: [{ ...row, gameIds: [gameId, gameId] }],
        blocker: /expected\.rows\.0\.gameIds\.1: Duplicate reviewed game ID/u,
      },
      {
        rows: [row, { ...row, id: tournamentId, gameIds: [gameId] }],
        blocker: /expected\.rows\.1\.gameIds\.0: Duplicate reviewed game ID/u,
      },
    ];

    for (const { rows, blocker } of cases) {
      const deps = dependencies();
      const snapshot = reviewedSnapshot({ expected: { ...base.expected, rows } });
      await expect(module.verifyAcceptanceSnapshot(snapshot, deps)).resolves.toMatchObject({
        status: "blocked",
        blockers: expect.arrayContaining([expect.stringMatching(blocker)]),
      });
      expect(deps.compare).not.toHaveBeenCalled();
      expect(deps.getRawObject).not.toHaveBeenCalled();
      expect(deps.getSourceMetadata).not.toHaveBeenCalled();
      expect(deps.getDatasetEvidence).not.toHaveBeenCalled();
      expect(deps.getMediaMetadata).not.toHaveBeenCalled();
      expect(deps.getAvatarIdentity).not.toHaveBeenCalled();
      expect(deps.generateAvatar).not.toHaveBeenCalled();
    }
  });

  it("requires the reviewed snapshot to declare exactly complete Leaguepedia Worlds coverage for 2013 through 2025", async () => {
    const module = await import("../../data/src/acceptance.js");
    const base = reviewedSnapshot();
    const rows = base.coverage.rows;
    const invalidRows = [
      rows.filter((row) => row.seasonYear !== 2019),
      rows.map((row) => row.seasonYear === 2019 ? { ...row, status: "partial" } : row),
      [...rows, { ...rows[0]!, seasonYear: 2026, earliestDate: "2026-10-01", latestDate: "2026-11-01" }],
      rows.map((row) => row.seasonYear === 2020 ? { ...row, seasonYear: 2019 } : row),
    ];

    for (const candidateRows of invalidRows) {
      const snapshot = reviewedSnapshot({ coverage: { ...base.coverage, rows: candidateRows } });
      await expect(module.verifyAcceptanceSnapshot(snapshot, dependencies())).resolves.toMatchObject({
        status: "blocked",
        blockers: expect.arrayContaining([expect.stringMatching(/Invalid acceptance snapshot.*coverage\.rows/iu)]),
      });
    }
  });

  it("blocks PostgreSQL coverage with missing, extra, partial, or date-drifted reviewed rows", async () => {
    const module = await import("../../data/src/acceptance.js");
    const variants = [
      reviewedCoverageRows.filter((row) => row.seasonYear !== 2019),
      [...reviewedCoverageRows, { ...reviewedCoverageRows[0]!, seasonYear: 2026, earliestDate: "2026-10-01", latestDate: "2026-11-01" }],
      reviewedCoverageRows.map((row) => row.seasonYear === 2020 ? { ...row, seasonYear: 2019 } : row),
      reviewedCoverageRows.map((row) => row.seasonYear === 2019 ? { ...row, status: "partial" } : row),
      reviewedCoverageRows.map((row) => row.seasonYear === 2019 ? { ...row, latestDate: "2019-11-02" } : row),
    ];

    for (const coverage of variants) {
      const deps = dependencies();
      const evidence = await deps.getDatasetEvidence("leaguepedia-reviewed-v1", [seriesId]);
      deps.getDatasetEvidence.mockResolvedValueOnce({ ...evidence, coverage });
      await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), deps)).resolves.toMatchObject({
        status: "blocked",
        blockers: expect.arrayContaining([expect.stringMatching(/coverage.*reviewed snapshot/iu)]),
      });
    }
  });

  it.each([
    "https://leaguepedia.acme.org/wiki/Leaguepedia:Copyrights",
    "https://leaguepedia.acme.org/wiki/Leaguepedia%3ACopyrights",
    "https://leaguepedia.acme.org/wiki/Leaguepedia%3aCopyrights",
  ])("accepts the exact Leaguepedia legal page spelling %s", async (url) => {
    const module = await import("../../data/src/acceptance.js");
    await expect(module.verifyAcceptanceSnapshot(
      reviewedSnapshot({ attribution: { provider: "Leaguepedia", url } }),
      dependencies(),
    )).resolves.toMatchObject({ status: "ready", blockers: [] });
  });

  it.each([
    "https://leaguepedia.acme.org/wiki/T1",
    "https://leaguepedia.acme.org/wiki/Leaguepedia:Copyrights/extra",
    "https://leaguepedia.acme.org/WIKI/Leaguepedia:Copyrights",
    "https://leaguepedia.acme.org/wiki/Leaguepedia:Copyrights?oldid=1",
    "https://leaguepedia.acme.org/wiki/Leaguepedia:Copyrights?",
    "https://leaguepedia.acme.org/wiki/Leaguepedia:Copyrights#section",
    "https://leaguepedia.acme.org/wiki/Leaguepedia:Copyrights#",
    "https://user@leaguepedia.acme.org/wiki/Leaguepedia:Copyrights",
    "https://user:password@leaguepedia.acme.org/wiki/Leaguepedia:Copyrights",
    "https://leaguepedia.acme.org:444/wiki/Leaguepedia:Copyrights",
    "http://leaguepedia.acme.org/wiki/Leaguepedia:Copyrights",
    "https://leaguepedia.acme.org/wiki/Leaguepedia%ZZCopyrights",
  ])("rejects non-canonical Leaguepedia legal-page URL %s", async (url) => {
    const module = await import("../../data/src/acceptance.js");
    await expect(module.verifyAcceptanceSnapshot(
      reviewedSnapshot({ attribution: { provider: "Leaguepedia", url } }),
      dependencies(),
    )).resolves.toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining([expect.stringMatching(/official Leaguepedia legal page/i)]),
    });
  });

  it("accepts generated avatars for both canonical subjects without querying retained media", async () => {
    const module = await import("../../data/src/acceptance.js");
    const deps = dependencies(generatedResponse());
    const snapshot = reviewedSnapshot({
      expected: { ...reviewedSnapshot().expected, media: { left: generatedLeft, right: generatedRight } },
    });

    await expect(module.verifyAcceptanceSnapshot(snapshot, deps)).resolves.toMatchObject({ status: "ready", blockers: [] });
    expect(deps.getAvatarIdentity).toHaveBeenCalledWith("team", leftId);
    expect(deps.getAvatarIdentity).toHaveBeenCalledWith("region", rightId);
    expect(deps.generateAvatar).toHaveBeenCalledWith(leftIdentity);
    expect(deps.generateAvatar).toHaveBeenCalledWith(rightIdentity);
    expect(deps.getMediaMetadata).not.toHaveBeenCalled();
    expect(deps.getRawObject).toHaveBeenCalledTimes(1);
  });

  it("accepts mixed retained and generated presentation evidence", async () => {
    const module = await import("../../data/src/acceptance.js");
    const response = generatedResponse();
    response.subjects.left.mediaUrl = "/media/media/t1.png";
    response.mediaUrls.left = response.subjects.left.mediaUrl;
    const deps = dependencies(response);
    const snapshot = reviewedSnapshot({
      expected: { ...reviewedSnapshot().expected, media: { left: retainedLeft, right: generatedRight } },
    });

    await expect(module.verifyAcceptanceSnapshot(snapshot, deps)).resolves.toMatchObject({ status: "ready", blockers: [] });
    expect(deps.getMediaMetadata).toHaveBeenCalledTimes(1);
    expect(deps.getMediaMetadata).toHaveBeenCalledWith("media/t1.png");
    expect(deps.generateAvatar).toHaveBeenCalledTimes(1);
    expect(deps.getAvatarIdentity).toHaveBeenCalledWith("region", rightId);
    expect(deps.generateAvatar).toHaveBeenCalledWith(rightIdentity);
  });

  it("rejects generated evidence with missing/wrong identity fields, v1 algorithm, checksum, or content type", async () => {
    const module = await import("../../data/src/acceptance.js");
    const wrongId = "99999999-9999-4999-8999-999999999999";
    const missingLabel = {
      kind: generatedLeft.kind, entityKind: generatedLeft.entityKind, entityId: generatedLeft.entityId,
      abbreviation: generatedLeft.abbreviation, algorithm: generatedLeft.algorithm,
      checksum: generatedLeft.checksum, contentType: generatedLeft.contentType,
    };
    const cases = [
      { left: missingLabel, blocker: /expected\.media\.left\.label/i },
      { left: { ...generatedLeft, label: "SK Telecom T1" }, blocker: /repository identity/i },
      { left: { ...generatedLeft, abbreviation: "SKT" }, blocker: /avatar abbreviation/i },
      { left: { ...generatedLeft, abbreviation: "t1" }, blocker: /expected\.media\.left\.abbreviation/i },
      { left: { ...generatedLeft, entityId: wrongId }, blocker: /subject identity/i },
      { left: { ...generatedLeft, entityKind: "player" }, blocker: /subject identity/i },
      { left: { ...generatedLeft, algorithm: "canonical-avatar-v1" }, blocker: /expected\.media\.left\.algorithm/i },
      { left: { ...generatedLeft, checksum: "0".repeat(64) }, blocker: /reviewed checksum/i },
      { left: { ...generatedLeft, contentType: "image/png" }, blocker: /expected\.media\.left\.contentType/i },
    ];

    for (const { left, blocker } of cases) {
      const snapshot = reviewedSnapshot({ expected: { ...reviewedSnapshot().expected, media: { left, right: generatedRight } } });
      await expect(module.verifyAcceptanceSnapshot(snapshot, dependencies(generatedResponse()))).resolves.toMatchObject({
        status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(blocker)]),
      });
    }
  });

  it("rejects generated evidence swapped between the left and right subjects", async () => {
    const module = await import("../../data/src/acceptance.js");
    const snapshot = reviewedSnapshot({
      expected: { ...reviewedSnapshot().expected, media: { left: generatedRight, right: generatedLeft } },
    });
    await expect(module.verifyAcceptanceSnapshot(snapshot, dependencies(generatedResponse()))).resolves.toMatchObject({
      status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/subject identity/i)]),
    });
  });

  it("rejects a generated avatar URL that is non-canonical or the generic placeholder", async () => {
    const module = await import("../../data/src/acceptance.js");
    const snapshot = reviewedSnapshot({
      expected: { ...reviewedSnapshot().expected, media: { left: generatedLeft, right: generatedRight } },
    });

    for (const mediaUrl of [
      `/avatars/v2/team/${rightId}.svg`,
      `/avatars/team/${leftId}.svg`,
      `/avatars/v2/team/${leftId}.svg?cache=1`,
      "/media-placeholder.svg",
    ]) {
      const response = generatedResponse();
      response.subjects.left.mediaUrl = mediaUrl;
      response.mediaUrls.left = mediaUrl;
      await expect(module.verifyAcceptanceSnapshot(snapshot, dependencies(response))).resolves.toMatchObject({
        status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/presentation|avatar|placeholder/i)]),
      });
    }
  });

  it("rejects generated bytes or metadata that do not match the reviewed evidence", async () => {
    const module = await import("../../data/src/acceptance.js");
    const snapshot = reviewedSnapshot({
      expected: { ...reviewedSnapshot().expected, media: { left: generatedLeft, right: generatedRight } },
    });
    const variants = [
      { ...leftAvatar, algorithm: "canonical-avatar-v1" as typeof leftAvatar.algorithm },
      { ...leftAvatar, contentType: "image/png" as typeof leftAvatar.contentType },
      { ...leftAvatar, checksum: "0".repeat(64) },
      { ...leftAvatar, body: Buffer.from("tampered") },
    ];

    for (const avatar of variants) {
      const deps = dependencies(generatedResponse());
      deps.generateAvatar.mockImplementation((identity) => identity.kind === "team" && identity.id === leftId ? avatar : generateCanonicalAvatar(identity));
      await expect(module.verifyAcceptanceSnapshot(snapshot, deps)).resolves.toMatchObject({
        status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/generated avatar/i)]),
      });
    }
  });

  it("blocks a page and revision pair assembled across separate response pages", async () => {
    const module = await import("../../data/src/acceptance.js");
    const crossPageBytes = Buffer.from(encodeLeaguepediaRawInput({
      ...rawInput,
      rawEvidence: [{
        requestId,
        action: "query",
        sourceUrl: requestUrl,
        revisionIds: [2],
        response: { query: { pages: [
          { pageid: 1, title: "T1", revisions: [{ revid: 999 }] },
          { pageid: 999, title: "T1", revisions: [{ revid: 2 }] },
        ] } },
      }],
    }));
    const crossPageChecksum = createHash("sha256").update(crossPageBytes).digest("hex");
    const deps = dependencies();
    deps.getRawObject.mockResolvedValueOnce(Readable.from([crossPageBytes]));
    deps.getSourceMetadata.mockResolvedValueOnce([{ ...(await dependencies().getSourceMetadata("x"))[0]!, checksum: crossPageChecksum }]);
    const snapshot = reviewedSnapshot({
      sources: [{
        pageId: 1, revisionId: 2, title: "T1", retrievedAt: "2026-07-13T00:00:00.000Z",
        objectKey: "sources/leaguepedia/raw.json", rawObjectChecksum: crossPageChecksum,
        requestId, requestUrl,
      }],
    });

    await expect(module.verifyAcceptanceSnapshot(snapshot, deps)).resolves.toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining([expect.stringMatching(/same page.*revision evidence/i)]),
    });
  });

  it("rejects a legacy root rawEvidence wrapper even when its evidence is otherwise valid", async () => {
    const module = await import("../../data/src/acceptance.js");
    const legacyBytes = Buffer.from(JSON.stringify({ sourceUrl: endpoint, rawEvidence: rawInput.rawEvidence }));
    const legacyChecksum = createHash("sha256").update(legacyBytes).digest("hex");
    const deps = dependencies();
    deps.getRawObject.mockResolvedValueOnce(Readable.from([legacyBytes]));
    deps.getSourceMetadata.mockResolvedValueOnce([{ ...(await dependencies().getSourceMetadata("x"))[0]!, checksum: legacyChecksum }]);
    const snapshot = reviewedSnapshot({ sources: [{
      pageId: 1, revisionId: 2, title: "T1", retrievedAt: "2026-07-13T00:00:00.000Z",
      objectKey: "sources/leaguepedia/raw.json", rawObjectChecksum: legacyChecksum, requestId, requestUrl,
    }] });

    await expect(module.verifyAcceptanceSnapshot(snapshot, deps)).resolves.toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining([expect.stringMatching(/canonical Leaguepedia raw wrapper/i)]),
    });
  });

  it("rejects attacker provenance and self-declared 999 totals", async () => {
    const module = await import("../../data/src/acceptance.js");
    const malicious = reviewedSnapshot({
      sources: [{ pageId: 1, revisionId: 2, title: "T1", retrievedAt: "2026-07-13T00:00:00.000Z", objectKey: "sources/leaguepedia/raw.json", rawObjectChecksum: checksum, requestId, requestUrl: "https://attacker.invalid/api.php?action=query&prop=info%7Crevisions&titles=T1" }],
      expected: { ...reviewedSnapshot().expected, seriesWins: 999, gameWins: 999 },
    });
    const result = await module.verifyAcceptanceSnapshot(malicious, dependencies());
    expect(result).toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/approved Leaguepedia endpoint/i), expect.stringMatching(/canonical series totals/i), expect.stringMatching(/canonical game totals/i)]) });
  });

  it("requires reviewed titles and both info and revisions in the exact request URL", async () => {
    const module = await import("../../data/src/acceptance.js");
    for (const invalidRequestUrl of [
      `${endpoint}?action=query&prop=info&rvprop=ids%7Ctimestamp&titles=T1`,
      `${endpoint}?action=query&prop=info%7Crevisions&rvprop=ids%7Ctimestamp&titles=Not-T1`,
    ]) {
      const snapshot = reviewedSnapshot({ sources: [{
        pageId: 1, revisionId: 2, title: "T1", retrievedAt: "2026-07-13T00:00:00.000Z",
        objectKey: "sources/leaguepedia/raw.json", rawObjectChecksum: checksum, requestId, requestUrl: invalidRequestUrl,
      }] });
      await expect(module.verifyAcceptanceSnapshot(snapshot, dependencies())).resolves.toMatchObject({
        status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/approved Leaguepedia endpoint known-page query/i)]),
      });
    }
  });

  it("blocks database failures, placeholder media, coverage warnings, and row drift", async () => {
    const module = await import("../../data/src/acceptance.js");
    const failed = dependencies(); failed.compare.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), failed)).resolves.toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining(["Acceptance dependency verification failed: comparison: database unavailable"]),
    });

    const drifted = canonicalResponse();
    drifted.mediaUrls.left = "/media/placeholder.svg";
    drifted.coverageWarnings = [{ code: "PARTIAL_EVENT_COVERAGE", message: "partial" }];
    drifted.rows[0] = { ...drifted.rows[0]!, id: "55555555-5555-4555-8555-555555555555" };
    const result = await module.verifyAcceptanceSnapshot(reviewedSnapshot(), dependencies(drifted));
    expect(result).toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/both canonical subjects.*presentation/i), expect.stringMatching(/coverage warnings/i), expect.stringMatching(/chronological series rows/i)]) });
  });

  it("reports the failing acceptance dependency stage without mislabeling it as comparison", async () => {
    const module = await import("../../data/src/acceptance.js");

    const dataset = dependencies();
    dataset.getDatasetEvidence.mockRejectedValueOnce(new Error("dataset audit unavailable"));
    await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), dataset)).resolves.toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining(["Acceptance dependency verification failed: dataset evidence: dataset audit unavailable"]),
    });

    const snapshot = reviewedSnapshot({
      expected: { ...reviewedSnapshot().expected, media: { left: generatedLeft, right: generatedRight } },
    });
    const resolver = dependencies(generatedResponse());
    resolver.getAvatarIdentity.mockRejectedValueOnce(new Error("avatar identity unavailable"));
    await expect(module.verifyAcceptanceSnapshot(snapshot, resolver)).resolves.toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining(["Acceptance dependency verification failed: left presentation: avatar identity unavailable"]),
    });

    const generator = dependencies(generatedResponse());
    generator.generateAvatar.mockImplementationOnce(() => { throw new Error("avatar generation failed"); });
    await expect(module.verifyAcceptanceSnapshot(snapshot, generator)).resolves.toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining(["Acceptance dependency verification failed: left presentation: avatar generation failed"]),
    });
  });

  it("blocks missing or checksum-mismatched immutable source objects", async () => {
    const module = await import("../../data/src/acceptance.js");
    const missing = dependencies(); missing.getRawObject.mockResolvedValueOnce(null);
    await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), missing)).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/immutable raw object.*missing/i)]) });
    const mismatch = dependencies(); mismatch.getRawObject.mockResolvedValueOnce(Readable.from([Buffer.from("tampered")]));
    await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), mismatch)).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/checksum mismatch/i)]) });
  });

  it("blocks raw objects that are not registered as PostgreSQL source provenance", async () => {
    const module = await import("../../data/src/acceptance.js");
    const deps = dependencies(); deps.getSourceMetadata.mockResolvedValueOnce([]);
    await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), deps)).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/registered PostgreSQL source provenance/i)]) });
  });

  it("blocks dataset/source provenance splicing, stale generations, missing audits, and game-set drift", async () => {
    const module = await import("../../data/src/acceptance.js");
    const cases = [
      [{ kind: "series" as const, id: seriesId, provider: "leaguepedia", publicationGeneration: "8", retiredGeneration: null, sourceObjectId }, { kind: "game" as const, id: gameId, seriesId, provider: "leaguepedia", publicationGeneration: "9", retiredGeneration: null, sourceObjectId }],
      [{ kind: "series" as const, id: seriesId, provider: "leaguepedia", publicationGeneration: "9", retiredGeneration: null, sourceObjectId: "77777777-7777-4777-8777-777777777777" }, { kind: "game" as const, id: gameId, seriesId, provider: "leaguepedia", publicationGeneration: "9", retiredGeneration: null, sourceObjectId: null }],
      [{ kind: "series" as const, id: seriesId, provider: "leaguepedia", publicationGeneration: "9", retiredGeneration: null, sourceObjectId }],
      [{ kind: "series" as const, id: seriesId, provider: "leaguepedia", publicationGeneration: "9", retiredGeneration: null, sourceObjectId }, { kind: "game" as const, id: gameId, seriesId, provider: "leaguepedia", publicationGeneration: "9", retiredGeneration: null, sourceObjectId }, { kind: "game" as const, id: "88888888-8888-4888-8888-888888888888", seriesId, provider: "leaguepedia", publicationGeneration: "9", retiredGeneration: null, sourceObjectId }],
    ];
    for (const facts of cases) {
      const deps = dependencies();
      deps.getDatasetEvidence.mockResolvedValueOnce({ dataset: { generation: "9", publishedAt: "2026-07-13T01:00:00.000Z" }, facts, coverage: reviewedCoverageRows });
      await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), deps)).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/dataset fact provenance|game facts/i)]) });
    }
  });

  it("verifies source retrieval timestamps and same-page titles", async () => {
    const module = await import("../../data/src/acceptance.js");
    const stale = dependencies();
    stale.getSourceMetadata.mockResolvedValueOnce([{ ...(await dependencies().getSourceMetadata("x"))[0]!, retrievedAt: "2026-07-13T00:00:00.001Z" }]);
    await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), stale)).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/retrieval timestamp/i)]) });

    const wrongTitleInput = { ...rawInput, rawEvidence: rawInput.rawEvidence.map((item) => ({ ...item, response: { query: { pages: [{ pageid: 1, title: "Not T1", revisions: [{ revid: 2 }] }] } } })) };
    const wrongTitleBytes = Buffer.from(encodeLeaguepediaRawInput(wrongTitleInput));
    const wrongTitleChecksum = createHash("sha256").update(wrongTitleBytes).digest("hex");
    const wrongTitle = dependencies();
    wrongTitle.getRawObject.mockResolvedValueOnce(Readable.from([wrongTitleBytes]));
    wrongTitle.getSourceMetadata.mockResolvedValueOnce([{ ...(await dependencies().getSourceMetadata("x"))[0]!, checksum: wrongTitleChecksum }]);
    const snapshot = reviewedSnapshot({ sources: [{ ...reviewedSnapshot().sources[0], rawObjectChecksum: wrongTitleChecksum }] });
    await expect(module.verifyAcceptanceSnapshot(snapshot, wrongTitle)).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/same page.*title/i)]) });
  });

  it("rejects the removed self-declared top-level retrieval timestamp", async () => {
    const module = await import("../../data/src/acceptance.js");
    await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot({ retrievedAt: "2026-07-13T00:00:00.000Z" }), dependencies())).resolves.toMatchObject({
      status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/unrecognized.*retrievedAt/i)]),
    });
  });

  it("rejects unknown fields in nested reviewed snapshot structures", async () => {
    const module = await import("../../data/src/acceptance.js");
    const base = reviewedSnapshot();
    const snapshots = [
      reviewedSnapshot({ sources: [{ ...base.sources[0], ignored: true }] }),
      reviewedSnapshot({ expected: { ...base.expected, rows: [{ ...base.expected.rows[0], ignored: true }] } }),
      reviewedSnapshot({ expected: { ...base.expected, media: { ...base.expected.media, ignored: true } } }),
      reviewedSnapshot({ review: { ...base.review, ignored: true } }),
    ];
    for (const snapshot of snapshots) {
      await expect(module.verifyAcceptanceSnapshot(snapshot, dependencies())).resolves.toMatchObject({
        status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/unrecognized.*ignored/i)]),
      });
    }
  });

  it("verifies both media objects against URL, database metadata, object bytes, and reviewed expectations", async () => {
    const module = await import("../../data/src/acceptance.js");
    const missing = dependencies(); missing.getMediaMetadata.mockResolvedValueOnce(null);
    await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), missing)).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/media metadata.*missing/i)]) });

    const tampered = dependencies(); tampered.getRawObject.mockImplementation(async (key: string) => Readable.from([key === "media/t1.png" ? Buffer.from("tampered") : key === "media/lpl.png" ? rightMediaBytes : rawBytes]));
    await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), tampered)).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/media checksum/i)]) });

    const swapped = reviewedSnapshot({ expected: { ...reviewedSnapshot().expected, media: { left: reviewedSnapshot().expected.media.right, right: reviewedSnapshot().expected.media.left } } });
    await expect(module.verifyAcceptanceSnapshot(swapped, dependencies())).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/reviewed media/i)]) });

    const wrongType = dependencies(); wrongType.getMediaMetadata.mockResolvedValueOnce({ objectKey: "media/t1.png", checksum: leftMediaChecksum, contentType: "image/jpeg", byteSize: String(leftMediaBytes.byteLength) });
    await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), wrongType)).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/content type/i)]) });

    for (const mediaUrl of ["https://attacker.invalid/media/x.png", "/media/../secret", "/media/placeholder.svg"]) {
      const response = canonicalResponse(); response.mediaUrls.left = mediaUrl; response.subjects.left.mediaUrl = mediaUrl;
      await expect(module.verifyAcceptanceSnapshot(reviewedSnapshot(), dependencies(response))).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/canonical media URL|retained media/i)]) });
    }
  });

  it("fails closed when retained media exceeds the acceptance byte ceiling", async () => {
    const module = await import("../../data/src/acceptance.js");
    const oversizedMedia = Buffer.alloc(10_000_001, 1);
    const oversizedChecksum = createHash("sha256").update(oversizedMedia).digest("hex");
    const deps = dependencies();
    deps.getRawObject.mockImplementation(async (key: string) => Readable.from([
      key === "media/t1.png" ? oversizedMedia : key === "media/lpl.png" ? rightMediaBytes : rawBytes,
    ]));
    deps.getMediaMetadata.mockImplementation(async (key: string) => key === "media/t1.png"
      ? { objectKey: key, checksum: oversizedChecksum, contentType: "image/png", byteSize: String(oversizedMedia.byteLength) }
      : key === "media/lpl.png" ? { objectKey: key, checksum: rightMediaChecksum, contentType: "image/png", byteSize: String(rightMediaBytes.byteLength) } : null);
    const snapshot = reviewedSnapshot({
      expected: {
        ...reviewedSnapshot().expected,
        media: { ...reviewedSnapshot().expected.media, left: { kind: "retained-media", checksum: oversizedChecksum, contentType: "image/png" } },
      },
    });

    await expect(module.verifyAcceptanceSnapshot(snapshot, deps)).resolves.toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining([expect.stringMatching(/exceeds 10000000 bytes/i)]),
    });
  });

  it("production composition reports missing runtime configuration as blocked", async () => {
    const module = await import("../src/acceptance-cli.js");
    await expect(module.runProductionAcceptanceCheck(undefined, {})).resolves.toMatchObject({ status: "blocked", blockers: expect.arrayContaining([expect.stringMatching(/runtime configuration/i)]) });
  });
});
