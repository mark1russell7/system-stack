/**
 * The inputs of the bench: the seeded inputs of `independentStop`, and one fixed input of `bestEndurance`.
 *
 * The cases `m4` to `m14` time `independentStop` on `m` cuts of one supply with two feeds.
 *
 * Each cut has a survival curve with `CURVE_POINTS` points between day 0 and day `CURVE_DAYS`.
 * The cuts are in two feeds, `a` and `b`. The supply stops when one cut of each feed is on.
 * Thus each cut is in a minimal set, and the minimal sets are the pairs of a cut of `a` and a cut of `b`.
 * Up to 12 cuts, `independentStop` sums the `2^m` states. Past 12 cuts, the pairs are one group, so it uses the expansion.
 * The curves fall over the same days, so the count of points is near its limit of approximately `m / sqrt(7.2e-6)`.
 */
import { random } from "@mark1russell7/rigor-generators";
import type { BestOptions } from "../src/best.ts";
import { ENDURANCE_SCHEMA, type CaseCuts, type EnduranceLayer, type Survival } from "../src/layer.ts";

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

/** The id of the case of `bestEndurance` (`bestInput`). */
export const BEST_CASE = "best";

/** The ids of the cases of the bench, in their order: the cases of `independentStop`, then the case of `bestEndurance`. */
export const BENCH_CASES: readonly string[] = [...BENCH_CUTS.map(caseId), BEST_CASE];

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

/** The date of the case `best`. The stores have no due date, so the date does not change the result. */
export const BEST_AT = "2026-12-01";
/** The horizon of the case `best`, in days. */
export const BEST_HORIZON = 14;

/** The input of the case `best`: a layer, a case that stops each supply, and the options of `bestEndurance`. */
export interface BestInput {
  readonly layer: EnduranceLayer;
  readonly caseCuts: CaseCuts;
  readonly options: BestOptions;
}

/**
 * This function gives the fixed input of the case `best`. It has no seed: a change of it is a change of the measure.
 *
 * Five draws of three levels share seven resources. Two cook converters share the water and the propane with the
 * drink, the wash and the heat, and a generator with a limit for each day makes battery energy from gasoline. The
 * case stops each supply, so each draw takes from the stores, and the horizon of 14 days fixes the draws that reach it.
 */
export function bestInput(): BestInput {
  const layer: EnduranceLayer = {
    schema: ENDURANCE_SCHEMA,
    levels: ["life", "health", "comfort"],
    resources: [
      { code: "water.stored", unit: "L" },
      { code: "food.ready", unit: "kcal" },
      { code: "food.grain-dry", unit: "kg" },
      { code: "food.beans-dry", unit: "kg" },
      { code: "fuel.propane", unit: "kg" },
      { code: "fuel.gasoline", unit: "L" },
      { code: "energy.battery", unit: "Wh" },
    ],
    stores: [
      { id: "jugs", resource: "water.stored", amount: 120 },
      { id: "bottles", resource: "water.stored", amount: 24 },
      { id: "cans", resource: "food.ready", amount: 6000 },
      { id: "rice", resource: "food.grain-dry", amount: 9 },
      { id: "beans", resource: "food.beans-dry", amount: 4 },
      { id: "propane", resource: "fuel.propane", amount: 2 },
      { id: "gasoline", resource: "fuel.gasoline", amount: 20 },
      { id: "battery", resource: "energy.battery", amount: 2000 },
    ],
    draws: [
      { need: "hydration.drink", level: "life", perDay: 11.355, users: 3, supply: "water-main" },
      { need: "food.energy", level: "health", perDay: 5400, users: 3, supply: "road" },
      { need: "hygiene.wash", level: "health", perDay: 6, users: 3, supply: "water-main" },
      { need: "power.electric", level: "comfort", perDay: 150, users: 3, supply: "grid" },
      { need: "heat.space", level: "comfort", perDay: 0.2, supply: "gas-line" },
    ],
    direct: [
      { resource: "water.stored", need: "hydration.drink", amount: 1 },
      { resource: "food.ready", need: "food.energy", amount: 1 },
      { resource: "water.stored", need: "hygiene.wash", amount: 1 },
      { resource: "energy.battery", need: "power.electric", amount: 1 },
      { resource: "fuel.propane", need: "heat.space", amount: 1 },
    ],
    converters: [
      { id: "cook-rice", device: "stove", takes: [{ resource: "food.grain-dry", amount: 1 }, { resource: "water.stored", amount: 2 }, { resource: "fuel.propane", amount: 0.05 }], gives: { need: "food.energy", amount: 3600 } },
      { id: "cook-beans", device: "stove", takes: [{ resource: "food.beans-dry", amount: 1 }, { resource: "water.stored", amount: 3 }, { resource: "fuel.propane", amount: 0.08 }], gives: { need: "food.energy", amount: 3400 } },
      { id: "generator", device: "generator", takes: [{ resource: "fuel.gasoline", amount: 1 }], gives: { resource: "energy.battery", amount: 2500 }, perDay: 4 },
    ],
  };
  const curve: Survival = [[0, 1], [1, 0.6], [3, 0.25], [10, 0.05], [30, 0]];
  const caseCuts: CaseCuts = {
    case: "storm",
    title: "Winter storm",
    cuts: ["grid", "road", "water-main", "gas-line"].map((part) => ({ part, title: part, duration: curve, source: "bench" })),
  };
  return { layer, caseCuts, options: { at: BEST_AT, horizon: BEST_HORIZON } };
}

