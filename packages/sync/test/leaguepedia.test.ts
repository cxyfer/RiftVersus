import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  LeaguepediaClient,
  LeaguepediaCargoEnvelopeError,
  LeaguepediaApiError,
  LeaguepediaSnapshotError,
  createLeaguepediaProvider,
  deriveLeaguepediaCoverage,
  fetchAllCargoPages,
  fetchLeaguepediaRawInput,
  fetchLeaguepediaSnapshot,
  loadOverrides,
  normalizeLeaguepediaSnapshot,
  parseLeaguepediaMedia,
  parseLeaguepediaRawInput,
  type LeaguepediaSnapshot,
  type LeaguepediaRawInput,
  type LeaguepediaCargoTable,
  type RawApiEvidence,
} from "../src/providers/leaguepedia/index.js";
import { RetainableStageError } from "../src/types.js";
import { decodeCargoExportRows } from "../src/providers/leaguepedia/cargo-export.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const fixturePath = `${root}/data/fixtures/leaguepedia-small.json`;

async function fixture(): Promise<LeaguepediaSnapshot> {
  return parseLeaguepediaRawInput(await rawFixture());
}
async function rawFixture(): Promise<LeaguepediaRawInput> { return JSON.parse(await readFile(fixturePath, "utf8")) as LeaguepediaRawInput; }
async function referencedSktFixture(): Promise<LeaguepediaSnapshot> {
  const input = await rawFixture();
  const current = parseLeaguepediaRawInput(input).entities.find((entity) => entity.sourceKey === "T1")!;
  const snapshot = parseLeaguepediaRawInput({
    ...input,
    rawEvidence: input.rawEvidence.map((item) => {
      if (item.table === "ScoreboardGames") return { ...item, response: (item.response as Record<string, unknown>[]).map((row) => ({ ...row, Team1: "SK Telecom T1" })) };
      if (item.table === "MatchSchedule") return { ...item, response: (item.response as Record<string, unknown>[]).map((row) => ({ ...row, Team1: "SK Telecom T1" })) };
      if (item.table === "ScoreboardPlayers") return { ...item, response: (item.response as Record<string, unknown>[]).map((row) => row.Team === "T1" ? { ...row, Team: "SK Telecom T1" } : row) };
      return item;
    }),
  });
  return {
    ...snapshot,
    entities: [
      ...snapshot.entities.map((entity) => entity.sourceKey === "SK Telecom T1" ? { ...entity, lineage: "T1" } : entity),
      current,
    ],
  };
}

async function currentCargoExportInput(): Promise<LeaguepediaRawInput> {
  const input = await rawFixture();
  const sourceCompetition = "Worlds 2024 Main Event";
  const slice = input.slices[0]!;
  const sliceId = `Worlds:${encodeURIComponent(sourceCompetition)}:${slice.seasonYear}:${slice.from}:${slice.to}`;
  return {
    ...input,
    slices: [{ ...slice, sliceId, sourceCompetition }],
    rawEvidence: input.rawEvidence.map((evidence) => {
      if (evidence.table === undefined) return evidence;
      const response = (evidence.response as Record<string, unknown>[]).map((row) => {
        if (evidence.table === "Tournaments") {
          return { ...row, OverviewPage: "2024 Season World Championship/Main Event", Name: "Worlds 2024 Main Event", StandardName: "Worlds 2024 Main Event", BasePage: "2024 Season World Championship" };
        }
        if (evidence.table === "ScoreboardGames") {
          return { ...row, Tournament: "Worlds 2024 Main Event" };
        }
        if (evidence.table === "MatchSchedule") {
          return { ...row, OverviewPage: "2024 Season World Championship/Main Event" };
        }
        return row;
      });
      const scope = evidence.scope === undefined ? undefined : { ...evidence.scope, sliceIds: [sliceId], competition: sourceCompetition };
      return { ...evidence, action: "cargoexport" as const, sourceUrl: `https://lol.example/wiki/Special:CargoExport?tables=${evidence.table}&offset=${evidence.offset ?? 0}&format=json`, response, ...(scope === undefined ? {} : { scope }) };
    }),
  };
}

async function overrides() {
  return loadOverrides({
    identities: `${root}/data/overrides/identities.yaml`,
    tournaments: `${root}/data/overrides/tournaments.yaml`,
    regions: `${root}/data/overrides/regions.yaml`,
    logicalFiles: { identities: "data/overrides/identities.yaml", tournaments: "data/overrides/tournaments.yaml", regions: "data/overrides/regions.yaml" },
  });
}

function rawEvidence(table: LeaguepediaCargoTable, offset: number, rows: readonly Record<string, unknown>[]): RawApiEvidence {
  const response = rows.map((row) => {
    if (table === "ScoreboardGames") {
      const { DateTime_UTC, N_GameInMatch, ...rest } = row;
      delete rest.BestOf;
      return { ...rest, DateTimeUTC: DateTime_UTC, GameNumber: N_GameInMatch };
    }
    if (table === "ScoreboardPlayers") {
      const { PlayerName, PlayerWin, ...rest } = row;
      return { ...rest, PlayerKey: PlayerName, PlayerDisplayName: PlayerName, PlayerWin: PlayerWin === 1 ? "Yes" : PlayerWin === 0 ? "No" : PlayerWin };
    }
    if (table === "MatchSchedule") {
      const { DateTime_UTC, ...rest } = row;
      return { ...rest, DateTimeUTC: DateTime_UTC };
    }
    return row;
  });
  return { requestId: `${table}:${offset}`, action: "cargoexport", table, offset, sourceUrl: `https://lol.example/wiki/Special:CargoExport?tables=${table}&offset=${offset}&format=json`, response, revisionIds: [] };
}

function cargoPage(table: LeaguepediaCargoTable, offset: number, rows: readonly Record<string, unknown>[]) {
  return { offset, rows, rawEvidence: rawEvidence(table, offset, rows) };
}
const standardTeamRedirects = [
  ["T1", "T1"], ["T1", "SKT"], ["T1", "SK Telecom T1"], ["Bilibili Gaming", "Bilibili Gaming"],
  ["Bilibili Gaming", "BLG"], ["Alpha Page", "Alpha"], ["Beta Page", "Beta"], ["Opponent", "Opponent"], ["A", "A"], ["B", "B"],
  ["Current T1", "Current T1"], ["Referenced Team", "Referenced Team"],
] as const;
function teamRedirectPage(offset: number, rows: readonly (readonly [string, string])[] = standardTeamRedirects) {
  return cargoPage("TeamRedirects", offset, rows.map(([_pageName, AllName]) => ({ _pageName, AllName })));
}
function playerRedirectPage(offset: number, rows: readonly (readonly [string, string])[] = [["Faker", "Faker"]]) {
  return cargoPage("PlayerRedirects", offset, rows.map(([OverviewPage, AllName]) => ({ OverviewPage, ID: OverviewPage, AllName })));
}
function matchSchedulePage(offset: number, rows: readonly Record<string, unknown>[]) {
  return cargoPage("MatchSchedule", offset, rows);
}
function playerRedirectCollisionClient(
  players: readonly Record<string, unknown>[],
  redirects: readonly (readonly [string, string])[],
) {
  return {
    fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, [{ OverviewPage: "T1", Name: "T1" }, { OverviewPage: "Opponent", Name: "Opponent" }]),
    fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset, [["T1", "T1"], ["Opponent", "Opponent"]]),
    fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, players),
    fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset, redirects),
    fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
    fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, [{ UniqueMatch: "M1", MatchId: "M1", OverviewPage: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", Team1: "T1", Team2: "Opponent", Team1Score: 1, Team2Score: 0, Winner: 1, BestOf: 1 }]),
    fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, [{
      GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z",
      N_GameInMatch: 1, Team1: "T1", Team2: "Opponent", Team1Score: 1, Team2Score: 0, Winner: 1,
    }]),
    fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, [{ GameId: "G1", PlayerName: "Dandy", Team: "T1", PlayerWin: 1 }]),
    fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
    fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
  };
}
function knownPagesResult(titles: readonly string[], firstRevisionId = 77) {
  const sourceUrl = `https://lol.example/api.php?action=query&prop=info%7Crevisions&rvprop=ids%7Ctimestamp&titles=${encodeURIComponent(titles.join("|"))}&format=json&formatversion=2`;
  const pages = titles.map((title, index) => ({ pageid: firstRevisionId + 1000 + index, title, revisions: [{ revid: firstRevisionId + index, timestamp: "2026-07-13T00:00:00Z" }] }));
  const response = { query: { pages } };
  return { data: response, rawEvidence: [{ requestId: `known:${titles.join("|")}`, action: "query" as const, sourceUrl, response, revisionIds: pages.map((page) => page.revisions[0]!.revid) }] };
}
function rawInput(snapshot: LeaguepediaSnapshot): LeaguepediaRawInput {
  return { provenance: snapshot.provenance, sourceUrl: snapshot.sourceUrl, slices: snapshot.slices.map(({ sliceId, competition, sourceCompetition, seasonYear, from, to }) => ({ sliceId, competition, sourceCompetition, seasonYear, from, to })), rawEvidence: snapshot.rawEvidence };
}

function retainedPlayerRowsForGameIds(input: LeaguepediaRawInput, gameIds: readonly string[]): Record<string, unknown>[] {
  const template = (input.rawEvidence.find((item) => item.table === "ScoreboardPlayers")!.response as Record<string, unknown>[])[0]!;
  return gameIds.map((gameId) => ({ ...template, GameId: gameId }));
}

