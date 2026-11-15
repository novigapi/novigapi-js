/**
 * Client for novigapi.com, a read-only Novig market data API. Uses the global fetch (Node 18+, Deno, Bun, browsers).
 *
 * Independent. Not affiliated with, endorsed by or sponsored by Novig.
 */

export * from "./devig.js";

export const DEFAULT_BASE_URL = "https://novigapi.com/api/v1";
export const VERSION = "0.1.0";

export type Row = Record<string, unknown>;
export type Meta = { next_cursor?: string | null; limit?: number; count?: number; formula?: string } & Record<string, unknown>;
export type Page<T = Row> = { data: T[]; meta: Meta };
export type One<T = Row> = { data: T; meta: Meta };

export type Outcome = {
  outcome_id: string;
  market_id?: string;
  name?: string | null;
  status?: string | null;
  last_price?: number | null;
  bid_price?: number | null;
  bid_qty?: number | null;
  /** 1 minus the best bid on the other outcome. */
  ask_price?: number | null;
  fair_price?: number | null;
} & Row;

export type Market = {
  market_id: string;
  event_id?: string | null;
  league?: string | null;
  market_type?: string | null;
  description?: string | null;
  status?: string | null;
  fee_coefficient?: number | null;
  outcomes?: Outcome[];
  observed_at?: string | null;
  source_age_seconds?: number | null;
} & Row;

export type MarketStatus = "open" | "closed" | "settled" | "suspended" | "all";
type Paging = { limit?: number; cursor?: string };
type Query = Record<string, string | number | boolean | undefined | null>;

/** Any non-2xx response. */
export class NovigAPIError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly body: Row = {}, readonly headers: Record<string, string> = {}) {
    super(`${status} ${code}: ${message}`);
    this.name = "NovigAPIError";
  }
}

/** HTTP 429: RATE_LIMITED (per minute, sends Retry-After) or QUOTA_EXCEEDED (monthly credits). */
export class RateLimitError extends NovigAPIError {
  readonly plan?: string;
  readonly limit?: number;
  readonly resetAt?: string;
  readonly upgradeUrl?: string;
  readonly retryAfter?: number;
  constructor(status: number, code: string, message: string, body: Row = {}, headers: Record<string, string> = {}) {
    super(status, code, message, body, headers);
    this.name = "RateLimitError";
    const err = (body.error ?? {}) as Row;
    if (typeof err.plan === "string") this.plan = err.plan;
    if (typeof err.limit === "number") this.limit = err.limit;
    if (typeof err.reset_at === "string") this.resetAt = err.reset_at;
    if (typeof err.upgrade_url === "string") this.upgradeUrl = err.upgrade_url;
    const retry = Number(headers["retry-after"]);
    if (Number.isFinite(retry) && retry > 0) this.retryAfter = retry;
    const extra = [this.plan && `plan=${this.plan}`, this.limit !== undefined && `limit=${this.limit}`, this.resetAt && `reset_at=${this.resetAt}`, this.retryAfter !== undefined && `retry_after=${this.retryAfter}s`, this.upgradeUrl && `upgrade_url=${this.upgradeUrl}`].filter(Boolean);
    if (extra.length) this.message += ` ${extra.join(" ")}`;
  }
}

export type ClientOptions = { apiKey?: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof fetch };

function envKey(): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.NOVIGAPI_KEY;
}

