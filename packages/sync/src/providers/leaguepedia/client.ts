import { createHash } from "node:crypto";

import { decodeCargoExportRows } from "./cargo-export.js";
import type { CargoPage, GamePlayersPageInput, GamesPageInput, LeaguepediaCargoTable, LeaguepediaClientOptions, MatchSchedulesPageInput, OffsetInput, PlayerImagesPageInput, QueryEvidenceResult, RawApiEvidence } from "./types.js";

const CARGO_LIMIT = 500;
const MAX_RETRY_AFTER_MS = 30_000;
const DEFAULT_REQUEST_INTERVAL_MS = 1_000;
const MAX_REQUEST_INTERVAL_MS = 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class LeaguepediaClient {
  readonly userAgent: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #requestIntervalMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #now: () => number;
  readonly #maxResponseBytes: number;
  #requestStartQueue: Promise<void> = Promise.resolve();
  #nextRequestStartAt = 0;

  constructor(options: LeaguepediaClientOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Leaguepedia endpoint must be a clean HTTPS URL.");
    if (options.userAgent.trim().length < 10) throw new Error("Leaguepedia requires a descriptive User-Agent.");
    this.#endpoint = endpoint.toString();
    this.userAgent = options.userAgent;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? 10_000, "timeoutMs");
    this.#maxRetries = nonNegativeInteger(options.maxRetries ?? 2, "maxRetries");
    this.#requestIntervalMs = nonNegativeInteger(options.requestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS, "requestIntervalMs");
    if (this.#requestIntervalMs > MAX_REQUEST_INTERVAL_MS) throw new Error(`requestIntervalMs must not exceed ${MAX_REQUEST_INTERVAL_MS}.`);
    this.#sleep = options.sleep ?? (async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#now = options.now ?? Date.now;
    this.#maxResponseBytes = positiveInteger(options.maxResponseBytes ?? 5_000_000, "maxResponseBytes");
  }

  async fetchSiteInfo(): Promise<Record<string, unknown>> {
    return (await this.#request({ action: "query", meta: "siteinfo", siprop: "general" })).body;
  }

  async fetchKnownPage(title: string): Promise<Record<string, unknown>> {
    return (await this.fetchKnownPagesWithEvidence([title])).data;
  }

  async fetchKnownPagesWithEvidence(titles: readonly string[]): Promise<QueryEvidenceResult> {
    if (titles.length === 0 || titles.length > 50 || new Set(titles).size !== titles.length
      || titles.some((title) => !title.trim() || title !== title.trim() || title.includes("|"))) {
      throw new Error("Leaguepedia known-page query requires 1 to 50 unique safe titles.");
    }
    const result = await this.#request({ action: "query", prop: "info|revisions", rvprop: "ids|timestamp", titles: titles.join("|") });
    return { data: result.body, rawEvidence: [toRawEvidence(result, { action: "query" })] };
  }

  async fetchImageInfo(titles: readonly string[]): Promise<Record<string, unknown>> {
    return (await this.fetchImageInfoWithEvidence(titles)).data;
  }

  fetchImageInfoWithEvidence(titles: readonly string[]): Promise<QueryEvidenceResult> {
    if (titles.length === 0 || titles.length > 50 || titles.some((title) => !title.trim() || title.includes("|"))) throw new Error("Leaguepedia image titles must contain 1 to 50 safe titles.");
    return this.#queryAll({ prop: "imageinfo", iiprop: "url|mime|sha1|extmetadata", titles: titles.map((title) => title.startsWith("File:") ? title : `File:${title}`).join("|") }, new Set(["continue", "iicontinue"]));
  }

  fetchMediaReviewWithEvidence(titles: readonly string[]): Promise<QueryEvidenceResult> {
    if (titles.length === 0 || titles.length > 50 || titles.some(title => !title.trim() || title.includes("|"))) throw new Error("Leaguepedia image review requires 1 to 50 safe titles.");
    return this.#queryAll({ prop: "imageinfo|revisions", iiprop: "url|mime|sha1|size|extmetadata", iiurlwidth: "512", rvprop: "ids|content", rvslots: "main", titles: titles.map(title => title.startsWith("File:") ? title : `File:${title}`).join("|") }, new Set(["continue", "iicontinue"]));
  }

  fetchTeamsPage(input: OffsetInput): Promise<CargoPage> {
    return this.#cargo("Teams", "OverviewPage,Name,Short,Region,OrganizationPage,Image,RenamedTo", "OverviewPage ASC", input.offset);
  }
  fetchTeamRedirectsPage(input: OffsetInput): Promise<CargoPage> {
    return this.#cargo("TeamRedirects", "_pageName,AllName", "_pageName ASC,AllName ASC", input.offset);
  }
  fetchPlayersPage(input: OffsetInput): Promise<CargoPage> {
    return this.#cargo("Players", "OverviewPage,ID,Name,Player,Team,Image", "OverviewPage ASC", input.offset);
  }
  fetchPlayerRedirectsPage(input: OffsetInput): Promise<CargoPage> {
    return this.#cargo("PlayerRedirects", "OverviewPage,ID,AllName", "OverviewPage ASC,AllName ASC", input.offset);
  }
  fetchPlayerImagesPage(input: PlayerImagesPageInput): Promise<CargoPage> {
    if (input.playerPages.length === 0 || input.playerPages.length > 100 || input.playerPages.some((page) => !page.trim())) throw new Error("Leaguepedia player image request requires 1 to 100 player pages.");
    return this.#cargo(
      "PlayerImages",
      "PR._pageName=PlayerPage,PR.ID=PlayerID,PR.AllName=PlayerRedirect,PI.Link,PI.Tournament,PI.FileName,PI.SortDate,PI.IsProfileImage,T.DateStartFuzzy=TournamentDateStartFuzzy,T.Date=TournamentDate",
      "COALESCE(PI.SortDate,T.DateStartFuzzy,T.Date) DESC,PI.FileName ASC",
      input.offset,
      `PI.IsProfileImage="1" AND PR._pageName IN (${input.playerPages.map(cargoLiteral).join(",")})`,
      {
        tables: "PlayerRedirects=PR,PlayerImages=PI,Tournaments=T",
        joinOn: "PR.AllName=PI.Link,PI.Tournament=T.OverviewPage",
      },
    );
  }
  fetchTournamentsPage(input: OffsetInput): Promise<CargoPage> {
    return this.#cargo("Tournaments", "OverviewPage,Name,Region,DateStart,StandardName,BasePage,AlternativeNames", "DateStart ASC,OverviewPage ASC", input.offset);
  }
  fetchMatchSchedulesPage(input: MatchSchedulesPageInput): Promise<CargoPage> {
    if (input.matchIds.length === 0 || input.matchIds.length > 100 || input.matchIds.some((id) => !id.trim())) throw new Error("Leaguepedia match schedule request requires 1 to 100 match IDs.");
    return this.#cargo("MatchSchedule", "UniqueMatch,MatchId,OverviewPage,DateTime_UTC=DateTimeUTC,Team1,Team2,Team1Score,Team2Score,Winner,BestOf", "DateTime_UTC ASC,MatchId ASC", input.offset, `MatchId IN (${input.matchIds.map(cargoLiteral).join(",")})`);
  }
  fetchGamesPage(input: GamesPageInput): Promise<CargoPage> {
    if (!DATE.test(input.from) || !DATE.test(input.to)) throw new Error("Leaguepedia game range dates must be YYYY-MM-DD.");
    if (input.competitions.length === 0 || input.competitions.length > 50) throw new Error("Leaguepedia game request requires bounded competitions.");
    const where = `DateTime_UTC >= '${input.from}' AND DateTime_UTC < '${input.to}' AND Tournament IN (${input.competitions.map(cargoLiteral).join(",")})`;
    return this.#cargo("ScoreboardGames", "GameId,MatchId,Tournament,DateTime_UTC=DateTimeUTC,N_GameInMatch=GameNumber,Team1,Team2,Winner", "DateTime_UTC ASC,GameId ASC", input.offset, where);
  }
  fetchGamePlayersPage(input: GamePlayersPageInput): Promise<CargoPage> {
    if (input.gameIds.length === 0 || input.gameIds.length > 100 || input.gameIds.some((id) => !id.trim())) throw new Error("Leaguepedia player request requires 1 to 100 game IDs.");
    return this.#cargo("ScoreboardPlayers", "GameId,PlayerWin,Name=PlayerDisplayName,Link=PlayerKey,Team", "GameId ASC,Link ASC", input.offset, `GameId IN (${input.gameIds.map(cargoLiteral).join(",")})`);
  }

  async #cargo(
    table: LeaguepediaCargoTable,
    fields: string,
    orderBy: string,
    offset: number,
    where?: string,
    join?: { tables: string; joinOn: string },
  ): Promise<CargoPage> {
    nonNegativeInteger(offset, "offset");
    const url = new URL("/wiki/Special:CargoExport", this.#endpoint);
    url.search = new URLSearchParams({
      tables: join?.tables ?? table,
      fields,
      order_by: orderBy,
      limit: String(CARGO_LIMIT),
      offset: String(offset),
      format: "json",
      ...(where === undefined ? {} : { where }),
      ...(join === undefined ? {} : { join_on: join.joinOn }),
    }).toString();
    const result = await this.#requestUrl(url, "cargoexport");
    const rawEvidence = toRawEvidence(result, { action: "cargoexport", table, offset });
    try {
      return { rows: decodeCargoExportRows(table, result.body), offset, rawEvidence };
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      throw new LeaguepediaCargoEnvelopeError(reason.message, rawEvidence, { cause: reason });
    }
  }

  async #queryAll(parameters: Readonly<Record<string, string>>, allowedContinuation: ReadonlySet<string>): Promise<QueryEvidenceResult> {
    const pages: unknown[] = [];
    const rawEvidence: RawApiEvidence[] = [];
    let continuation: Record<string, string> = {};
    for (let page = 0; page < 100; page += 1) {
      const result = await this.#request({ ...parameters, ...continuation, action: "query" });
      const body = result.body;
      rawEvidence.push(toRawEvidence(result, { action: "query", continuation }));
      const query = isRecord(body.query) ? body.query : {};
      if (Array.isArray(query.pages)) pages.push(...query.pages);
      if (!isRecord(body.continue)) return { data: { ...body, query: { ...query, pages } }, rawEvidence };
      continuation = {};
      for (const [key, value] of Object.entries(body.continue)) {
        if (!allowedContinuation.has(key) || typeof value !== "string") throw new Error("Leaguepedia returned an unsupported continuation token.");
        continuation[key] = value;
      }
    }
    throw new Error("Leaguepedia query exceeded the continuation page limit.");
  }

  async #request(parameters: Readonly<Record<string, string>>): Promise<QueryRequestResult> {
    const action = parameters.action;
    if (action !== "query") throw new Error("Unsupported Leaguepedia action.");
    const url = new URL(this.#endpoint);
    url.search = new URLSearchParams({ ...parameters, action, format: "json", formatversion: "2" }).toString();
    const result = await this.#requestUrl(url, action);
    if (!isRecord(result.body)) throw new Error("Leaguepedia response must be a JSON object.");
    return { ...result, body: result.body };
  }

  async #requestUrl(url: URL, action: "query" | "cargoexport"): Promise<RequestResult> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      await this.#paceRequestStart();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const response = await this.#fetch(url, { headers: { Accept: "application/json", "User-Agent": this.userAgent }, signal: controller.signal });
        if (!response.ok) {
          await consumeBounded(response, this.#maxResponseBytes, url.toString());
          const error = new Error(`Leaguepedia ${action} request failed (${response.status}).`);
          if (!retryableStatus(response.status) || attempt === this.#maxRetries) throw error;
          lastError = error;
          await this.#sleep(retryDelay(response.headers.get("Retry-After"), attempt, this.#now(), response.status === 429 ? MAX_RETRY_AFTER_MS : undefined));
          continue;
        }
        const decoded = await readJsonBounded(response, this.#maxResponseBytes, url.toString());
        const body: unknown = decoded.body;
        if (action === "query" && !isRecord(body)) throw new Error("Leaguepedia response must be a JSON object.");
        if (action === "query" && isRecord(body) && isRecord(body.error)) {
          const code = typeof body.error.code === "string" ? body.error.code : "unknown";
          const result = { body, url: url.toString(), responseBytes: decoded.responseBytes };
          const apiError = new LeaguepediaApiError(code, toRawEvidence(result, { action }));
          if ((code === "ratelimited" || code === "maxlag") && attempt < this.#maxRetries) {
            lastError = apiError;
            const retryAfterHeader = response.headers.get("Retry-After");
            const apiDelay = code === "ratelimited" ? numberField(body.error["retry-after"]) : numberField(body.error.lag);
            if (code === "ratelimited" && retryAfterHeader === null && apiDelay === null) throw apiError;
            await this.#sleep(retryAfterHeader !== null ? retryDelay(retryAfterHeader, attempt, this.#now()) : Math.min((apiDelay ?? 0.1 * 2 ** attempt) * 1000, MAX_RETRY_AFTER_MS));
            continue;
          }
          throw apiError;
        }
        return { body, url: url.toString(), responseBytes: decoded.responseBytes };
      } catch (error) {
        const reason = error instanceof Error ? error : new Error(String(error));
        if (attempt === this.#maxRetries || !retryableError(reason)) throw reason;
        lastError = reason;
        await this.#sleep(100 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error("Leaguepedia request failed.");
  }

  async #paceRequestStart(): Promise<void> {
    let release: () => void = () => undefined;
    const previous = this.#requestStartQueue;
    this.#requestStartQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const waitMs = Math.max(this.#nextRequestStartAt - this.#now(), 0);
      if (waitMs > 0) await this.#sleep(waitMs);
      const startedAt = this.#now();
      this.#nextRequestStartAt = Math.max(this.#nextRequestStartAt, startedAt) + this.#requestIntervalMs;
    } finally {
      release();
    }
  }
}

