import { neededParts } from "@mark1russell7/system-stack";
import { caseDraws, caseStopped, enduranceOf, type CaseOptions } from "./endurance.ts";
import type { CaseCuts, Draw, Endurance, EnduranceLayer, Prior, Survival } from "./layer.ts";

// The shortfall: the user-days in which a draw does not get its need, for one case and for one year.

/** This function gives the chance that a cut lasts more than `days`, linear between the points of the curve. After the last point it is 0. */
export function survivalAt(curve: Survival, days: number): number {
  if (days <= 0) return curve[0]?.[1] ?? 0;
  for (let index = 1; index < curve.length; index += 1) {
    const [t0, p0] = curve[index - 1] ?? [0, 1];
    const [t1, p1] = curve[index] ?? [0, 0];
    if (days < t1) {
      // The chance stays between the chances of the two points, so a rounding does not go below the lower one.
      const chance = p0 + (p1 - p0) * ((days - t0) / (t1 - t0));
      return Math.min(Math.max(p0, p1), Math.max(Math.min(p0, p1), chance));
    }
    if (days === t1) return p1;
  }
  return 0;
}

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
export interface ShortfallOptions extends Pick<CaseOptions, "stack" | "down"> {
  /** The horizon in days, more than 0. The default is no horizon. */
  readonly horizon?: number | undefined;
}

