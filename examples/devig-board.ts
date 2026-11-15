/**
 * Devig every two-sided Novig market in a league.
 *
 *   export NOVIGAPI_KEY=nv_...
 *   npx tsx examples/devig-board.ts NFL shin
 *
 * Takes the taker price (ask) on both sides of each open two-way market, removes the spread with the chosen method and
 * prints fair probabilities and fair American odds.
 */
import { NovigAPI, devig, hold, probToAmerican, twoSides, type DevigMethod, type Market, type One } from "../src/index.js";

const [league = "NFL", method = "multiplicative"] = process.argv.slice(2);
const api = new NovigAPI();

let shown = 0;
console.log(["market".padEnd(52), "outcome".padEnd(22), "ask".padStart(6), "fair".padStart(6), "fair US".padStart(8), "spread".padStart(8)].join(" "));
for await (const listed of api.iterRows<Market>("markets", { league, status: "open", limit: 100 }, 3)) {
  const market = listed.outcomes?.length === 2 ? listed : (await api.market(listed.market_id) as One<Market>).data;
  const sides = twoSides(market);
  if (!sides) continue;
  const asks = [sides[0].ask, sides[1].ask];
  if (asks[0] + asks[1] <= 1) continue; // crossed or locked book; see arb-scanner.ts
  const fair = devig(asks, method as DevigMethod);
  let label = String(market.description ?? market.market_id).slice(0, 52);
  sides.forEach((side, i) => {
    const p = fair[i];
    const us = Math.round(probToAmerican(p));
    console.log([label.padEnd(52), side.name.slice(0, 22).padEnd(22), side.ask.toFixed(3).padStart(6), p.toFixed(3).padStart(6), (us > 0 ? `+${us}` : `${us}`).padStart(8), `${(hold(asks) * 100).toFixed(2)}%`.padStart(8)].join(" "));
    label = "";
  });
  shown += 1;
}
console.log(`\n${shown} two-sided markets devigged with the ${method} method.`);
