/**
 * Closing-line value backtest on Novig's free daily CSVs. No API key needed.
 *
 *   npx tsx examples/clv-backtest.ts 2026-10-01 2026-11-11
 *
 * Streams https://data.novig.com/reporting/trade-data/<YYYY-MM-DD>/markets.csv (columns: date, marketId, reportTicker,
 * openInterest, dailyVolume, open, high, low, close, status; prices in percent) line by line, without saving it.
 * Entry is the first opening print of each market; close is its last close on or before the end date. CLV, in
 * percentage points, for buying the quoted outcome is close - entry.
 *
 * Caveat: close is the day's last print, and Novig trades in-game, so for live-traded markets it can sit near the
 * result. The CSVs have no event start time to cut at kickoff. Combination (parlay) markets are skipped.
 */

const BASE = "https://data.novig.com/reporting/trade-data";
const [startArg = "2026-10-01", endArg = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), minVolumeArg = "100"] = process.argv.slice(2);
const minVolume = Number(minVolumeArg);

function* days(start: string, end: string): Generator<string> {
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) yield d.toISOString().slice(0, 10);
}

/** Lines of a remote text file, read from the response stream chunk by chunk. */
async function* lines(url: string): AsyncGenerator<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    console.error(`  ${url}: HTTP ${res.status}, skipped`);
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, at).replace(/\r$/, "");
      buffer = buffer.slice(at + 1);
    }
  }
  if (buffer) yield buffer;
}

const pct = (v: string | undefined) => {
  if (!v) return null;
  const p = Number(v) / 100;
  return p > 0 && p < 1 ? p : null;
};

const firstOpen = new Map<string, number>();
const lastClose = new Map<string, number>();
const ticker = new Map<string, string>();
const volume = new Map<string, number>();
let rowsRead = 0;

for (const day of days(startArg, endArg)) {
  let header: string[] | null = null;
  let n = 0;
  for await (const line of lines(`${BASE}/${day}/markets.csv`)) {
    // These files carry no quoted fields; a plain split is enough.
    const cells = line.split(",");
    if (!header) { header = cells; continue; }
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i]])) as Record<string, string | undefined>;
    n += 1;
    const id = row.marketId;
    const t = row.reportTicker ?? "";
    if (!id || t.startsWith("COMBO")) continue;
    ticker.set(id, t);
    volume.set(id, (volume.get(id) ?? 0) + (Number(row.dailyVolume) || 0));
    const o = pct(row.open), c = pct(row.close);
    if (o !== null && !firstOpen.has(id)) firstOpen.set(id, o);
    if (c !== null) lastClose.set(id, c);
  }
  rowsRead += n;
  console.error(`  ${day}: ${n} rows`);
}

const byLeague = new Map<string, number[]>();
for (const [id, close] of lastClose) {
  const entry = firstOpen.get(id);
  if (entry === undefined || (volume.get(id) ?? 0) < minVolume) continue;
  const clv = (close - entry) * 100;
  const league = (ticker.get(id) ?? "UNKNOWN").split("-")[0] || "UNKNOWN";
  for (const key of ["ALL", league]) byLeague.set(key, [...(byLeague.get(key) ?? []), clv]);
}

const all = byLeague.get("ALL") ?? [];
console.log(`\nNovig daily CSVs ${startArg} to ${endArg}: ${rowsRead} rows read, ${all.length} markets with an entry and a close (volume >= $${minVolume}).\n`);
console.log(["league".padEnd(10), "markets".padStart(8), "mean CLV".padStart(10), "mean |move|".padStart(12), ">= 1 pp".padStart(9), ">= 5 pp".padStart(9), "CLV > 0".padStart(9)].join(" "));
const share = (xs: number[], f: (x: number) => boolean) => `${((xs.filter(f).length / xs.length) * 100).toFixed(1)}%`;
for (const [league, xs] of [...byLeague].sort((a, b) => (a[0] === "ALL" ? -1 : b[0] === "ALL" ? 1 : b[1].length - a[1].length))) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const absMean = xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length;
  console.log([league.padEnd(10), String(xs.length).padStart(8), `${mean >= 0 ? "+" : ""}${mean.toFixed(2)}p`.padStart(10), `${absMean.toFixed(2)}p`.padStart(12), share(xs, (x) => Math.abs(x) >= 1).padStart(9), share(xs, (x) => Math.abs(x) >= 5).padStart(9), share(xs, (x) => x > 0).padStart(9)].join(" "));
}

export {};
