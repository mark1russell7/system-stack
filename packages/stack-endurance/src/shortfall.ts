import { type OrderedRing, pathSetReliability, stronglyConnectedComponents } from "@mark1russell7/collections/graph";
import { DEFAULT_MAX_SETS, neededParts, survivalAt, weakestBound, type CutBound, type PathOptions } from "@mark1russell7/system-stack";
import { bestEndurance } from "./best.ts";
import { caseDraws, caseStopped, enduranceOf, type CaseOptions } from "./endurance.ts";
import type { CaseCuts, Draw, Endurance, EnduranceLayer, Prior, Survival } from "./layer.ts";
import { stackStops } from "./stops.ts";

// The shortfall: the user-days in which a draw does not get its need, for one case and for one year.

/** The read of a curve at a time is in the core since system-stack 0.1.13. This package gives it again, so its API does not change. */
export { survivalAt };

/**
 * This function gives the expected days of a cut after a time, up to a horizon: `E[max(0, min(D, to) - from)]`.
 * It is the area under the curve from `from` to `to`. The curve is linear between its points, so the area is exact.
 * With no horizon, the area goes to the end of the curve.
 */
export function tailDays(curve: Survival, from: number, to: number = Infinity): number {
  let area = 0;
  for (let index = 1; index < curve.length; index += 1) {
    const [t0] = curve[index - 1] ?? [0, 1];
    const [t1] = curve[index] ?? [0, 0];
    const start = Math.max(t0, from);
    const end = Math.min(t1, to);
    if (start < end) area += ((survivalAt(curve, start) + survivalAt(curve, end)) / 2) * (end - start);
  }
  return area;
}

/**
 * The options of a shortfall: the stack or the parts that are also down, as for `enduranceOf`, and a horizon.
 * With a horizon of `h` days, the shortfall counts only the first `h` days of each cut. A draw that holds `h` days has no shortfall.
 * Thus a plan can aim at a target, for example 14 days and then 90 days.
 */
/**
 * The options of `stopCurves`. With a stack, `maxSets` is the budget of the search of the needs (`stopSets` of the core).
 * When the search passes it, `minimalStops` gives the sets.
 */
export interface StopCurveOptions extends Pick<CaseOptions, "stack" | "down">, Pick<PathOptions, "maxSets"> {
  /** The budget of `independentStop` for the curve of each draw, a whole number from 1. The default is `INDEPENDENT_MAX_WORK`. */
  readonly maxWork?: number | undefined;
}

export interface ShortfallOptions extends StopCurveOptions {
  /** The horizon in days, more than 0. The default is no horizon. */
  readonly horizon?: number | undefined;
}

function horizonOf(options: ShortfallOptions): number {
  const horizon = options.horizon ?? Infinity;
  if (!(horizon > 0)) throw new RangeError(`The horizon ${String(options.horizon)} is not a number of days more than 0.`);
  return horizon;
}

function budgetsOf(options: StopCurveOptions): { readonly maxSets: number; readonly maxWork: number } {
  const maxSets = options.maxSets ?? DEFAULT_MAX_SETS;
  if (!Number.isInteger(maxSets) || maxSets < 1) throw new RangeError(`The option maxSets is ${String(options.maxSets)}: it is not a whole number from 1.`);
  const maxWork = options.maxWork ?? INDEPENDENT_MAX_WORK;
  if (!Number.isInteger(maxWork) || maxWork < 1) throw new RangeError(`The option maxWork is ${String(options.maxWork)}: it is not a whole number from 1.`);
  return { maxSets, maxWork };
}

/**
 * This function gives the days at which the chance of the curve falls to `chance`. With `0.1`, it is the 90th percentile of the duration.
 * When the curve does not fall to `chance`, the result is `Infinity`.
 */
export function survivalQuantile(curve: Survival, chance: number): number {
  for (let index = 1; index < curve.length; index += 1) {
    const [t0, p0] = curve[index - 1] ?? [0, 1];
    const [t1, p1] = curve[index] ?? [0, 0];
    if (p0 <= chance) return t0;
    if (p1 <= chance) return t0 + ((p0 - chance) * (t1 - t0)) / (p0 - p1);
  }
  return Infinity;
}

/** This function gives the chance that a case reaches its place one or more times in one year: `1 - exp(-perYear * reach)`. */
export function yearChance(prior: Prior): number {
  return 1 - Math.exp(-prior.perYear * prior.reach);
}

/** This function gives the expected count of the events of a case at its place in one year: `perYear * reach`. */
export function yearRate(prior: Prior): number {
  return prior.perYear * prior.reach;
}

