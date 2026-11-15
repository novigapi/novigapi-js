# novigapi (TypeScript / JavaScript)

A small TypeScript client for [novigapi.com](https://novigapi.com), a read-only Novig market data API, plus devig helpers and three runnable examples. It uses the global `fetch`, so it runs on Node 18+, Deno, Bun and in browsers. No runtime dependencies.

Novig has an official trading API and free daily CSVs. novigapi.com is the read-only data layer on top: no account, names resolved, intraday line history, fair prices and alerts. To place orders or read a Novig account, use the official Novig API documented at [docs.novig.com](https://docs.novig.com).

Independent. Not affiliated with, endorsed by or sponsored by Novig.

## Install

```bash
npm install novigapi
```

Not on npm yet: the name `novigapi` was free on 15 Nov 2026 and the package is ready to publish (see OFFSITE-HANDOFF.md in the novigapi.com repository). Until then, build from source: `npm install && npm run build`, then `npm install /path/to/novigapi-js`.

Tests use an injected fetch and need no key or network: `npm test`.

## Quickstart

Get a free key at [novigapi.com/sign-up](https://novigapi.com/sign-up) (Free plan: 100 credits a month, 20 requests a minute).

```bash
export NOVIGAPI_KEY=nv_...
```

```ts
import { NovigAPI, devig, probToAmerican } from "novigapi";

const api = new NovigAPI(); // reads NOVIGAPI_KEY; or new NovigAPI({ apiKey: "nv_..." })

const page = await api.markets({ league: "NFL", status: "open", limit: 20 });
for (const m of page.data) console.log(m.market_id, m.description);

const fair = await api.fairPrice(page.data[0].market_id);
console.log(fair.data, fair.meta.formula);

console.log(devig([0.5238, 0.5238], "shin")); // [0.5, 0.5]
console.log(probToAmerican(0.4));             // 150
```

Every method resolves to the JSON envelope `{ data, meta }`. List endpoints page with `cursor`; `api.iterRows("markets", { league: "NBA" })` is an async generator that follows `meta.next_cursor`.

| Method | Endpoint |
|---|---|
| `markets({ league, event_id, market_type, player, team, status, limit, cursor })` | `GET /markets` |
| `events({ league, status })` | `GET /events` |
| `market(id)` | `GET /markets/{id}` |
| `orderbook(id)` | `GET /orderbook/{id}` |
| `trades({ market_id, since })` | `GET /trades` |
| `ohlcDaily({ market_id, date })` | `GET /ohlc/daily` |
| `fairPrice(marketId)` | `GET /fair-price` |
| `lineHistory({ market_id or outcome_id, since, until })` | `GET /line-history` |
| `playerProps({ league, player })` | `GET /player-props` |
| `players({ league, q })`, `teams({ league })`, `leagues()` | `GET /players`, `/teams`, `/leagues` |
| `results({ league, market_id, graded, since })` | `GET /results` |
| `clv({ market_id, player, league, date, settled, since, until })` | `GET /clv` |
| `lineMoves({ league, market_id, kind, since, min_delta_pp })` | `GET /line-moves` |
| `marketSummary({ date, since, league, market_type, kind })` | `GET /market-summary/daily` |
| `ev({ league, min_edge, min_prob, books, sort, ... })` | `GET /ev` (FanDuel and DraftKings vs the Novig fair price) |
| `arbitrage({ type, league, min_profit })` | `GET /arbitrage` (Production and up) |
| `compare(marketId)` | `GET /compare/{market_id}` |

Base URL `https://novigapi.com/api/v1`; auth header `Authorization: Bearer nv_...`. Full reference: [novigapi.com/docs](https://novigapi.com/docs).

### Errors and limits

Non-2xx responses throw `NovigAPIError` (`status`, `code`, `message`, `body`). A 429 throws `RateLimitError`, which also carries `plan`, `limit`, `resetAt`, `upgradeUrl` and `retryAfter` (seconds, from `Retry-After`, sent on `RATE_LIMITED`):

```ts
import { NovigAPI, RateLimitError } from "novigapi";

try {
  await new NovigAPI().markets({ league: "NBA" });
} catch (err) {
  if (err instanceof RateLimitError) console.log(err.code, err.plan, err.limit, err.resetAt, err.retryAfter);
  else throw err;
}
```

## Devig helpers

`multiplicative`, `additive`, `power`, `shin` and `devig(probs, method)`, plus `americanToProb`, `probToAmerican`, `decimalToProb`, `probToDecimal`, `overround`, `hold` and `takerFee(price, contracts, coefficient = 0.06)`, Novig's taker fee `coefficient x p x (1 - p) x contracts` per [docs.novig.com](https://docs.novig.com/fees.md) (checked 12 Nov 2026). The same four methods run in the browser at [novigapi.com/no-vig-calculator](https://novigapi.com/no-vig-calculator).

## Examples

```bash
npx tsx examples/devig-board.ts NFL shin                  # devig every two-sided market in a league
npx tsx examples/arb-scanner.ts NBA                       # pairs below $1 after the taker fee
npx tsx examples/clv-backtest.ts 2026-10-01 2026-11-11    # Novig's public CSVs, no key needed
```

`clv-backtest.ts` streams Novig's own `markets.csv` for each day from `https://data.novig.com/reporting/trade-data/<date>/markets.csv` and compares the first opening print with the last `close`. It saves nothing to disk.

## License

MIT. Copyright (c) 2026 Stunning Couches LLC.

Independent. Not affiliated with, endorsed by or sponsored by Novig.
