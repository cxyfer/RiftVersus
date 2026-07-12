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

const root = fileURLToPath(new URL("../../..", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixtures/leaguepedia-snapshot.json", import.meta.url));

async function fixture(): Promise<LeaguepediaSnapshot> {
  return parseLeaguepediaRawInput(await rawFixture());
}
async function rawFixture(): Promise<LeaguepediaRawInput> { return JSON.parse(await readFile(fixturePath, "utf8")) as LeaguepediaRawInput; }

async function overrides() {
  return loadOverrides({
    identities: `${root}/data/overrides/identities.yaml`,
    tournaments: `${root}/data/overrides/tournaments.yaml`,
  });
}

function rawEvidence(table: LeaguepediaCargoTable, offset: number, rows: readonly Record<string, unknown>[]): RawApiEvidence {
  return { requestId: `${table}:${offset}`, action: "cargoquery", table, offset, sourceUrl: `https://lol.example/api.php?action=cargoquery&tables=${table}&offset=${offset}`, response: { cargoquery: rows.map((title) => ({ title })) }, revisionIds: [] };
}

function cargoPage(table: LeaguepediaCargoTable, offset: number, rows: readonly Record<string, unknown>[]) {
  return { offset, rows, rawEvidence: rawEvidence(table, offset, rows) };
}
function rawInput(snapshot: LeaguepediaSnapshot): LeaguepediaRawInput {
  return { sourceUrl: snapshot.sourceUrl, slices: snapshot.slices.map(({ sliceId, competition, sourceCompetition, seasonYear, from, to }) => ({ sliceId, competition, sourceCompetition, seasonYear, from, to })), rawEvidence: snapshot.rawEvidence };
}

describe("LeaguepediaClient", () => {
  it("fixes endpoint, action, format, fields and table in typed methods", async () => {
    const urls: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      urls.push(new URL(String(input)));
      return Response.json({ cargoquery: [] });
    });
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", fetch: fetchMock });

    await client.fetchTeamsPage({ offset: 0 });
    await client.fetchPlayersPage({ offset: 0 });
    await client.fetchTournamentsPage({ offset: 0 });
    await client.fetchGamesPage({ offset: 0, from: "2024-01-01", to: "2024-12-31", competitions: ["Worlds"] });
    await client.fetchGamePlayersPage({ offset: 0, gameIds: ["g1"] });

    expect(urls.map((url) => url.searchParams.get("tables"))).toEqual(["Teams", "Players", "Tournaments", "ScoreboardGames", "ScoreboardPlayers"]);
    for (const url of urls) {
      expect(url.origin + url.pathname).toBe("https://lol.example/api.php");
      expect(url.searchParams.get("action")).toBe("cargoquery");
      expect(url.searchParams.get("format")).toBe("json");
      expect(url.searchParams.get("fields")).toBeTruthy();
      expect(url.searchParams.get("limit")).toBe("500");
    }
  });

  it("exposes no generic parameter passthrough and only query/cargoquery requests", async () => {
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", fetch: async () => Response.json({ query: { general: {} } }) });
    expect("request" in client).toBe(false);
    expect("cargo" in client).toBe(false);
    expect("query" in client).toBe(false);
    expect(() => client.fetchGamesPage({ offset: 0, from: "bad' date", to: "2024-12-31", competitions: [] })).toThrow(/date/i);
  });

  it("honors bounded Retry-After and succeeds within the retry limit", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", maxRetries: 2,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      fetch: async () => ++calls === 1 ? new Response("busy", { status: 429, headers: { "Retry-After": "999" } }) : Response.json({ query: { general: { sitename: "Leaguepedia" } } }),
    });
    await expect(client.fetchSiteInfo()).resolves.toMatchObject({ query: { general: { sitename: "Leaguepedia" } } });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([30_000]);
  });

  it("honors bounded HTTP-date Retry-After using the injected clock", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const now = Date.parse("2026-07-12T00:00:00Z");
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", maxRetries: 1, now: () => now,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      fetch: async () => ++calls === 1 ? new Response("busy", { status: 503, headers: { "Retry-After": "Sun, 12 Jul 2026 00:01:00 GMT" } }) : Response.json({ query: { general: {} } }),
    });
    await client.fetchSiteInfo();
    expect(sleeps).toEqual([30_000]);
  });

  it("follows allow-listed MediaWiki continuation without exposing its parameters", async () => {
    const urls: URL[] = [];
    const client = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com",
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
      endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", timeoutMs: 5, maxRetries: 1, sleep: async () => {},
      fetch: async (_input, init) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      },
    });
    await expect(client.fetchSiteInfo()).rejects.toThrow(/aborted/i);
    expect(calls).toBe(2);
  });

  it("retries bounded retryable API error envelopes and preserves the final one", async () => {
    const sleeps: number[] = []; let calls = 0;
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", maxRetries: 2, sleep: async (ms) => { sleeps.push(ms); }, fetch: async () => { calls += 1; return Response.json(calls < 3 ? { error: { code: calls === 1 ? "ratelimited" : "maxlag", ...(calls === 1 ? {} : { lag: 2 }) } } : { query: { general: {} } }); } });
    await expect(client.fetchSiteInfo()).resolves.toHaveProperty("query");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([100, 2000]);

    const failing = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", maxRetries: 0, fetch: async () => Response.json({ error: { code: "maxlag", lag: 4, info: "busy" } }) });
    const error = await failing.fetchSiteInfo().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(LeaguepediaApiError);
    expect((error as LeaguepediaApiError).code).toBe("maxlag");
    expect((error as LeaguepediaApiError).rawEvidence.response).toEqual({ error: { code: "maxlag", lag: 4, info: "busy" } });
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
    ["missing cargoquery", {}],
    ["non-array cargoquery", { cargoquery: {} }],
    ["non-object item", { cargoquery: ["bad"] }],
    ["missing title object", { cargoquery: [{}] }],
  ])("rejects %s while preserving the raw response", async (_label, response) => {
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", fetch: async () => Response.json(response) });
    const failure = await client.fetchTeamsPage({ offset: 0 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LeaguepediaCargoEnvelopeError);
    expect((failure as LeaguepediaCargoEnvelopeError).rawEvidence.response).toEqual(response);
  });

  it("accepts an explicit empty cargoquery array as zero rows", async () => {
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", fetch: async () => Response.json({ cargoquery: [] }) });
    await expect(client.fetchTeamsPage({ offset: 0 })).resolves.toMatchObject({ rows: [] });
  });
});