/** This function gives the times at which a curve of the result can bend: each point of each curve, and each crossing of two curves. */
function bendTimes(curves: readonly Survival[]): number[] {
  const times = [...new Set(curves.flatMap((curve) => curve.map(([days]) => days)))].sort((x, y) => x - y);
  const out = new Set(times);
  for (let index = 1; index < times.length; index += 1) {
    const t0 = times[index - 1] ?? 0;
    const t1 = times[index] ?? 0;
    for (const [i, a] of curves.entries()) {
      for (const b of curves.slice(i + 1)) {
        const d0 = survivalAt(a, t0) - survivalAt(b, t0);
        const d1 = survivalAt(a, t1) - survivalAt(b, t1);
        if (d0 * d1 < 0) out.add(t0 + ((t1 - t0) * d0) / (d0 - d1));
      }
    }
  }
  return [...out].sort((x, y) => x - y);
}

/**
 * This function makes a survival curve from a chance at each time. It stops at the first chance of 0, and it removes an increase of rounding.
 *
 * @throws RangeError when the chance at the last time is more than 0, as for curves that do not end at a chance of 0
 */
function curveFrom(times: readonly number[], chanceAt: (days: number) => number): Survival {
  const out: [number, number][] = [];
  for (const days of times) {
    const chance = Math.min(out[out.length - 1]?.[1] ?? 1, chanceAt(days));
    out.push([days, chance]);
    if (chance === 0) return out;
  }
  throw new RangeError("The curves do not fall to a chance of 0 at their last point.");
}

/**
 * This function gives the curve of a stop of some cuts when one event makes each cut longer together.
 * At each time, the chance is the largest `s` at which the cuts with a chance of `s` or more stop the supply.
 *
 * - When any one cut stops the supply, the result is the largest chance of the curves (`longestStop`).
 * - When the supply needs `any` of two parts, the stop ends with the shorter of the two cuts.
 * - Between two times of `bendTimes` the order of the curves does not change. So the result is linear between its points.
 * - When no set of cuts stops the supply, the result is `[[0, 0]]`. This curve does not start at `[0, 1]`, so `checkEndurance` refuses it.
 *
 * The result is not a limit. When the cuts are independent, a stop of two cuts in series can be longer. A stop through a need of `any` can be shorter.
 *
 * @param curves - The curves of the cuts, each one good for `checkEndurance`
 * @param stops - This function tells if the cuts of a list of indexes stop the supply. A larger list stops it when a smaller list does.
 * @throws RangeError when a curve does not end at a chance of 0
 */
export function eventStop(curves: readonly Survival[], stops: (cuts: readonly number[]) => boolean): Survival {
  return curveFrom(bendTimes(curves), (days) => {
    const chances = curves.map((curve) => survivalAt(curve, days));
    for (const level of [...new Set(chances)].sort((x, y) => y - x)) {
      if (stops(chances.flatMap((chance, index) => (chance >= level ? [index] : [])))) return level;
    }
    return 0;
  });
}

/**
 * This function gives the curve of the longest of some stops: at each time, the largest chance of the curves.
 * It is `eventStop` when any one cut stops the supply.
 *
 * @param curves - The curves, each one good for `checkEndurance`
 * @throws RangeError when there is no curve, or when a curve does not end at a chance of 0
 */
export function longestStop(curves: readonly Survival[]): Survival {
  const first = curves[0];
  if (first === undefined) throw new RangeError("longestStop needs one or more curves.");
  return curves.length === 1 ? first : eventStop(curves, (cuts) => cuts.length > 0);
}

/**
 * The largest count of cuts for which `minimalStops` examines each set, and for which `independentStop` adds the chance of each state.
 * With a stack, `stopCurves` finds the minimal sets from the needs, so a larger count of cuts can have exact sets.
 */
export const MINIMAL_STOP_CUTS = 12;

/**
 * This function gives the minimal sets of cuts that stop the supply: each set stops it, and no smaller part of a set stops it.
 * With more than `MINIMAL_STOP_CUTS` cuts, the result is `undefined`.
 */
export function minimalStops(count: number, stops: (cuts: readonly number[]) => boolean): number[][] | undefined {
  if (count > MINIMAL_STOP_CUTS) return undefined;
  const found: number[][] = [];
  const masks: number[] = [];
  const all = Array.from({ length: 1 << count }, (_, mask) => mask).sort((x, y) => popCount(x) - popCount(y) || x - y);
  for (const mask of all) {
    if (mask === 0 || masks.some((other) => (other & mask) === other)) continue;
    const cuts = Array.from({ length: count }, (_, index) => index).filter((index) => (mask >> index) & 1);
    if (!stops(cuts)) continue;
    masks.push(mask);
    found.push(cuts);
  }
  return found;
}

