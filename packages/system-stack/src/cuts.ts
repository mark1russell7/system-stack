// The cuts of a case: an event that stops some parts at the same time, and the curve of the duration of each stop.
// The add-ons share these records. One add-on gives the cuts of a case, and another add-on calculates with them.
// The core names no topic: the cases, the parts and the curves are data. The unit of time is the day.

/**
 * The chance that a cut lasts more than a time: a list of points `[days, chance]`, from `[0, 1]` down to a chance of 0.
 * The days increase, and the chance does not increase. Between two points the chance is linear. This is a survival curve.
 */
export type Survival = readonly (readonly [days: number, chance: number])[];

/**
 * The pointwise sampling band of a survival curve: a low curve and a high curve. Since 0.1.14.
 * At each day, the chance of `low` is at or below the chance of the estimate, and the chance of `high` is at or above it.
 * Thus `low` gives shorter cuts and `high` gives longer cuts. The band holds each day only pointwise, not all days together.
 */
export interface DurationBand {
  readonly low: Survival;
  readonly high: Survival;
}

/**
 * What the curve of a cut tells about the true days of the cut. Since 0.1.12.
 *
 * - `law`: the curve is a cited law of the days.
 * - `upper`: at each day, the chance of the curve is at or above the true chance. So a shortfall from the curve is too high or equal.
 * - `lower`: at each day, the chance of the curve is at or below the true chance. So a shortfall from the curve is too low or equal.
 * - `none`: the curve is not a bound of the days. A shortfall from it can be too high or too low.
 */
export type CutBound = "law" | "upper" | "lower" | "none";

/** Each value of `CutBound`, from the strongest claim to the weakest claim. Since 0.1.12. */
export const CUT_BOUNDS: readonly ["law", "upper", "lower", "none"] = ["law", "upper", "lower", "none"];

/** This function tells if a value is a `CutBound`. Since 0.1.12. */
export function isCutBound(value: unknown): value is CutBound {
  return (CUT_BOUNDS as readonly unknown[]).includes(value);
}

/**
 * This function gives the bound of the curve of a cut. A cut with no `bound` has a cited law, as before 0.1.12. Since 0.1.12.
 *
 * @returns The bound, or `undefined` when the cut has no curve. A cut with no curve has no bound to read.
 */
export function cutBound(cut: Cut): CutBound | undefined {
  return cut.duration === undefined ? undefined : (cut.bound ?? "law");
}

/**
 * This function gives the weakest bound of some curves, for a result that does not decrease when a cut lasts longer. Since 0.1.12.
 *
 * - With no bound, or only `law`, the result is `law`.
 * - `law` with `upper` gives `upper`, and `law` with `lower` gives `lower`.
 * - Any `none`, or `upper` with `lower`, gives `none`.
 */
export function weakestBound(bounds: Iterable<CutBound>): CutBound {
  let upper = false;
  let lower = false;
  for (const bound of bounds) {
    if (bound === "none") return "none";
    if (bound === "upper") upper = true;
    if (bound === "lower") lower = true;
  }
  if (upper && lower) return "none";
  return upper ? "upper" : lower ? "lower" : "law";
}

/** The side of a term of a dependent cut. `upper` can only make the cut longer, and `lower` can only make it shorter. Since 0.1.13. */
export type FollowSide = "upper" | "lower";

/** A term of a dependent cut: the onset or the recovery. Since 0.1.13. */
export interface FollowTerm {
  /** The days of the term in the curve. */
  readonly days: number;
  /** `true` when a cited span gives the term. */
  readonly cited: boolean;
  readonly side: FollowSide;
  /** The term in plain words, for example "onset not cited: 0, an upper bound". */
  readonly says: string;
}

/**
 * The terms of a dependent cut: a cut that starts after its cause cut starts and ends after the cause ends. Since 0.1.13.
 * The curve of the dependent cut is the curve of the cause, shifted by the recovery minus the onset.
 */
export interface CutFollows {
  /** The `part` of the cause cut, in the same case. */
  readonly part: string;
  /** The days from the start of the cause to the start of the cut. */
  readonly onset: FollowTerm;
  /** The days from the end of the cause to the end of the cut. */
  readonly recovery: FollowTerm;
  /**
   * `upper` when each term is an upper bound and the cause is a law or an upper bound. Then the curve is an upper bound of the days of the cut, for the cited spans.
   * `none` in each other case. Then the curve is not a bound of the days of the cut.
   */
  readonly bound: "upper" | "none";
}

