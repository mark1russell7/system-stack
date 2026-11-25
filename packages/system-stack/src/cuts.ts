// The cuts of a case: an event that stops some parts at the same time, and the curve of the duration of each stop.
// The add-ons share these records. One add-on gives the cuts of a case, and another add-on calculates with them.
// The core names no topic: the cases, the parts and the curves are data. The unit of time is the day.

/**
 * The chance that a cut lasts more than a time: a list of points `[days, chance]`, from `[0, 1]` down to a chance of 0.
 * The days increase, and the chance does not increase. Between two points the chance is linear. This is a survival curve.
 */
export type Survival = readonly (readonly [days: number, chance: number])[];

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
  /** The source of the curve, or of the cut when it has no curve. */
  readonly source: string;
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
