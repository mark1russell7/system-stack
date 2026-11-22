/**
 * The seeded inputs of the bench of `independentStop`: `m` cuts of one supply with two feeds.
 *
 * Each cut has a survival curve with `CURVE_POINTS` points between day 0 and day `CURVE_DAYS`.
 * The cuts are in two feeds, `a` and `b`. The supply stops when one cut of each feed is on.
 * Thus each cut is in a minimal set, and the minimal sets are the pairs of a cut of `a` and a cut of `b`.
 * Up to 12 cuts, `independentStop` sums the `2^m` states. Past 12 cuts, the pairs are one group, so it uses the expansion.
 * The curves fall over the same days, so the count of points is near its limit of approximately `m / sqrt(7.2e-6)`.
 */
import { random } from "@mark1russell7/rigor-generators";
import type { Survival } from "../src/layer.ts";

/** The seed of each input of the bench. A change of the seed is a change of the measure. */
export const BENCH_SEED = "stack-endurance/independent-stop/1";
/**
 * The counts of cuts of the cases of the bench. 12 is `MINIMAL_STOP_CUTS`, the largest count of the sum over the states of `independentStop`.
 * The case of 14 cuts measures the Shannon expansion of `pathSetReliability`. 14 cuts are in `INDEPENDENT_MAX_WORK`. 16 is the first count of this input that the budget refuses.
 */
export const BENCH_CUTS = [4, 8, 12, 14] as const;
/** The points of each curve after `[0, 1]`. */
export const CURVE_POINTS = 6;
/** The last day of each curve. */
export const CURVE_DAYS = 30;

/** One input of the bench: the curves of the cuts and the minimal sets that stop the supply. */
export interface IndependentInput {
  readonly cuts: number;
  readonly curves: readonly Survival[];
  readonly sets: readonly (readonly number[])[];
}

/** This function gives the id of the case of `m` cuts, for example `m12`. */
export const caseId = (cuts: number): string => `m${String(cuts)}`;

/** This function gives the count of cuts of a case id, or `undefined` for an id that is not a case of the bench. */
export function cutsOf(id: string): number | undefined {
  const cuts = Number(/^m(\d+)$/.exec(id)?.[1]);
  return (BENCH_CUTS as readonly number[]).includes(cuts) ? cuts : undefined;
}

/**
 * This function gives the seeded input of `cuts` cuts. The same seed and count give the same input.
 *
 * The sets come in the order of `minimalStops`: by the larger cut, then by the smaller cut.
 *
 * @throws RangeError when the count is less than 2, because one feed then has no cut
 */
export function independentInput(cuts: number, seed: string = BENCH_SEED): IndependentInput {
  if (!Number.isInteger(cuts) || cuts < 2) throw new RangeError(`The bench needs 2 cuts or more, not ${String(cuts)}.`);
  const rng = random(`${seed}/${String(cuts)}`);
  const curves = Array.from({ length: cuts }, (_, index) => curveOf(rng.fork(`curve-${String(index)}`).next));
  // Cut 0 is in feed a and cut 1 is in feed b, so each feed has a cut. The other cuts go to a feed at random.
  const feeds = rng.fork("feeds");
  const inFeedA = Array.from({ length: cuts }, (_, index) => (index < 2 ? index === 0 : feeds.chance(0.5)));
  const sets: number[][] = [];
  for (let high = 1; high < cuts; high += 1) for (let low = 0; low < high; low += 1) if (inFeedA[low] !== inFeedA[high]) sets.push([low, high]);
  return { cuts, curves, sets };
}

/** This function gives one survival curve: `[0, 1]`, then falling chances at rising days, and a chance of 0 at `CURVE_DAYS`. */
function curveOf(next: () => number): Survival {
  const days = Array.from({ length: CURVE_POINTS - 1 }, () => 0.5 + next() * (CURVE_DAYS - 1)).sort((x, y) => x - y);
  const chances = Array.from({ length: CURVE_POINTS - 1 }, () => 0.02 + next() * 0.96).sort((x, y) => y - x);
  const curve: [number, number][] = [[0, 1]];
  for (const [index, day] of days.entries()) {
    // Two equal days do not make a curve. A draw of two equal floats is rare, and the next point then moves a little.
    const at = Math.max(day, (curve[curve.length - 1]?.[0] ?? 0) + 1e-6);
    curve.push([at, chances[index] ?? 0]);
  }
  curve.push([CURVE_DAYS, 0]);
  return curve;
}