function horizonOf(options: ShortfallOptions): number {
  const horizon = options.horizon ?? Infinity;
  if (!(horizon > 0)) throw new RangeError(`The horizon ${String(options.horizon)} is not a number of days more than 0.`);
  return horizon;
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
 * The largest count of cuts for which `minimalStops` examines each set.
 * `stopCurves` counts only the cuts that can reach the supply. Past this count, its `upper` is coarse.
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
 * @param curves - The curves of the cuts, each one good for `checkEndurance`
 * @param sets - The minimal sets of `minimalStops`. With `undefined`, as for too many cuts, the result is `undefined`. With no sets, it is `[[0, 0]]`
 * @throws RangeError when a curve does not end at a chance of 0
 */
export function independentStop(curves: readonly Survival[], sets: readonly (readonly number[])[] | undefined): Survival | undefined {
  if (sets === undefined) return undefined;
  // With no set, no cuts stop the supply, as for `eventStop` and `upperStop`.
  if (sets.length === 0) return [[0, 0]];
  // Only the cuts of a set change the chance. Their place in `used` is their bit in a state.
  const used = [...new Set(sets.flat())].sort((x, y) => x - y);
  const usedCurves = used.map((index) => curves[index] ?? []);
  const setMasks = sets.map((set) => set.reduce((mask, index) => mask | (1 << used.indexOf(index)), 0));
  const stopping = Array.from({ length: 1 << used.length }, (_, mask) => setMasks.some((set) => (set & mask) === set));
  const states = new Float64Array(1 << used.length);
  const chanceAt = (days: number): number => {
    // The chance of each state of the cuts, one cut at a time. Bit k of a state is 1 when cut k is on.
    states[0] = 1;
    let length = 1;
    for (const curve of usedCurves) {
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
  const times = [...new Set(usedCurves.flatMap((curve) => curve.map(([days]) => days)))].sort((x, y) => x - y);
  const points: number[] = [];
  for (const [index, t1] of times.entries()) {
    const t0 = times[index - 1];
    if (t0 !== undefined) {
      const h = t1 - t0;
      const slopes = usedCurves.map((curve) => Math.abs(survivalAt(curve, t1) - survivalAt(curve, t0)) / h);
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
  return curveFrom(points, chanceAt);
}

/**
 * The curves of the stop of a draw. `event` is for one event that makes each cut longer together, and `independent` is for independent cuts.
 * `upper` is an upper limit for each dependence.
 */
export interface StopCurves {
  readonly event: Survival;
  /** The stop when the cuts are independent (`independentStop`). When `coarse` is true, it is `upper`. */
  readonly independent: Survival;
  readonly upper: Survival;
  /** This is true when `upper` is the sum of the curves of the cuts that can reach the supply, because there are more than `MINIMAL_STOP_CUTS`. */
  readonly coarse: boolean;
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

function stopCurvesWith(caseCuts: CaseCuts, draw: Draw, options: Pick<CaseOptions, "stack" | "down">, stoppedOf: StoppedOf): StopCurves | undefined {
  const reach = supplyReach(draw.supply, options);
  const relevant = caseCuts.cuts.flatMap((cut, index) => (reach.has(cut.part) ? [index] : []));
  const stops = (cuts: readonly number[]): boolean => stoppedOf(cuts.map((index) => relevant[index] ?? -1)).has(draw.supply);
  if (stops([])) return undefined;
  if (!stops(relevant.map((_, index) => index))) return undefined;
  const curves = relevant.map((index) => caseCuts.cuts[index]?.duration ?? []);
  const sets = minimalStops(curves.length, stops);
  const upper = upperStop(curves, sets);
  return { event: eventStop(curves, stops), independent: independentStop(curves, sets) ?? upper, upper, coarse: sets === undefined };
}

/**
 * This function gives the curves of the duration of the stop of a draw, or `undefined` when the query has no curve.
 *
 * - A set of cuts stops the supply when the supply cannot work without the cut parts, through the needs of the stack.
 * - Only the cuts of the supply, and of the parts that it needs through the stack, count. Another cut does not change the curves.
 * - The parts of `down` are down for the full event. When they stop the supply with no cut, the query has no curve.
 * - `event` is `eventStop`. `independent` is `independentStop`, and `upper` is `upperStop`, over the minimal sets of the cuts that count.
 * - Past `MINIMAL_STOP_CUTS` cuts that count, `upper` is the sum of their curves, `independent` is `upper`, and `coarse` is true.
 */
export function stopCurves(caseCuts: CaseCuts, draw: Draw, options: Pick<CaseOptions, "stack" | "down"> = {}): StopCurves | undefined {
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
 * @throws RangeError when the horizon is not a number more than 0
 */
export function caseShortfall(layer: EnduranceLayer, caseCuts: CaseCuts, endurance: Endurance, options: ShortfallOptions = {}): Shortfall {
  const horizon = horizonOf(options);
  const levels = zeroLevels(layer);
  const independent = zeroLevels(layer);
  const upper = zeroLevels(layer);
  const unread: string[] = [];
  const coarse: string[] = [];
  const stoppedOf = stoppedMemo(caseCuts, options);
  for (const draw of caseDraws(layer, caseCuts, caseStopped(caseCuts, options))) {
    const held = endurance.needs[draw.need];
    const curves = stopCurvesWith(caseCuts, draw, options, stoppedOf);
    if (held === undefined || curves === undefined) {
      unread.push(draw.need);
      continue;
    }
    if (curves.coarse) coarse.push(draw.need);
    const users = draw.users ?? 1;
    levels[draw.level] = (levels[draw.level] ?? 0) + tailDays(curves.event, held.days, horizon) * users;
    independent[draw.level] = (independent[draw.level] ?? 0) + tailDays(curves.independent, held.days, horizon) * users;
    upper[draw.level] = (upper[draw.level] ?? 0) + tailDays(curves.upper, held.days, horizon) * users;
  }
  return { levels, independent, upper, unread, coarse };
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
 * - `unread` is the union of the needs that a case cannot read, in the order of the cases. `coarse` is the union of the coarse needs.
 *
 * @param layer - The endurance layer, with its cases and priors
 * @param place - The place of the priors
 * @param options - The date, the stack or the parts that are also down, and the horizon
 * @throws RangeError when the date is not `YYYY-MM-DD`, or when the horizon is not a number more than 0
 */
export function yearShortfall(layer: EnduranceLayer, place: string, options: CaseOptions & ShortfallOptions): YearShortfall {
  horizonOf(options);
  const levels = zeroLevels(layer);
  const independent = zeroLevels(layer);
  const upper = zeroLevels(layer);
  const unread: string[] = [];
  const coarse: string[] = [];
  const cases: YearShortfall["cases"][number][] = [];
  for (const caseCuts of layer.cases ?? []) {
    const prior = (layer.priors ?? []).find((item) => item.case === caseCuts.case && item.place === place);
    if (prior === undefined) continue;
    const rate = yearRate(prior);
    const endurance = enduranceOf(layer, caseCuts, options);
    const shortfall = caseShortfall(layer, caseCuts, endurance, options);
    for (const [level, days] of Object.entries(shortfall.levels)) levels[level] = (levels[level] ?? 0) + rate * days;
    for (const [level, days] of Object.entries(shortfall.independent)) independent[level] = (independent[level] ?? 0) + rate * days;
    for (const [level, days] of Object.entries(shortfall.upper)) upper[level] = (upper[level] ?? 0) + rate * days;
    for (const need of shortfall.unread) if (!unread.includes(need)) unread.push(need);
    for (const need of shortfall.coarse) if (!coarse.includes(need)) coarse.push(need);
    cases.push({ case: caseCuts.case, rate, endurance, shortfall });
  }
  return { place, levels, independent, upper, unread, coarse, cases };
}
