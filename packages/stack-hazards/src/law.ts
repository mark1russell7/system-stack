import { kaplanMeier, survivalAt, survivalBand, survivalQuantile, type SurvivalCurve } from "@mark1russell7/rigor-statistics";
import type { DurationBand, Survival } from "@mark1russell7/system-stack";
import type { OutageEvent } from "./outages.ts";

// The curves of a law of a duration from events: the Kaplan-Meier estimate of rigor-statistics, read at fixed days, in the form of the core.

/**
 * The days at which a law reads a curve, from 15 minutes to 90 days. Each day under 1 is a count of minutes over 1440.
 * Thus it is equal to a count of seconds over 86400 for the same time.
 */
export const LAW_DAYS: readonly number[] = [
  ...[15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1080].map((minutes) => minutes / 1440),
  ...[1, 1.5, 2, 3, 4, 5, 7, 10, 14, 21, 30, 45, 60, 90],
];

/** The options of the form of a curve. */
export interface SurvivalOptions {
  /** The days at which the curve is read. They are more than 0 and they increase. The default is `LAW_DAYS`. */
  readonly days?: readonly number[] | undefined;
  /** The day at which an open tail gets to 0. It is more than the largest observed time. The default is two times that time. */
  readonly end?: number | undefined;
}

/**
 * This function gives a survival curve of the core from a Kaplan-Meier curve in days.
 * It reads the chance at each day of `days`, up to the largest observed time. Between two days, the chance of the core is linear.
 * An open tail is a curve that does not get to 0, because of a censored time at the end. Its last chance falls linearly to 0 at `end`.
 */
export function survivalOf(curve: SurvivalCurve, options: SurvivalOptions = {}): Survival {
  return curvePoints("survivalOf", curve, (time) => survivalAt(curve, time), options);
}

/**
 * This function gives the pointwise sampling band of a Kaplan-Meier curve in days, as a `DurationBand` of the core.
 * Each end is the end of `survivalBand` of rigor-statistics at each day of `days`, with the steps of `survivalOf`.
 * The two curves read the same days and close at the same end. Thus at each day, low <= estimate <= high.
 * The band holds each day only pointwise, not all days together.
 *
 * @param curve - The Kaplan-Meier curve, in days
 * @param options - The form of each curve, as for `survivalOf`
 * @param z - The normal quantile of the level. The default of `survivalBand` gives a 95% band
 */
export function bandOf(curve: SurvivalCurve, options: SurvivalOptions = {}, z?: number): DurationBand {
  return {
    low: curvePoints("bandOf", curve, (time) => survivalBand(curve, time, z)?.low, options),
    high: curvePoints("bandOf", curve, (time) => survivalBand(curve, time, z)?.high, options),
  };
}

/** This function gives the points of a curve of the core from the chance `read` of a Kaplan-Meier curve at each day. */
function curvePoints(name: string, curve: SurvivalCurve, read: (time: number) => number | undefined, options: SurvivalOptions): Survival {
  const days = options.days ?? LAW_DAYS;
  if (curve.steps[0]?.time === 0) throw new RangeError(`${name}: the curve has a step at 0 days.`);
  const points: [number, number][] = [[0, 1]];
  let previous = 0;
  for (const day of days) {
    if (!(Number.isFinite(day) && day > previous)) throw new RangeError(`${name}: the days are not more than 0, or they do not increase.`);
    previous = day;
    if (day > curve.last) break;
    const chance = read(day) ?? 0;
    points.push([day, chance]);
    if (chance === 0) return points;
  }
  const lastDay = points[points.length - 1]?.[0] ?? 0;
  const open = read(curve.last) ?? 0;
  if (open === 0) {
    const zero = curve.steps.find((step) => step.chance === 0)?.time ?? curve.last;
    points.push([zero, 0]);
    return points;
  }
  if (curve.last > lastDay) points.push([curve.last, open]);
  const end = options.end ?? 2 * curve.last;
  if (!(Number.isFinite(end) && end > curve.last)) throw new RangeError(`${name}: the end is not more than the largest observed time.`);
  points.push([end, 0]);
  return points;
}

/** The curve of the durations of one region, with its counts. */
export interface RegionCurve {
  /** The survival curve of the duration, in days. */
  readonly curve: Survival;
  /** The count of the events of the region. */
  readonly count: number;
  /** The count of the censored events. */
  readonly censored: number;
  /** The chance at the largest observed time. The curve closes it to 0 at its end. It is 0 when the curve gets to 0. */
  readonly open: number;
  /** The median duration in days, or `undefined` when the curve does not get to a chance of 0.5. */
  readonly median: number | undefined;
  /** The pointwise 95% sampling band of `curve` (`bandOf`). */
  readonly band: DurationBand;
}

/**
 * This function gives the curve of the durations of the events of each region. The keys are the codes of the regions, in their order.
 *
 * @param events - The events, for example of `outageReader`
 * @param region - The region of an area, for example `eagleRegion`
 * @param options - The form of each curve
 * @returns The curve of each region with one event or more
 */
export function outageCurves(events: readonly OutageEvent[], region: (area: string) => string, options: SurvivalOptions = {}): Readonly<Record<string, RegionCurve>> {
  const byRegion = new Map<string, { time: number; censored: boolean }[]>();
  for (const event of events) {
    const code = region(event.area);
    const list = byRegion.get(code) ?? [];
    list.push({ time: event.seconds / 86_400, censored: event.censored });
    byRegion.set(code, list);
  }
  const curves: Record<string, RegionCurve> = {};
  for (const code of [...byRegion.keys()].sort()) {
    const estimate = kaplanMeier(byRegion.get(code) ?? []);
    curves[code] = {
      curve: survivalOf(estimate, options),
      band: bandOf(estimate, options),
      count: estimate.count,
      censored: estimate.censored,
      open: survivalAt(estimate, estimate.last) ?? 0,
      median: survivalQuantile(estimate, 0.5),
    };
  }
  return curves;
}
