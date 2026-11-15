/**
 * Devig (remove the vig from) a set of mutually exclusive prices.
 *
 * Every function takes implied probabilities that sum to more than 1 and returns fair probabilities that sum to 1.
 * All functions are pure. Novig quotes probabilities as percentages (54% = 0.54); convert sportsbook odds first with
 * americanToProb or decimalToProb.
 */

export type DevigMethod = "multiplicative" | "additive" | "power" | "shin";

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

function checkProb(p: number): void {
  if (!(p > 0 && p < 1)) throw new RangeError("probability must be between 0 and 1 (exclusive)");
}

function validate(probs: readonly number[]): number[] {
  if (probs.length < 2) throw new RangeError("need at least two outcomes");
  probs.forEach(checkProb);
  return [...probs];
}

function bisect(f: (x: number) => number, lo: number, hi: number, tol = 1e-12, maxIter = 200): number {
  // f is decreasing on [lo, hi].
  for (let i = 0; i < maxIter; i += 1) {
    const mid = (lo + hi) / 2;
    const v = f(mid);
    if (Math.abs(v) < tol) return mid;
    if (v > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Implied probability of American odds. -110 -> 0.5238, +150 -> 0.4. */
export function americanToProb(odds: number): number {
  if (odds === 0 || (odds > -100 && odds < 100)) throw new RangeError("American odds must be <= -100 or >= +100");
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

/** Implied probability of decimal odds. 2.5 -> 0.4. */
export function decimalToProb(odds: number): number {
  if (!(odds > 1)) throw new RangeError("decimal odds must be greater than 1");
  return 1 / odds;
}

/** American odds for a probability. 0.4 -> 150, 0.6 -> -150. */
export function probToAmerican(p: number): number {
  checkProb(p);
  return p > 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p;
}

/** Decimal odds for a probability. 0.4 -> 2.5. */
export function probToDecimal(p: number): number {
  checkProb(p);
  return 1 / p;
}

/** Sum of implied probabilities minus 1. */
export const overround = (probs: readonly number[]): number => sum(probs) - 1;

/** Theoretical hold: 1 - 1 / sum(probs). -110/-110 -> 0.04545. */
export const hold = (probs: readonly number[]): number => 1 - 1 / sum(probs);

/** p_i = q_i / sum(q). Keeps the ratio between outcomes. */
export function multiplicative(probs: readonly number[]): number[] {
  const qs = validate(probs);
  const total = sum(qs);
  return qs.map((q) => q / total);
}

/** p_i = q_i - (sum(q) - 1) / n. Floors at 0 and renormalises if a longshot goes negative. */
export function additive(probs: readonly number[]): number[] {
  const qs = validate(probs);
  const margin = (sum(qs) - 1) / qs.length;
  let out = qs.map((q) => q - margin);
  if (Math.min(...out) <= 0) {
    out = out.map((p) => Math.max(p, 0));
    const total = sum(out);
    out = out.map((p) => p / total);
  }
  return out;
}

/** Solve sum(q_i ^ k) = 1 for k, then p_i = q_i ^ k. Puts more of the margin on longshots. */
export function power(probs: readonly number[]): number[] {
  const qs = validate(probs);
  const f = (k: number) => sum(qs.map((q) => q ** k)) - 1;
  let hi = 1;
  while (f(hi) > 0) {
    hi *= 2;
    if (hi > 1e6) throw new RangeError("power method did not converge");
  }
  const k = bisect(f, 1e-6, hi);
  const out = qs.map((q) => q ** k);
  const total = sum(out);
  return out.map((p) => p / total);
}

/**
 * Shin's method. For an insider share z, p_i(z) = (sqrt(z^2 + 4 (1 - z) q_i^2 / S) - z) / (2 (1 - z)), with S the
 * sum of the q_i; z is chosen so the p_i sum to 1. With two outcomes it equals the additive method.
 */
export function shin(probs: readonly number[]): number[] {
  const qs = validate(probs);
  const total = sum(qs);
  if (total <= 1) return qs.map((q) => q / total);
  const fair = (z: number) => qs.map((q) => (Math.sqrt(z * z + (4 * (1 - z) * q * q) / total) - z) / (2 * (1 - z)));
  const z = bisect((x) => sum(fair(x)) - 1, 0, 0.999);
  const out = fair(z);
  const s = sum(out);
  return out.map((p) => p / s);
}

export const METHODS: Record<DevigMethod, (probs: readonly number[]) => number[]> = { multiplicative, additive, power, shin };

/** Devig with the named method. */
export function devig(probs: readonly number[], method: DevigMethod = "multiplicative"): number[] {
  const fn = METHODS[method];
  if (!fn) throw new RangeError(`method must be one of: ${Object.keys(METHODS).join(", ")}`);
  return fn(probs);
}

/**
 * Novig taker fee in dollars: coefficient x p x (1 - p) per $1 of payout. `contracts` counts dollars of payout; a v3
 * contract pays 1 cent, so divide a raw v3 quantity by 100 first. The coefficient is 0.06 on straight contracts per
 * docs.novig.com (checked 12 Nov 2026). Game markets charge it only while live (pregame fills are fee-free); futures
 * always. Makers pay nothing and earn 0.25 of the taker fee on game markets (0.5 on futures) since 22 Oct 2026.
 */
export function takerFee(price: number, contracts = 1, coefficient = 0.06): number {
  checkProb(price);
  return coefficient * price * (1 - price) * contracts;
}