async function multiSourceWorldsInput(): Promise<LeaguepediaRawInput> {
  const input = await rawFixture();
  const gamePage = input.rawEvidence.find((item) => item.table === "ScoreboardGames")!;
  const schedulePage = input.rawEvidence.find((item) => item.table === "MatchSchedule")!;
  const playerPage = input.rawEvidence.find((item) => item.table === "ScoreboardPlayers")!;
  const tournamentPage = input.rawEvidence.find((item) => item.table === "Tournaments")!;
  const original = (gamePage.response as Record<string, unknown>[])[0]!;
  const sourceCompetition = "2024 Worlds Play-In";
  const sliceId = "Worlds:2024%20Worlds%20Play-In:2024:2024-01-01:2025-01-01";
  const title = { ...original, GameId: "WORLD24-PLAYIN-G1", MatchId: "WORLD24-PLAYIN-M1", Tournament: sourceCompetition, DateTimeUTC: "2024-10-01T00:00:00Z", Team1Score: 1, Team2Score: 0, GameNumber: 1, Winner: 1 };
  return {
    ...input,
    slices: [...input.slices, { sliceId, competition: "Worlds", sourceCompetition, seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }],
    rawEvidence: input.rawEvidence.map((item) => item === tournamentPage ? { ...item, response: [...(item.response as unknown[]), { OverviewPage: sourceCompetition, Name: sourceCompetition, DateStart: "2024-09-01" }] } : item).concat(
      {
        ...schedulePage, requestId: "schedule:playin:0", offset: 0, scope: { sliceIds: [sliceId], matchIds: ["WORLD24-PLAYIN-M1"] },
        response: [{ UniqueMatch: "WORLD24-PLAYIN-M1", MatchId: "WORLD24-PLAYIN-M1", OverviewPage: sourceCompetition, DateTimeUTC: "2024-10-01T00:00:00Z", Team1: "T1", Team2: "Bilibili Gaming", Team1Score: 1, Team2Score: 0, Winner: 1, BestOf: 1 }],
      },
      {
        ...gamePage, requestId: "games:playin:0", offset: 0,
        scope: { sliceIds: [sliceId], competition: sourceCompetition, seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" },
        response: Array.from({ length: 500 }, () => title),
      },
      {
        ...playerPage, requestId: "players:playin:0", offset: 0,
        scope: { sliceIds: [sliceId], gameIds: ["WORLD24-PLAYIN-G1"] }, response: retainedPlayerRowsForGameIds(input, ["WORLD24-PLAYIN-G1"]),
      },
    ),
  };
}

async function duplicateGameWorldsInput(): Promise<LeaguepediaRawInput> {
  const input = await rawFixture();
  const gamePage = input.rawEvidence.find((item) => item.table === "ScoreboardGames")!;
  const playerPage = input.rawEvidence.find((item) => item.table === "ScoreboardPlayers")!;
  const sourceCompetition = input.slices[0]!.sourceCompetition;
  const sliceId = "Worlds:2024%20Season%20World%20Championship:2024:2024-07-01:2025-01-01";
  return {
    ...input,
    slices: [...input.slices, { sliceId, competition: "Worlds", sourceCompetition, seasonYear: 2024, from: "2024-07-01", to: "2025-01-01" }],
    rawEvidence: input.rawEvidence.map((item) => item === playerPage || item.table === "MatchSchedule"
      ? { ...item, scope: { ...item.scope, sliceIds: [...(item.scope?.sliceIds ?? []), sliceId] } }
      : item).concat(
      { ...gamePage, requestId: "games:duplicate:0", scope: { sliceIds: [sliceId], competition: sourceCompetition, seasonYear: 2024, from: "2024-07-01", to: "2025-01-01" } },
    ),
  };
}

async function twoCompleteSlicesInput(): Promise<LeaguepediaRawInput> {
  const input = await rawFixture();
  const firstSlice = input.slices[0]!;
  const secondSliceId = "Worlds:2024%20Season%20World%20Championship:2025:2025-01-01:2026-01-01";
  const cloneFactEvidence = (table: "MatchSchedule" | "ScoreboardGames" | "ScoreboardPlayers"): RawApiEvidence => {
    const original = input.rawEvidence.find((item) => item.table === table)!;
    const response = (original.response as Record<string, unknown>[]).map((row) => ({
      ...row,
      ...(typeof row.UniqueMatch === "string" ? { UniqueMatch: row.UniqueMatch.replace("WORLD24-FINAL", "WORLD25-FINAL") } : {}),
      ...(typeof row.MatchId === "string" ? { MatchId: row.MatchId.replace("WORLD24-FINAL", "WORLD25-FINAL") } : {}),
      ...(typeof row.GameId === "string" ? { GameId: row.GameId.replace("WORLD24-FINAL", "WORLD25-FINAL") } : {}),
      ...(typeof row.DateTimeUTC === "string" ? { DateTimeUTC: row.DateTimeUTC.replace("2024-11-02", "2025-11-02") } : {}),
    }));
    const scope = table === "MatchSchedule"
      ? { sliceIds: [secondSliceId], matchIds: ["WORLD25-FINAL"] }
      : table === "ScoreboardPlayers"
        ? { sliceIds: [secondSliceId], gameIds: response.map((row) => String(row.GameId)) }
        : { sliceIds: [secondSliceId], competition: firstSlice.sourceCompetition, seasonYear: 2025, from: "2025-01-01", to: "2026-01-01" };
    return { ...original, requestId: `${table}:2025:0`, offset: 0, scope, response };
  };
  return {
    ...input,
    slices: [...input.slices, {
      sliceId: secondSliceId,
      competition: "Worlds",
      sourceCompetition: firstSlice.sourceCompetition,
      seasonYear: 2025,
      from: "2025-01-01",
      to: "2026-01-01",
    }],
    rawEvidence: [
      ...input.rawEvidence,
      cloneFactEvidence("MatchSchedule"),
      cloneFactEvidence("ScoreboardGames"),
      cloneFactEvidence("ScoreboardPlayers"),
    ],
  };
}

function swapFactSliceScopes(input: LeaguepediaRawInput, table: "MatchSchedule" | "ScoreboardPlayers"): LeaguepediaRawInput {
  const evidence = input.rawEvidence.filter((item) => item.table === table);
  const firstSliceIds = evidence[0]!.scope!.sliceIds!;
  const secondSliceIds = evidence[1]!.scope!.sliceIds!;
  return {
    ...input,
    rawEvidence: input.rawEvidence.map((item) => item === evidence[0]
      ? { ...item, scope: { ...item.scope, sliceIds: secondSliceIds } }
      : item === evidence[1]
        ? { ...item, scope: { ...item.scope, sliceIds: firstSliceIds } }
        : item),
  };
}

function swapFactSliceScopesWithWidenedIds(input: LeaguepediaRawInput, table: "MatchSchedule" | "ScoreboardPlayers"): LeaguepediaRawInput {
  const swapped = swapFactSliceScopes(input, table);
  const scopeKey = table === "MatchSchedule" ? "matchIds" : "gameIds";
  const allIds = input.rawEvidence.filter((item) => item.table === table).flatMap((item) => item.scope?.[scopeKey] ?? []);
  return {
    ...swapped,
    rawEvidence: swapped.rawEvidence.map((item) => item.table === table
      ? { ...item, scope: { ...item.scope, [scopeKey]: allIds } }
      : item),
  };
}

function shareFactEvidenceAcrossSlices(input: LeaguepediaRawInput, table: "MatchSchedule" | "ScoreboardPlayers"): LeaguepediaRawInput {
  const evidence = input.rawEvidence.filter((item) => item.table === table);
  const scopeKey = table === "MatchSchedule" ? "matchIds" : "gameIds";
  const merged: RawApiEvidence = {
    ...evidence[0]!,
    requestId: `${table}:shared:0`,
    scope: {
      ...evidence[0]!.scope,
      sliceIds: input.slices.map((slice) => slice.sliceId),
      [scopeKey]: evidence.flatMap((item) => item.scope?.[scopeKey] ?? []),
    },
    response: evidence.flatMap((item) => item.response as Record<string, unknown>[]),
  };
  return {
    ...input,
    rawEvidence: input.rawEvidence.flatMap((item) => item === evidence[0] ? [merged] : item === evidence[1] ? [] : [item]),
  };
}

describe("LeaguepediaClient", () => {
  it("uses the official CargoExport transport with the reviewed current fields", async () => {
    const urls: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      urls.push(new URL(String(input)));
      return Response.json([]);
    });
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", requestIntervalMs: 0, fetch: fetchMock });

    await client.fetchTeamsPage({ offset: 0 });
    await client.fetchTeamRedirectsPage({ offset: 0 });
    await client.fetchPlayersPage({ offset: 0 });
    await client.fetchPlayerRedirectsPage({ offset: 0 });
    await client.fetchPlayerImagesPage({ offset: 0, playerPages: ["Faker (Player)"] });
    await client.fetchTournamentsPage({ offset: 0 });
    await client.fetchMatchSchedulesPage({ offset: 0, matchIds: ["M1"] });
    await client.fetchGamesPage({ offset: 0, from: "2024-01-01", to: "2024-12-31", competitions: ["Worlds"] });
    await client.fetchGamePlayersPage({ offset: 0, gameIds: ["g1"] });

    expect(urls.map((url) => url.searchParams.get("tables"))).toEqual(["Teams", "TeamRedirects", "Players", "PlayerRedirects", "PlayerRedirects=PR,PlayerImages=PI,Tournaments=T", "Tournaments", "MatchSchedule", "ScoreboardGames", "ScoreboardPlayers"]);
    for (const url of urls) {
      expect(url.origin + url.pathname).toBe("https://lol.example/wiki/Special:CargoExport");
      expect(url.searchParams.has("action")).toBe(false);
      expect(url.searchParams.get("format")).toBe("json");
      expect(url.searchParams.get("fields")).toBeTruthy();
      expect(url.searchParams.get("limit")).toBe("500");
    }
    expect(urls[0]!.searchParams.get("fields")).toBe("OverviewPage,Name,Short,Region,OrganizationPage,Image,RenamedTo");
    expect(urls[1]!.searchParams.get("fields")).toBe("_pageName,AllName");
    expect(urls[2]!.searchParams.get("fields")).toBe("OverviewPage,ID,Name,Player,Team,Image");
    expect(urls[3]!.searchParams.get("fields")).toBe("OverviewPage,ID,AllName");
    expect(urls[4]!.searchParams.get("join_on")).toBe("PR.AllName=PI.Link,PI.Tournament=T.OverviewPage");
    expect(urls[4]!.searchParams.get("where")).toBe('PI.IsProfileImage="1" AND PR._pageName IN (\'Faker (Player)\')');
    expect(urls[4]!.searchParams.get("order_by")).toBe("COALESCE(PI.SortDate,T.DateStartFuzzy,T.Date) DESC,PI.FileName ASC");
    expect(urls[4]!.searchParams.get("fields")).toContain("PR._pageName=PlayerPage");
    expect(urls[4]!.searchParams.get("fields")).toContain("PI.FileName");
    expect(urls[5]!.searchParams.get("fields")).toBe("OverviewPage,Name,Region,DateStart,StandardName,BasePage,AlternativeNames");
    expect(urls[6]!.searchParams.get("fields")).toBe("UniqueMatch,MatchId,OverviewPage,DateTime_UTC=DateTimeUTC,Team1,Team2,Team1Score,Team2Score,Winner,BestOf");
    expect(urls[7]!.searchParams.get("fields")).not.toMatch(/BestOf|Team1Score|Team2Score/);
    expect(urls[7]!.searchParams.get("fields")).toMatch(/DateTime_UTC=DateTimeUTC/);
    expect(urls[8]!.searchParams.get("fields")).toMatch(/Link=PlayerKey/);
    expect(urls[8]!.searchParams.get("fields")).toMatch(/Name=PlayerDisplayName/);
  });

  it("exposes no generic parameter passthrough and only query/cargoquery requests", async () => {
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", fetch: async () => Response.json({ query: { general: {} } }) });
    expect("request" in client).toBe(false);
    expect("cargo" in client).toBe(false);
    expect("query" in client).toBe(false);
    expect(() => client.fetchGamesPage({ offset: 0, from: "bad' date", to: "2024-12-31", competitions: [] })).toThrow(/date/i);
  });

  it("returns immutable evidence for a bounded known-page revision query", async () => {
    const urls: URL[] = [];
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com",
      fetch: async (input) => {
        urls.push(new URL(String(input)));
        return Response.json({ query: { pages: [{ pageid: 10, title: "Bilibili Gaming", revisions: [{ revid: 20, timestamp: "2026-07-13T00:00:00Z" }] }] } });
      },
    });

    const result = await client.fetchKnownPagesWithEvidence(["Bilibili Gaming"]);
    expect(result.rawEvidence).toHaveLength(1);
    expect(result.rawEvidence[0]).toMatchObject({ action: "query", revisionIds: [20], response: result.data });
    expect(urls[0]?.searchParams.get("prop")?.split("|").sort()).toEqual(["info", "revisions"]);
    expect(urls[0]?.searchParams.get("rvprop")?.split("|").sort()).toEqual(["ids", "timestamp"]);
    expect(urls[0]?.searchParams.get("titles")).toBe("Bilibili Gaming");
  });

  it("serializes query and Cargo request starts through one default pacing gate", async () => {
    let now = 0;
    const starts: number[] = [];
    const sleeps: number[] = [];
    const releaseSleeps: Array<() => void> = [];
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php",
      userAgent: "RiftVersus/0.1 contact@example.com",
      now: () => now,
      sleep: (milliseconds) => new Promise<void>((resolve) => {
        sleeps.push(milliseconds);
        releaseSleeps.push(() => {
          now += milliseconds;
          resolve();
        });
      }),
      fetch: async (input) => {
        starts.push(now);
        const url = new URL(String(input));
        return url.pathname.endsWith("/Special:CargoExport")
          ? Response.json([])
          : Response.json({ query: { general: {}, pages: [] } });
      },
    });

    const requests = Promise.all([
      client.fetchSiteInfo(),
      client.fetchTeamsPage({ offset: 0 }),
      client.fetchKnownPagesWithEvidence(["T1"]),
    ]);

    await vi.waitFor(() => { expect(starts).toEqual([0]); });
    expect(sleeps).toEqual([1_000]);
    releaseSleeps.shift()?.();
    await vi.waitFor(() => { expect(starts).toEqual([0, 1_000]); });
    expect(sleeps).toEqual([1_000, 1_000]);
    releaseSleeps.shift()?.();
    await requests;

    expect(starts).toEqual([0, 1_000, 2_000]);
    expect(sleeps).toEqual([1_000, 1_000]);
  });

  it("honors bounded Retry-After and succeeds within the retry limit", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", maxRetries: 2, requestIntervalMs: 0,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      fetch: async () => ++calls === 1 ? new Response("busy", { status: 429, headers: { "Retry-After": "999" } }) : Response.json({ query: { general: { sitename: "Leaguepedia" } } }),
    });
    await expect(client.fetchSiteInfo()).resolves.toMatchObject({ query: { general: { sitename: "Leaguepedia" } } });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([30_000]);
  });

  it("uses conservative backoff for HTTP 429 without Retry-After", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php",
      userAgent: "RiftVersus/0.1 contact@example.com",
      maxRetries: 1,
      requestIntervalMs: 0,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      fetch: async () => ++calls === 1
        ? new Response("busy", { status: 429 })
        : Response.json({ query: { general: {} } }),
    });

    await client.fetchSiteInfo();
    expect(calls).toBe(2);
    expect(sleeps).toEqual([30_000]);
  });

  it("honors bounded HTTP-date Retry-After using the injected clock", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const now = Date.parse("2026-07-12T00:00:00Z");
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", maxRetries: 1, requestIntervalMs: 0, now: () => now,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      fetch: async () => ++calls === 1 ? new Response("busy", { status: 503, headers: { "Retry-After": "Sun, 12 Jul 2026 00:01:00 GMT" } }) : Response.json({ query: { general: {} } }),
    });
    await client.fetchSiteInfo();
    expect(sleeps).toEqual([30_000]);
  });

  it("follows allow-listed MediaWiki continuation without exposing its parameters", async () => {
    const urls: URL[] = [];
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", requestIntervalMs: 0,
      fetch: async (input) => {
        const url = new URL(String(input));
        urls.push(url);
        return url.searchParams.has("iicontinue")
          ? Response.json({ query: { pages: [{ pageid: 2 }] } })
          : Response.json({ continue: { continue: "||", iicontinue: "next" }, query: { pages: [{ pageid: 1 }] } });
      },
    });
    const result = await client.fetchImageInfo(["T1.png"]);
    expect((result.query as { pages: unknown[] }).pages).toHaveLength(2);
    expect(urls[1]?.searchParams.get("action")).toBe("query");
    expect(urls[1]?.searchParams.get("format")).toBe("json");
    expect(urls[1]?.searchParams.get("iicontinue")).toBe("next");
  });

  it("aborts timed-out requests and stops after bounded retries", async () => {
    let calls = 0;
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", timeoutMs: 5, maxRetries: 1, requestIntervalMs: 0, sleep: async () => {},
      fetch: async (_input, init) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      },
    });
    await expect(client.fetchSiteInfo()).rejects.toThrow(/aborted/i);
    expect(calls).toBe(2);
  });

  it("retries bounded maxlag API error envelopes and preserves the final one", async () => {
    const sleeps: number[] = []; let calls = 0;
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", maxRetries: 2, requestIntervalMs: 0, sleep: async (ms) => { sleeps.push(ms); }, fetch: async () => { calls += 1; return Response.json(calls < 2 ? { error: { code: "maxlag", lag: 2 } } : { query: { general: {} } }); } });
    await expect(client.fetchSiteInfo()).resolves.toHaveProperty("query");
    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);

    const failing = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", maxRetries: 0, fetch: async () => Response.json({ error: { code: "maxlag", lag: 4, info: "busy" } }) });
    const error = await failing.fetchSiteInfo().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(LeaguepediaApiError);
    expect((error as LeaguepediaApiError).code).toBe("maxlag");
    expect((error as LeaguepediaApiError).rawEvidence.response).toEqual({ error: { code: "maxlag", lag: 4, info: "busy" } });
  });

  it("fails fast when a ratelimited envelope supplies no retry guidance", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php",
      userAgent: "RiftVersus/0.1 contact@example.com",
      maxRetries: 2,
      requestIntervalMs: 0,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      fetch: async () => {
        calls += 1;
        return Response.json({ error: { code: "ratelimited", info: "rate limit exceeded" } });
      },
    });

    await expect(client.fetchSiteInfo()).rejects.toThrow(/retry the sync later/i);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("honors capped Retry-After for a ratelimited API envelope", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php",
      userAgent: "RiftVersus/0.1 contact@example.com",
      maxRetries: 1,
      requestIntervalMs: 0,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? Response.json({ error: { code: "ratelimited" } }, { headers: { "Retry-After": "999" } })
          : Response.json({ query: { general: {} } });
      },
    });

    await client.fetchSiteInfo();
    expect(calls).toBe(2);
    expect(sleeps).toEqual([30_000]);
  });

  it("fails non-retryable API errors immediately", async () => {
    let calls = 0;
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", maxRetries: 2, fetch: async () => { calls += 1; return Response.json({ error: { code: "badvalue" } }); } });
    await expect(client.fetchSiteInfo()).rejects.toBeInstanceOf(LeaguepediaApiError);
    expect(calls).toBe(1);
  });

  it("cancels a declared oversized response before JSON parsing", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new TextEncoder().encode("{}")); }, cancel() { cancelled = true; } });
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", maxResponseBytes: 10, fetch: async () => new Response(body, { headers: { "Content-Length": "100" } }) });
    await expect(client.fetchSiteInfo()).rejects.toThrow(/byte limit/);
    expect(cancelled).toBe(true);
  });

  it("consumes a bounded non-2xx body before failing", async () => {
    let consumed = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { consumed = true; controller.enqueue(new TextEncoder().encode("busy")); controller.close(); } });
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", maxRetries: 0, fetch: async () => new Response(body, { status: 503 }) });
    await expect(client.fetchSiteInfo()).rejects.toThrow("503");
    expect(consumed).toBe(true);
  });

  it.each([
    ["non-array object", {}],
    ["legacy cargoquery wrapper", { cargoquery: [] }],
    ["non-object item", ["bad"]],
  ])("rejects %s while preserving the raw response", async (_label, response) => {
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", fetch: async () => Response.json(response) });
    const failure = await client.fetchTeamsPage({ offset: 0 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LeaguepediaCargoEnvelopeError);
    expect((failure as LeaguepediaCargoEnvelopeError).rawEvidence.response).toEqual(response);
  });

  it("accepts an explicit empty CargoExport array as zero rows", async () => {
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", fetch: async () => Response.json([]) });
    await expect(client.fetchTeamsPage({ offset: 0 })).resolves.toMatchObject({ rows: [] });
  });

  it("restores numeric-looking Cargo string fields without coercing scores", async () => {
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", requestIntervalMs: 0,
      fetch: async (input) => {
        const table = new URL(String(input)).searchParams.get("tables");
        if (table === "Teams") return Response.json([{ OverviewPage: "300 (North American Team)", Name: 300, Short: 300 }]);
        if (table === "ScoreboardPlayers") return Response.json([{ GameId: "G1", PlayerWin: "Yes", PlayerDisplayName: 369, PlayerKey: 369, Team: "Top Esports" }]);
        if (table === "ScoreboardGames") return Response.json([{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTimeUTC: "2024-01-01 00:00:00", GameNumber: 1, Team1: "T1", Team2: "BLG", Team1Score: 1, Team2Score: 0, Winner: 1 }]);
        return Response.json([]);
      },
    });

    await expect(client.fetchTeamsPage({ offset: 0 })).resolves.toMatchObject({ rows: [{ OverviewPage: "300 (North American Team)", Name: "300", Short: "300" }] });
    await expect(client.fetchGamePlayersPage({ offset: 0, gameIds: ["G1"] })).resolves.toMatchObject({ rows: [{ PlayerName: "369", PlayerDisplayName: "369", PlayerKey: "369" }] });
    await expect(client.fetchGamesPage({ offset: 0, from: "2024-01-01", to: "2025-01-01", competitions: ["Worlds"] })).resolves.toMatchObject({ rows: [{ Team1Score: 1, Team2Score: 0, Winner: 1, N_GameInMatch: 1 }] });
  });
});

