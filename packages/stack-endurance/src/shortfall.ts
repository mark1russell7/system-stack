import { caseDraws, caseStopped, enduranceOf, type CaseOptions } from "./endurance.ts";
import type { CaseCuts, Draw, Endurance, EnduranceLayer, Prior, Survival } from "./layer.ts";

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

/** This function gives the expected count of the events of a case at its place in one year: `perYear * reach`. */
export function yearRate(prior: Prior): number {
  return prior.perYear * prior.reach;
}

/**
 * This function gives the curve of the longest of some stops: at each time, the largest chance of the curves.
 * The stops of one case come from one event, so the longest stop ends last. The result is a survival curve.
 *
 * @param curves - The curves, each one good for `checkEndurance`
 * @throws RangeError when there is no curve
 */
export function longestStop(curves: readonly Survival[]): Survival {
  const first = curves[0];
  if (first === undefined) throw new RangeError("longestStop needs one or more curves.");
  if (curves.length === 1) return first;
  const times = [...new Set(curves.flatMap((curve) => curve.map(([days]) => days)))].sort((x, y) => x - y);
  const points = new Set(times);
  // Two lines can cross between two times. Each crossing is a point of the result.
  for (let index = 1; index < times.length; index += 1) {
    const t0 = times[index - 1] ?? 0;
    const t1 = times[index] ?? 0;
    for (const [i, a] of curves.entries()) {
      for (const b of curves.slice(i + 1)) {
        const d0 = survivalAt(a, t0) - survivalAt(b, t0);
        const d1 = survivalAt(a, t1) - survivalAt(b, t1);
        if (d0 * d1 < 0) points.add(t0 + ((t1 - t0) * d0) / (d0 - d1));
      }
    }
  }
  const out: [number, number][] = [];
  for (const days of [...points].sort((x, y) => x - y)) {
    // The largest of curves that do not increase does not increase. The limit only removes an error of rounding.
    const chance = Math.min(out[out.length - 1]?.[1] ?? 1, Math.max(...curves.map((curve) => survivalAt(curve, days))));
    // The first point with a chance of 0 ends the curve.
    out.push([days, chance]);
    if (chance === 0) break;
  }
  return out;
}

/**
 * This function gives the curve of the duration of the stop of a draw, or `undefined` when the query has no curve.
 *
 * - A cut stops the supply when it cuts the supply part, or when the supply needs the cut part through the stack.
 * - The stop lasts as long as its longest cut (`longestStop`).
 * - When only the parts of `down` stop the supply, or when no cut stops it, the query has no curve.
 */
export function stopCurve(caseCuts: CaseCuts, draw: Draw, options: Pick<CaseOptions, "stack" | "down"> = {}): Survival | undefined {
  if ((options.down ?? []).length > 0 && caseStopped({ ...caseCuts, cuts: [] }, options).has(draw.supply)) return undefined;
  const alone = options.stack === undefined ? {} : { stack: options.stack };
  const causes = caseCuts.cuts.filter((cut) => caseStopped({ ...caseCuts, cuts: [cut] }, alone).has(draw.supply));
  return causes.length === 0 ? undefined : longestStop(causes.map((cut) => cut.duration));
}

/** The shortfall of each level, in user-days, and the draws that the query cannot read. */
export interface Shortfall {
  /** The user-days of each level of the layer. The query adds the draws of one level. It does not add two levels. */
  readonly levels: Readonly<Record<string, number>>;
  /**
   * The needs of the draws whose stop has no curve (`stopCurve`).
   * The query has no curve of their duration, so their shortfall is not in `levels`. A gate shows them as no read.
   */
  readonly unread: readonly string[];
}

function zeroLevels(layer: EnduranceLayer): Record<string, number> {
  return Object.fromEntries(layer.levels.map((level) => [level, 0]));
}

/**
 * This function gives the shortfall of one event of a case: for each draw, `E[max(0, min(D, h) - T)] * users`.
 * `T` is the endurance of the draw, `D` is the duration of the stop of its supply (`stopCurve`), and `h` is the horizon.
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
    const curve = stopCurve(caseCuts, draw, options);
    if (held === undefined || curve === undefined) {
      unread.push(draw.need);
      continue;
    }
    levels[draw.level] = (levels[draw.level] ?? 0) + tailDays(curve, held.days, horizon) * (draw.users ?? 1);
  }
  return { levels, unread };
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
    const rate = yearRate(prior);
    const endurance = enduranceOf(layer, caseCuts, options);
    const shortfall = caseShortfall(layer, caseCuts, endurance, options);
    for (const [level, days] of Object.entries(shortfall.levels)) levels[level] = (levels[level] ?? 0) + rate * days;
    for (const need of shortfall.unread) if (!unread.includes(need)) unread.push(need);
    cases.push({ case: caseCuts.case, rate, endurance, shortfall });
  }
  return { place, levels, unread, cases };
}
