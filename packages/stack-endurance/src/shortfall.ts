import { caseDraws, caseStopped, enduranceOf, type CaseOptions } from "./endurance.ts";
import type { CaseCuts, Endurance, EnduranceLayer, Prior, Survival } from "./layer.ts";

// The shortfall: the user-days in which a draw does not get its need, for one case and for one year.

/** This function gives the chance that a cut lasts more than `days`, linear between the points of the curve. After the last point it is 0. */
export function survivalAt(curve: Survival, days: number): number {
  if (days <= 0) return curve[0]?.[1] ?? 0;
  for (let index = 1; index < curve.length; index += 1) {
    const [t0, p0] = curve[index - 1] ?? [0, 1];
    const [t1, p1] = curve[index] ?? [0, 0];
    if (days <= t1) return p0 + ((p1 - p0) * (days - t0)) / (t1 - t0);
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

/** The shortfall of each level, in user-days, and the draws that the query cannot read. */
export interface Shortfall {
  /** The user-days of each level of the layer. The query adds the draws of one level. It does not add two levels. */
  readonly levels: Readonly<Record<string, number>>;
  /**
   * The needs of the draws whose supply stops through the stack, with no cut on the supply part itself.
   * The query has no curve of their duration, so their shortfall is not in `levels`. A gate shows them as no read.
   */
  readonly unread: readonly string[];
}

function zeroLevels(layer: EnduranceLayer): Record<string, number> {
  return Object.fromEntries(layer.levels.map((level) => [level, 0]));
}

/**
 * This function gives the shortfall of one event of a case: for each draw, `E[max(0, min(D, h) - T)] * users`.
 * `T` is the endurance of the draw, `D` is the duration of the cut of its supply part, and `h` is the horizon.
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
  const unread: string[] = [];
  for (const draw of caseDraws(layer, caseCuts, caseStopped(caseCuts, options))) {
    const held = endurance.needs[draw.need];
    const cut = caseCuts.cuts.find((item) => item.part === draw.supply);
    if (held === undefined || cut === undefined) {
      unread.push(draw.need);
      continue;
    }
    levels[draw.level] = (levels[draw.level] ?? 0) + tailDays(cut.duration, held.days, horizon) * (draw.users ?? 1);
  }
  return { levels, unread };
}

/** The shortfall of one year at one place, with the part of each case. */
export interface YearShortfall extends Shortfall {
  readonly place: string;
  readonly cases: readonly { readonly case: string; readonly chance: number; readonly endurance: Endurance; readonly shortfall: Shortfall }[];
}

/**
 * This function gives the shortfall of one year at one place.
 * It is the sum over the cases of the layer of the year chance of each case times its shortfall.
 *
 * - The year chance of a case is `1 - exp(-perYear * reach)`, from the first prior of the case at the place.
 * - A case with no prior at the place is not in the sum.
 * - `unread` is the union of the needs that a case cannot read, in the order of the cases.
 *
 * @param layer - The endurance layer, with its cases and priors
 * @param place - The place of the priors
 * @param options - The date, the stack or the parts that are also down, and the horizon
 * @throws RangeError when the date is not `YYYY-MM-DD`, or when the horizon is not a number more than 0
 */
export function yearShortfall(layer: EnduranceLayer, place: string, options: CaseOptions & ShortfallOptions): YearShortfall {
  horizonOf(options);
  const levels = zeroLevels(layer);
  const unread: string[] = [];
  const cases: YearShortfall["cases"][number][] = [];
  for (const caseCuts of layer.cases ?? []) {
    const prior = (layer.priors ?? []).find((item) => item.case === caseCuts.case && item.place === place);
    if (prior === undefined) continue;
    const chance = yearChance(prior);
    const endurance = enduranceOf(layer, caseCuts, options);
    const shortfall = caseShortfall(layer, caseCuts, endurance, options);
    for (const [level, days] of Object.entries(shortfall.levels)) levels[level] = (levels[level] ?? 0) + chance * days;
    for (const need of shortfall.unread) if (!unread.includes(need)) unread.push(need);
    cases.push({ case: caseCuts.case, chance, endurance, shortfall });
  }
  return { place, levels, unread, cases };
}
