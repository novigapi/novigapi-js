// Client tests with an injected fetch: no network, no key. Run: npx tsx --test test/client.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { NovigAPI, NovigAPIError, RateLimitError, americanToProb, devig } from "../src/index.js";

function stub(responses: { status?: number; body: unknown; headers?: Record<string, string> }[]) {
  const urls: string[] = [];
  let i = 0;
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    urls.push(String(input));
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer nv_test");
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  return { api: new NovigAPI({ apiKey: "nv_test", fetch: fetchImpl }), urls };
}

test("keys must start with nv_", () => {
  assert.throws(() => new NovigAPI({ apiKey: "sk_x" }), /nv_/);
});

test("query strings and paging", async () => {
  const { api, urls } = stub([{ body: { data: [{ market_id: "a" }], meta: { next_cursor: "c2" } } }, { body: { data: [{ market_id: "b" }], meta: { next_cursor: null } } }]);
  const ids: string[] = [];
  for await (const m of api.iterRows<{ market_id: string }>("markets", { league: "NFL", status: "open" })) ids.push(m.market_id);
  assert.deepEqual(ids, ["a", "b"]);
  assert.equal(urls[0], "https://novigapi.com/api/v1/markets?league=NFL&status=open");
  assert.match(urls[1], /cursor=c2/);
});

test("cross-venue endpoints", async () => {
  const { api, urls } = stub([{ body: { data: [], meta: {} } }]);
  await api.ev({ league: "NBA", min_edge: 2, sort: "ev" });
  await api.arbitrage({ type: "middles" });
  await api.compare("01a1/x");
  await api.clv({ league: "NFL", date: "2026-11-15", settled: true });
  assert.deepEqual(urls, [
    "https://novigapi.com/api/v1/ev?league=NBA&min_edge=2&sort=ev",
    "https://novigapi.com/api/v1/arbitrage?type=middles",
    "https://novigapi.com/api/v1/compare/01a1%2Fx",
    "https://novigapi.com/api/v1/clv?league=NFL&date=2026-11-15&settled=true",
  ]);
  assert.throws(() => api.clv({}), /send market_id/);
});

test("429 and 401 are typed errors", async () => {
  const { api } = stub([{ status: 429, body: { error: { code: "RATE_LIMITED", message: "slow down", plan: "free", limit: 20 } }, headers: { "Retry-After": "12" } }]);
  await assert.rejects(api.markets(), (e: unknown) => e instanceof RateLimitError && e.code === "RATE_LIMITED" && e.retryAfter === 12);
  const bad = stub([{ status: 401, body: { error: { code: "INVALID_API_KEY", message: "bad" } } }]);
  await assert.rejects(bad.api.markets(), (e: unknown) => e instanceof NovigAPIError && e.status === 401);
});

test("devig matches the keyless server tool on -150 / +130", () => {
  const fair = devig([americanToProb(-150), americanToProb(130)], "multiplicative");
  assert.ok(Math.abs(fair[0] - 0.579832) < 1e-5, String(fair[0]));
});