function popCount(mask: number): number {
  let total = 0;
  for (let rest = mask; rest > 0; rest &= rest - 1) total += 1;
  return total;
}

/**
 * This function gives an upper limit of the curve of a stop for each dependence of the cuts.
 * At each time it is `min(1, sum over the minimal sets of the smallest chance of the set)`.
 * With no minimal sets, as for too many cuts, it is `min(1, sum of the chances)`.
 *
 * @param curves - The curves of the cuts
 * @param sets - The minimal sets of `minimalStops`, or `undefined`
 * @throws RangeError when a curve does not end at a chance of 0
 */
export function upperStop(curves: readonly Survival[], sets: readonly (readonly number[])[] | undefined): Survival {
  const groups = sets ?? curves.map((_, index) => [index]);
  const sum = (days: number): number => groups.reduce((total, set) => total + Math.min(...set.map((index) => survivalAt(curves[index] ?? [], days))), 0);
  // The sum is linear between two times of bendTimes. A point where it falls through 1 is a bend of min(1, sum).
  const times = bendTimes(curves);
  const bends = new Set(times);
  for (let index = 1; index < times.length; index += 1) {
    const t0 = times[index - 1] ?? 0;
    const t1 = times[index] ?? 0;
    const s0 = sum(t0) - 1;
    const s1 = sum(t1) - 1;
    if (s0 * s1 < 0) bends.add(t0 + ((t1 - t0) * s0) / (s0 - s1));
  }
  return curveFrom([...bends].sort((x, y) => x - y), (days) => Math.min(1, sum(days)));
}

/** The largest difference between `independentStop` and the true chance of a stop of independent cuts, at each time. */
export const INDEPENDENT_TOLERANCE = 1e-6;

/**
 * The default budget of `independentStop` for its groups of more than `MINIMAL_STOP_CUTS` cuts.
 * The budget counts the steps of the expansion times the count of points of the curve.
 * It is near the work of the sum over the states of 12 cuts.
 */
export const INDEPENDENT_MAX_WORK: number = 2 ** 26;

/**
 * This function gives the curve of a stop of some cuts when the cuts are independent.
 * At each time `t`, the supply is stopped when the cuts that are still on contain a minimal set.
 * Its chance is a sum over each set of cuts that stops the supply.
 * Each term is the product of `s(t)` for the cuts that are on, and of `1 - s(t)` for the other cuts.
 *
 * - When any one cut stops the supply, the result is `1 - prod(1 - s)`. It is not less than the longest cut (`eventStop`).
 * - When the supply needs `any` of two parts, the stop of the two is `s1 * s2`. It is not more than the shorter cut.
 * - The result is not more than `upperStop` of the same sets, because `upperStop` is a limit for each dependence.
 * - Between two points of the curves the chance is a polynomial, not a line. The function splits each such segment into equal pieces.
 *   The chance is linear in each `s`, and each mixed second derivative is between -1 and 1.
 *   Thus `|f''| <= (sum |s'|)^2 - sum s'^2`, and the line of a piece of length `h` is within `h^2 |f''| / 8` of the chance.
 *   The count of pieces keeps each line within `INDEPENDENT_TOLERANCE`. With a margin of 10 %, the count of points is less than `n / sqrt(7.2 * INDEPENDENT_TOLERANCE)` plus the segments, for `n` cuts.
 *
 * - Up to `MINIMAL_STOP_CUTS` cuts in the sets, the function adds the chance of each of the 2 to the power of that count of states.
 * - Two groups of cuts that share no set are independent, so the chance that the supply works is the product over the groups.
 *   For example, 20 stages of 2 feeds give 20 groups of 2 cuts.
 * - In a group of more than `MINIMAL_STOP_CUTS` cuts, it uses the Shannon expansion of `pathSetReliability` of collections.
 *   The expansion merges two states with the same sets left, and it drops a set that holds another set.
 * - The expansion is exponential in the worst case. The groups share one budget, `maxWork`.
 *   When the steps of the expansions times the count of points of the curve pass it, the result is `undefined`.
 *
 * @param curves - The curves of the cuts, each one good for `checkEndurance`
 * @param sets - The minimal sets of the cuts. With `undefined`, as for no minimal sets, the result is `undefined`. With no sets, it is `[[0, 0]]`
 * @param maxWork - The budget of the expansions of the groups of more than `MINIMAL_STOP_CUTS` cuts, a whole number from 1. The default is `INDEPENDENT_MAX_WORK`
 * @throws RangeError when a curve does not end at a chance of 0, or for a bad `maxWork`
 */