export class NovigAPI {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions = {}) {
    const key = options.apiKey ?? envKey();
    if (!key) throw new Error("No API key. Set NOVIGAPI_KEY or pass { apiKey: 'nv_...' }. Free keys: https://novigapi.com/sign-up");
    if (!key.startsWith("nv_")) throw new Error("novigapi.com keys start with nv_");
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** GET a path under the base URL. Undefined and null params are dropped. */
  async get<T = unknown>(path: string, params: Query = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, "")}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" }, signal: controller.signal });
      const text = await res.text();
      let body: Row = {};
      try { body = text ? (JSON.parse(text) as Row) : {}; } catch { body = {}; }
      if (!res.ok) {
        const headers: Record<string, string> = {};
        res.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });
        const err = (body.error ?? {}) as Row;
        const code = typeof err.code === "string" ? err.code : `HTTP_${res.status}`;
        const message = typeof err.message === "string" ? err.message : res.statusText || "request failed";
        throw res.status === 429 ? new RateLimitError(res.status, code, message, body, headers) : new NovigAPIError(res.status, code, message, body, headers);
      }
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Every row of a list endpoint, following meta.next_cursor. */
  async *iterRows<T = Row>(path: string, params: Query = {}, maxPages = Infinity): AsyncGenerator<T> {
    let cursor = typeof params.cursor === "string" ? params.cursor : undefined;
    for (let pages = 0; pages < maxPages; pages += 1) {
      const page = await this.get<Page<T>>(path, { ...params, cursor });
      for (const row of page.data ?? []) yield row;
      cursor = page.meta?.next_cursor ?? undefined;
      if (!cursor) return;
    }
  }

  markets(q: { league?: string; event_id?: string; market_type?: string; player?: string; team?: string; status?: MarketStatus } & Paging = {}) {
    return this.get<Page<Market>>("markets", q);
  }
  events(q: { league?: string; status?: MarketStatus } & Paging = {}) {
    return this.get<Page>("events", q);
  }
  market(marketId: string) {
    return this.get<One<Market>>(`markets/${encodeURIComponent(marketId)}`);
  }
  /** Novig holds bids only; the ask on an outcome is 1 minus the best bid on the other outcome. */
  orderbook(marketId: string) {
    return this.get<One>(`orderbook/${encodeURIComponent(marketId)}`);
  }
  trades(q: { market_id?: string; since?: string } & Paging = {}) {
    return this.get<Page>("trades", q);
  }
  ohlcDaily(q: ({ market_id: string; date?: string } | { market_id?: string; date: string }) & Paging) {
    return this.get<Page>("ohlc/daily", q);
  }
  /** fair_yes = (bid_yes + (1 - bid_no)) / 2. */
  fairPrice(marketId: string) {
    return this.get<One>("fair-price", { market_id: marketId });
  }
  lineHistory(q: ({ market_id: string; outcome_id?: string } | { market_id?: string; outcome_id: string }) & { since?: string; until?: string } & Paging) {
    return this.get<Page>("line-history", q);
  }
  playerProps(q: { league: string; player: string } & Paging) {
    return this.get<Page<Market>>("player-props", q);
  }
  players(q: { league?: string; q?: string } & Paging = {}) {
    return this.get<Page>("players", q);
  }
  teams(q: { league?: string } & Paging = {}) {
    return this.get<Page>("teams", q);
  }
  leagues(q: Paging = {}) {
    return this.get<Page>("leagues", q);
  }
  results(q: { league?: string; market_id?: string; graded?: boolean; since?: string } & Paging = {}) {
    return this.get<Page>("results", q);
  }
  /** Each outcome's open_fair and close_fair before the start, clv_pp, and won once graded. Send at least one filter. */
  clv(q: { market_id?: string; player?: string; league?: string; date?: string; settled?: boolean; since?: string; until?: string } & Paging) {
    if (!q.market_id && !q.player && !q.league && !q.date) throw new Error("send market_id, player, league or date");
    return this.get<Page>("clv", q);
  }
  lineMoves(q: { league?: string; market_id?: string; kind?: "move" | "steam"; since?: string; min_delta_pp?: number } & Paging = {}) {
    return this.get<Page>("line-moves", q);
  }
  /** Straight markets and parlays (COMBO) per day, from Novig's daily files. */
  marketSummary(q: { date?: string; since?: string; league?: string; market_type?: string; kind?: "straight" | "total" | "combo" } & Paging = {}) {
    return this.get<Page>("market-summary/daily", q);
  }
  /** FanDuel and DraftKings prices that pay more than the Novig fair probability. ev_pct = (fair x decimal - 1) x 100. */
  ev(q: { league?: string; market_type?: string; min_edge?: number; books?: string; min_prob?: number; alt_lines?: boolean; confidence?: "high" | "any"; sort?: "ev" | "edge_cents" | "kelly"; player?: string; market_id?: string } & Paging = {}) {
    return this.get<Page>("ev", q);
  }
  /** Two-way arbitrage across Novig, FanDuel and DraftKings, or type "middles". Production and Scale plans. */
  arbitrage(q: { type?: "arbitrage" | "middles"; league?: string; market_type?: string; min_profit?: number } & Paging = {}) {
    return this.get<Page>("arbitrage", q);
  }
  /** One Novig market beside each book on exactly the same line. */
  compare(marketId: string) {
    return this.get<One>(`compare/${encodeURIComponent(marketId)}`);
  }
}

/** Bid and ask for both sides of a two-way market, or null. Prices are probabilities from 0 to 1. */
export function twoSides(market: Market): [Side, Side] | null {
  const o = market.outcomes ?? [];
  if (o.length !== 2) return null;
  const num = (v: unknown) => (typeof v === "number" && v > 0 && v < 1 ? v : typeof v === "string" && Number(v) > 0 && Number(v) < 1 ? Number(v) : null);
  const [a, b] = o as [Outcome, Outcome];
  const bidA = num(a.bid_price), bidB = num(b.bid_price);
  const askA = num(a.ask_price) ?? (bidB !== null ? 1 - bidB : null);
  const askB = num(b.ask_price) ?? (bidA !== null ? 1 - bidA : null);
  if (askA === null || askB === null) return null;
  return [
    { name: a.name ?? "side A", outcomeId: a.outcome_id, bid: bidA, ask: askA },
    { name: b.name ?? "side B", outcomeId: b.outcome_id, bid: bidB, ask: askB },
  ];
}
export type Side = { name: string; outcomeId: string; bid: number | null; ask: number };
