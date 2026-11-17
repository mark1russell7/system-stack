import { dayNumber, stopped, type Stack } from "@mark1russell7/system-stack";
import type { SpendOptions } from "./check.ts";
import { END_DAYS, type SpendLayer } from "./layer.ts";
import { firstServices } from "./states.ts";

// The ends of the plans of a layer, as queries. The gate `checkSpend` gives the faults of an end, and these
// functions give the dates and the parts of the stack that stop.

/** The end of the plan of one service, from the date of a check. */
export interface PlanEndState {
  /** The `id` of the part of the service. */
  readonly part: string;
  /** The last day of the plan, as `YYYY-MM-DD`. */
  readonly date: string;
  /** The count of days from the date of the check to the last day. A plan that ended gives a count below 0. */
  readonly days: number;
  /** This field tells if the provider stops the service after the date: the record gives no plan after the end. */
  readonly stops: boolean;
}

/**
 * This function gives the end of the plan of each service that has one, with the nearest date first.
 *
 * - Two ends on one date are in the sequence of the records. The first record of a part is used.
 * - A record whose date is not a date is not in the result. The gate gives the fault `end-date` for it.
 *
 * The function is pure. It has no clock: the caller gives the date.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`
 */
export function planEnds(layer: SpendLayer, options: SpendOptions): PlanEndState[] {
  const today = dayNumber(options.today);
  if (today === undefined) throw new RangeError(`The date "${options.today}" is not a date of the form YYYY-MM-DD.`);
  const ends: PlanEndState[] = [];
  for (const service of firstServices(layer)) {
    if (service.ends === undefined) continue;
    const end = dayNumber(service.ends.date);
    if (end === undefined) continue;
    ends.push({ part: service.part, date: service.ends.date, days: end - today, stops: service.ends.next === undefined });
  }
  // The sort of an array is stable, so two ends on one date keep the sequence of the records.
  return ends.sort((first, second) => first.days - second.days);
}

/** The options of `endStops`. */
export interface EndOptions extends SpendOptions {
  /**
   * The largest count of days from `today` to the last day of a plan, for a plan to be in the result.
   * The default is the `endDays` of the layer, or `END_DAYS`. Thus the default result agrees with the fault `end-soon` of the gate.
   */
  readonly days?: number | undefined;
}

/** The parts of a stack that stop at the ends of the plans of a layer. */
export interface EndStops {
  /** The `id` of the part of each service that its provider stops, with the nearest date first. */
  readonly ended: readonly string[];
  /** The `id` of each part of the stack that stops when the parts of `ended` do not work, in the order of the parts. */
  readonly stopped: readonly string[];
}

/**
 * This function gives the parts of a stack that stop when the plans that end in `days` days, or fewer, come to their end.
 *
 * - A plan that ended before `today` is in the result too.
 * - A service with a plan after the end does not stop: its cost changes.
 * - `stopped` comes from the needs of the stack: `stopped` of the core, with the parts of `ended` down.
 *
 * For the parts that stop with one service, use `stopped` of the core with the `id` of its part.
 * The function is pure.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`
 */
export function endStops(layer: SpendLayer, stack: Stack, options: EndOptions): EndStops {
  const days = options.days ?? layer.endDays ?? END_DAYS;
  const ended = planEnds(layer, options)
    .filter((end) => end.stops && end.days <= days)
    .map((end) => end.part);
  return { ended, stopped: stopped(stack, ended) };
}
