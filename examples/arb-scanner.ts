/**
 * Scan Novig two-way markets for a combined price below $1 after the taker fee.
 *
 *   export NOVIGAPI_KEY=nv_...
 *   npx tsx examples/arb-scanner.ts NBA
 *
 * $1 of payout on each side pays exactly $1 at settlement. If both prices plus the taker fee on each leg come to less
 * than $1, the pair locks in a profit. Taker fee per $1 of payout (docs.novig.com, checked 12 Nov 2026; a v3
 * contract pays 1 cent):
 *
 *   feePerDollar = 0.06 x p x (1 - p)
 *
 * Game markets charge it only while the event is live (pregame fills are fee-free) and futures always; this scan charges it on every leg, the
 * conservative case. Inside one Novig book a sum below $1 means a crossed book, which is rare and brief; the Python
 * version also pairs a Novig side with a price you collected from another venue.
 */
import { NovigAPI, takerFee, twoSides, type Market, type One } from "../src/index.js";

const [league = "NBA", minEdgeArg = "0"] = process.argv.slice(2);
const minEdge = Number(minEdgeArg);
const api = new NovigAPI();

let scanned = 0;
let found = 0;
for await (const listed of api.iterRows<Market>("markets", { league, status: "open", limit: 200 }, 5)) {
  const market = listed.outcomes?.length === 2 ? listed : (await api.market(listed.market_id) as One<Market>).data;
  const sides = twoSides(market);
  if (!sides) continue;
  scanned += 1;
  const coef = typeof market.fee_coefficient === "number" ? market.fee_coefficient : 0.06;
  const cost = sides.reduce((total, s) => total + s.ask + takerFee(s.ask, 1, coef), 0);
  const edge = 1 - cost;
  if (edge > minEdge) {
    found += 1;
    console.log(`${market.market_id}  cost ${cost.toFixed(4)}  edge ${edge.toFixed(4)} per $1 pair (${((edge / cost) * 100).toFixed(2)}%)  [${sides[0].name} / ${sides[1].name}]`);
  }
}
console.log(`\nScanned ${scanned} two-way markets; ${found} below $1 after fees.`);