describe("Leaguepedia fetching", () => {
  it("retains the referenced player ID separately from the real name", async () => {
    const snapshot = await fixture();
    expect(snapshot.entities.find((entity) => entity.playerId === "Faker")).toMatchObject({
      kind: "player",
      sourceKey: "Faker (Player)",
      playerId: "Faker",
      displayName: "Lee Sang-hyeok",
    });
  });

  it("fails closed when a referenced player lacks an ID", async () => {
    const input = await rawFixture();
    const missingId = {
      ...input,
      rawEvidence: input.rawEvidence.map((evidence) => evidence.table === "Players"
        ? { ...evidence, response: (evidence.response as Record<string, unknown>[]).map((row) => row.ID === "Faker" ? { ...row, ID: undefined } : row) }
        : evidence),
    };
    expect(() => parseLeaguepediaRawInput(missingId)).toThrow(/player Faker \(Player\) ID is required/i);
  });

  it("replays current CargoExport arrays without guessing removed fields", async () => {
    const snapshot = parseLeaguepediaRawInput(await currentCargoExportInput());
    expect(snapshot.series).toEqual([
      expect.objectContaining({ sourceKey: "WORLD24-FINAL", tournamentKey: "2024 Season World Championship/Main Event", bestOf: 5, sideAScore: 3, sideBScore: 2 }),
    ]);
    expect(snapshot.games).toHaveLength(5);
    expect(snapshot.gamePlayers).toHaveLength(50);
    expect(snapshot.gamePlayers.find((player) => player.playerKey === "Faker (Player)" && player.gameKey === "WORLD24-FINAL-G2")?.playerWin).toBe(true);
    expect(normalizeLeaguepediaSnapshot(snapshot, await overrides()).dimensions.tournaments).toEqual([
      expect.objectContaining({ id: "22222222-2222-5222-8222-222222222222", sourceKey: "2024 Season World Championship/Main Event", name: "Worlds 2024" }),
    ]);
  });

  it("uses MatchSchedule as the sole final-score and BestOf owner", async () => {
    const input = await currentCargoExportInput();
    const misleadingGameScores = {
      ...input,
      rawEvidence: input.rawEvidence.map((evidence) => evidence.table === "ScoreboardGames"
        ? { ...evidence, response: (evidence.response as Record<string, unknown>[]).map((row) => ({ ...row, Team1Score: 99, Team2Score: 99, BestOf: 1 })) }
        : evidence),
    };
    expect(parseLeaguepediaRawInput(misleadingGameScores).series).toEqual([
      expect.objectContaining({ sourceKey: "WORLD24-FINAL", bestOf: 5, sideAScore: 3, sideBScore: 2 }),
    ]);
  });

  it("uses the earliest actual game time for series playedAt even when schedule and rows differ", async () => {
    const input = await currentCargoExportInput();
    const actualTimes = ["2024-11-02T23:20:00Z", "2024-11-02T23:00:00Z", "2024-11-02T23:30:00Z", "2024-11-02T23:40:00Z", "2024-11-02T23:50:00Z"];
    const actual = {
      ...input,
      rawEvidence: input.rawEvidence.map((evidence) => {
        if (evidence.table === "ScoreboardGames") return { ...evidence, response: (evidence.response as Record<string, unknown>[]).map((row, index) => ({ ...row, DateTimeUTC: actualTimes[index] })) };
        if (evidence.table === "MatchSchedule") return { ...evidence, response: (evidence.response as Record<string, unknown>[]).map((row) => ({ ...row, DateTimeUTC: "2024-11-03T00:00:00Z" })) };
        return evidence;
      }),
    };
    const snapshot = parseLeaguepediaRawInput(actual);
    expect(snapshot.series[0]?.playedAt).toBe("2024-11-02T23:00:00Z");
    expect(snapshot.games.map((game) => game.playedAt)).toEqual(actualTimes);
    const reviewed = await overrides();
    expect(() => normalizeLeaguepediaSnapshot(snapshot, reviewed)).not.toThrow();
  });

  it.each(["", "not-a-timestamp"])("fails closed when an actual game timestamp is %j", async (DateTimeUTC) => {
    const input = await currentCargoExportInput();
    const invalid = { ...input, rawEvidence: input.rawEvidence.map((evidence) => evidence.table === "ScoreboardGames"
      ? { ...evidence, response: (evidence.response as Record<string, unknown>[]).map((row, index) => index === 0 ? { ...row, DateTimeUTC } : row) }
      : evidence) };
    expect(() => parseLeaguepediaRawInput(invalid)).toThrow(/timestamp.*(?:required|invalid)/i);
  });

  it("joins MatchSchedule by MatchId while retaining a distinct non-empty UniqueMatch identity", async () => {
    const input = await currentCargoExportInput();
    const distinctIdentity = { ...input, rawEvidence: input.rawEvidence.map((evidence) => evidence.table === "MatchSchedule"
      ? { ...evidence, response: (evidence.response as Record<string, unknown>[]).map((row) => ({ ...row, UniqueMatch: "2024 Season World Championship/Main Event/2_FINAL" })) }
      : evidence) };
    expect(parseLeaguepediaRawInput(distinctIdentity).series).toEqual([
      expect.objectContaining({ sourceKey: "WORLD24-FINAL", bestOf: 5, sideAScore: 3, sideBScore: 2 }),
    ]);
  });

  it("fails closed when MatchSchedule UniqueMatch identity is empty", async () => {
    const input = await currentCargoExportInput();
    const missingIdentity = { ...input, rawEvidence: input.rawEvidence.map((evidence) => evidence.table === "MatchSchedule"
      ? { ...evidence, response: (evidence.response as Record<string, unknown>[]).map((row) => ({ ...row, UniqueMatch: "" })) }
      : evidence) };
    expect(() => parseLeaguepediaRawInput(missingIdentity)).toThrow(/UniqueMatch.*required/i);
  });

  it("accepts reversed game sides only when they match the MatchSchedule pair", async () => {
    const input = await currentCargoExportInput();
    const reversed = {
      ...input,
      rawEvidence: input.rawEvidence.map((evidence) => {
        if (evidence.table === "MatchSchedule") return { ...evidence, response: (evidence.response as Record<string, unknown>[]).map((row) => ({ ...row, Team1Score: 1, Team2Score: 2, Winner: 2, BestOf: 3 })) };
        if (evidence.table === "ScoreboardGames") return { ...evidence, response: (evidence.response as Record<string, unknown>[]).slice(0, 3).map((row, index) => index === 1
          ? { ...row, Team1: "Bilibili Gaming", Team2: "T1", Winner: 2 }
          : { ...row, Winner: 2 }) };
        if (evidence.table === "ScoreboardPlayers") return { ...evidence, response: (evidence.response as Record<string, unknown>[]).filter((row) => ["WORLD24-FINAL-G1", "WORLD24-FINAL-G2", "WORLD24-FINAL-G3"].includes(String(row.GameId))) };
        return evidence;
      }),
    };
    const snapshot = parseLeaguepediaRawInput(reversed);
    expect(snapshot.series).toEqual([
      expect.objectContaining({ sourceKey: "WORLD24-FINAL", bestOf: 3, sideAScore: 1, sideBScore: 2 }),
    ]);
    const normalized = normalizeLeaguepediaSnapshot(snapshot, await overrides());
    expect(normalized.facts.games?.find((game) => game.gameNumber === 2)).toMatchObject({
      sideATeamId: normalized.entityIds.get("Bilibili Gaming"),
      sideBTeamId: normalized.entityIds.get("T1"),
      winnerTeamId: normalized.entityIds.get("T1"),
    });
  });

  it("keeps distinct complete MatchIds as distinct series", async () => {
    const input = await currentCargoExportInput();
    const gameIds = ["G1", "G2"];
    const distinct = {
      ...input,
      rawEvidence: input.rawEvidence.map((evidence) => {
        if (evidence.table === "ScoreboardGames") return { ...evidence, response: (evidence.response as Record<string, unknown>[]).slice(0, 2).map((row, index) => ({ ...row, GameId: `G${index + 1}`, MatchId: `2024 Season World Championship/Main Event_Round 3_${index + 1}`, GameNumber: 1, Winner: 1 })) };
        if (evidence.table === "MatchSchedule") return { ...evidence, scope: { ...evidence.scope, matchIds: ["2024 Season World Championship/Main Event_Round 3_1", "2024 Season World Championship/Main Event_Round 3_2"] }, response: [1, 2].map((number) => ({
          UniqueMatch: `2024 Season World Championship/Main Event_Round 3_${number}`, MatchId: `2024 Season World Championship/Main Event_Round 3_${number}`,
          OverviewPage: "2024 Season World Championship/Main Event", DateTimeUTC: `2024-11-02T1${number + 3}:00:00Z`, Team1: "T1", Team2: "Bilibili Gaming", Team1Score: 1, Team2Score: 0, Winner: 1, BestOf: 1,
        })) };
        if (evidence.table === "ScoreboardPlayers") return { ...evidence, scope: { ...evidence.scope, gameIds }, response: retainedPlayerRowsForGameIds(input, gameIds) };
        return evidence;
      }),
    };
    expect(parseLeaguepediaRawInput(distinct).series.map((series) => series.sourceKey)).toEqual([
      "2024 Season World Championship/Main Event_Round 3_1",
      "2024 Season World Championship/Main Event_Round 3_2",
    ]);
  });

  it("retains the MatchSchedule result when retained game rows are incomplete", async () => {
    const input = await currentCargoExportInput();
    const broken = {
      ...input,
      rawEvidence: input.rawEvidence.map((evidence) => evidence.table === "ScoreboardGames"
        ? { ...evidence, response: (evidence.response as Record<string, unknown>[]).slice(0, 4) }
        : evidence),
    };
    const parsed = parseLeaguepediaRawInput(broken);
    expect(parsed.series[0]).toMatchObject({ sideAScore: 3, sideBScore: 2 });
    expect(parsed.games).toHaveLength(4);
  });

  it.each([
    [0, 0], [2, 2], [4, 0], [3, 3],
  ])("rejects invalid MatchSchedule final score %i-%i", async (left, right) => {
    const input = await currentCargoExportInput();
    const broken = {
      ...input,
      rawEvidence: input.rawEvidence.map((evidence) => evidence.table === "MatchSchedule"
        ? { ...evidence, response: (evidence.response as Record<string, unknown>[]).map((row) => ({ ...row, Team1Score: left, Team2Score: right })) }
        : evidence),
    };
    expect(() => parseLeaguepediaRawInput(broken)).toThrow(/completed score|BestOf|final score/i);
  });

  it.each([
    ["missing", (input: LeaguepediaRawInput) => ({ ...input, rawEvidence: input.rawEvidence.filter((evidence) => evidence.table !== "MatchSchedule") }), /exactly one retained MatchSchedule row/i],
    ["duplicate", (input: LeaguepediaRawInput) => ({ ...input, rawEvidence: input.rawEvidence.map((evidence) => evidence.table === "MatchSchedule" ? { ...evidence, response: [...(evidence.response as unknown[]), ...(evidence.response as unknown[])] } : evidence) }), /exactly one retained MatchSchedule row/i],
    ["orphan", (input: LeaguepediaRawInput) => ({ ...input, rawEvidence: input.rawEvidence.map((evidence) => evidence.table === "MatchSchedule" ? { ...evidence, response: [...(evidence.response as Record<string, unknown>[]), { ...(evidence.response as Record<string, unknown>[])[0], UniqueMatch: "ORPHAN", MatchId: "ORPHAN" }] } : evidence) }), /orphan MatchSchedule/i],
  ])("fails closed on a %s MatchSchedule owner row", async (_label, mutate, expected) => {
    const input = mutate(await currentCargoExportInput());
    expect(() => parseLeaguepediaRawInput(input)).toThrow(expected);
  });

  it("fails closed when MatchSchedule teams do not match the game pair", async () => {
    const input = await currentCargoExportInput();
    const broken = { ...input, rawEvidence: input.rawEvidence.map((evidence) => evidence.table === "MatchSchedule"
      ? { ...evidence, response: (evidence.response as Record<string, unknown>[]).map((row) => ({ ...row, Team1: "SK Telecom T1" })) }
      : evidence) };
    expect(() => parseLeaguepediaRawInput(broken)).toThrow(/teams.*game pair|sides.*schedule/i);
  });

  it.each([
    ["winner", { Winner: 2 }, /winner.*final score/i],
    ["score", { Team1Score: 3, Team2Score: 1 }, /game rows conflict with final score|game rows do not exactly explain final score|game count/i],
    ["BestOf", { BestOf: 3 }, /BestOf.*inconsistent|inconsistent.*BestOf/i],
  ])("fails closed on MatchSchedule %s conflict", async (_label, replacement, expected) => {
    const input = await currentCargoExportInput();
    const broken = { ...input, rawEvidence: input.rawEvidence.map((evidence) => evidence.table === "MatchSchedule"
      ? { ...evidence, response: (evidence.response as Record<string, unknown>[]).map((row) => ({ ...row, ...replacement })) }
      : evidence) };
    expect(() => parseLeaguepediaRawInput(broken)).toThrow(expected);
  });

  it("follows offset pagination until a short page", async () => {
    const offsets: number[] = [];
    const pages = await fetchAllCargoPages(async (offset) => {
      offsets.push(offset);
      const rows = offset === 0 ? Array.from({ length: 500 }, (_, index) => ({ id: index })) : [{ id: 500 }];
      return cargoPage("Teams", offset, rows);
    });
    expect(offsets).toEqual([0, 500]);
    expect(pages.rows).toHaveLength(501);
    expect(pages.evidence).toEqual({ requestedPages: 2, visitedPages: 2, complete: true });
  });

  it("enforces Cargo page, traversal page, and slice bounds", async () => {
    await expect(fetchAllCargoPages(async (offset) => cargoPage("Teams", offset, Array.from({ length: 501 }, (_, id) => ({ id }))))).rejects.toThrow(/500 rows/);
    const bounded = await fetchAllCargoPages(async (offset) => cargoPage("Teams", offset, Array.from({ length: 500 }, (_, id) => ({ id }))), 2);
    expect(bounded.evidence).toEqual({ requestedPages: 3, visitedPages: 2, complete: false });
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, []), fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset), fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []), fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, []), fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []), fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, []),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []), fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }), fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    };
    await expect(fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/wiki", slices: Array.from({ length: 101 }, (_, seasonYear) => ({ competition: "Worlds", seasonYear, from: "2024-01-01", to: "2025-01-01" })) })).rejects.toThrow(/100/);
    expect((await fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/wiki", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] })).provenance).toEqual({ kind: "live" });
  });

  it("limits concurrent slice requests to four", async () => {
    let active = 0; let maximum = 0;
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, []), fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset), fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []), fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, []),
      fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }: { offset: number }) => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 1)); active -= 1; return cargoPage("ScoreboardGames", offset, []); },
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []), fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }), fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    };
    await fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/wiki", slices: Array.from({ length: 12 }, (_, index) => ({ competition: `C${index}`, seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" })) });
    expect(maximum).toBeLessThanOrEqual(4);
  });

  it("limits concurrent player chunk traversals to four", async () => {
    let active = 0; let maximum = 0;
    const gameRows = Array.from({ length: 401 }, (_, index) => ({
      GameId: `G${index}`, MatchId: `M${index}`, Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z",
      BestOf: 1, N_GameInMatch: 1, Team1: "T1", Team2: "BLG", Team1Score: 1, Team2Score: 0, Winner: 1,
    }));
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, [{ OverviewPage: "T1", Name: "T1" }, { OverviewPage: "BLG", Name: "BLG" }]), fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset, [["T1", "T1"], ["BLG", "BLG"]]), fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []), fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, []), fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []), fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, gameRows),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 1)); active -= 1; return cargoPage("ScoreboardPlayers", offset, []); },
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }), fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    };
    await fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/wiki", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] });
    expect(maximum).toBeLessThanOrEqual(4);
    expect(maximum).toBeGreaterThan(1);
  });

  it("maps more than 100 game teams to unique OverviewPages in 50-title batches with concurrency four", async () => {
    const teams = Array.from({ length: 102 }, (_, index) => ({ OverviewPage: `Team Page ${index}`, Name: `Team ${index}` }));
    const games = Array.from({ length: 51 }, (_, index) => ({
      GameId: `G${index}`, MatchId: `M${index}`, Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z",
      BestOf: 1, N_GameInMatch: 1, Team1: `Team ${index * 2}`, Team2: `Team ${index * 2 + 1}`, Team1Score: 1, Team2Score: 0, Winner: 1,
    }));
    const batches: string[][] = []; let active = 0; let maximum = 0;
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, teams),
      fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset, teams.map((team) => [team.OverviewPage, team.Name])),
      fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []),
      fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, games),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => {
        batches.push([...titles]); active += 1; maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 1)); active -= 1;
        return knownPagesResult(titles);
      },
    };

    const input = await fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/api.php", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] });
    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 2]);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(maximum).toBeGreaterThan(1);
    expect(input.rawEvidence.filter((item) => new URL(item.sourceUrl).searchParams.get("prop")?.includes("revisions"))).toHaveLength(3);

    await expect(fetchLeaguepediaRawInput(client, {
      sourceUrl: "https://lol.example/api.php", resourceLimits: { maxReviewedPages: 100 },
      slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }],
    })).rejects.toThrow(/reviewed page.*100/i);
  });

  it("fails honestly when a game team has no unique Teams OverviewPage mapping", async () => {
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, [{ OverviewPage: "Alpha Page", Name: "Alpha" }]),
      fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset),
      fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []),
      fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", BestOf: 1, N_GameInMatch: 1, Team1: "Alpha", Team2: "Missing", Team1Score: 1, Team2Score: 0, Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    };
    const failure = await fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/api.php", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LeaguepediaSnapshotError);
    expect((failure as LeaguepediaSnapshotError).message).toMatch(/Missing.*unique TeamRedirects AllName/i);
    expect((failure as LeaguepediaSnapshotError).rawEvidence.some((item) => item.table === "ScoreboardGames")).toBe(true);
  });

  it("maps SKT and SK Telecom T1 game aliases to the unique T1 OverviewPage", async () => {
    const requested: string[][] = [];
    const games = ["SKT", "SK Telecom T1"].map((team, index) => ({ GameId: `GA${index}`, MatchId: `MA${index}`, Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", BestOf: 1, N_GameInMatch: 1, Team1: team, Team2: "BLG", Team1Score: 1, Team2Score: 0, Winner: 1 }));
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, [{ OverviewPage: "T1", Name: "T1", Aliases: "SKT;SK Telecom T1" }, { OverviewPage: "Bilibili Gaming", Name: "Bilibili Gaming", Aliases: "BLG" }]),
      fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset),
      fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []), fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset), fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]), fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, games), fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []), fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => { requested.push([...titles]); return knownPagesResult(titles); },
    };
    await fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/api.php", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] });
    expect(requested.flat().sort()).toEqual(["Bilibili Gaming", "T1"]);
  });

  it("uses the unique TeamRedirects target despite colliding Teams short names", async () => {
    const requested: string[][] = [];
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, [
        { OverviewPage: "Team Same Mordeczki", Name: "Team Same Mordeczki", Short: "TSM" },
        { OverviewPage: "Team Solo Mebdi", Name: "Team Solo Mebdi", Short: "TSM" },
        { OverviewPage: "TSM", Name: "TSM", Short: "TSM" },
        { OverviewPage: "Opponent", Name: "Opponent" },
      ]),
      fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset, [["TSM", "TSM"], ["Opponent", "Opponent"]]),
      fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, [{ OverviewPage: "Faker", ID: "Faker", Name: "Faker" }]),
      fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, [{ UniqueMatch: "M1", MatchId: "M1", OverviewPage: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", Team1: "TSM", Team2: "Opponent", Team1Score: 1, Team2Score: 0, Winner: 1, BestOf: 1 }]),
      fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", N_GameInMatch: 1, Team1: "TSM", Team2: "Opponent", Team1Score: 1, Team2Score: 0, Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, [{ GameId: "G1", PlayerName: "Faker", Team: "TSM", PlayerWin: 1 }]),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => { requested.push([...titles]); return knownPagesResult(titles); },
    };
    const input = await fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/api.php", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] });
    expect(requested.flat().sort()).toEqual(["Opponent", "TSM"]);
    expect(parseLeaguepediaRawInput(input).entities.filter((entity) => entity.kind === "team").map((entity) => entity.sourceKey).sort()).toEqual(["Opponent", "TSM"]);
  });

  it("uses TeamRedirects AllName instead of inferring from Teams display fields", async () => {
    const requested: string[][] = [];
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, [
        { OverviewPage: "Official Legacy", Name: "Legacy", Short: "LEG" },
        { OverviewPage: "Short Collision", Name: "Short Collision", Short: "Legacy" },
        { OverviewPage: "Opponent", Name: "Opponent" },
      ]),
      fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset, [["Official Legacy", "Legacy"], ["Opponent", "Opponent"]]),
      fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []),
      fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", N_GameInMatch: 1, Team1: "Legacy", Team2: "Opponent", Team1Score: 1, Team2Score: 0, Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => { requested.push([...titles]); return knownPagesResult(titles); },
    };
    await fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/api.php", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] });
    expect(requested.flat().sort()).toEqual(["Official Legacy", "Opponent"]);
  });

  it("matches TeamRedirects AllName with case-insensitive normalized keys", async () => {
    const requested: string[][] = [];
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, [{ OverviewPage: "Ahq eSports Club", Name: "Ahq eSports Club" }, { OverviewPage: "Opponent", Name: "Opponent" }]),
      fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset, [["Ahq eSports Club", "Ahq eSports Club"], ["Opponent", "Opponent"]]),
      fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []),
      fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", N_GameInMatch: 1, Team1: "ahq eSports Club", Team2: "Opponent", Team1Score: 1, Team2Score: 0, Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => { requested.push([...titles]); return knownPagesResult(titles); },
    };
    await fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/api.php", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] });
    expect(requested.flat().sort()).toEqual(["Ahq eSports Club", "Opponent"]);
  });

  it("uses the sole structurally valid PlayerRedirects target and audits a malformed collision", async () => {
    const snapshot = await fetchLeaguepediaSnapshot(playerRedirectCollisionClient([
      { OverviewPage: "DanDy", ID: "DanDy", Name: "Choi In-kyu", Player: "DanDy" },
      { OverviewPage: "Dandy (British Player)", ID: "Dandy", Name: "" },
    ], [["DanDy", "DanDy"], ["Dandy (British Player)", "Dandy"]]), {
      sourceUrl: "https://lol.example/api.php",
      slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }],
    });

    expect(snapshot.entities.filter((entity) => entity.kind === "player")).toEqual([
      expect.objectContaining({ sourceKey: "DanDy", displayName: "Choi In-kyu" }),
    ]);
    expect(snapshot.gamePlayers).toEqual([{ gameKey: "G1", playerKey: "DanDy", teamKey: "T1", playerWin: true }]);
    expect(snapshot.slices[0]).toMatchObject({
      malformedOptionalRows: 1,
      malformedOptionalRowKeys: ["Players:Dandy (British Player)"],
    });
    const reviewed = await overrides();
    expect(() => normalizeLeaguepediaSnapshot(snapshot, reviewed)).not.toThrow();
  });

  it("fails closed when a PlayerRedirects key has two structurally valid targets", async () => {
    await expect(fetchLeaguepediaSnapshot(playerRedirectCollisionClient([
      { OverviewPage: "DanDy", ID: "DanDy", Name: "Choi In-kyu" },
      { OverviewPage: "Dandy (British Player)", ID: "Dandy", Name: "Dan Henry" },
    ], [["DanDy", "DanDy"], ["Dandy (British Player)", "Dandy"]]), {
      sourceUrl: "https://lol.example/api.php",
      slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }],
    })).rejects.toThrow(/Dandy.*exactly one valid PlayerRedirects target/i);
  });

  it("fails closed when a PlayerRedirects key has no structurally valid target", async () => {
    await expect(fetchLeaguepediaSnapshot(playerRedirectCollisionClient([
      { OverviewPage: "DanDy", ID: "DanDy", Name: "" },
      { OverviewPage: "Dandy (British Player)", ID: "Dandy" },
    ], [["DanDy", "DanDy"], ["Dandy (British Player)", "Dandy"]]), {
      sourceUrl: "https://lol.example/api.php",
      slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }],
    })).rejects.toThrow(/Dandy.*exactly one valid PlayerRedirects target/i);
  });

  it("fails closed when a game alias maps to multiple Teams OverviewPages", async () => {
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, [{ OverviewPage: "T1", Name: "T1", Aliases: "Legacy" }, { OverviewPage: "Other", Name: "Other", Aliases: "Legacy" }, { OverviewPage: "Bilibili Gaming", Name: "Bilibili Gaming", Aliases: "BLG" }]),
      fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset, [["T1", "Legacy"], ["Other", "Legacy"], ["Bilibili Gaming", "BLG"]]),
      fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []), fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset), fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]), fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", BestOf: 1, N_GameInMatch: 1, Team1: "Legacy", Team2: "BLG", Team1Score: 1, Team2Score: 0, Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []), fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }), fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    };
    await expect(fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/api.php", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] })).rejects.toThrow(/Legacy.*unique TeamRedirects AllName/i);
  });

  it.each([
    ["cyclic", [{ OverviewPage: "A", Name: "A", RenamedTo: "B" }, { OverviewPage: "B", Name: "B", RenamedTo: "A" }, { OverviewPage: "Opponent", Name: "Opponent" }], /RenamedTo closure contains a cycle/i],
    ["ambiguous", [{ OverviewPage: "A", Name: "A", RenamedTo: "Legacy" }, { OverviewPage: "B", Name: "Legacy" }, { OverviewPage: "C", Name: "Legacy" }, { OverviewPage: "Opponent", Name: "Opponent" }], /RenamedTo target Legacy.*unique TeamRedirects AllName/i],
  ])("fails closed on a %s forward rename closure", async (_label, teams, expected) => {
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, teams),
      fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset, _label === "cyclic" ? [["A", "A"], ["B", "B"], ["Opponent", "Opponent"]] : [["A", "A"], ["B", "B"], ["B", "Legacy"], ["C", "Legacy"], ["Opponent", "Opponent"]]),
      fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []),
      fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", N_GameInMatch: 1, Team1: "A", Team2: _label === "ambiguous" ? "B" : "Opponent", Team1Score: 1, Team2Score: 0, Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    };
    await expect(fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/api.php", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] })).rejects.toThrow(expected);
  });

  it("audits an out-of-scope forward rename cycle without staging it", async () => {
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, [
        { OverviewPage: "A", Name: "A", RenamedTo: "B" },
        { OverviewPage: "B", Name: "B", RenamedTo: "C" },
        { OverviewPage: "C", Name: "C", RenamedTo: "B" },
        { OverviewPage: "Opponent", Name: "Opponent" },
      ]),
      fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset, [["A", "A"], ["B", "B"], ["C", "C"], ["Opponent", "Opponent"]]),
      fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, [{ OverviewPage: "Faker", ID: "Faker", Name: "Faker" }]),
      fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, [{ UniqueMatch: "M1", MatchId: "M1", OverviewPage: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", Team1: "A", Team2: "Opponent", Team1Score: 1, Team2Score: 0, Winner: 1, BestOf: 1 }]),
      fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", N_GameInMatch: 1, Team1: "A", Team2: "Opponent", Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, [{ GameId: "G1", PlayerName: "Faker", Team: "A", PlayerWin: 1 }]),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    };
    const snapshot = await fetchLeaguepediaSnapshot(client, { sourceUrl: "https://lol.example/api.php", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] });
    expect(snapshot.entities.filter((entity) => entity.kind === "team").map((entity) => entity.sourceKey).sort()).toEqual(["A", "Opponent"]);
    expect(snapshot.slices[0]).toMatchObject({
      outOfScopeForwardRenames: 3,
      outOfScopeForwardRenameSamples: ["A -> B", "B -> C", "C -> B"],
    });
  });

  it("charges known-page evidence to the aggregate page budget", async () => {
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, [{ OverviewPage: "Alpha Page", Name: "Alpha" }, { OverviewPage: "Beta Page", Name: "Beta" }]),
      fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset),
      fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []),
      fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", BestOf: 1, N_GameInMatch: 1, Team1: "Alpha", Team2: "Beta", Team1Score: 1, Team2Score: 0, Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    };
    await expect(fetchLeaguepediaRawInput(client, {
      sourceUrl: "https://lol.example/api.php", resourceLimits: { maxPages: 5 },
      slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }],
    })).rejects.toThrow(/global resource budget/);
  });

  it("retains known-page evidence when the API omits a requested page revision", async () => {
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, [{ OverviewPage: "Alpha Page", Name: "Alpha" }, { OverviewPage: "Beta Page", Name: "Beta" }]),
      fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset),
      fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []),
      fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", BestOf: 1, N_GameInMatch: 1, Team1: "Alpha", Team2: "Beta", Team1Score: 1, Team2Score: 0, Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => {
        const result = knownPagesResult(titles);
        const response = { query: { pages: [result.data.query.pages[0]] } };
        return { data: response, rawEvidence: [{ ...result.rawEvidence[0]!, response }] };
      },
    };
    const failure = await fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/api.php", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LeaguepediaSnapshotError);
    expect((failure as LeaguepediaSnapshotError).message).toMatch(/Beta Page.*exact page\/revision evidence/i);
    expect((failure as LeaguepediaSnapshotError).rawEvidence.some((item) => item.requestId.startsWith("known:"))).toBe(true);
  });

  it("enforces one aggregate snapshot budget across concurrent slices", async () => {
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, []), fetchTeamRedirectsPage: async ({ offset }: { offset: number }) => teamRedirectPage(offset), fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []), fetchPlayerRedirectsPage: async ({ offset }: { offset: number }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, []), fetchMatchSchedulesPage: async ({ offset }: { offset: number }) => matchSchedulePage(offset, []), fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, []),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []), fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }), fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    };
    const failure = await fetchLeaguepediaRawInput(client, {
      sourceUrl: "https://lol.example/wiki", resourceLimits: { maxPages: 4, maxRows: 100, maxBytes: 100_000 },
      slices: [
        { competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" },
        { competition: "MSI", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" },
      ],
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LeaguepediaSnapshotError);
    expect((failure as LeaguepediaSnapshotError).message).toMatch(/global resource budget/);
    expect((failure as LeaguepediaSnapshotError).rawEvidence.length).toBeGreaterThan(4);
  });

  it("rejects retained pagination with a missing middle offset", async () => {
    const input = await rawFixture();
    const gamePage = input.rawEvidence.find((item) => item.table === "ScoreboardGames")!;
    const schedulePage = input.rawEvidence.find((item) => item.table === "MatchSchedule")!;
    const title = (gamePage.response as Record<string, unknown>[])[0]!;
    const matchIds = Array.from({ length: 500 }, (_, index) => `M${index}`);
    const gameIds = Array.from({ length: 500 }, (_, index) => `G${index}`);
    const broken: LeaguepediaRawInput = {
      ...input,
      rawEvidence: input.rawEvidence.flatMap((item) => item.table === "MatchSchedule" ? [{
        ...schedulePage, scope: { ...schedulePage.scope, matchIds }, response: matchIds.map((matchId) => ({
          UniqueMatch: matchId, MatchId: matchId, OverviewPage: "2024 Season World Championship", DateTimeUTC: "2024-11-02T14:00:00Z",
          Team1: "T1", Team2: "Bilibili Gaming", Team1Score: 1, Team2Score: 0, Winner: 1, BestOf: 1,
        })),
      }] : item.table === "ScoreboardGames" ? [
          { ...item, requestId: "games:0", offset: 0, response: Array.from({ length: 500 }, (_, index) => ({ ...title, GameId: `G${index}`, MatchId: `M${index}`, Team1Score: 1, Team2Score: 0, GameNumber: 1, Winner: 1 })) },
          { ...item, requestId: "games:1000", offset: 1000, response: [] },
        ] : item.table === "ScoreboardPlayers" ? [{ ...item, scope: { ...item.scope, gameIds }, response: retainedPlayerRowsForGameIds(input, gameIds) }] : [item]),
    };
    expect(() => parseLeaguepediaRawInput(broken)).toThrow(/expected offset 500, received 1000/);
  });

  it("fails closed when MatchSchedule scope union does not cover the slice match IDs", async () => {
    const input = swapFactSliceScopes(await twoCompleteSlicesInput(), "MatchSchedule");

    expect(() => parseLeaguepediaRawInput(input)).toThrow(/MatchSchedule.*scope.*cover.*match IDs/i);
  });

  it("fails closed when ScoreboardPlayers scope union does not cover the slice game IDs", async () => {
    const input = swapFactSliceScopes(await twoCompleteSlicesInput(), "ScoreboardPlayers");

    expect(() => parseLeaguepediaRawInput(input)).toThrow(/ScoreboardPlayers.*scope.*cover.*game IDs/i);
  });

  it("fails closed when widened MatchSchedule declarations hide missing slice response rows", async () => {
    const input = swapFactSliceScopesWithWidenedIds(await twoCompleteSlicesInput(), "MatchSchedule");

    expect(() => parseLeaguepediaRawInput(input)).toThrow(/MatchSchedule.*response.*cover.*match IDs/i);
  });

  it("fails closed when widened ScoreboardPlayers declarations hide missing slice response rows", async () => {
    const input = swapFactSliceScopesWithWidenedIds(await twoCompleteSlicesInput(), "ScoreboardPlayers");
    expect(() => parseLeaguepediaRawInput(input)).toThrow(/ScoreboardPlayers.*response.*cover.*game IDs/i);
  });

  it("retains complete rosters and reports partial coverage for successfully queried empty rosters", async () => {
    const input = await rawFixture();
    const gameId = (input.rawEvidence.find((item) => item.table === "ScoreboardPlayers")!.response as Record<string, unknown>[])[0]!.GameId;
    for (const item of input.rawEvidence.filter((item) => item.table === "ScoreboardPlayers")) {
      item.response = (item.response as Record<string, unknown>[]).filter((row) => row.GameId !== gameId);
    }
    const parsed = parseLeaguepediaRawInput(input);
    const normalized = normalizeLeaguepediaSnapshot(parsed, await overrides());
    expect(normalized.rosterIncompleteGameKeys).toEqual([gameId]);
    expect(normalized.facts.gamePlayers!.length).toBeGreaterThan(0);
    const batch = await createLeaguepediaProvider({ loadRawInput: async () => input, overrides: await overrides() }).stage({ mode: "sync-once" });
    expect(batch.coverage.every((scope) => scope.status === "partial")).toBe(true);
  });

  it("replays reviewed schedule aliases with the original game scope and immutable response", async () => {
    const input = await rawFixture();
    const item = input.rawEvidence.find((evidence) => evidence.table === "MatchSchedule")!;
    const originalId = (item.response as Record<string, unknown>[])[0]!.MatchId as string;
    item.response = (item.response as Record<string, unknown>[]).map((row) => ({ ...row, MatchId: "reviewed-schedule-id" }));
    const reviewed = await overrides();
    reviewed.sourceCorrections = [{ table: "MatchSchedule", key: "MatchId", value: "reviewed-schedule-id", field: "MatchId", expected: "reviewed-schedule-id", replacement: originalId, sourceUrl: "https://lol.fandom.com/wiki/Reviewed_Tournament?oldid=123", reviewedNote: "Verified exact bracket match." }];
    const batch = await createLeaguepediaProvider({ loadRawInput: async () => input, overrides: reviewed }).stage({ mode: "sync-once" });
    expect(batch.facts.series).toHaveLength(1);
    expect((item.response as Record<string, unknown>[])[0]!.MatchId).toBe("reviewed-schedule-id");
  });

  it("recovers only source-reviewed missing roster rows within imported games", async () => {
    const input = await rawFixture();
    const evidence = input.rawEvidence.find((item) => item.table === "ScoreboardPlayers")!;
    const originalRows = evidence.response as Record<string, unknown>[];
    const gameId = originalRows[0]!.GameId as string;
    const roster = originalRows.filter((row) => row.GameId === gameId);
    evidence.response = originalRows.filter((row) => row.GameId !== gameId);
    const reviewed = await overrides();
    reviewed.sourceCorrections = [...roster, { ...roster[0], GameId: "unrequested-game" }].map((row) => ({ table: "ScoreboardPlayers", key: "GameId", value: row.GameId as string, row: { ...row, PlayerName: row.PlayerKey }, sourceUrl: "https://lol.fandom.com/wiki/Reviewed_Scoreboards?oldid=123", reviewedNote: "Ten explicit player links from the matched single-game scoreboard." }));
    const normalized = normalizeLeaguepediaSnapshot(parseLeaguepediaRawInput(input, reviewed.sourceCorrections), reviewed);
    expect(normalized.rosterIncompleteGameKeys).toEqual([]);
    expect(normalized.facts.gamePlayers).toHaveLength(originalRows.length);
    expect((evidence.response as Record<string, unknown>[]).some((row) => row.GameId === gameId)).toBe(false);
  });

  it("uses reviewed source pages and schedule IDs in live fetching without changing retained rows", async () => {
    const client = playerRedirectCollisionClient([{ OverviewPage: "Dandy", ID: "Dandy", Name: "Dandy" }], [["Dandy", "Dandy"]]);
    client.fetchTeamsPage = async ({ offset }) => cargoPage("Teams", offset, [{ OverviewPage: "T1", Name: "T1" }]);
    client.fetchTeamRedirectsPage = async ({ offset }) => teamRedirectPage(offset, [["T1", "T1"]]);
    client.fetchGamesPage = async ({ offset }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", N_GameInMatch: 1, Team1: "T1", Team2: "DDoL", Winner: 1 }]);
    client.fetchGamePlayersPage = async ({ offset }) => cargoPage("ScoreboardPlayers", offset, [{ GameId: "G1", PlayerName: "Dandy", Team: "T1", PlayerWin: "Yes" }]);
    const requested: string[][] = [];
    client.fetchKnownPagesWithEvidence = async (titles) => { requested.push([...titles]); return knownPagesResult(titles); };
    const fetchSchedules = vi.fn(async ({ offset }: { offset: number; matchIds: readonly string[] }) => matchSchedulePage(offset, [{ UniqueMatch: "source-match", MatchId: "source-match", OverviewPage: "Worlds", DateTime_UTC: "2024-10-01T00:00:00Z", Team1: "T1", Team2: "DDoL", Team1Score: 1, Team2Score: 0, Winner: 1, BestOf: 1 }]));
    const proof = { sourceUrl: "https://lol.fandom.com/wiki/Reviewed_Tournament?oldid=123", reviewedNote: "Reviewed participant and exact match." };
    const corrections = [
      { ...proof, table: "Teams" as const, key: "OverviewPage", value: "DDoL", row: { OverviewPage: "DDoL", Name: "DDoL" } },
      { ...proof, table: "TeamRedirects" as const, key: "AllName", value: "DDoL", row: { _pageName: "DDoL", AllName: "DDoL" } },
      { ...proof, table: "MatchSchedule" as const, key: "MatchId", value: "source-match", field: "MatchId" as const, expected: "source-match", replacement: "M1" },
    ];
    const input = await fetchLeaguepediaRawInput({ ...client, fetchMatchSchedulesPage: fetchSchedules }, { sourceUrl: "https://lol.example/api.php", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] }, corrections);
    expect(fetchSchedules).toHaveBeenCalledWith({ offset: 0, matchIds: ["source-match"] });
    expect(requested.flat().sort()).toEqual(["Reviewed Tournament", "T1"]);
    expect(parseLeaguepediaRawInput(input, corrections).series[0]!.sourceKey).toBe("M1");
    expect((input.rawEvidence.find((item) => item.table === "Teams")!.response as Record<string, unknown>[])).toHaveLength(1);
    expect((input.rawEvidence.find((item) => item.table === "MatchSchedule")!.response as Record<string, unknown>[])[0]!.MatchId).toBe("source-match");
  });

  it("restores a source-reviewed game only in its observed series and keeps player-query coverage mandatory", async () => {
    const input = await rawFixture();
    const evidence = input.rawEvidence.find((item) => item.table === "ScoreboardGames")!;
    const gameRow = decodeCargoExportRows("ScoreboardGames", evidence.response)[1]!;
    evidence.response = (evidence.response as Record<string, unknown>[]).filter((row) => row.GameId !== gameRow.GameId);
    const reviewed = await overrides();
    reviewed.sourceCorrections = [{ table: "ScoreboardGames", key: "GameId", value: gameRow.GameId as string, row: gameRow, sourceUrl: "https://lol.fandom.com/wiki/Reviewed_Scoreboards?oldid=123", reviewedNote: "Exact missing game observed on its scoreboard page." }];
    const normalized = normalizeLeaguepediaSnapshot(parseLeaguepediaRawInput(input, reviewed.sourceCorrections), reviewed);
    expect(normalized.facts.games).toHaveLength(5);
    expect(normalized.facts.gamePlayers).toHaveLength(50);
    expect((evidence.response as Record<string, unknown>[])).toHaveLength(4);
    for (const players of input.rawEvidence.filter((item) => item.table === "ScoreboardPlayers")) {
      players.scope = { ...players.scope!, gameIds: players.scope!.gameIds!.filter((id) => id !== gameRow.GameId) };
      players.response = (players.response as Record<string, unknown>[]).filter((row) => row.GameId !== gameRow.GameId);
    }
    expect(() => parseLeaguepediaRawInput(input, reviewed.sourceCorrections)).toThrow(/scope does not cover/);
  });

  it("retains alternative manual provenance separately and replays it without changing Cargo responses", async () => {
    const input = await rawFixture();
    const games = input.rawEvidence.find((item) => item.table === "ScoreboardGames")!;
    const row = decodeCargoExportRows("ScoreboardGames", games.response)[1]!;
    games.response = (games.response as Record<string, unknown>[]).filter((game) => game.GameId !== row.GameId);
    const original = JSON.stringify(input);
    const reviewed = await overrides();
    reviewed.sourceCorrections = [{ table: "ScoreboardGames", key: "GameId", value: row.GameId as string, row,
      sourceKind: "reviewed-alternative", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      corroboratingUrls: ["https://www.inven.co.kr/webzine/news/?news=123"], reviewedNote: "Official game-specific video and independent report identify winner and participants." }];
    const snapshot = parseLeaguepediaRawInput(input, reviewed.sourceCorrections);
    expect(snapshot.games).toHaveLength(5);
    expect(snapshot.rawEvidence.filter((item) => item.action === "review")).toHaveLength(1);
    const replay = parseLeaguepediaRawInput({ ...input, rawEvidence: snapshot.rawEvidence }, reviewed.sourceCorrections);
    expect(replay.rawEvidence).toEqual(snapshot.rawEvidence);
    expect(JSON.stringify(input)).toBe(original);
    const batch = await createLeaguepediaProvider({ loadRawInput: async () => input, overrides: reviewed }).stage({ mode: "sync-once" });
    const retained = JSON.parse(new TextDecoder().decode(batch.source.bytes));
    expect(retained.input.rawEvidence.filter((item: { action: string }) => item.action === "review")).toHaveLength(1);
    expect(batch.facts.games).toHaveLength(5);
  });

  it("accepts shared fact evidence whose scope includes extra IDs from another slice", async () => {
    const scheduleShared = shareFactEvidenceAcrossSlices(await twoCompleteSlicesInput(), "MatchSchedule");
    const fullyShared = shareFactEvidenceAcrossSlices(scheduleShared, "ScoreboardPlayers");

    expect(parseLeaguepediaRawInput(fullyShared).slices.map((slice) => slice.traversal.complete)).toEqual([true, true]);
  });

  it("rejects game rows outside their retained slice date range", async () => {
    const input = await rawFixture();
    const outside: LeaguepediaRawInput = { ...input, rawEvidence: input.rawEvidence.map((item) => item.table === "ScoreboardGames" ? {
      ...item, response: (item.response as Record<string, unknown>[]).map((row) => ({ ...row, DateTimeUTC: "2030-01-01T00:00:00Z" })),
    } : item) };
    const failure = (() => { try { parseLeaguepediaRawInput(outside); } catch (error) { return error; } return undefined; })();
    expect(failure).toBeInstanceOf(LeaguepediaSnapshotError);
    expect((failure as LeaguepediaSnapshotError).message).toMatch(/outside \[2024-01-01, 2025-01-01\)/);
    expect((failure as LeaguepediaSnapshotError).rawEvidence[0]?.table).toBe("ScoreboardGames");
    const staged = await createLeaguepediaProvider({ loadRawInput: async () => outside, overrides: await overrides() }).stage({ mode: "sync-once" }).catch((error: unknown) => error);
    expect(staged).toBeInstanceOf(RetainableStageError);
  });

  it("rejects retained raw input without an explicit provenance discriminator", async () => {
    const input = await rawFixture();
    expect(() => parseLeaguepediaRawInput({ ...input, provenance: undefined as never })).toThrow(/provenance/i);
    expect(() => parseLeaguepediaRawInput({ ...input, provenance: { kind: "synthetic-fixture", name: "" } })).toThrow(/provenance/i);
  });

  it("rejects a game row from a different exact tournament source key", async () => {
    const input = await rawFixture();
    const wrong: LeaguepediaRawInput = { ...input, rawEvidence: input.rawEvidence.map((item) => item.table === "ScoreboardGames" ? {
      ...item, response: (item.response as Record<string, unknown>[]).map((row) => ({ ...row, Tournament: "2024 Mid-Season Invitational" })),
    } : item) };
    expect(() => parseLeaguepediaRawInput(wrong)).toThrow(/does not match requested source key/);
  });

  it("accepts a game row whose tournament source key differs only by case", async () => {
    const input = await rawFixture();
    const caseVariant: LeaguepediaRawInput = { ...input, rawEvidence: input.rawEvidence.map((item) => item.table === "ScoreboardGames" ? {
      ...item, response: (item.response as Record<string, unknown>[]).map((row) => ({ ...row, Tournament: String(row.Tournament).toLocaleLowerCase() })),
    } : item) };
    expect(parseLeaguepediaRawInput(caseVariant).games).not.toHaveLength(0);
  });

  it("treats slice from as inclusive and to as exclusive", async () => {
    const input = await rawFixture();
    const at = (timestamp: string): LeaguepediaRawInput => ({ ...input, rawEvidence: input.rawEvidence.map((item) => item.table === "ScoreboardGames" ? {
      ...item, response: (item.response as Record<string, unknown>[]).map((row) => ({ ...row, DateTimeUTC: timestamp })),
    } : item) });
    expect(parseLeaguepediaRawInput(at("2024-01-01T00:00:00Z")).games).toHaveLength(5);
    expect(() => parseLeaguepediaRawInput(at("2025-01-01T00:00:00Z"))).toThrow(/outside \[2024-01-01, 2025-01-01\)/);
  });

  it("keeps an incomplete traversal isolated to its own slice", async () => {
    const input = await rawFixture();
    const gamePage = input.rawEvidence.find((item) => item.table === "ScoreboardGames")!;
    const schedulePage = input.rawEvidence.find((item) => item.table === "MatchSchedule")!;
    const playerPage = input.rawEvidence.find((item) => item.table === "ScoreboardPlayers")!;
    const original = (gamePage.response as Record<string, unknown>[])[0]!;
    const sliceId = "Worlds:2024%20Season%20World%20Championship:2025:2025-01-01:2026-01-01";
    const title = { ...original, GameId: "WORLD25-G1", MatchId: "WORLD25-M1", DateTimeUTC: "2025-10-01T00:00:00Z", Team1Score: 1, Team2Score: 0, GameNumber: 1, Winner: 1 };
    const secondPage: RawApiEvidence = {
      ...gamePage, requestId: "games:2025:0", offset: 0,
      scope: { sliceIds: [sliceId], competition: "2024 Season World Championship", seasonYear: 2025, from: "2025-01-01", to: "2026-01-01" },
      response: Array.from({ length: 500 }, () => title),
    };
    const secondSchedule: RawApiEvidence = {
      ...schedulePage, requestId: "schedule:2025:0", offset: 0, scope: { sliceIds: [sliceId], matchIds: ["WORLD25-M1"] },
      response: [{ UniqueMatch: "WORLD25-M1", MatchId: "WORLD25-M1", OverviewPage: "2024 Season World Championship", DateTimeUTC: "2025-10-01T00:00:00Z", Team1: "T1", Team2: "Bilibili Gaming", Team1Score: 1, Team2Score: 0, Winner: 1, BestOf: 1 }],
    };
    const secondPlayers: RawApiEvidence = {
      ...playerPage, requestId: "players:2025:0", offset: 0, scope: { sliceIds: [sliceId], gameIds: ["WORLD25-G1"] }, response: retainedPlayerRowsForGameIds(input, ["WORLD25-G1"]),
    };
    const multi: LeaguepediaRawInput = { ...input, slices: [...input.slices, { sliceId, competition: "Worlds", sourceCompetition: "2024 Season World Championship", seasonYear: 2025, from: "2025-01-01", to: "2026-01-01" }], rawEvidence: [...input.rawEvidence, secondPage, secondSchedule, secondPlayers] };
    const batch = await createLeaguepediaProvider({ loadRawInput: async () => multi, overrides: await overrides() }).stage({ mode: "backfill", years: [2024, 2025], competitions: ["Worlds"] });
    expect(batch.coverage).toEqual([
      expect.objectContaining({ seasonYear: 2024, status: "partial" }),
      expect.objectContaining({ seasonYear: 2025, status: "partial" }),
    ]);
  });

  it("audits malformed unreferenced dimensions without degrading requested fact coverage", async () => {
    const input = await rawFixture();
    const audited: LeaguepediaRawInput = {
      ...input,
      rawEvidence: input.rawEvidence.map((item) => item.table === "Teams"
        ? { ...item, response: [...(item.response as Record<string, unknown>[]), { OverviewPage: "Malformed Optional Team" }] }
        : item),
    };
    const snapshot = parseLeaguepediaRawInput(audited);
    expect(snapshot.slices[0]).toMatchObject({
      malformedOptionalRows: 1,
      malformedOptionalRowKeys: ["Teams:Malformed Optional Team"],
    });

    const batch = await createLeaguepediaProvider({ loadRawInput: async () => audited, overrides: await overrides() }).stage({ mode: "sync-once" });
    expect(batch.coverage[0]?.detail).toMatch(/Ignored 1 malformed unreferenced optional dimension rows.*Teams:Malformed Optional Team.*raw evidence retained/i);
    expect(batch.publicationScopes).toEqual([expect.objectContaining({ unresolvedRows: 0 })]);
  });

  it("does not let duplicate unreferenced Teams rows own fact scope", async () => {
    const input = await rawFixture();
    const duplicate: LeaguepediaRawInput = {
      ...input,
      rawEvidence: input.rawEvidence.map((item) => item.table === "Teams"
        ? { ...item, response: [...(item.response as Record<string, unknown>[]), { OverviewPage: "Unreferenced Duplicate", Name: "First" }, { OverviewPage: "Unreferenced Duplicate", Name: "Second" }] }
        : item),
    };
    expect(parseLeaguepediaRawInput(duplicate).games).toHaveLength(5);
  });

  it("parses a large retained game page without repeated series scans", async () => {
    const input = await rawFixture();
    const gamePage = input.rawEvidence.find((item) => item.table === "ScoreboardGames")!;
    const schedulePage = input.rawEvidence.find((item) => item.table === "MatchSchedule")!;
    const playerPage = input.rawEvidence.find((item) => item.table === "ScoreboardPlayers")!;
    const original = (gamePage.response as Record<string, unknown>[])[0]!;
    const rows = Array.from({ length: 400 }, (_, index) => ({ ...original, GameId: `G${index}`, MatchId: `M${index}`, Team1Score: 1, Team2Score: 0, GameNumber: 1, Winner: 1 }));
    const matchIds = rows.map((row) => String(row.MatchId));
    const large = { ...input, rawEvidence: input.rawEvidence.map((item) => item === gamePage ? { ...item, response: rows } : item === schedulePage ? {
      ...item, scope: { ...item.scope, matchIds }, response: matchIds.map((matchId, index) => ({
        UniqueMatch: matchId, MatchId: matchId, OverviewPage: "2024 Season World Championship", DateTimeUTC: `2024-11-02T14:${String(index % 60).padStart(2, "0")}:00Z`,
        Team1: "T1", Team2: "Bilibili Gaming", Team1Score: 1, Team2Score: 0, Winner: 1, BestOf: 1,
      })),
    } : item === playerPage ? { ...item, scope: { ...item.scope, gameIds: rows.map((row) => String(row.GameId)) }, response: retainedPlayerRowsForGameIds(input, rows.map((row) => String(row.GameId))) } : item) };
    const started = performance.now();
    expect(parseLeaguepediaRawInput(large).series).toHaveLength(400);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it("converts typed Cargo pages into explicit series, games, players and media", async () => {
    const requestedImages: string[][] = [];
    const requestedPlayerPages: string[][] = [];
    const snapshot = await fetchLeaguepediaSnapshot({
      fetchTeamsPage: async ({ offset }) => cargoPage("Teams", offset, [
        { OverviewPage: "T1", Name: "T1", Aliases: "SKT", Region: "Korea", Image: "T1_logo.png", RenamedTo: "Current T1" },
        { OverviewPage: "Current T1", Name: "Current T1", Region: "Korea", Image: "Current T1.png" },
        { OverviewPage: "Bilibili Gaming", Name: "Bilibili Gaming", Aliases: "BLG", Region: "China" },
        { OverviewPage: "Unrelated Team", Name: "Unrelated Team", Region: "Europe", Image: "Unrelated Team.png" },
        { OverviewPage: "300 (North American Team)" },
      ]),
      fetchTeamRedirectsPage: async ({ offset }) => teamRedirectPage(offset, [["T1", "T1"], ["Current T1", "Current T1"], ["Bilibili Gaming", "Bilibili Gaming"]]),
      fetchPlayersPage: async ({ offset }) => cargoPage("Players", offset, [
        { OverviewPage: "Faker", ID: "Faker", Name: "Lee Sang-hyeok", Team: "T1" },
        { OverviewPage: "Unrelated Player", Name: "Unrelated Player", Team: "Unrelated Team", Image: "Unrelated Player.png" },
        { OverviewPage: "Malformed Player" },
      ]),
      fetchPlayerRedirectsPage: async ({ offset }) => playerRedirectPage(offset),
      fetchPlayerImagesPage: async ({ offset, playerPages }) => {
        requestedPlayerPages.push([...playerPages]);
        return cargoPage("PlayerImages", offset, [
          { PlayerPage: "Faker", PlayerRedirect: "Faker", Link: "Faker", Tournament: "2024 Season World Championship", FileName: "Faker.png", SortDate: "2024-11-02", TournamentDateStartFuzzy: "2024-09-25", TournamentDate: "2024-09-25", IsProfileImage: "1" },
          { PlayerPage: "Unrelated Player", PlayerRedirect: "Faker", Link: "Faker", Tournament: "2024 Season World Championship", FileName: "wrong-player.png", SortDate: "2025-11-02", TournamentDateStartFuzzy: "2024-09-25", TournamentDate: "2024-09-25", IsProfileImage: "1" },
        ]);
      },
      fetchTournamentsPage: async ({ offset }) => cargoPage("Tournaments", offset, [
        { OverviewPage: "2024 Season World Championship", Name: "Worlds 2024", DateStart: "2024-09-25", DateEnd: "2024-11-02" },
        { OverviewPage: "Unrelated Tournament", Name: "Unrelated Tournament", DateStart: "2024-01-01" },
        { OverviewPage: "Malformed Tournament" },
      ]),
      fetchMatchSchedulesPage: async ({ offset }) => matchSchedulePage(offset, [{ UniqueMatch: "M1", MatchId: "M1", OverviewPage: "2024 Season World Championship", DateTime_UTC: "2024-11-02T14:00:00Z", Team1: "T1", Team2: "Bilibili Gaming", Team1Score: 1, Team2Score: 0, Winner: 1, BestOf: 1 }]),
      fetchGamesPage: async ({ offset }) => cargoPage("ScoreboardGames", offset, [{
        GameId: "G1", MatchId: "M1", Tournament: "2024 Season World Championship", DateTime_UTC: "2024-11-02T14:00:00Z",
        BestOf: "1", N_GameInMatch: "1", Team1: "T1", Team2: "Bilibili Gaming", Team1Score: "1", Team2Score: "0", Winner: "1",
      }]),
      fetchGamePlayersPage: async ({ offset }) => cargoPage("ScoreboardPlayers", offset, [{ GameId: "G1", PlayerName: "Faker", Team: "T1", PlayerWin: 1 }]),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
      fetchImageInfoWithEvidence: async (titles) => {
        requestedImages.push([...titles]);
        const pages = titles.map((title) => ({
          title: `File:${title.replaceAll("_", " ")}`,
          imageinfo: [{
            url: `https://media.leaguepedia.example/${title.toLowerCase()}`,
            mime: "image/png",
            extmetadata: { LicenseShortName: { value: "CC BY-SA" }, Artist: { value: "Leaguepedia contributors" } },
          }],
        }));
        const response = { query: { pages } };
        return { data: response, rawEvidence: [{ requestId: "query:image:0", action: "query", sourceUrl: "https://lol.example/api.php?action=query&titles=media", response, revisionIds: [77] }] };
      },
    }, { slices: [{ competition: "2024 Season World Championship", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }], sourceUrl: "https://leaguepedia.example/wiki/T1" });

    expect(snapshot.series).toEqual([expect.objectContaining({ sourceKey: "M1", bestOf: 1 })]);
    expect(snapshot.games).toEqual([expect.objectContaining({ sourceKey: "G1", seriesKey: "M1", winnerTeam: "T1" })]);
    expect(snapshot.gamePlayers).toEqual([{ gameKey: "G1", playerKey: "Faker", teamKey: "T1", playerWin: true }]);
    expect(snapshot.media.filter((item) => item.sourceUrl !== null)).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityKey: "T1", attribution: "Leaguepedia contributors" }),
      expect.objectContaining({ entityKey: "Faker", sourceKey: "Faker.png", attribution: "Leaguepedia contributors" }),
    ]));
    expect(snapshot.tournaments).toEqual(expect.arrayContaining([expect.objectContaining({ sourceKey: "2024 Season World Championship" })]));
    expect(requestedPlayerPages).toEqual([["Faker"]]);
    expect(requestedImages).toEqual([["T1_logo.png", "Faker.png"]]);
    expect(snapshot.media.some((item) => item.sourceKey === "wrong-player.png")).toBe(false);
    expect(snapshot.slices[0]).toMatchObject({ competition: "2024 Season World Championship", seasonYear: 2024, gameSourceKeys: ["G1"] });
    expect(snapshot.entities.some((entity) => entity.sourceKey === "Current T1")).toBe(false);
    expect(snapshot.entities.find((entity) => entity.sourceKey === "T1")?.lineage).toBeNull();
    expect(snapshot.slices[0]).toMatchObject({
      outOfScopeForwardRenames: 1,
      outOfScopeForwardRenameSamples: ["T1 -> Current T1"],
    });
    expect(snapshot.rawEvidence.map((item) => item.table)).toEqual(expect.arrayContaining(["Teams", "Players", "PlayerImages", "Tournaments", "ScoreboardGames", "ScoreboardPlayers"]));
    expect(snapshot.rawEvidence.find((item) => item.table === "ScoreboardGames")?.scope).toMatchObject({ competition: "2024 Season World Championship", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01", sliceIds: [expect.any(String)] });
    expect(snapshot.rawEvidence.find((item) => item.table === "ScoreboardPlayers")?.scope).toMatchObject({ gameIds: ["G1"], sliceIds: [expect.any(String)] });
    expect(snapshot.provenance).toEqual({ kind: "live" });
    expect(snapshot.revisionIds).toEqual([77, 78]);
    expect(snapshot.traversal.complete).toBe(true);
  });

  it("binds PlayerImages through redirects and selects the effective latest profile deterministically", async () => {
    const input = await rawFixture();
    const playerImages = rawEvidence("PlayerImages", 0, [
      { PlayerPage: "Faker (Player)", PlayerRedirect: "Faker", Link: "Faker", Tournament: "Worlds 2024", FileName: "Faker older.png", SortDate: "2024-01-01", TournamentDateStartFuzzy: "2024-09-25", TournamentDate: "2024-09-25", IsProfileImage: "1" },
      { PlayerPage: "Faker (Player)", PlayerRedirect: "Faker", Link: "Faker", Tournament: "Worlds 2024", FileName: "Faker latest.png", SortDate: "2025-01-01", TournamentDateStartFuzzy: "2024-09-25", TournamentDate: "2024-09-25", IsProfileImage: "1" },
      { PlayerPage: "Faker (Player)", PlayerRedirect: "Faker", Link: "Faker", Tournament: "Worlds 2024", FileName: "Faker not-profile.png", SortDate: "2026-01-01", TournamentDateStartFuzzy: "2024-09-25", TournamentDate: "2024-09-25", IsProfileImage: "0" },
    ]);
    const imageInfo: RawApiEvidence = {
      requestId: "query:player-image:0",
      action: "query",
      sourceUrl: "https://fixture.riftversus.invalid/api.php?action=query&titles=File%3AFaker%20latest.png",
      response: {
        query: {
          pages: [{
            title: "File:Faker latest.png",
            imageinfo: [{
              url: "https://fixture.riftversus.invalid/media/faker-latest.png",
              mime: "image/png",
              extmetadata: { LicenseShortName: { value: "CC BY-SA" }, Artist: { value: "Leaguepedia contributors" } },
            }],
          }],
        },
      },
      revisionIds: [],
    };
    const snapshot = parseLeaguepediaRawInput({ ...input, rawEvidence: [...input.rawEvidence, playerImages, imageInfo] });
    expect(snapshot.rawEvidence.find((item) => item.table === "PlayerImages")?.response).toEqual(playerImages.response);
    expect(snapshot.media).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityKey: "Faker (Player)", sourceKey: "Faker latest.png", sourceUrl: "https://fixture.riftversus.invalid/media/faker-latest.png" }),
    ]));
    expect(snapshot.media.some((item) => item.sourceKey === "Faker older.png" || item.sourceKey === "Faker not-profile.png")).toBe(false);
  });

  it.each([
    ["File:T1 logo", true, "CC BY-SA", "Leaguepedia contributors"],
    ["File:T1_logo", true, "CC BY-SA", "Leaguepedia contributors"],
    ["File:t1 logo", false, "CC BY-SA", "Leaguepedia contributors"],
    ["File:T1 logo", true, null, null],
  ])("matches retained file %s without changing case or inferring rights (%s, %s, %s)", async (title, matched, license, attribution) => {
    const input = await rawFixture();
    const rawInput: LeaguepediaRawInput = {
      ...input,
      rawEvidence: input.rawEvidence.map((item) => {
        if (item.table === "Teams") return { ...item, response: (item.response as Record<string, unknown>[]).map((row) => row.OverviewPage === "T1" ? { ...row, Image: "File:T1_logo" } : row) };
        if (item.action !== "query") return item;
        return { ...item, response: { query: { pages: [{ title, imageinfo: [{
          url: "https://fixture.riftversus.invalid/media/t1.png",
          mime: "image/png",
          extmetadata: license === null ? {} : { LicenseShortName: { value: license }, Artist: { value: attribution } },
        }] }] } } };
      }),
    };
    const media = parseLeaguepediaRawInput(rawInput).media.find((item) => item.entityKey === "T1")!;
    expect(media).toMatchObject({
      sourceKey: "File:T1_logo",
      sourceUrl: matched ? "https://fixture.riftversus.invalid/media/t1.png" : null,
      license: matched ? license : null,
      attribution: matched ? attribution : null,
    });
    expect(parseLeaguepediaMedia([media], new Map([["T1", "11111111-1111-5111-8111-111111111111"]]))).toHaveLength(matched && license !== null ? 1 : 0);
  });

  it("fails on a malformed required game row instead of silently completing traversal", async () => {
    const empty = (table: LeaguepediaCargoTable, offset: number) => cargoPage(table, offset, []);
    const failure = await fetchLeaguepediaSnapshot({
      fetchTeamsPage: async ({ offset }) => cargoPage("Teams", offset, [{ OverviewPage: "T1", Name: "T1" }, { OverviewPage: "BLG", Name: "BLG" }]),
      fetchTeamRedirectsPage: async ({ offset }) => teamRedirectPage(offset, [["Referenced Team", "Referenced Team"], ["BLG", "BLG"]]),
      fetchPlayersPage: async ({ offset }) => empty("Players", offset),
      fetchPlayerRedirectsPage: async ({ offset }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchMatchSchedulesPage: async ({ offset }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }) => cargoPage("ScoreboardGames", offset, [{ MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-01-01T00:00:00Z", BestOf: 5, N_GameInMatch: 1, Team1: "T1", Team2: "BLG", Team1Score: 3, Team2Score: 0, Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }) => empty("ScoreboardPlayers", offset),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }), fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    }, { slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }], sourceUrl: "https://leaguepedia.example/wiki/Worlds" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LeaguepediaSnapshotError);
    expect((failure as LeaguepediaSnapshotError).message).toMatch(/GameId/);
    expect((failure as LeaguepediaSnapshotError).rawEvidence.find((item) => item.table === "ScoreboardGames")?.response).toEqual(expect.any(Array));
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["object", { value: "Referenced Team" }],
    ["array", ["Referenced Team"]],
  ])("fails closed when a referenced team string field is %s", async (_label, name) => {
    const empty = (table: LeaguepediaCargoTable, offset: number) => cargoPage(table, offset, []);
    await expect(fetchLeaguepediaSnapshot({
      fetchTeamsPage: async ({ offset }) => cargoPage("Teams", offset, [{ OverviewPage: "Referenced Team", Name: name }, { OverviewPage: "BLG", Name: "BLG" }]),
      fetchTeamRedirectsPage: async ({ offset }) => teamRedirectPage(offset, [["Referenced Team", "Referenced Team"], ["BLG", "BLG"]]),
      fetchPlayersPage: async ({ offset }) => empty("Players", offset),
      fetchPlayerRedirectsPage: async ({ offset }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchMatchSchedulesPage: async ({ offset }) => matchSchedulePage(offset, []),
      fetchGamesPage: async ({ offset }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-01-01T00:00:00Z", N_GameInMatch: 1, Team1: "Referenced Team", Team2: "BLG", Team1Score: 1, Team2Score: 0, Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }) => empty("ScoreboardPlayers", offset),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
      fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    }, { slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }], sourceUrl: "https://leaguepedia.example/wiki/Worlds" })).rejects.toThrow(/Referenced Team.*Name is required/i);
  });

  it("retains the late malformed ScoreboardPlayers response in the provider error envelope", async () => {
    const malformedPlayersClient = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php",
      userAgent: "RiftVersus/0.1 contact@example.com",
      fetch: async () => Response.json([{}]),
    });
    const loadRawInput = () => fetchLeaguepediaRawInput({
      fetchTeamsPage: async ({ offset }) => cargoPage("Teams", offset, [{ OverviewPage: "T1", Name: "T1" }, { OverviewPage: "Bilibili Gaming", Name: "Bilibili Gaming" }]),
      fetchTeamRedirectsPage: async ({ offset }) => teamRedirectPage(offset),
      fetchPlayersPage: async ({ offset }) => cargoPage("Players", offset, [{ OverviewPage: "Faker", ID: "Faker", Name: "Lee Sang-hyeok" }]),
      fetchPlayerRedirectsPage: async ({ offset }) => playerRedirectPage(offset),
      fetchTournamentsPage: async ({ offset }) => cargoPage("Tournaments", offset, [{ OverviewPage: "2024 Season World Championship", Name: "Worlds 2024" }]),
      fetchMatchSchedulesPage: async ({ offset }) => matchSchedulePage(offset, [{ UniqueMatch: "M1", MatchId: "M1", OverviewPage: "2024 Season World Championship", DateTime_UTC: "2024-11-02T14:00:00Z", Team1: "T1", Team2: "Bilibili Gaming", Team1Score: 3, Team2Score: 2, Winner: 1, BestOf: 5 }]),
      fetchGamesPage: async ({ offset }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "2024 Season World Championship", DateTime_UTC: "2024-11-02T14:00:00Z", BestOf: 5, N_GameInMatch: 1, Team1: "T1", Team2: "Bilibili Gaming", Team1Score: 3, Team2Score: 2, Winner: 1 }]),
      fetchGamePlayersPage: (input) => malformedPlayersClient.fetchGamePlayersPage(input),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }), fetchKnownPagesWithEvidence: async (titles: readonly string[]) => knownPagesResult(titles),
    }, { slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }], sourceUrl: "https://leaguepedia.example/wiki/Worlds" });
    const provider = createLeaguepediaProvider({ loadRawInput, overrides: await overrides() });

    const failure = await provider.stage({ mode: "sync-once" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RetainableStageError);
    const retained = JSON.parse(new TextDecoder().decode((failure as RetainableStageError).source.bytes)) as { input: LeaguepediaRawInput };
    const malformed = retained.input.rawEvidence.find((item) => item.table === "ScoreboardPlayers");
    expect(malformed?.response).toEqual([{}]);
    expect(retained.input.rawEvidence.filter((item) => item.requestId === malformed?.requestId)).toHaveLength(1);
  });

  it("does not treat known-page revision evidence as image metadata", async () => {
    const input = await rawFixture();
    const knownFileTitle = knownPagesResult(["File:T1 logo"]).rawEvidence[0]!;
    const snapshot = parseLeaguepediaRawInput({ ...input, rawEvidence: [knownFileTitle, ...input.rawEvidence] });
    expect(snapshot.media.find((item) => item.entityKey === "T1")).toMatchObject({
      sourceUrl: "https://fixture.riftversus.invalid/media/t1.png",
      contentType: "image/png",
    });
  });
});