/** A cut of a case: a part that the case stops, and the curve of the duration of the stop. */
export interface Cut {
  /** The `id` of the part of the stack. */
  readonly part: string;
  /** The printed name of the cut, for example "Power outage". */
  readonly title: string;
  /**
   * The survival curve of the duration of the cut. A cut can have no curve, as before a source gives one.
   * Then each draw whose stop the cut can be part of is no read in the shortfall (`stopCurves`), not a pass.
   */
  readonly duration?: Survival | undefined;
  /**
   * What the curve tells about the true days of the cut (`CutBound`). Since 0.1.12.
   * A cut with a curve and no bound has a cited law, so an old record keeps its meaning. A cut with no curve has no bound to read.
   */
  readonly bound?: CutBound | undefined;
  /**
   * The pointwise sampling band of `duration` (`DurationBand`), when the law of the curve gives one. Since 0.1.14.
   * The shortfall reads only `duration`. A cut with a band and no curve is a fault (`bandFault`).
   */
  readonly band?: DurationBand | undefined;
  /** The source of the curve, or of the cut when it has no curve. */
  readonly source: string;
  /** The terms of a dependent cut, when its curve comes from the curve of a cause cut (`CutFollows`). The shortfall does not read them. Since 0.1.13. */
  readonly follows?: CutFollows | undefined;
}

/** A case: an event that cuts some parts at the same time, and the change that it makes to the draws. */
export interface CaseCuts {
  /** The code of the case. */
  readonly case: string;
  /** The printed name of the case, for example "Winter storm". */
  readonly title: string;
  readonly cuts: readonly Cut[];
  /** A factor on the amount of a need for each day, by the code of the need. Example: 1.5 for water in a heat wave. The default is 1. */
  readonly factors?: Readonly<Record<string, number>> | undefined;
  /** The usual time from the warning to the start, in seconds. A case with no warning has no lead time. */
  readonly leadSeconds?: number | undefined;
}

/** The yearly prior of one case at one place: the events in one year in an area, and the share of them that reach the place. */
export interface Prior {
  readonly case: string;
  readonly place: string;
  /** The events in one year in the area (`lambda`), 0 or more. */
  readonly perYear: number;
  /** The share of the events of the area that reach the place (`q`), from 0 to 1. */
  readonly reach: number;
  readonly source: string;
  /** The date of the data of the source, as an ISO date. */
  readonly asOf: string;
}

/** This function gives the first fault of a survival curve, or `undefined`. */
export function curveFault(curve: Survival): string | undefined {
  const first = curve[0];
  if (first === undefined || first[0] !== 0 || first[1] !== 1) return "The curve does not start at [0, 1].";
  for (let index = 1; index < curve.length; index += 1) {
    const [t0, p0] = curve[index - 1] ?? [0, 1];
    const [t1, p1] = curve[index] ?? [0, 0];
    if (!(Number.isFinite(t1) && t1 > t0)) return `The days of the point ${String(index)} are not more than the days of the point before it.`;
    if (!(p1 >= 0 && p1 <= p0)) return `The chance of the point ${String(index)} is not from 0 to the chance of the point before it.`;
  }
  if (curve[curve.length - 1]?.[1] !== 0) return "The curve does not end at a chance of 0.";
  return undefined;
}

/**
 * This function gives the first fault of the band of a survival curve, or `undefined`. Since 0.1.14.
 * Each end must be a curve with no fault (`curveFault`). At each day of a point of the three curves, low <= estimate <= high.
 * The comparison has a tolerance of `1e-12`, so that a float error does not give a fault.
 */
export function bandFault(curve: Survival, band: DurationBand): string | undefined {
  for (const end of ["low", "high"] as const) {
    const fault = curveFault(band[end]);
    if (fault !== undefined) return `The ${end} end: ${fault}`;
  }
  const days = [...new Set([curve, band.low, band.high].flatMap((points) => points.map(([day]) => day)))].sort((a, b) => a - b);
  for (const day of days) {
    const chance = survivalAt(curve, day);
    if (survivalAt(band.low, day) - chance > 1e-12) return `At ${String(day)} days, the low end is above the curve.`;
    if (chance - survivalAt(band.high, day) > 1e-12) return `At ${String(day)} days, the high end is below the curve.`;
  }
  return undefined;
}

/** This function gives the chance that a cut lasts more than `days`, linear between the points of the curve. After the last point it is 0. Since 0.1.13. */
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