export class LeaguepediaCargoEnvelopeError extends Error {
  constructor(message: string, readonly rawEvidence: RawApiEvidence, options?: ErrorOptions) {
    super(message, options);
    this.name = "LeaguepediaCargoEnvelopeError";
  }
}
export class LeaguepediaApiError extends Error {
  constructor(readonly code: string, readonly rawEvidence: RawApiEvidence) { super(code === "ratelimited" ? "Leaguepedia API rate limited the request; retry the sync later." : `Leaguepedia API error: ${code}.`); this.name = "LeaguepediaApiError"; }
}
export class LeaguepediaResourceLimitError extends Error { constructor(readonly sourceUrl: string, readonly limit: number) { super(`Leaguepedia response exceeds the ${limit} byte limit.`); this.name = "LeaguepediaResourceLimitError"; } }

interface RequestResult { body: unknown; url: string; responseBytes: number }
interface QueryRequestResult extends RequestResult { body: Record<string, unknown> }

function toRawEvidence(result: RequestResult, request: { action: "query" | "cargoexport"; table?: CargoPage["rawEvidence"]["table"]; offset?: number; continuation?: Readonly<Record<string, string>> }): RawApiEvidence {
  const digest = createHash("sha256").update(result.url).digest("hex").slice(0, 16);
  return {
    requestId: `${request.action}:${request.table ?? "mediawiki"}:${request.offset ?? 0}:${digest}`,
    action: request.action,
    ...(request.table === undefined ? {} : { table: request.table }),
    ...(request.offset === undefined ? {} : { offset: request.offset }),
    ...(request.continuation === undefined || Object.keys(request.continuation).length === 0 ? {} : { continuation: { ...request.continuation } }),
    sourceUrl: result.url,
    response: result.body,
    responseBytes: result.responseBytes,
    revisionIds: collectRevisionIds(result.body),
  };
}