export function independentStop(curves: readonly Survival[], sets: readonly (readonly number[])[] | undefined, maxWork: number = INDEPENDENT_MAX_WORK): Survival | undefined {
  if (!Number.isInteger(maxWork) || maxWork < 1) throw new RangeError(`The budget maxWork is ${String(maxWork)}: it is not a whole number from 1.`);
  if (sets === undefined) return undefined;
  // With no set, no cuts stop the supply, as for `eventStop` and `upperStop`.
  if (sets.length === 0) return [[0, 0]];
  // Only the cuts of a set change the chance. Their place in `used` is their index in the sets of the cuts that count.
  const used = [...new Set(sets.flat())].sort((x, y) => x - y);
  const usedCurves = used.map((index) => curves[index] ?? []);
  const usedSets = sets.map((set) => set.map((index) => used.indexOf(index)));
  const points = independentPoints(usedCurves);
  // Two groups of cuts that share no set are independent: the supply works when it works in each group.
  const groupChances: ((days: number) => number)[] = [];
  // The expansions of all groups share one budget.
  let work = maxWork;
  for (const group of cutGroups(used.length, usedSets)) {
    const curvesOf = group.map((index) => usedCurves[index] ?? []);
    const setsOf = usedSets.filter((set) => group.includes(set[0] ?? -1)).map((set) => set.map((index) => group.indexOf(index)));
    // Up to MINIMAL_STOP_CUTS cuts, the sum over the states is exact with a fixed cost. Past them, the expansion is exact within its budget.
    if (group.length <= MINIMAL_STOP_CUTS) {
      groupChances.push(stateChance(curvesOf, setsOf));
      continue;
    }
    const expanded = expandedChances(curvesOf, setsOf, points, work);
    if (expanded === undefined) return undefined;
    work -= expanded.steps * points.length;
    const chanceOf = new Map(points.map((days, index) => [days, expanded.chances[index] ?? 0]));
    groupChances.push((days) => {
      const chance = chanceOf.get(days);
      if (chance === undefined) throw new Error(`The expansion has no chance at ${String(days)} days.`);
      return chance;
    });
  }
  // With one group, the chance of the group is the result, with no rounding of 1 - (1 - chance).
  const [only] = groupChances;
  if (groupChances.length === 1 && only !== undefined) return curveFrom(points, only);
  return curveFrom(points, (days) => Math.min(1, Math.max(0, 1 - groupChances.reduce((works, chanceAt) => works * (1 - chanceAt(days)), 1))));
}

/** The groups of the cuts `0` to `count - 1`: two cuts are in one group when a chain of sets joins them. Each set has its cuts in one group. */
function cutGroups(count: number, sets: readonly (readonly number[])[]): number[][] {
  const next = Array.from({ length: count }, () => new Set<number>());
  // A cycle through the cuts of each set joins them both ways, so the strongly connected components are the groups.
  for (const set of sets) for (const [at, index] of set.entries()) next[index]?.add(set[(at + 1) % set.length] ?? index);
  return stronglyConnectedComponents(
    Array.from({ length: count }, (_, index) => index),
    (index) => next[index] ?? [],
  );
}

/** The times of `independentStop`: the points of the curves, and the pieces that keep each line within `INDEPENDENT_TOLERANCE`. */
function independentPoints(curves: readonly Survival[]): number[] {
  const times = [...new Set(curves.flatMap((curve) => curve.map(([days]) => days)))].sort((x, y) => x - y);
  const points: number[] = [];
  for (const [index, t1] of times.entries()) {
    const t0 = times[index - 1];
    if (t0 !== undefined) {
      const h = t1 - t0;
      const slopes = curves.map((curve) => Math.abs(survivalAt(curve, t1) - survivalAt(curve, t0)) / h);
      const sum = slopes.reduce((total, slope) => total + slope, 0);
      const bound = Math.max(0, sum * sum - slopes.reduce((total, slope) => total + slope * slope, 0));
      // A margin of 10 % keeps the rounding of the chance under the tolerance.
      const pieces = Math.ceil(h * Math.sqrt(bound / (8 * 0.9 * INDEPENDENT_TOLERANCE)));
      for (let piece = 1; piece < pieces; piece += 1) {
        const days = t0 + (h * piece) / pieces;
        // Two times that are next to each other as floats have no time between them.
        if (days > (points[points.length - 1] ?? t0) && days < t1) points.push(days);
      }
    }
    points.push(t1);
  }
  return points;
}