describe("Leaguepedia fetching", () => {
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
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, []), fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, []), fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, []),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []), fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
    };
    await expect(fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/wiki", slices: Array.from({ length: 101 }, (_, seasonYear) => ({ competition: "Worlds", seasonYear, from: "2024-01-01", to: "2025-01-01" })) })).rejects.toThrow(/100/);
  });

  it("limits concurrent slice requests to four", async () => {
    let active = 0; let maximum = 0;
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, []), fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, []),
      fetchGamesPage: async ({ offset }: { offset: number }) => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 1)); active -= 1; return cargoPage("ScoreboardGames", offset, []); },
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []), fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
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
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, []), fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, []), fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, gameRows),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 1)); active -= 1; return cargoPage("ScoreboardPlayers", offset, []); },
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
    };
    await fetchLeaguepediaRawInput(client, { sourceUrl: "https://lol.example/wiki", slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }] });
    expect(maximum).toBeLessThanOrEqual(4);
    expect(maximum).toBeGreaterThan(1);
  });

  it("enforces one aggregate snapshot budget across concurrent slices", async () => {
    const client = {
      fetchTeamsPage: async ({ offset }: { offset: number }) => cargoPage("Teams", offset, []), fetchPlayersPage: async ({ offset }: { offset: number }) => cargoPage("Players", offset, []),
      fetchTournamentsPage: async ({ offset }: { offset: number }) => cargoPage("Tournaments", offset, []), fetchGamesPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardGames", offset, []),
      fetchGamePlayersPage: async ({ offset }: { offset: number }) => cargoPage("ScoreboardPlayers", offset, []), fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
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
    const title = (gamePage.response.cargoquery as Array<{ title: Record<string, unknown> }>)[0]!.title;
    const broken: LeaguepediaRawInput = {
      ...input,
      rawEvidence: input.rawEvidence.flatMap((item) => item.table !== "ScoreboardGames" ? [item] : [
        { ...item, requestId: "games:0", offset: 0, response: { cargoquery: Array.from({ length: 500 }, () => ({ title })) } },
        { ...item, requestId: "games:1000", offset: 1000, response: { cargoquery: [] } },
      ]),
    };
    expect(() => parseLeaguepediaRawInput(broken)).toThrow(/expected offset 500, received 1000/);
  });

  it("rejects game rows outside their retained slice date range", async () => {
    const input = await rawFixture();
    const outside: LeaguepediaRawInput = { ...input, rawEvidence: input.rawEvidence.map((item) => item.table === "ScoreboardGames" ? {
      ...item, response: { cargoquery: (item.response.cargoquery as Array<{ title: Record<string, unknown> }>).map(({ title }) => ({ title: { ...title, DateTime_UTC: "2030-01-01T00:00:00Z" } })) },
    } : item) };
    const failure = (() => { try { parseLeaguepediaRawInput(outside); } catch (error) { return error; } return undefined; })();
    expect(failure).toBeInstanceOf(LeaguepediaSnapshotError);
    expect((failure as LeaguepediaSnapshotError).message).toMatch(/outside \[2024-01-01, 2025-01-01\)/);
    expect((failure as LeaguepediaSnapshotError).rawEvidence[0]?.table).toBe("ScoreboardGames");
    const staged = await createLeaguepediaProvider({ loadRawInput: async () => outside, overrides: await overrides() }).stage({ mode: "sync-once" }).catch((error: unknown) => error);
    expect(staged).toBeInstanceOf(RetainableStageError);
  });

  it("rejects a game row from a different exact tournament source key", async () => {
    const input = await rawFixture();
    const wrong: LeaguepediaRawInput = { ...input, rawEvidence: input.rawEvidence.map((item) => item.table === "ScoreboardGames" ? {
      ...item, response: { cargoquery: (item.response.cargoquery as Array<{ title: Record<string, unknown> }>).map(({ title }) => ({ title: { ...title, Tournament: "2024 Mid-Season Invitational" } })) },
    } : item) };
    expect(() => parseLeaguepediaRawInput(wrong)).toThrow(/does not match requested source key/);
  });

  it("treats slice from as inclusive and to as exclusive", async () => {
    const input = await rawFixture();
    const at = (timestamp: string): LeaguepediaRawInput => ({ ...input, rawEvidence: input.rawEvidence.map((item) => item.table === "ScoreboardGames" ? {
      ...item, response: { cargoquery: (item.response.cargoquery as Array<{ title: Record<string, unknown> }>).map(({ title }) => ({ title: { ...title, DateTime_UTC: timestamp } })) },
    } : item) });
    expect(parseLeaguepediaRawInput(at("2024-01-01T00:00:00Z")).games).toHaveLength(1);
    expect(() => parseLeaguepediaRawInput(at("2025-01-01T00:00:00Z"))).toThrow(/outside \[2024-01-01, 2025-01-01\)/);
  });

  it("keeps an incomplete traversal isolated to its own slice", async () => {
    const input = await rawFixture();
    const gamePage = input.rawEvidence.find((item) => item.table === "ScoreboardGames")!;
    const original = (gamePage.response.cargoquery as Array<{ title: Record<string, unknown> }>)[0]!.title;
    const sliceId = "Worlds:2024%20Season%20World%20Championship:2025:2025-01-01:2026-01-01";
    const title = { ...original, GameId: "WORLD25-G1", MatchId: "WORLD25-M1", DateTime_UTC: "2025-10-01T00:00:00Z" };
    const secondPage: RawApiEvidence = {
      ...gamePage, requestId: "games:2025:0", offset: 0,
      scope: { sliceIds: [sliceId], competition: "2024 Season World Championship", seasonYear: 2025, from: "2025-01-01", to: "2026-01-01" },
      response: { cargoquery: Array.from({ length: 500 }, () => ({ title })) },
    };
    const multi: LeaguepediaRawInput = { ...input, slices: [...input.slices, { sliceId, competition: "Worlds", sourceCompetition: "2024 Season World Championship", seasonYear: 2025, from: "2025-01-01", to: "2026-01-01" }], rawEvidence: [...input.rawEvidence, secondPage] };
    const batch = await createLeaguepediaProvider({ loadRawInput: async () => multi, overrides: await overrides() }).stage({ mode: "backfill", years: [2024, 2025], competitions: ["Worlds"] });
    expect(batch.coverage).toEqual([
      expect.objectContaining({ seasonYear: 2024, status: "complete" }),
      expect.objectContaining({ seasonYear: 2025, status: "partial" }),
    ]);
  });

  it("parses a large retained game page without repeated series scans", async () => {
    const input = await rawFixture();
    const gamePage = input.rawEvidence.find((item) => item.table === "ScoreboardGames")!;
    const original = (gamePage.response.cargoquery as Array<{ title: Record<string, unknown> }>)[0]!.title;
    const rows = Array.from({ length: 400 }, (_, index) => ({ title: { ...original, GameId: `G${index}`, MatchId: `M${index}` } }));
    const large = { ...input, rawEvidence: input.rawEvidence.map((item) => item === gamePage ? { ...item, response: { cargoquery: rows } } : item) };
    const started = performance.now();
    expect(parseLeaguepediaRawInput(large).series).toHaveLength(400);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it("converts typed Cargo pages into explicit series, games, players and media", async () => {
    const snapshot = await fetchLeaguepediaSnapshot({
      fetchTeamsPage: async ({ offset }) => cargoPage("Teams", offset, [
        { OverviewPage: "T1", Name: "T1", Aliases: "SKT", Region: "Korea", Image: "T1.png" },
        { OverviewPage: "Bilibili Gaming", Name: "Bilibili Gaming", Aliases: "BLG", Region: "China" },
      ]),
      fetchPlayersPage: async ({ offset }) => cargoPage("Players", offset, [{ OverviewPage: "Faker", Name: "Faker", Team: "T1" }]),
      fetchTournamentsPage: async ({ offset }) => cargoPage("Tournaments", offset, [{ OverviewPage: "2024 Season World Championship", Name: "Worlds 2024", DateStart: "2024-09-25", DateEnd: "2024-11-02" }]),
      fetchGamesPage: async ({ offset }) => cargoPage("ScoreboardGames", offset, [{
        GameId: "G1", MatchId: "M1", Tournament: "2024 Season World Championship", DateTime_UTC: "2024-11-02T14:00:00Z",
        BestOf: "5", N_GameInMatch: "1", Team1: "T1", Team2: "Bilibili Gaming", Team1Score: "3", Team2Score: "2", Winner: "1",
      }]),
      fetchGamePlayersPage: async ({ offset }) => cargoPage("ScoreboardPlayers", offset, [{ GameId: "G1", PlayerName: "Faker", Team: "T1", PlayerWin: 1 }]),
      fetchImageInfoWithEvidence: async () => ({ data: { query: { pages: [{ title: "File:T1.png", imageinfo: [{
        url: "https://static.wikia.nocookie.net/t1.png", mime: "image/png", extmetadata: { LicenseShortName: { value: "CC BY-SA" }, Artist: { value: "Leaguepedia contributors" } },
      }] }] } }, rawEvidence: [{ requestId: "query:image:0", action: "query", sourceUrl: "https://lol.example/api.php?action=query&titles=T1.png", response: { query: { pages: [{ title: "File:T1.png", imageinfo: [{ url: "https://static.wikia.nocookie.net/t1.png", mime: "image/png", extmetadata: { LicenseShortName: { value: "CC BY-SA" }, Artist: { value: "Leaguepedia contributors" } } }] }] } }, revisionIds: [77] }] }),
    }, { slices: [{ competition: "2024 Season World Championship", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }], sourceUrl: "https://lol.fandom.com/wiki/T1" });

    expect(snapshot.series).toEqual([expect.objectContaining({ sourceKey: "M1", bestOf: 5 })]);
    expect(snapshot.games).toEqual([expect.objectContaining({ sourceKey: "G1", seriesKey: "M1", winnerTeam: "T1" })]);
    expect(snapshot.gamePlayers).toEqual([{ gameKey: "G1", playerKey: "Faker", teamKey: "T1", playerWin: true }]);
    expect(snapshot.media).toEqual([expect.objectContaining({ entityKey: "T1", attribution: "Leaguepedia contributors" })]);
    expect(snapshot.tournaments).toEqual([expect.objectContaining({ sourceKey: "2024 Season World Championship" })]);
    expect(snapshot.slices[0]).toMatchObject({ competition: "2024 Season World Championship", seasonYear: 2024, gameSourceKeys: ["G1"] });
    expect(snapshot.rawEvidence.map((item) => item.table)).toEqual(expect.arrayContaining(["Teams", "Players", "Tournaments", "ScoreboardGames", "ScoreboardPlayers"]));
    expect(snapshot.rawEvidence.find((item) => item.table === "ScoreboardGames")?.scope).toMatchObject({ competition: "2024 Season World Championship", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01", sliceIds: [expect.any(String)] });
    expect(snapshot.rawEvidence.find((item) => item.table === "ScoreboardPlayers")?.scope).toMatchObject({ gameIds: ["G1"], sliceIds: [expect.any(String)] });
    expect(snapshot.revisionIds).toEqual([77]);
    expect(snapshot.traversal.complete).toBe(true);
  });

  it("fails on a malformed required game row instead of silently completing traversal", async () => {
    const empty = (table: LeaguepediaCargoTable, offset: number) => cargoPage(table, offset, []);
    const failure = await fetchLeaguepediaSnapshot({
      fetchTeamsPage: async ({ offset }) => cargoPage("Teams", offset, [{ OverviewPage: "T1", Name: "T1" }, { OverviewPage: "BLG", Name: "BLG" }]),
      fetchPlayersPage: async ({ offset }) => empty("Players", offset),
      fetchTournamentsPage: async ({ offset }) => cargoPage("Tournaments", offset, [{ OverviewPage: "Worlds", Name: "Worlds" }]),
      fetchGamesPage: async ({ offset }) => cargoPage("ScoreboardGames", offset, [{ MatchId: "M1", Tournament: "Worlds", DateTime_UTC: "2024-01-01T00:00:00Z", BestOf: 5, N_GameInMatch: 1, Team1: "T1", Team2: "BLG", Team1Score: 3, Team2Score: 0, Winner: 1 }]),
      fetchGamePlayersPage: async ({ offset }) => empty("ScoreboardPlayers", offset),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
    }, { slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }], sourceUrl: "https://lol.fandom.com/wiki/Worlds" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LeaguepediaSnapshotError);
    expect((failure as LeaguepediaSnapshotError).message).toMatch(/GameId/);
    expect((failure as LeaguepediaSnapshotError).rawEvidence.find((item) => item.table === "ScoreboardGames")?.response).toEqual(expect.objectContaining({ cargoquery: expect.any(Array) }));
  });

  it("retains the late malformed ScoreboardPlayers response in the provider error envelope", async () => {
    const malformedPlayersClient = new LeaguepediaClient({
      endpoint: "https://lol.example/api.php",
      userAgent: "RiftVersus/0.1 contact@example.com",
      fetch: async () => Response.json({ cargoquery: [{}] }),
    });
    const loadRawInput = () => fetchLeaguepediaRawInput({
      fetchTeamsPage: async ({ offset }) => cargoPage("Teams", offset, [{ OverviewPage: "T1", Name: "T1" }, { OverviewPage: "Bilibili Gaming", Name: "Bilibili Gaming" }]),
      fetchPlayersPage: async ({ offset }) => cargoPage("Players", offset, [{ OverviewPage: "Faker", Name: "Faker" }]),
      fetchTournamentsPage: async ({ offset }) => cargoPage("Tournaments", offset, [{ OverviewPage: "2024 Season World Championship", Name: "Worlds 2024" }]),
      fetchGamesPage: async ({ offset }) => cargoPage("ScoreboardGames", offset, [{ GameId: "G1", MatchId: "M1", Tournament: "2024 Season World Championship", DateTime_UTC: "2024-11-02T14:00:00Z", BestOf: 5, N_GameInMatch: 1, Team1: "T1", Team2: "Bilibili Gaming", Team1Score: 3, Team2Score: 2, Winner: 1 }]),
      fetchGamePlayersPage: (input) => malformedPlayersClient.fetchGamePlayersPage(input),
      fetchImageInfoWithEvidence: async () => ({ data: {}, rawEvidence: [] }),
    }, { slices: [{ competition: "Worlds", seasonYear: 2024, from: "2024-01-01", to: "2025-01-01" }], sourceUrl: "https://lol.fandom.com/wiki/Worlds" });
    const provider = createLeaguepediaProvider({ loadRawInput, overrides: await overrides() });

    const failure = await provider.stage({ mode: "sync-once" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RetainableStageError);
    const retained = JSON.parse(new TextDecoder().decode((failure as RetainableStageError).source.bytes)) as { evidence: RawApiEvidence[] };
    const malformed = retained.evidence.find((item) => item.table === "ScoreboardPlayers");
    expect(malformed?.response).toEqual({ cargoquery: [{}] });
    expect(retained.evidence.filter((item) => item.requestId === malformed?.requestId)).toHaveLength(1);
  });
});

describe("Leaguepedia normalization", () => {
  it("applies reviewed SKT to T1 precedence and quarantines duplicate names", async () => {
    const result = normalizeLeaguepediaSnapshot(await fixture(), await overrides());
    expect(result.entities.filter((entity) => entity.canonicalName === "T1")).toHaveLength(2);
    expect(result.entities.find((entity) => entity.sourceKey === "SK Telecom T1")?.precedence).toBe("override");
    expect(result.quarantine.map((item) => item.sourceKey)).toEqual(["Duplicate One", "Duplicate Two"]);
    expect(result.quarantineAffectedGameKeys).toEqual([]);
    expect(result.entities.some((entity) => entity.sourceKey === "Duplicate One")).toBe(false);
  });

  it("normalizes explicit series, games and player facts with stable identifiers", async () => {
    const result = normalizeLeaguepediaSnapshot(await fixture(), await overrides());
    expect(result.facts.series).toHaveLength(1);
    expect(result.facts.series?.[0]).toMatchObject({ sourceKey: "WORLD24-FINAL", bestOf: 5, completed: true, sideAScore: 3, sideBScore: 2 });
    expect(result.facts.games?.[0]).toMatchObject({ sourceKey: "WORLD24-FINAL-G1", gameNumber: 1 });
    expect(result.facts.gamePlayers?.[0]?.gameId).toBe(result.facts.games?.[0]?.id);
    expect(result.rosterGameIds).toEqual([result.facts.games?.[0]?.id]);
    expect(result.dimensions.entities.find((entity) => entity.canonicalName === "T1")?.sourceKeys).toEqual(["SK Telecom T1", "T1"]);
    const t1Eras = result.dimensions.teamEras.filter((era) => era.teamEntityId === result.entityIds.get("T1"));
    expect(t1Eras).toHaveLength(2);
    expect(new Set(t1Eras.map((era) => era.id)).size).toBe(2);
    expect(result.facts.series?.[0]?.sideAEraId).toBe(result.eraIds.get("T1"));
    expect(result.dimensions.tournaments).toEqual([expect.objectContaining({ name: "Worlds 2024", category: "worlds" })]);
  });

  it("selects the unique canonical team era by playedAt", async () => {
    const snapshot = await fixture(); const reviewed = await overrides();
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
    const snapshot = await fixture();
    const entities = snapshot.entities.map((entity) => entity.sourceKey === "SK Telecom T1" ? { ...entity, region: "Old Korea" } : entity.sourceKey === "T1" ? { ...entity, region: "New Korea" } : entity);
    const series = [{ ...snapshot.series[0]!, playedAt: "2020-10-01T00:00:00Z", sideATeam: "SK Telecom T1" }];
    const games = [{ ...snapshot.games[0]!, playedAt: series[0]!.playedAt, sideATeam: "SK Telecom T1" }];
    const result = normalizeLeaguepediaSnapshot({ ...snapshot, entities, series, games, gamePlayers: [], slices: [] }, await overrides());
    const t1Era = result.dimensions.teamEras.find((era) => era.sourceKey === "T1")!;
    expect(result.facts.series?.[0]).toMatchObject({ sideAEraId: t1Era.id, sideARegionId: t1Era.regionId });
    expect(t1Era.regionId).toBe(result.dimensions.regions.find((region) => region.name === "New Korea")?.id);
  });

  it("override checksums are deterministic and reviewed precedence wins", async () => {
    const first = await overrides();
    const second = await overrides();
    expect(first.checksums).toEqual(second.checksums);
    expect(Object.values(first.checksums).every((checksum) => /^sha256:[a-f0-9]{64}$/.test(checksum))).toBe(true);
    expect(first.identities.get("SK Telecom T1")?.canonicalName).toBe("T1");
  });

  it("rejects a conflicting reviewed override instead of weakening quarantine", async () => {
    const loaded = await overrides();
    const snapshot = await fixture();
    const identities = new Map(loaded.identities);
    identities.set("Faker", { sourceKey: "Faker", canonicalName: "Faker", canonicalId: "33333333-3333-5333-8333-333333333333", kind: "team", aliases: [], reviewedNote: "invalid fixture" });
    expect(() => normalizeLeaguepediaSnapshot({ ...snapshot, entities: snapshot.entities.filter((entity) => entity.sourceKey === "Faker") }, { ...loaded, identities })).toThrow(/kind/i);
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
    expect(batch.coverage[0]?.status).toBe("complete");
    expect(batch.dimensions.entities).not.toHaveLength(0);
    const raw = JSON.parse(new TextDecoder().decode(batch.source.bytes)) as Record<string, unknown>;
    expect(raw).toHaveProperty("format", "riftversus-leaguepedia-raw-v1");
    expect(raw).toHaveProperty("input");
    expect(raw).not.toHaveProperty("entities");
    expect(raw).not.toHaveProperty("games");
    expect(new TextDecoder().decode(batch.source.bytes)).toContain("Duplicate One");
    expect(batch.source.sourceUrl).toContain("action=cargoquery");
    expect(batch.provenance).toMatchObject({ sourceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), parserVersion: "leaguepedia-v1" });
    expect(batch.provenance.overrideChecksums).toHaveLength(2);
    const replayed = normalizeLeaguepediaSnapshot(parseLeaguepediaRawInput(raw.input as LeaguepediaRawInput), await overrides());
    expect(replayed.facts).toEqual(batch.facts);
    expect(replayed.dimensions).toEqual(batch.dimensions);
    expect("repository" in provider).toBe(false);
    expect("publish" in provider).toBe(false);
  });

  it("only marks a slice partial when it references a quarantined identity", async () => {
    const snapshot = await fixture();
    const affected: LeaguepediaRawInput = { ...rawInput(snapshot), rawEvidence: snapshot.rawEvidence.map((item) => item.table === "ScoreboardPlayers" ? { ...item, response: { cargoquery: [...(item.response.cargoquery as unknown[]), { title: { GameId: "WORLD24-FINAL-G1", PlayerName: "Duplicate One", Team: "T1", PlayerWin: 0 } }] } } : item) };
    const provider = createLeaguepediaProvider({ loadRawInput: async () => affected, overrides: await overrides() });
    const batch = await provider.stage({ mode: "backfill", years: [2024, 2025], competitions: ["Worlds"] });
    expect(batch.coverage).toEqual([
      expect.objectContaining({ seasonYear: 2024, status: "partial" }),
      expect.objectContaining({ seasonYear: 2025, status: "missing" }),
    ]);
  });

  it("does not publish destructive roster authority for a nine-player game", async () => {
    const snapshot = await fixture();
    const incomplete: LeaguepediaRawInput = { ...rawInput(snapshot), rawEvidence: snapshot.rawEvidence.map((item) => item.table === "ScoreboardPlayers" ? { ...item, response: { cargoquery: (item.response.cargoquery as unknown[]).slice(0, 9) } } : item) };
    const batch = await createLeaguepediaProvider({ loadRawInput: async () => incomplete, overrides: await overrides() }).stage({ mode: "backfill", years: [2024], competitions: ["Worlds"] });
    expect(batch.facts.gamePlayers).toEqual([]);
    expect(batch.rosterGameIds).toEqual([]);
    expect(batch.coverage[0]?.status).toBe("partial");
  });

  it("fails duplicate or extra roster rows", async () => {
    const snapshot = await fixture(); const reviewed = await overrides();
    const mutate = (rows: unknown[]) => ({ ...rawInput(snapshot), rawEvidence: snapshot.rawEvidence.map((item) => item.table === "ScoreboardPlayers" ? { ...item, response: { cargoquery: rows } } : item) });
    const rows = snapshot.rawEvidence.find((item) => item.table === "ScoreboardPlayers")!.response.cargoquery as Array<{ title: Record<string, unknown> }>;
    const duplicate = [...rows.slice(0, 9), { title: { ...rows[9]!.title, PlayerName: "Faker" } }];
    await expect(createLeaguepediaProvider({ loadRawInput: async () => mutate(duplicate), overrides: reviewed }).stage({ mode: "sync-once" })).rejects.toThrow(/duplicate/i);
    const extra = [...rows, { title: { GameId: "WORLD24-FINAL-G1", PlayerName: "Extra", Team: "T1", PlayerWin: 0 } }];
    await expect(createLeaguepediaProvider({ loadRawInput: async () => mutate(extra), overrides: reviewed }).stage({ mode: "sync-once" })).rejects.toThrow(/exceeds 10/);
  });

  it("converts a malformed Cargo envelope into retainable raw provider evidence", async () => {
    const client = new LeaguepediaClient({ endpoint: "https://lol.example/api.php", userAgent: "RiftVersus/0.1 contact@example.com", fetch: async () => Response.json({ cargoquery: [{}] }) });
    const provider = createLeaguepediaProvider({
      loadRawInput: async () => {
        await client.fetchTeamsPage({ offset: 0 });
        throw new Error("unreachable");
      },
      overrides: await overrides(),
    });
    const failure = await provider.stage({ mode: "sync-once" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RetainableStageError);
    expect(JSON.parse(new TextDecoder().decode((failure as RetainableStageError).source.bytes))).toEqual(expect.objectContaining({ format: "riftversus-leaguepedia-raw-v1", evidence: expect.any(Array) }));
  });

  it("derives dates and completeness independently for each requested slice", async () => {
    const snapshot = await fixture();
    const provider = createLeaguepediaProvider({ loadRawInput: async () => rawInput(snapshot), overrides: await overrides() });
    const batch = await provider.stage({ mode: "backfill", years: [2024, 2025], competitions: ["Worlds"] });
    expect(batch.coverage).toEqual([
      expect.objectContaining({ seasonYear: 2024, earliestDate: "2024-11-02", latestDate: "2024-11-02", status: "complete" }),
      expect.objectContaining({ seasonYear: 2025, earliestDate: null, latestDate: null, status: "missing" }),
    ]);
  });

  it("changes deterministic version when parser or reviewed override checksums change", async () => {
    const snapshot = await fixture();
    const reviewed = await overrides();
    const base = createLeaguepediaProvider({ loadRawInput: async () => rawInput(snapshot), overrides: reviewed, parserVersion: "parser-a" });
    const changedParser = createLeaguepediaProvider({ loadRawInput: async () => rawInput(snapshot), overrides: reviewed, parserVersion: "parser-b" });
    const changedOverrides = createLeaguepediaProvider({ loadRawInput: async () => rawInput(snapshot), overrides: { ...reviewed, checksums: { ...reviewed.checksums, synthetic: `sha256:${"f".repeat(64)}` } }, parserVersion: "parser-a" });
    const request = { mode: "backfill", years: [2024], competitions: ["Worlds"] } as const;
    const [a1, a2, parser, override] = await Promise.all([base.stage(request), base.stage(request), changedParser.stage(request), changedOverrides.stage(request)]);
    expect(a1.version).toBe(a2.version);
    expect(a1.version).not.toBe(parser.version);
    expect(a1.version).not.toBe(override.version);
  });

  it("changes sourceKey and version when raw Cargo evidence changes despite identical revisions", async () => {
    const snapshot = await fixture();
    const reviewed = await overrides();
    const changed: LeaguepediaRawInput = {
      ...rawInput(snapshot),
      rawEvidence: snapshot.rawEvidence.map((item, index) => index === 0 ? { ...item, response: { ...item.response, changedCargoField: "changed" } } : item),
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
