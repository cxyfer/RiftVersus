import type { CargoPage, GamePlayersPageInput, GamesPageInput, LeaguepediaClientOptions, OffsetInput } from "./types.js";

const CARGO_LIMIT = 500;
const MAX_RETRY_AFTER_MS = 30_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class LeaguepediaClient {
  readonly userAgent: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: LeaguepediaClientOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Leaguepedia endpoint must be a clean HTTPS URL.");
    if (options.userAgent.trim().length < 10) throw new Error("Leaguepedia requires a descriptive User-Agent.");
    this.#endpoint = endpoint.toString();
    this.userAgent = options.userAgent;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? 10_000, "timeoutMs");
    this.#maxRetries = nonNegativeInteger(options.maxRetries ?? 2, "maxRetries");
    this.#sleep = options.sleep ?? (async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  fetchSiteInfo(): Promise<Record<string, unknown>> {
    return this.#request({ action: "query", meta: "siteinfo", siprop: "general" });
  }

  fetchKnownPage(title: string): Promise<Record<string, unknown>> {
    if (!title.trim() || title.includes("|")) throw new Error("Leaguepedia page title is invalid.");
    return this.#request({ action: "query", prop: "info|revisions", rvprop: "ids|timestamp", titles: title.trim() });
  }

  fetchImageInfo(titles: readonly string[]): Promise<Record<string, unknown>> {
    if (titles.length === 0 || titles.length > 50 || titles.some((title) => !title.trim() || title.includes("|"))) throw new Error("Leaguepedia image titles must contain 1 to 50 safe titles.");
    return this.#queryAll({ prop: "imageinfo", iiprop: "url|mime|sha1|extmetadata", titles: titles.map((title) => title.startsWith("File:") ? title : `File:${title}`).join("|") }, new Set(["continue", "iicontinue"]));
  }

  fetchTeamsPage(input: OffsetInput): Promise<CargoPage> {
    return this.#cargo("Teams", "OverviewPage,Name,Aliases,Region,DateStart,DateEnd,Image", "OverviewPage ASC", input.offset);
  }
  fetchPlayersPage(input: OffsetInput): Promise<CargoPage> {
    return this.#cargo("Players", "OverviewPage,ID,Name,Aliases,Team,Image", "OverviewPage ASC", input.offset);
  }
  fetchTournamentsPage(input: OffsetInput): Promise<CargoPage> {
    return this.#cargo("Tournaments", "OverviewPage,Name,Region,DateStart,DateEnd", "DateStart ASC,OverviewPage ASC", input.offset);
  }
  fetchGamesPage(input: GamesPageInput): Promise<CargoPage> {
    if (!DATE.test(input.from) || !DATE.test(input.to)) throw new Error("Leaguepedia game range dates must be YYYY-MM-DD.");
    if (input.competitions.length === 0 || input.competitions.length > 50) throw new Error("Leaguepedia game request requires bounded competitions.");
    const where = `DateTime_UTC >= '${input.from}' AND DateTime_UTC < '${input.to}' AND Tournament IN (${input.competitions.map(cargoLiteral).join(",")})`;
    return this.#cargo("ScoreboardGames", "GameId,MatchId,MatchHistory,Tournament,DateTime_UTC,BestOf,N_GameInMatch,Team1,Team2,Team1Score,Team2Score,Winner", "DateTime_UTC ASC,GameId ASC", input.offset, where);
  }
  fetchGamePlayersPage(input: GamePlayersPageInput): Promise<CargoPage> {
    if (input.gameIds.length === 0 || input.gameIds.length > 100 || input.gameIds.some((id) => !id.trim())) throw new Error("Leaguepedia player request requires 1 to 100 game IDs.");
    return this.#cargo("ScoreboardPlayers", "GameId,PlayerWin,PlayerName,Team", "GameId ASC,PlayerName ASC", input.offset, `GameId IN (${input.gameIds.map(cargoLiteral).join(",")})`);
  }

  async #cargo(table: "Teams" | "Players" | "Tournaments" | "ScoreboardGames" | "ScoreboardPlayers", fields: string, orderBy: string, offset: number, where?: string): Promise<CargoPage> {
    nonNegativeInteger(offset, "offset");
    const body = await this.#request({ action: "cargoquery", tables: table, fields, order_by: orderBy, limit: String(CARGO_LIMIT), offset: String(offset), ...(where === undefined ? {} : { where }) });
    return { rows: cargoRows(body), offset };
  }

  async #queryAll(parameters: Readonly<Record<string, string>>, allowedContinuation: ReadonlySet<string>): Promise<Record<string, unknown>> {
    const pages: unknown[] = [];
    let continuation: Record<string, string> = {};
    for (let page = 0; page < 100; page += 1) {
      const body = await this.#request({ ...parameters, ...continuation, action: "query" });
      const query = isRecord(body.query) ? body.query : {};
      if (Array.isArray(query.pages)) pages.push(...query.pages);
      if (!isRecord(body.continue)) return { ...body, query: { ...query, pages } };
      continuation = {};
      for (const [key, value] of Object.entries(body.continue)) {
        if (!allowedContinuation.has(key) || typeof value !== "string") throw new Error("Leaguepedia returned an unsupported continuation token.");
        continuation[key] = value;
      }
    }
    throw new Error("Leaguepedia query exceeded the continuation page limit.");
  }

  async #request(parameters: Readonly<Record<string, string>>): Promise<Record<string, unknown>> {
    const action = parameters.action;
    if (action !== "query" && action !== "cargoquery") throw new Error("Unsupported Leaguepedia action.");
    const url = new URL(this.#endpoint);
    url.search = new URLSearchParams({ ...parameters, action, format: "json", formatversion: "2" }).toString();
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const response = await this.#fetch(url, { headers: { Accept: "application/json", "User-Agent": this.userAgent }, signal: controller.signal });
        if (!response.ok) {
          const error = new Error(`Leaguepedia ${action} request failed (${response.status}).`);
          if (!retryableStatus(response.status) || attempt === this.#maxRetries) throw error;
          lastError = error;
          await this.#sleep(retryDelay(response.headers.get("Retry-After"), attempt));
          continue;
        }
        const body: unknown = await response.json();
        if (!isRecord(body)) throw new Error("Leaguepedia response must be a JSON object.");
        if (isRecord(body.error)) throw new Error("Leaguepedia returned an API error.");
        return body;
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
}

function cargoRows(body: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(body.cargoquery)) return [];
  return body.cargoquery.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [isRecord(item.title) ? item.title : item];
  });
}
function cargoLiteral(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].some((character) => (character.codePointAt(0) ?? 0) < 32)) throw new Error("Unsafe Leaguepedia Cargo value.");
  return `'${trimmed.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
function retryableStatus(status: number): boolean { return status === 429 || status >= 500; }
function retryableError(error: Error): boolean { return error.name === "AbortError" || error instanceof TypeError; }
function retryDelay(header: string | null, attempt: number): number {
  if (header !== null && /^\d+$/.test(header)) return Math.min(Number(header) * 1000, MAX_RETRY_AFTER_MS);
  return 100 * 2 ** attempt;
}
function positiveInteger(value: number, name: string): number { if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`); return value; }
function nonNegativeInteger(value: number, name: string): number { if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export const LEAGUEPEDIA_CARGO_LIMIT = CARGO_LIMIT;