/** The chance of a stop at a time, as the sum over each state of `MINIMAL_STOP_CUTS` cuts or fewer. Bit k of a state is 1 when cut k is on. */
function stateChance(curves: readonly Survival[], sets: readonly (readonly number[])[]): (days: number) => number {
  const setMasks = sets.map((set) => set.reduce((mask, index) => mask | (1 << index), 0));
  const stopping = Array.from({ length: 1 << curves.length }, (_, mask) => setMasks.some((set) => (set & mask) === set));
  const states = new Float64Array(1 << curves.length);
  return (days) => {
    // The chance of each state of the cuts, one cut at a time.
    states[0] = 1;
    let length = 1;
    for (const curve of curves) {
      const on = survivalAt(curve, days);
      for (let mask = 0; mask < length; mask += 1) {
        const chance = states[mask] ?? 0;
        states[mask + length] = chance * on;
        states[mask] = chance * (1 - on);
      }
      length *= 2;
    }
    let total = 0;
    for (let mask = 0; mask < length; mask += 1) if (stopping[mask]) total += states[mask] ?? 0;
    return Math.min(1, Math.max(0, total));
  };
}

/** The count of times in one expansion of `expandedChances`: the length of the vectors of its ring. */
const EXPANSION_WIDTH = 64;

/**
 * The ring of the vectors of `width` chances, one for each time, for `pathSetReliability` of collections.
 * Each operation is on each time alone. In the order, `a` is less than `b` when it is less or equal at each time, and not equal.
 */
function vectorRing(width: number): OrderedRing<Float64Array> {
  const zip = (a: Float64Array, b: Float64Array, op: (x: number, y: number) => number): Float64Array => {
    const out = new Float64Array(width);
    for (let index = 0; index < width; index += 1) out[index] = op(a[index] ?? 0, b[index] ?? 0);
    return out;
  };
  return {
    zero: new Float64Array(width),
    one: new Float64Array(width).fill(1),
    add: (a, b) => zip(a, b, (x, y) => x + y),
    sub: (a, b) => zip(a, b, (x, y) => x - y),
    mul: (a, b) => zip(a, b, (x, y) => x * y),
    compare: (a, b) => {
      let less = false;
      let more = false;
      for (let index = 0; index < width; index += 1) {
        const [x, y] = [a[index] ?? 0, b[index] ?? 0];
        if (x < y) less = true;
        else if (x > y) more = true;
        else if (x !== y) return Number.NaN;
      }
      return less ? (more ? Number.NaN : -1) : more ? 1 : 0;
    },
  };
}

/**
 * The chance of a stop at each point, from the Shannon expansion of `pathSetReliability`. A set works when each of its cuts is on.
 * One call gives `EXPANSION_WIDTH` points. When the steps of one expansion times the count of points pass `maxWork`, the result is `undefined`.
 * Else `steps` is the count of steps of one expansion.
 */
function expandedChances(
  curves: readonly Survival[],
  sets: readonly (readonly number[])[],
  points: readonly number[],
  maxWork: number,
): { readonly chances: number[]; readonly steps: number } | undefined {
  const maxSteps = Math.floor(maxWork / points.length);
  if (maxSteps < 1) return undefined;
  const out: number[] = [];
  let steps = 0;
  for (let start = 0; start < points.length; start += EXPANSION_WIDTH) {
    const times = points.slice(start, start + EXPANSION_WIDTH);
    const chances = curves.map((curve) => Float64Array.from(times, (days) => survivalAt(curve, days)));
    const result = pathSetReliability(sets, chances, vectorRing(times.length), { maxSteps });
    // Each call has the same sets, so the first call tells if the expansion is in the budget.
    if (result.kind === "budget") return undefined;
    steps = result.steps;
    for (const chance of result.value) out.push(Math.min(1, Math.max(0, chance)));
  }
  return { chances: out, steps };
}

/**
 * The curves of the stop of a draw. `event` is for one event that makes each cut longer together, and `independent` is for independent cuts.
 * `upper` is an upper limit for each dependence.
 */
export interface StopCurves {
  readonly event: Survival;
  /** The stop when the cuts are independent (`independentStop`). When `independentUpper` is true, it is `upper`. */
  readonly independent: Survival;
  readonly upper: Survival;
  /**
   * This is true when `upper` is the sum of the curves of the cuts that count, because the query has no minimal sets.
   * With a stack, the search of the needs passed its budget. With no stack, more than `MINIMAL_STOP_CUTS` cuts count.
   */
  readonly coarse: boolean;
  /** This is true when `independent` is `upper`: `coarse` is true, or the expansion of `independentStop` passed its budget. */
  readonly independentUpper: boolean;
  /**
   * The weakest bound (`weakestBound` of the core) of the curves of the cuts that the stop uses. Since 0.8.4.
   * With minimal sets, the stop uses the cuts of the sets. With no minimal sets, it uses each cut with a curve.
   * Each of the three curves does not decrease when a cut lasts longer, so it has this bound.
   */
  readonly bound: CutBound;
}