function cargoLiteral(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].some((character) => (character.codePointAt(0) ?? 0) < 32)) throw new Error("Unsafe Leaguepedia Cargo value.");
  return `'${trimmed.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
function retryableStatus(status: number): boolean { return status === 429 || status >= 500; }
function retryableError(error: Error): boolean { return error.name === "AbortError" || error instanceof TypeError; }
function retryDelay(header: string | null, attempt: number, now: number, fallbackMs = 100 * 2 ** attempt): number {
  if (header !== null && /^\d+$/.test(header)) return Math.min(Number(header) * 1000, MAX_RETRY_AFTER_MS);
  if (header !== null) {
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - now, 0), MAX_RETRY_AFTER_MS);
  }
  return fallbackMs;
}
async function readJsonBounded(response: Response, maxBytes: number, sourceUrl: string): Promise<{ body: unknown; responseBytes: number }> { const bytes = await readBounded(response, maxBytes, sourceUrl); return { body: JSON.parse(new TextDecoder().decode(bytes)) as unknown, responseBytes: bytes.byteLength }; }
async function consumeBounded(response: Response, maxBytes: number, sourceUrl: string): Promise<void> { try { await readBounded(response, maxBytes, sourceUrl); } catch { await response.body?.cancel().catch(() => undefined); } }
async function readBounded(response: Response, maxBytes: number, sourceUrl: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) { await response.body?.cancel(); throw new LeaguepediaResourceLimitError(sourceUrl, maxBytes); }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) { await reader.cancel(); throw new LeaguepediaResourceLimitError(sourceUrl, maxBytes); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const output = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output;
}
function numberField(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function collectRevisionIds(value: unknown): number[] {
  const result = new Set<number>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) { for (const child of item) visit(child); return; }
    if (!isRecord(item)) return;
    for (const [key, child] of Object.entries(item)) {
      if ((key === "revid" || key === "lastrevid") && typeof child === "number" && Number.isInteger(child)) result.add(child);
      visit(child);
    }
  };
  visit(value);
  return [...result].sort((a, b) => a - b);
}
function positiveInteger(value: number, name: string): number { if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`); return value; }
function nonNegativeInteger(value: number, name: string): number { if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export const LEAGUEPEDIA_CARGO_LIMIT = CARGO_LIMIT;