describe("Leaguepedia normalization", () => {
  function observedLineageSnapshot(input: {
    legacyPlayedAt?: string;
    currentPlayedAt?: string;
  }): LeaguepediaSnapshot {
    const legacyPlayedAt = input.legacyPlayedAt ?? "2024-10-01T00:00:00Z";
    const currentPlayedAt = input.currentPlayedAt;
    const tournament = {
      sourceKey: "Worlds",
      displayName: "Worlds",
      validFrom: "2024-01-01",
      validTo: "2025-12-31",
    };
    const series = [
      { sourceKey: "LEGACY", tournamentKey: "Worlds", playedAt: legacyPlayedAt, sideATeam: "Legacy Team", sideBTeam: "Opponent", bestOf: 1 as const, sideAScore: 1, sideBScore: 0 },
      ...(currentPlayedAt === undefined ? [] : [{ sourceKey: "CURRENT", tournamentKey: "Worlds", playedAt: currentPlayedAt, sideATeam: "Current Team", sideBTeam: "Opponent", bestOf: 1 as const, sideAScore: 1, sideBScore: 0 }]),
    ];
    const games = series.map((item) => ({
      sourceKey: `${item.sourceKey}-G1`, seriesKey: item.sourceKey, gameNumber: 1, playedAt: item.playedAt,
      sideATeam: item.sideATeam, sideBTeam: item.sideBTeam, winnerTeam: item.sideATeam,
    }));
    return {
      provenance: { kind: "synthetic-fixture", name: "observed-lineage" },
      revisionIds: [], sourceUrl: "https://lol.example/wiki", rawEvidence: [], traversal: { requestedPages: 0, visitedPages: 0, complete: true }, slices: [],
      entities: [
        { kind: "team", sourceKey: "Legacy Team", displayName: "Legacy Team", aliases: [], region: "Korea", lineage: "Current Team" },
        { kind: "team", sourceKey: "Current Team", displayName: "Current Team", aliases: [], region: "Korea" },
        { kind: "team", sourceKey: "Opponent", displayName: "Opponent", aliases: [], region: "China" },
      ],
      tournaments: [tournament], series, games, gamePlayers: [], media: [],
    };
  }

  async function observedLineageOverrides(input: { explicitLegacyDates?: boolean } = {}) {
    const reviewed = await overrides();
    const identities = new Map(reviewed.identities);
    const canonicalId = "55555555-5555-5555-8555-555555555555";
    identities.set("Legacy Team", {
      sourceKey: "Legacy Team", canonicalName: "Current Team", canonicalId, kind: "team", aliases: [], reviewedNote: "Official forward rename edge.",
      ...(input.explicitLegacyDates ? { validFrom: "2020-01-01", validTo: "2024-12-31" } : {}),
    });
    identities.set("Current Team", { sourceKey: "Current Team", canonicalName: "Current Team", canonicalId, kind: "team", aliases: [], reviewedNote: "Official forward rename target." });
    return { ...reviewed, identities };
  }

  it("applies reviewed SKT to T1 precedence and excludes unreferenced duplicate players", async () => {
    const snapshot = await fixture();
    const result = normalizeLeaguepediaSnapshot(snapshot, await overrides());
    expect(result.entities.filter((entity) => entity.canonicalName === "T1")).toHaveLength(1);
    expect(result.entities.some((entity) => entity.sourceKey === "SK Telecom T1")).toBe(false);
    expect(result.quarantine).toEqual([]);
    expect(result.quarantineAffectedGameKeys).toEqual([]);
    expect(result.entities.some((entity) => entity.sourceKey === "Duplicate One")).toBe(false);
    expect(snapshot.slices[0]?.excludedOptionalDimensionRowKeys).toEqual(expect.arrayContaining(["Players:Duplicate One", "Players:Duplicate Two"]));
  });

  it("merges the reviewed Team Secret rename into the existing Secret Whales identity", async () => {
    const reviewed = await overrides();
    const secret = reviewed.identities.get("Team Secret (Vietnamese Team)");
    const whales = reviewed.identities.get("Team Secret Whales");
    expect(secret).toMatchObject({ canonicalName: "Team Secret Whales", canonicalId: "c948ba23-06d4-56f1-8990-1ee34429fbea", kind: "team" });
    expect(whales).toMatchObject({ canonicalName: "Team Secret Whales", canonicalId: secret?.canonicalId, kind: "team" });
  });

  it("stages player ID, real name, and source aliases without conflating canonical identity", async () => {
    const result = normalizeLeaguepediaSnapshot(await fixture(), await overrides());
    const normalizedFaker = result.entities.find((entity) => entity.playerId === "Faker");
    const faker = result.dimensions.entities.find((entity) => entity.playerId === "Faker");
    const expectedAliases = ["Faker (Player)", "Faker", "Lee Sang-hyeok", "The Unkillable Demon King"];
    expect(normalizedFaker?.aliases).toEqual(expectedAliases);
    expect(faker).toMatchObject({
      kind: "player",
      playerId: "Faker",
      canonicalName: "Lee Sang-hyeok",
    });
    expect(faker?.aliases).toEqual(expectedAliases);
    expect(faker?.aliases).not.toContain("");
    expect(new Set(faker?.aliases).size).toBe(faker?.aliases.length);
    const team = result.dimensions.entities.find((entity) => entity.kind === "team")!;
    expect(team.playerId).toBeUndefined();
    expect("playerId" in team).toBe(false);
  });

  it("merges the same player ID across source keys mapped to one canonical player", async () => {
    const snapshot = await fixture();
    const faker = snapshot.entities.find((entity) => entity.playerId === "Faker")!;
    const alias = { ...faker, sourceKey: "Faker Alternate Page", aliases: ["Unkillable Demon King"] };
    const reviewed = await overrides();
    const identities = new Map(reviewed.identities);
    const canonicalId = "66666666-6666-5666-8666-666666666666";
    for (const sourceKey of [faker.sourceKey, alias.sourceKey]) identities.set(sourceKey, {
      sourceKey, canonicalName: "Lee Sang-hyeok", canonicalId, kind: "player", aliases: [], reviewedNote: "Reviewed player source merge.",
    });

    for (const mergedPlayers of [[faker, alias], [alias, faker]]) {
      const result = normalizeLeaguepediaSnapshot({ ...snapshot, entities: [...snapshot.entities.filter((entity) => entity.playerId !== "Faker"), ...mergedPlayers] }, { ...reviewed, identities });
      const definition = result.dimensions.entities.find((entity) => entity.id === canonicalId);
      expect(new Set(definition?.sourceKeys)).toEqual(new Set(["Faker (Player)", "Faker Alternate Page"]));
      expect(definition?.playerId).toBe("Faker");
      expect(definition?.canonicalName).toBe("Lee Sang-hyeok");
    }
  });

  it("fails closed in either order when source keys mapped to one canonical player disagree on player ID", async () => {
    const snapshot = await fixture();
    const faker = snapshot.entities.find((entity) => entity.playerId === "Faker")!;
    const alias = { ...faker, sourceKey: "Faker Alternate Page", playerId: "Hide on bush" };
    const reviewed = await overrides();
    const identities = new Map(reviewed.identities);
    const canonicalId = "66666666-6666-5666-8666-666666666666";
    for (const sourceKey of [faker.sourceKey, alias.sourceKey]) identities.set(sourceKey, {
      sourceKey, canonicalName: "Lee Sang-hyeok", canonicalId, kind: "player", aliases: [], reviewedNote: "Reviewed player source merge.",
    });

    for (const mergedPlayers of [[faker, alias], [alias, faker]]) {
      expect(() => normalizeLeaguepediaSnapshot({ ...snapshot, entities: [...snapshot.entities.filter((entity) => entity.playerId !== "Faker"), ...mergedPlayers] }, { ...reviewed, identities }))
        .toThrow(/66666666-6666-5666-8666-666666666666.*Faker \(Player\).*Faker Alternate Page.*Faker.*Hide on bush|66666666-6666-5666-8666-666666666666.*Faker Alternate Page.*Faker \(Player\).*Hide on bush.*Faker/i);
    }
  });

  it("fails closed in either order when merged source keys disagree on canonical name", async () => {
    const snapshot = await fixture();
    const faker = snapshot.entities.find((entity) => entity.playerId === "Faker")!;
    const alias = { ...faker, sourceKey: "Faker Alternate Page" };
    const reviewed = await overrides();
    const identities = new Map(reviewed.identities);
    const canonicalId = "66666666-6666-5666-8666-666666666666";
    identities.set(faker.sourceKey, { sourceKey: faker.sourceKey, canonicalName: "Lee Sang-hyeok", canonicalId, kind: "player", aliases: [], reviewedNote: "Reviewed player source merge." });
    identities.set(alias.sourceKey, { sourceKey: alias.sourceKey, canonicalName: "Sang-hyeok Lee", canonicalId, kind: "player", aliases: [], reviewedNote: "Conflicting player source merge." });

    for (const mergedPlayers of [[faker, alias], [alias, faker]]) {
      expect(() => normalizeLeaguepediaSnapshot({ ...snapshot, entities: [...snapshot.entities.filter((entity) => entity.playerId !== "Faker"), ...mergedPlayers] }, { ...reviewed, identities }))
        .toThrow(/66666666-6666-5666-8666-666666666666.*Faker \(Player\).*Faker Alternate Page.*Lee Sang-hyeok.*Sang-hyeok Lee|66666666-6666-5666-8666-666666666666.*Faker Alternate Page.*Faker \(Player\).*Sang-hyeok Lee.*Lee Sang-hyeok/i);
    }
  });

  it("fails closed when official RenamedTo lineage is not merged by reviewed overrides", async () => {
    const snapshot = observedLineageSnapshot({ currentPlayedAt: "2025-02-15T12:00:00Z" });
    const reviewed = await observedLineageOverrides();
    const identities = new Map(reviewed.identities);
    identities.delete("Legacy Team");
    expect(() => normalizeLeaguepediaSnapshot(snapshot, { ...reviewed, identities })).toThrow(/RenamedTo.*same reviewed canonical identity/i);
  });

  it("merges a direct transitive rename chain end-to-end without staging a connector era", async () => {
    const snapshot = observedLineageSnapshot({ currentPlayedAt: "2025-02-15T12:00:00Z" });
    snapshot.entities = snapshot.entities.flatMap((entity) => entity.sourceKey === "Legacy Team"
      ? [{ ...entity, lineage: "Bridge Team" }, { kind: "team" as const, sourceKey: "Bridge Team", displayName: "Bridge Team", aliases: [], region: "Korea", lineage: "Current Team" }]
      : entity);
    const reviewed = await observedLineageOverrides();
    const identities = new Map(reviewed.identities);
    identities.set("Bridge Team", { sourceKey: "Bridge Team", canonicalName: "Current Team", canonicalId: identities.get("Current Team")!.canonicalId, kind: "team", aliases: [], reviewedNote: "Official direct-chain connector." });
    const result = normalizeLeaguepediaSnapshot(snapshot, { ...reviewed, identities });
    expect(result.dimensions.entities.find((entity) => entity.id === result.entityIds.get("Legacy Team"))?.sourceKeys).toEqual(["Legacy Team", "Bridge Team", "Current Team"]);
    expect(result.dimensions.teamEras.some((era) => era.sourceKey === "Bridge Team")).toBe(false);
    expect(result.dimensions.teamEras.filter((era) => era.teamEntityId === result.entityIds.get("Legacy Team"))).toEqual([
      expect.objectContaining({ sourceKey: "Legacy Team", validTo: "2025-02-14" }),
      expect.objectContaining({ sourceKey: "Current Team", validFrom: "2025-02-15" }),
    ]);
  });

  it("bounds undated lineage eras at the next source team's first observed day", async () => {
    const result = normalizeLeaguepediaSnapshot(observedLineageSnapshot({
      legacyPlayedAt: "2024-10-01T12:00:00Z",
      currentPlayedAt: "2025-02-15T12:00:00Z",
    }), await observedLineageOverrides());
    expect(result.dimensions.teamEras.filter((era) => era.teamEntityId === result.entityIds.get("Legacy Team"))).toEqual([
      expect.objectContaining({ sourceKey: "Legacy Team", validFrom: null, validTo: "2025-02-14" }),
      expect.objectContaining({ sourceKey: "Current Team", validFrom: "2025-02-15", validTo: null }),
    ]);
    expect(result.facts.series.map((item) => item.sideAEraId)).toEqual([
      result.eraIds.get("Legacy Team"),
      result.eraIds.get("Current Team"),
    ]);
  });

  it("fails when two undated source team eras share the same canonical identity and observed day", async () => {
    const reviewed = await observedLineageOverrides();
    expect(() => normalizeLeaguepediaSnapshot(observedLineageSnapshot({
      legacyPlayedAt: "2024-10-01T12:00:00Z",
      currentPlayedAt: "2024-10-01T18:00:00Z",
    }), reviewed)).toThrow(/observed facts.*outside inferred era/i);
  });

  it("keeps reviewed validity dates ahead of observed fact bounds", async () => {
    const result = normalizeLeaguepediaSnapshot(observedLineageSnapshot({ legacyPlayedAt: "2024-10-01T12:00:00Z" }), await observedLineageOverrides({ explicitLegacyDates: true }));
    expect(result.dimensions.teamEras.find((era) => era.sourceKey === "Legacy Team")).toMatchObject({ validFrom: "2020-01-01", validTo: "2024-12-31" });
  });

  it("keeps one undated directly referenced team era open and selectable", async () => {
    const snapshot = observedLineageSnapshot({ legacyPlayedAt: "2024-10-01T12:00:00Z" });
    snapshot.entities = snapshot.entities.filter((entity) => entity.sourceKey !== "Current Team").map((entity) => entity.sourceKey === "Legacy Team" ? { ...entity, lineage: null } : entity);
    snapshot.series = [...snapshot.series, { ...snapshot.series[0]!, sourceKey: "LEGACY-LATER", playedAt: "2024-11-02T12:00:00Z" }];
    snapshot.games = [...snapshot.games, { ...snapshot.games[0]!, sourceKey: "LEGACY-LATER-G1", seriesKey: "LEGACY-LATER", playedAt: "2024-11-02T12:00:00Z" }];
    const result = normalizeLeaguepediaSnapshot(snapshot, await overrides());
    expect(result.dimensions.teamEras.find((era) => era.sourceKey === "Legacy Team")).toMatchObject({ validFrom: null, validTo: null });
    expect(new Set(result.facts.series.map((item) => item.sideAEraId))).toEqual(new Set([result.eraIds.get("Legacy Team")]));
  });

  it("keeps an undated forward target in canonical closure without staging an unobserved era", async () => {
    const result = normalizeLeaguepediaSnapshot(observedLineageSnapshot({ legacyPlayedAt: "2024-10-01T12:00:00Z" }), await observedLineageOverrides());
    expect(result.dimensions.entities.find((entity) => entity.id === result.entityIds.get("Legacy Team"))?.sourceKeys).toEqual(["Legacy Team", "Current Team"]);
    expect(result.dimensions.teamEras.filter((era) => era.teamEntityId === result.entityIds.get("Legacy Team"))).toEqual([
      expect.objectContaining({ sourceKey: "Legacy Team", validFrom: null, validTo: null }),
    ]);
  });

  it("keeps a terminal inferred era open for future games", async () => {
    const snapshot = observedLineageSnapshot({ legacyPlayedAt: "2024-10-01T12:00:00Z", currentPlayedAt: "2025-02-15T12:00:00Z" });
    snapshot.series = [...snapshot.series, { ...snapshot.series[1]!, sourceKey: "CURRENT-FUTURE", playedAt: "2026-03-01T12:00:00Z" }];
    snapshot.games = [...snapshot.games, { ...snapshot.games[1]!, sourceKey: "CURRENT-FUTURE-G1", seriesKey: "CURRENT-FUTURE", playedAt: "2026-03-01T12:00:00Z" }];
    const result = normalizeLeaguepediaSnapshot(snapshot, await observedLineageOverrides());
    const currentEra = result.dimensions.teamEras.find((era) => era.sourceKey === "Current Team")!;
    expect(currentEra).toMatchObject({ validFrom: "2025-02-15", validTo: null });
    expect(result.facts.series.find((item) => item.sourceKey === "CURRENT-FUTURE")?.sideAEraId).toBe(currentEra.id);
  });

  it("rejects predecessor facts observed after the inferred successor boundary", async () => {
    const snapshot = observedLineageSnapshot({ legacyPlayedAt: "2024-10-01T12:00:00Z", currentPlayedAt: "2025-02-15T12:00:00Z" });
    snapshot.series = [...snapshot.series, { ...snapshot.series[0]!, sourceKey: "LEGACY-LATE", playedAt: "2025-03-01T12:00:00Z" }];
    snapshot.games = [...snapshot.games, { ...snapshot.games[0]!, sourceKey: "LEGACY-LATE-G1", seriesKey: "LEGACY-LATE", playedAt: "2025-03-01T12:00:00Z" }];
    const reviewed = await observedLineageOverrides();
    expect(() => normalizeLeaguepediaSnapshot(snapshot, reviewed)).toThrow(/observed facts.*outside inferred era/i);
  });

  it("normalizes explicit series, games and player facts with stable identifiers", async () => {
    const snapshot = await referencedSktFixture();
    const result = normalizeLeaguepediaSnapshot(snapshot, await overrides());
    expect(result.facts.series).toHaveLength(1);
    expect(result.facts.series?.[0]).toMatchObject({ sourceKey: "WORLD24-FINAL", bestOf: 5, completed: true, sideAScore: 3, sideBScore: 2 });
    expect(result.facts.games?.map((game) => game.winnerTeamId === result.entityIds.get("T1") ? "T1" : "Bilibili Gaming")).toEqual(["Bilibili Gaming", "T1", "Bilibili Gaming", "T1", "T1"]);
    expect(result.facts.gamePlayers).toHaveLength(50);
    expect(new Set(result.facts.gamePlayers?.map((player) => snapshot.entities.find((entity) => result.entityIds.get(entity.sourceKey) === player.playerEntityId)?.sourceKey))).toEqual(new Set(["Zeus", "Oner", "Faker (Player)", "Gumayusi", "Keria", "Bin", "Xun", "knight", "Elk", "ON"]));
    expect(result.facts.games?.[0]).toMatchObject({ sourceKey: "WORLD24-FINAL-G1", gameNumber: 1 });
    expect(result.facts.gamePlayers?.[0]?.gameId).toBe(result.facts.games?.[0]?.id);
    expect(result.rosterGameIds).toEqual(result.facts.games?.map((game) => game.id));
    expect(result.dimensions.entities.find((entity) => entity.canonicalName === "T1")?.sourceKeys).toEqual(["SK Telecom T1", "T1"]);
    const t1Eras = result.dimensions.teamEras.filter((era) => era.teamEntityId === result.entityIds.get("T1"));
    expect(t1Eras).toHaveLength(2);
    expect(new Set(t1Eras.map((era) => era.id)).size).toBe(2);
    expect(result.facts.series?.[0]?.sideAEraId).toBe(result.eraIds.get("T1"));
    expect(result.dimensions.tournaments).toEqual([expect.objectContaining({ sourceKey: "2024 Season World Championship", name: "2024 Season World Championship", category: "worlds" })]);
  });

  it("selects the unique canonical team era by playedAt", async () => {
    const snapshot = await referencedSktFixture(); const reviewed = await overrides();
    const series = [
      { ...snapshot.series[0]!, sourceKey: "S2018", playedAt: "2018-10-01T00:00:00Z", sideATeam: "T1" },
      { ...snapshot.series[0]!, sourceKey: "S2020", playedAt: "2020-10-01T00:00:00Z", sideATeam: "SK Telecom T1" },
    ];
    const games = series.map((item, index) => ({ ...snapshot.games[0]!, sourceKey: `G${index}`, seriesKey: item.sourceKey, playedAt: item.playedAt, sideATeam: item.sideATeam }));
    const result = normalizeLeaguepediaSnapshot({ ...snapshot, series, games, gamePlayers: [], slices: [] }, reviewed);
    const sktEra = result.dimensions.teamEras.find((era) => era.sourceKey === "SK Telecom T1")!;
    const t1Era = result.dimensions.teamEras.find((era) => era.sourceKey === "T1")!;
    expect(result.facts.series?.map((item) => item.sideAEraId)).toEqual([sktEra.id, t1Era.id]);
  });

  it("takes era and region from the same playedAt-selected definition", async () => {
    const snapshot = await referencedSktFixture();
    const entities = snapshot.entities.map((entity) => entity.sourceKey === "SK Telecom T1" ? { ...entity, region: "Old Korea" } : entity.sourceKey === "T1" ? { ...entity, region: "New Korea" } : entity);
    const series = [{ ...snapshot.series[0]!, playedAt: "2020-10-01T00:00:00Z", sideATeam: "SK Telecom T1" }];
    const games = [{ ...snapshot.games[0]!, playedAt: series[0]!.playedAt, sideATeam: "SK Telecom T1" }];
    const result = normalizeLeaguepediaSnapshot({ ...snapshot, entities, series, games, gamePlayers: [], slices: [] }, await overrides());
    const t1Era = result.dimensions.teamEras.find((era) => era.sourceKey === "T1")!;
    expect(result.facts.series?.[0]).toMatchObject({ sideAEraId: t1Era.id, sideARegionId: t1Era.regionId });
    expect(t1Era.regionId).toBe(result.dimensions.regions.find((region) => region.name === "New Korea")?.id);
  });

  it("maps official source regions to reviewed canonical esports regions", async () => {
    const result = normalizeLeaguepediaSnapshot(await fixture(), await overrides());
    const lpl = result.dimensions.regions.find((region) => region.sourceKey === "China");
    const lck = result.dimensions.regions.find((region) => region.sourceKey === "Korea");
    expect(lpl).toMatchObject({ id: "33333333-3333-5333-8333-333333333333", name: "LPL" });
    expect(lck).toMatchObject({ id: "44444444-4444-5444-8444-444444444444", name: "LCK" });
    expect(result.facts.series?.[0]?.sideBRegionId).toBe(lpl?.id);
    expect(result.facts.series?.[0]?.sideARegionId).toBe(lck?.id);
  });

  it("override checksums are deterministic and reviewed precedence wins", async () => {
    const first = await overrides();
    const second = await overrides();
    expect(first.checksums).toEqual(second.checksums);
    expect(Object.values(first.checksums).every((checksum) => /^sha256:[a-f0-9]{64}$/.test(checksum))).toBe(true);
    expect(first.identities.get("SK Telecom T1")?.canonicalName).toBe("T1");
    expect(first.identities.get("Phong Vũ Buffalo")).toMatchObject({
      canonicalName: "Saigon Buffalo",
      canonicalId: "ee77cc6b-b3c8-5f06-8068-3c8d96cd4ed7",
      validTo: "2019-05-30",
    });
    expect(first.identities.get("Saigon Buffalo")).toMatchObject({
      canonicalName: "Saigon Buffalo",
      canonicalId: "ee77cc6b-b3c8-5f06-8068-3c8d96cd4ed7",
      validFrom: "2020-05-25",
    });
    expect(first.identities.get("Movistar R7")).toMatchObject({
      canonicalName: "LYON",
      canonicalId: "0d531ed1-8517-56d4-84a4-742d46d63bb1",
      validTo: "2024-10-30",
    });
    expect(first.identities.get("LYON (2024 American Team)")).toMatchObject({
      canonicalName: "LYON",
      canonicalId: "0d531ed1-8517-56d4-84a4-742d46d63bb1",
      validFrom: "2024-10-31",
    });
    expect(first.identities.get("Splyce")).toMatchObject({
      canonicalName: "Movistar KOI",
      canonicalId: "35c453b9-1773-5568-8e9b-c7613835f8c8",
      validTo: "2019-11-28",
    });
    expect(first.identities.get("MAD Lions KOI")).toMatchObject({
      canonicalName: "Movistar KOI",
      canonicalId: "35c453b9-1773-5568-8e9b-c7613835f8c8",
      validFrom: "2019-11-29",
      validTo: "2024-12-05",
    });
    expect(first.identities.get("Movistar KOI")).toMatchObject({
      canonicalId: "35c453b9-1773-5568-8e9b-c7613835f8c8",
      validFrom: "2024-12-06",
    });
    expect(first.regions.get("China")?.canonicalName).toBe("LPL");
  });

  it("rejects a conflicting reviewed override instead of weakening quarantine", async () => {
    const loaded = await overrides();
    const snapshot = await fixture();
    const identities = new Map(loaded.identities);
    identities.set("Faker (Player)", { sourceKey: "Faker (Player)", canonicalName: "Faker", canonicalId: "33333333-3333-5333-8333-333333333333", kind: "team", aliases: [], reviewedNote: "invalid fixture" });
    expect(() => normalizeLeaguepediaSnapshot({ ...snapshot, entities: snapshot.entities.filter((entity) => entity.playerId === "Faker") }, { ...loaded, identities }))
      .toThrow(/33333333-3333-5333-8333-333333333333.*Faker \(Player\).*player.*team/i);
  });

  it("keeps missing media out and retains required attribution metadata", async () => {
    const normalized = normalizeLeaguepediaSnapshot(await fixture(), await overrides());
    const media = parseLeaguepediaMedia((await fixture()).media, normalized.entityIds);
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ attribution: "Leaguepedia contributors", license: "CC BY-SA" });
    expect(media[0]?.sourceUrl).toMatch(/^https:/);
  });

  it("rejects inconsistent BestOf scores even when a snapshot bypasses Cargo parsing", async () => {
    const snapshot = await fixture();
    const reviewed = await overrides();
    expect(() => normalizeLeaguepediaSnapshot({ ...snapshot, series: snapshot.series.map((series) => ({ ...series, sideAScore: 2, sideBScore: 2 })) }, reviewed)).toThrow(/BestOf 5/);
  });
});