/** This function gives the parts of the stack that are down for a list of cut indexes. A case uses one memo for each of its draws. */
type StoppedOf = (cuts: readonly number[]) => ReadonlySet<string>;

function stoppedMemo(caseCuts: CaseCuts, options: Pick<CaseOptions, "stack" | "down">): StoppedOf {
  const memo = new Map<string, ReadonlySet<string>>();
  return (cuts) => {
    const key = cuts.join(",");
    let found = memo.get(key);
    if (found === undefined) {
      found = caseStopped({ ...caseCuts, cuts: cuts.flatMap((index) => caseCuts.cuts[index] ?? []) }, options);
      memo.set(key, found);
    }
    return found;
  };
}

/** This function gives the parts whose cut can stop a supply: the supply, and each part that it needs through the stack. */
function supplyReach(supply: string, options: Pick<CaseOptions, "stack">): Set<string> {
  const reach = options.stack === undefined ? new Set<string>() : neededParts(options.stack, supply);
  reach.add(supply);
  return reach;
}

function stopCurvesWith(caseCuts: CaseCuts, draw: Draw, options: StopCurveOptions, stoppedOf: StoppedOf): StopCurves | undefined {
  const reach = supplyReach(draw.supply, options);
  const relevant = caseCuts.cuts.flatMap((cut, index) => (reach.has(cut.part) ? [index] : []));
  const stops = (cuts: readonly number[]): boolean => stoppedOf(cuts.map((index) => relevant[index] ?? -1)).has(draw.supply);
  if (stops([])) return undefined;
  if (!stops(relevant.map((_, index) => index))) return undefined;
  const given = relevant.map((index) => caseCuts.cuts[index]?.duration);
  // With a stack, the needs give the minimal sets. When their search passes its budget, the sets of each list of cuts are the check.
  const parts = relevant.map((index) => caseCuts.cuts[index]?.part ?? "");
  const structural = options.stack === undefined ? undefined : stackStops(options.stack, draw.supply, parts, options.down, budgetsOf(options).maxSets);
  const sets = structural ?? minimalStops(given.length, stops);
  // The stop has no curve when a cut with no curve can be part of it. With no minimal sets, the query cannot tell.
  const unsourced = given.flatMap((curve, index) => (curve === undefined ? [index] : []));
  if (unsourced.length > 0 && (sets === undefined || sets.some((set) => set.some((index) => unsourced.includes(index))))) return undefined;
  // A cut with no curve is in no minimal set here, so it does not change a stop. The curves do not include it.
  const kept = given.flatMap((curve, index) => (curve === undefined ? [] : [index]));
  const curves = kept.map((index) => given[index] ?? []);
  const keptStops = (cuts: readonly number[]): boolean => stops(cuts.map((index) => kept[index] ?? -1));
  const keptSets = sets?.map((set) => set.map((index) => kept.indexOf(index)));
  const upper = upperStop(curves, keptSets);
  const independent = independentStop(curves, keptSets, budgetsOf(options).maxWork);
  // A cut in no minimal set does not change a stop, so its bound does not weaken the bound of the stop.
  const used = sets === undefined ? kept : kept.filter((index) => sets.some((set) => set.includes(index)));
  const bound = weakestBound(used.map((index) => caseCuts.cuts[relevant[index] ?? -1]?.bound ?? "law"));
  return { event: eventStop(curves, keptStops), independent: independent ?? upper, upper, coarse: keptSets === undefined, independentUpper: independent === undefined, bound };
}

/**
 * This function gives the curves of the duration of the stop of a draw, or `undefined` when the query has no curve.
 *
 * - A set of cuts stops the supply when the supply cannot work without the cut parts, through the needs of the stack.
 * - Only the cuts of the supply, and of the parts that it needs through the stack, count. Another cut does not change the curves.
 * - The parts of `down` are down for the full event. When they stop the supply with no cut, the query has no curve.
 * - With a stack, the minimal sets come from the paths of the needs (`stopSets` of the core), so the count of cuts has no limit of `MINIMAL_STOP_CUTS`.
 *   When that search passes its budget (the option `maxSets`), `minimalStops` examines each set of up to `MINIMAL_STOP_CUTS` cuts.
 * - A cut with no `duration` gives no curve when it is in a minimal set, or when the query has no minimal sets.
 * - `event` is `eventStop`. `independent` is `independentStop`, and `upper` is `upperStop`, over the minimal sets of the cuts that count.
 * - With no minimal sets, `upper` is the sum of the curves, `independent` is `upper`, and `coarse` is true.
 * - When the expansion of `independentStop` passes its budget, `independent` is `upper`, and `independentUpper` is true.
 * - `bound` is the weakest bound of the curves of the cuts that the stop uses. A cut with no `bound` has a law.
 */
export function stopCurves(caseCuts: CaseCuts, draw: Draw, options: StopCurveOptions = {}): StopCurves | undefined {
  budgetsOf(options);
  return stopCurvesWith(caseCuts, draw, options, stoppedMemo(caseCuts, options));
}

/** The shortfall of each level, in user-days, and the draws that the query cannot read. */
export interface Shortfall {
  /**
   * The user-days of each level of the layer, when one event makes each cut longer together. The query does not add two levels.
   * This value is not a limit. The true value can be more or less. `upper` is the limit.
   */
  readonly levels: Readonly<Record<string, number>>;
  /** The user-days of each level when the cuts are independent (`StopCurves.independent`). This value is not more than `upper`. */
  readonly independent: Readonly<Record<string, number>>;
  /** The upper limit of the user-days of each level, for each dependence of the cuts. A gate of a high level can use it. */
  readonly upper: Readonly<Record<string, number>>;
  /**
   * The needs of the draws whose stop has no curve (`stopCurves`).
   * The query has no curve of their duration, so their shortfall is not in `levels`. A gate shows them as no read.
   */
  readonly unread: readonly string[];
  /** The needs of the draws whose `upper` is coarse (`StopCurves.coarse`). A gate on `upper` shows them. */
  readonly coarse: readonly string[];
  /** The needs of the draws whose `independent` is `upper` (`StopCurves.independentUpper`). A gate on `independent` shows them. */
  readonly independentUpper: readonly string[];
  /**
   * The bound of the shortfall: the weakest bound (`weakestBound` of the core) of the curves that the query uses. Since 0.8.4.
   * The shortfall does not decrease when a cut lasts longer. So with `upper`, each value is too high or equal, and with `lower` too low or equal.
   * With `none`, a value can be too high or too low.
   *
   * A draw in `unread` and a case that adds 0 do not change the bound. With no curve, the bound is `law`.
   * The bound is for each of `levels`, `independent` and `upper`, each with its own rule of the dependence of the cuts.
   */
  readonly bound: CutBound;
}

function zeroLevels(layer: EnduranceLayer): Record<string, number> {
  return Object.fromEntries(layer.levels.map((level) => [level, 0]));
}

/**
 * This function gives the shortfall of one event of a case: for each draw, `E[max(0, min(D, h) - T)] * users`.
 * `T` is the endurance of the draw, `D` is the duration of the stop of its supply (`stopCurves`), and `h` is the horizon.
 *
 * @param layer - The endurance layer
 * @param caseCuts - The case
 * @param endurance - The endurance of the case, from `enduranceOf`
 * @param options - The stack or the parts that are also down, as for `enduranceOf`, and the horizon
 * @throws RangeError when the horizon is not a number more than 0, or `maxSets` is not a whole number from 1
 */
export function caseShortfall(layer: EnduranceLayer, caseCuts: CaseCuts, endurance: Endurance, options: ShortfallOptions = {}): Shortfall {
  const horizon = horizonOf(options);
  budgetsOf(options);
  const levels = zeroLevels(layer);
  const independent = zeroLevels(layer);
  const upper = zeroLevels(layer);
  const unread: string[] = [];
  const coarse: string[] = [];
  const independentUpper: string[] = [];
  const bounds: CutBound[] = [];
  const stoppedOf = stoppedMemo(caseCuts, options);
  for (const draw of caseDraws(layer, caseCuts, caseStopped(caseCuts, options))) {
    const held = endurance.needs[draw.need];
    const curves = stopCurvesWith(caseCuts, draw, options, stoppedOf);
    if (held === undefined || curves === undefined) {
      unread.push(draw.need);
      continue;
    }
    if (curves.coarse) coarse.push(draw.need);
    if (curves.independentUpper) independentUpper.push(draw.need);
    bounds.push(curves.bound);
    const users = draw.users ?? 1;
    levels[draw.level] = (levels[draw.level] ?? 0) + tailDays(curves.event, held.days, horizon) * users;
    independent[draw.level] = (independent[draw.level] ?? 0) + tailDays(curves.independent, held.days, horizon) * users;
    upper[draw.level] = (upper[draw.level] ?? 0) + tailDays(curves.upper, held.days, horizon) * users;
  }
  return { levels, independent, upper, unread, coarse, independentUpper, bound: weakestBound(bounds) };
}