describe("Leaguepedia coverage and provider", () => {
  it("never treats zero rows as complete", () => {
    expect(deriveLeaguepediaCoverage({ competition: "Worlds", seasonYear: 2024, observedRows: 0, traversal: { requestedPages: 1, visitedPages: 1, complete: true } }).status).toBe("missing");
  });

  it("requires bounded traversal evidence before complete coverage", () => {
    expect(deriveLeaguepediaCoverage({ competition: "Worlds", seasonYear: 2024, observedRows: 1, traversal: { requestedPages: 2, visitedPages: 1, complete: false } }).status).toBe("partial");
    expect(deriveLeaguepediaCoverage({ competition: "Worlds", seasonYear: 2024, observedRows: 1, traversal: { requestedPages: 2, visitedPages: 2, complete: true } }).status).toBe("complete");
  });

  it("marks otherwise complete coverage partial when optional identities are quarantined", () => {
    expect(deriveLeaguepediaCoverage({ competition: "Worlds", seasonYear: 2024, observedRows: 1, unresolvedRows: 2, traversal: { requestedPages: 1, visitedPages: 1, complete: true } }).status).toBe("partial");
  });

  it("stages a runner-owned batch without repository or publication access", async () => {
    const snapshot = await fixture();
    const provider = createLeaguepediaProvider({ loadRawInput: async () => rawInput(snapshot), overrides: await overrides() });
    const batch = await provider.stage({ mode: "backfill", years: [2024], competitions: ["Worlds"] });
    expect(provider.id).toBe("leaguepedia");
    expect(batch.source.bytes.byteLength).toBeGreaterThan(0);
    expect(batch.media).toHaveLength(1);
    expect(batch.facts.series).toHaveLength(1);
    expect(batch.coverage[0]).toMatchObject({ status: "partial", detail: expect.stringContaining("synthetic fixture is not source coverage") });
    expect(batch.publicationScopes.every((scope) => scope.status !== "complete")).toBe(true);
    expect(batch.dimensions.entities).not.toHaveLength(0);
    const raw = JSON.parse(new TextDecoder().decode(batch.source.bytes)) as Record<string, unknown>;
    expect(raw).toHaveProperty("format", "riftversus-leaguepedia-raw-v1");
    expect(raw).toHaveProperty("input.provenance", { kind: "synthetic-fixture", name: "leaguepedia-small" });
    const retainedInput = raw.input as LeaguepediaRawInput;
    expect([retainedInput.sourceUrl, ...retainedInput.rawEvidence.map((item) => item.sourceUrl)].every((url) => new URL(url).hostname === "fixture.riftversus.invalid")).toBe(true);
    expect(retainedInput.rawEvidence.every((item) => item.revisionIds.length === 0
      && ["/api.php", "/wiki/Special:CargoExport", "/raw/media/t1-logo"].includes(new URL(item.sourceUrl).pathname))).toBe(true);
    expect(batch.media.every((item) => new URL(item.sourceUrl).hostname === "fixture.riftversus.invalid")).toBe(true);
    expect(raw).not.toHaveProperty("entities");
    expect(raw).not.toHaveProperty("games");
    expect(new TextDecoder().decode(batch.source.bytes)).toContain("Duplicate One");
    expect(batch.source.sourceUrl).toBe("https://fixture.riftversus.invalid/dataset/leaguepedia-small");
    expect(batch.provenance).toMatchObject({ sourceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), parserVersion: "leaguepedia-v3" });
    expect(batch.provenance.overrideFiles).toEqual([
      expect.objectContaining({ file: "data/overrides/identities.yaml", checksum: expect.stringMatching(/^sha256:/) }),
      expect.objectContaining({ file: "data/overrides/regions.yaml", checksum: expect.stringMatching(/^sha256:/) }),
      expect.objectContaining({ file: "data/overrides/tournaments.yaml", checksum: expect.stringMatching(/^sha256:/) }),
    ]);
    const replayed = normalizeLeaguepediaSnapshot(parseLeaguepediaRawInput(raw.input as LeaguepediaRawInput), await overrides());
    expect(replayed.facts).toEqual(batch.facts);
    expect(replayed.dimensions).toEqual(batch.dimensions);
    expect("repository" in provider).toBe(false);
    expect("publish" in provider).toBe(false);
  });

  it("only marks a slice partial when it references a quarantined identity", async () => {
    const snapshot = await fixture();
    const affected: LeaguepediaRawInput = { ...rawInput(snapshot), rawEvidence: snapshot.rawEvidence.map((item) => item.table === "ScoreboardPlayers" ? {
      ...item,
      response: [
        ...(item.response as Record<string, unknown>[]).filter((row) => row.GameId !== "WORLD24-FINAL-G1" || (row.PlayerKey !== "Faker" && row.PlayerKey !== "Zeus")),
        { GameId: "WORLD24-FINAL-G1", PlayerKey: "Duplicate One", PlayerDisplayName: "Rookie", Team: "T1", PlayerWin: "No" },
        { GameId: "WORLD24-FINAL-G1", PlayerKey: "Duplicate Two", PlayerDisplayName: "Rookie", Team: "T1", PlayerWin: "No" },
      ],
    } : item) };
    const provider = createLeaguepediaProvider({ loadRawInput: async () => affected, overrides: await overrides() });
    const batch = await provider.stage({ mode: "backfill", years: [2024, 2025], competitions: ["Worlds"] });
    expect(batch.coverage).toEqual([
      expect.objectContaining({ seasonYear: 2024, status: "partial" }),
      expect.objectContaining({ seasonYear: 2025, status: "missing" }),
    ]);
  });

  it("does not publish destructive roster authority for a nine-player game", async () => {
    const snapshot = await fixture();
    const incomplete: LeaguepediaRawInput = { ...rawInput(snapshot), rawEvidence: snapshot.rawEvidence.map((item) => item.table === "ScoreboardPlayers" ? { ...item, response: [...(item.response as unknown[]).slice(0, 9), ...(item.response as unknown[]).slice(10)] } : item) };
    const batch = await createLeaguepediaProvider({ loadRawInput: async () => incomplete, overrides: await overrides() }).stage({ mode: "backfill", years: [2024], competitions: ["Worlds"] });
    const incompleteGameId = batch.facts.games?.find((game) => game.sourceKey === "WORLD24-FINAL-G1")?.id;
    const completeGameIds = batch.facts.games?.filter((game) => game.sourceKey !== "WORLD24-FINAL-G1").map((game) => game.id);
    expect(batch.facts.gamePlayers).toHaveLength(40);
    expect(batch.facts.gamePlayers?.every((player) => player.gameId !== incompleteGameId)).toBe(true);
    expect(batch.rosterGameIds).toEqual(completeGameIds);
    expect(batch.coverage[0]?.status).toBe("partial");
  });

  it("fails duplicate or extra roster rows", async () => {
    const snapshot = await fixture(); const reviewed = await overrides();
    const mutate = (rows: unknown[]) => ({ ...rawInput(snapshot), rawEvidence: snapshot.rawEvidence.map((item) => item.table === "ScoreboardPlayers" ? { ...item, response: rows } : item) });
    const rows = snapshot.rawEvidence.find((item) => item.table === "ScoreboardPlayers")!.response as Array<Record<string, unknown>>;
    const duplicate = [...rows.slice(0, 9), { ...rows[9]!, PlayerKey: "Faker", PlayerDisplayName: "Faker" }, ...rows.slice(10)];
    await expect(createLeaguepediaProvider({ loadRawInput: async () => mutate(duplicate), overrides: reviewed }).stage({ mode: "sync-once" })).rejects.toThrow(/duplicate/i);
    const extra = [...rows, { GameId: "WORLD24-FINAL-G1", PlayerKey: "Duplicate One", PlayerDisplayName: "Rookie", Team: "T1", PlayerWin: "No" }];
    await expect(createLeaguepediaProvider({ loadRawInput: async () => mutate(extra), overrides: reviewed }).stage({ mode: "sync-once" })).rejects.toThrow(/exceeds 10/);
  });

  it("converts a malformed Cargo envelope into retainable raw provider evidence", async () => {
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", fetch: async () => Response.json({ error: "malformed" }) });
    const provider = createLeaguepediaProvider({
      loadRawInput: async () => {
        await client.fetchTeamsPage({ offset: 0 });
        throw new Error("unreachable");
      },
      overrides: await overrides(),
    });
    const failure = await provider.stage({ mode: "sync-once" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RetainableStageError);
    expect(JSON.parse(new TextDecoder().decode((failure as RetainableStageError).source.bytes))).toEqual(expect.objectContaining({ format: "riftversus-leaguepedia-raw-v1", provenance: { kind: "live" }, evidence: expect.any(Array) }));
  });

  it("derives dates and completeness independently for each requested slice", async () => {
    const snapshot = await fixture();
    const provider = createLeaguepediaProvider({ loadRawInput: async () => rawInput(snapshot), overrides: await overrides() });
    const batch = await provider.stage({ mode: "backfill", years: [2024, 2025], competitions: ["Worlds"] });
    expect(batch.coverage).toEqual([
      expect.objectContaining({ seasonYear: 2024, earliestDate: "2024-11-02", latestDate: "2024-11-02", status: "partial" }),
      expect.objectContaining({ seasonYear: 2025, earliestDate: null, latestDate: null, status: "missing" }),
    ]);
  });

  it("groups Worlds main and Play-In source slices into one logical partial coverage row", async () => {
    const input = await multiSourceWorldsInput();
    const batch = await createLeaguepediaProvider({ loadRawInput: async () => input, overrides: await overrides() }).stage({ mode: "backfill", years: [2024], competitions: ["Worlds"] });
    expect(batch.coverage).toEqual([expect.objectContaining({
      competition: "Worlds", seasonYear: 2024, status: "partial", earliestDate: "2024-10-01", latestDate: "2024-11-02",
    })]);
    expect(batch.facts.games).toHaveLength(6);
  });

  it("counts top-level traversal by unique retained HTTP requests across slices", async () => {
    const input = await multiSourceWorldsInput();
    const snapshot = parseLeaguepediaRawInput(input);
    const uniqueRequestIds = new Set(input.rawEvidence.map((item) => item.requestId)).size;

    expect(snapshot.slices).toHaveLength(2);
    expect(snapshot.slices[1]?.traversal.complete).toBe(false);
    expect(snapshot.traversal).toEqual({
      requestedPages: uniqueRequestIds,
      visitedPages: uniqueRequestIds,
      complete: false,
    });
  });

  it("deduplicates the same consistent GameId across logical source slices", async () => {
    const input = await duplicateGameWorldsInput();
    const batch = await createLeaguepediaProvider({ loadRawInput: async () => input, overrides: await overrides() }).stage({ mode: "backfill", years: [2024], competitions: ["Worlds"] });
    expect(batch.facts.games).toHaveLength(5);
    expect(batch.coverage).toEqual([expect.objectContaining({ status: "partial", detail: expect.stringContaining("synthetic fixture is not source coverage") })]);
  });

  it("retains a completed series when an individual game row is missing", async () => {
    const input = await rawFixture();
    const missing: LeaguepediaRawInput = { ...input, rawEvidence: input.rawEvidence.map((item) => {
      if (item.table !== "ScoreboardGames" && item.table !== "ScoreboardPlayers") return item;
      return { ...item, response: (item.response as Record<string, unknown>[]).filter((row) => row.GameId !== "WORLD24-FINAL-G3") };
    }) };
    const batch = await createLeaguepediaProvider({ loadRawInput: async () => missing, overrides: await overrides() }).stage({ mode: "sync-once" });
    expect(batch.facts.series).toHaveLength(1);
    expect(batch.facts.series[0]).toMatchObject({ sideAScore: 3, sideBScore: 2 });
    expect(batch.facts.games).toHaveLength(4);
  });

  it("emits one inferred coverage row per logical competition and year", async () => {
    const input = await multiSourceWorldsInput();
    const batch = await createLeaguepediaProvider({ loadRawInput: async () => input, overrides: await overrides() }).stage({ mode: "sync-once" });
    expect(batch.coverage).toHaveLength(1);
    expect(batch.coverage[0]).toMatchObject({ competition: "Worlds", seasonYear: 2024 });
  });

  it("changes deterministic version when parser or reviewed override checksums change", async () => {
    const snapshot = await fixture();
    const reviewed = await overrides();
    const base = createLeaguepediaProvider({ loadRawInput: async () => rawInput(snapshot), overrides: reviewed, parserVersion: "parser-a" });
    const changedParser = createLeaguepediaProvider({ loadRawInput: async () => rawInput(snapshot), overrides: reviewed, parserVersion: "parser-b" });
    const changedOverrides = createLeaguepediaProvider({ loadRawInput: async () => rawInput(snapshot), overrides: { ...reviewed, checksums: { ...reviewed.checksums, "data/overrides/synthetic.yaml": `sha256:${"f".repeat(64)}` } }, parserVersion: "parser-a" });
    const request = { mode: "backfill", years: [2024], competitions: ["Worlds"] } as const;
    const [a1, a2, parser, override] = await Promise.all([base.stage(request), base.stage(request), changedParser.stage(request), changedOverrides.stage(request)]);
    expect(a1.version).toBe(a2.version);
    expect(a1.version).not.toBe(parser.version);
    expect(a1.version).not.toBe(override.version);
  });

  it("keeps live completeness authoritative and versions provenance separately", async () => {
    const syntheticInput = await rawFixture();
    const reviewed = await overrides();
    const request = { mode: "sync-once" } as const;
    const synthetic = await createLeaguepediaProvider({ loadRawInput: async () => syntheticInput, overrides: reviewed }).stage(request);
    const live = await createLeaguepediaProvider({ loadRawInput: async () => ({ ...syntheticInput, provenance: { kind: "live" } }), overrides: reviewed }).stage(request);
    expect(synthetic.coverage[0]?.status).toBe("partial");
    expect(live.coverage[0]?.status).toBe("complete");
    expect(live.publicationScopes).toEqual([expect.objectContaining({ status: "complete" })]);
    expect(live.version).not.toBe(synthetic.version);
  });

  it("rejects absolute or synthetic override identities before staging provenance", async () => {
    const snapshot = await fixture(); const reviewed = await overrides();
    const provider = createLeaguepediaProvider({ loadRawInput: async () => rawInput(snapshot), overrides: { ...reviewed, checksums: { "/tmp/identities.yaml": `sha256:${"a".repeat(64)}` } } });
    await expect(provider.stage({ mode: "sync-once" })).rejects.toThrow(/repository-relative/);
  });

  it("changes sourceKey and version when raw Cargo evidence changes despite identical revisions", async () => {
    const snapshot = await fixture();
    const reviewed = await overrides();
    const changed: LeaguepediaRawInput = {
      ...rawInput(snapshot),
      rawEvidence: snapshot.rawEvidence.map((item, index) => index === 0 ? { ...item, response: (item.response as Record<string, unknown>[]).map((row, rowIndex) => rowIndex === 0 ? { ...row, changedCargoField: "changed" } : row) } : item),
    };
    const originalBatch = await createLeaguepediaProvider({ loadRawInput: async () => rawInput(snapshot), overrides: reviewed }).stage({ mode: "sync-once" });
    const changedBatch = await createLeaguepediaProvider({ loadRawInput: async () => changed, overrides: reviewed }).stage({ mode: "sync-once" });
    expect(originalBatch.source.sourceKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(changedBatch.source.sourceKey).not.toBe(originalBatch.source.sourceKey);
    expect(changedBatch.version).not.toBe(originalBatch.version);
  });

  it("rejects a player winner flag that contradicts the canonical game winner", async () => {
    const snapshot = await fixture();
    const reviewed = await overrides();
    expect(() => normalizeLeaguepediaSnapshot({ ...snapshot, gamePlayers: snapshot.gamePlayers.map((item) => ({ ...item, playerWin: !item.playerWin })) }, reviewed)).toThrow(/winner flag/);
  });

  it("rejects player facts whose game key is absent before slice coverage is derived", async () => {
    const snapshot = await fixture();
    const reviewed = await overrides();
    expect(() => normalizeLeaguepediaSnapshot({ ...snapshot, gamePlayers: [{ ...snapshot.gamePlayers[0]!, gameKey: "UNKNOWN" }] }, reviewed)).toThrow(/unknown game UNKNOWN/);
  });
});