/**
 * The share of the stores in a case. `take` is the take order of `enduranceOf`. `best` is the leximin share of
 * `bestEndurance`, level by level.
 */
export type Share = "take" | "best";

/** The shares, with the default first. */
export const SHARES: readonly Share[] = ["take", "best"];

/** The options of `yearShortfall`: the date, the stack or the parts that are also down, the horizon and the share. */
export interface YearShortfallOptions extends CaseOptions, ShortfallOptions {
  /**
   * The share of the stores in each case. The default `take` gives the endurance from `enduranceOf`. With `best`,
   * the endurance comes from `bestEndurance`, and the horizon of the shortfall is the horizon of the share. Thus a
   * draw at the horizon keeps back only the horizon times its demand, and the lower levels get the rest.
   */
  readonly share?: Share | undefined;
}

/** The shortfall of one year at one place, with the part of each case. */
export interface YearShortfall extends Shortfall {
  readonly place: string;
  /** The part of each case. `rate` is the expected count of its events in one year. */
  readonly cases: readonly { readonly case: string; readonly rate: number; readonly endurance: Endurance; readonly shortfall: Shortfall }[];
}

/**
 * This function gives the shortfall of one year at one place.
 * It is the sum over the cases of the layer of the expected count of the events of each case times its shortfall.
 *
 * - The expected count of a case is `perYear * reach`, from the first prior of the case at the place. Thus the result is the expected user-days of one year.
 * - A case with no prior at the place is not in the sum.
 * - `unread` is the union of the needs that a case cannot read, in the order of the cases. `coarse` and `independentUpper` are unions too.
 * - `bound` is the weakest bound of the cases in the sum. A case with no prior, or with an expected count of 0, adds 0, so it does not change the bound.
 *
 * @param layer - The endurance layer, with its cases and priors
 * @param place - The place of the priors
 * - With `share: "best"`, the endurance of each case comes from `bestEndurance` with the horizon of the shortfall.
 *
 * @param options - The date, the stack or the parts that are also down, the horizon and the share
 * @throws RangeError for a bad date, horizon, `maxSets` or share: refer to `caseShortfall` and `enduranceOf`
 */
export function yearShortfall(layer: EnduranceLayer, place: string, options: YearShortfallOptions): YearShortfall {
  horizonOf(options);
  budgetsOf(options);
  const share = options.share ?? "take";
  if (!SHARES.includes(share)) throw new RangeError(`The share ${String(options.share)} is not ${SHARES.join(" or ")}.`);
  const levels = zeroLevels(layer);
  const independent = zeroLevels(layer);
  const upper = zeroLevels(layer);
  const unread: string[] = [];
  const coarse: string[] = [];
  const independentUpper: string[] = [];
  const cases: YearShortfall["cases"][number][] = [];
  const bounds: CutBound[] = [];
  for (const caseCuts of layer.cases ?? []) {
    const prior = (layer.priors ?? []).find((item) => item.case === caseCuts.case && item.place === place);
    if (prior === undefined) continue;
    const rate = yearRate(prior);
    const endurance = share === "best" ? bestEndurance(layer, caseCuts, options) : enduranceOf(layer, caseCuts, options);
    const shortfall = caseShortfall(layer, caseCuts, endurance, options);
    for (const [level, days] of Object.entries(shortfall.levels)) levels[level] = (levels[level] ?? 0) + rate * days;
    for (const [level, days] of Object.entries(shortfall.independent)) independent[level] = (independent[level] ?? 0) + rate * days;
    for (const [level, days] of Object.entries(shortfall.upper)) upper[level] = (upper[level] ?? 0) + rate * days;
    for (const need of shortfall.unread) if (!unread.includes(need)) unread.push(need);
    for (const need of shortfall.coarse) if (!coarse.includes(need)) coarse.push(need);
    for (const need of shortfall.independentUpper) if (!independentUpper.includes(need)) independentUpper.push(need);
    if (rate > 0) bounds.push(shortfall.bound);
    cases.push({ case: caseCuts.case, rate, endurance, shortfall });
  }
  return { place, levels, independent, upper, unread, coarse, independentUpper, bound: weakestBound(bounds), cases };
}
