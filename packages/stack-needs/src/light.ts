import { addDays, firstInstantOf, inWindow, nextBoundary, windowProblems, type CivilDate, type TimeWindow } from "@mark1russell7/algebra/clock";
import { sunDay, type LatLon, type SunDay } from "@mark1russell7/geo";
import type { Source } from "@mark1russell7/guidebook";
import { LIGHT_NEED, type DailyNeed } from "./daily.ts";

// The hours of light that a household needs each day: the dark hours of its awake window.
// The sun times come from `@mark1russell7/geo`, and the local time comes from `@mark1russell7/algebra/clock`.
// The point and the awake window are input data of the household. This file names no place.

/** The page "Position of the Sun" of Wikipedia: the formulas of the place of the sun that `sunDay` of `@mark1russell7/geo` uses. */
export const SUN_POSITION_SOURCE: Source = {
  id: "wikipedia-position-of-the-sun",
  title: "Position of the Sun",
  url: "https://en.wikipedia.org/w/index.php?title=Position_of_the_Sun&oldid=1386341289",
  license: "cc-by-sa-4.0",
  checked: "2026-11-24",
  by: "Wikipedia contributors",
  terms: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
};

/** The page "Sunrise equation" of Wikipedia: the hour angle of the sunrise and the sunset that `sunDay` of `@mark1russell7/geo` uses. */
export const SUNRISE_EQUATION_SOURCE: Source = {
  id: "wikipedia-sunrise-equation",
  title: "Sunrise equation",
  url: "https://en.wikipedia.org/w/index.php?title=Sunrise_equation&oldid=1379585755",
  license: "cc-by-sa-4.0",
  checked: "2026-11-24",
  by: "Wikipedia contributors",
  terms: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
};

/** The most days of one calculation of the light hours: three years. */
export const MAX_LIGHT_DAYS = 1096;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The input of `lightHours`. */
export interface LightHoursInput {
  /** The point of the home. It is input data of the household. */
  readonly point: LatLon;
  /** The awake window of the household in its local time, for example 07:00 to 23:00 in its time zone. */
  readonly awake: TimeWindow;
  /** The first date of the plan, `YYYY-MM-DD`, in the local time of the window. */
  readonly from: CivilDate;
  /** The count of the days of the plan, a whole number from 1 to `MAX_LIGHT_DAYS`. */
  readonly days: number;
  /** The altitude of the sun at which the dark starts, in degrees. The default is the sunrise altitude of `@mark1russell7/geo`. */
  readonly altitudeDeg?: number | undefined;
}

/** The hours of one local date: the awake hours, and the awake hours in the dark. */
export interface LightDay {
  readonly date: CivilDate;
  readonly awakeHours: number;
  readonly darkHours: number;
}

/** The result of `lightHours`: each day, and the most and the mean of the dark awake hours. */
export interface LightHours {
  readonly days: readonly LightDay[];
  /** The dark awake hours of the worst day. */
  readonly most: number;
  /** The mean of the dark awake hours of the days. */
  readonly mean: number;
}

/** An interval of instants, with its start in it and its end not in it. */
type Span = readonly [start: number, end: number];

/** This function gives the instant of the start of a local date, or throws a RangeError. */
function startOf(date: CivilDate, zone: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const at = firstInstantOf(Date.UTC(year, month - 1, day), zone);
  if (at === undefined) throw new RangeError(`The date ${date} has no start in the time zone "${zone}".`);
  return at;
}

/** This function gives the awake spans of the window in one local day. */
function awakeSpans(dayStart: number, dayEnd: number, window: TimeWindow): Span[] {
  const spans: Span[] = [];
  let at = dayStart;
  let open = inWindow(at, window);
  while (at < dayEnd) {
    const next = nextBoundary(at, window);
    const end = next === undefined ? dayEnd : Math.min(next.at, dayEnd);
    if (open) spans.push([at, end]);
    if (next === undefined) break;
    at = next.at;
    open = next.opens;
  }
  return spans;
}

/** This function gives the span of light of a sun day. A polar day is light for 24 hours about its solar noon. */
function lightSpan(day: SunDay): Span | undefined {
  if (day.kind === "rise-set") return [day.rise, day.set];
  if (day.kind === "polar-day") return [day.noon - DAY_MS / 2, day.noon + DAY_MS / 2];
  return undefined;
}

/** This function joins spans that touch or overlap, in order. */
function union(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/** This function gives the length of the common part of two lists of spans, in milliseconds. */
function overlap(a: readonly Span[], b: readonly Span[]): number {
  let total = 0;
  for (const [aStart, aEnd] of a) for (const [bStart, bEnd] of b) total += Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  return total;
}

/**
 * This function gives the dark hours of the awake window of a household on each local date of a plan.
 *
 * - A local date is the time from its local midnight to the next local midnight. The hours of a window across midnight go to each date by the clock.
 * - The light is the time from the sunrise to the sunset of `sunDay` of `@mark1russell7/geo`. A polar day is light, and a polar night is dark.
 * - The dark awake hours of a date are its awake hours minus its awake hours in the light.
 *
 * @throws RangeError - The window has a problem, or the date is not a date. Or the count of days is not a whole number from 1 to `MAX_LIGHT_DAYS`.
 */
export function lightHours(input: LightHoursInput): LightHours {
  const problems = windowProblems(input.awake);
  if (problems.length > 0) throw new RangeError(problems.join(" "));
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_LIGHT_DAYS)
    throw new RangeError(`The count of days ${input.days} is not a whole number from 1 to ${MAX_LIGHT_DAYS}.`);
  if (addDays(input.from, 0) !== input.from) throw new RangeError(`The date ${input.from} is not a date YYYY-MM-DD.`);
  const options = input.altitudeDeg === undefined ? {} : { altitudeDeg: input.altitudeDeg };
  const zone = input.awake.zone;
  const days: LightDay[] = [];
  for (let index = 0; index < input.days; index++) {
    const date = addDays(input.from, index) as CivilDate;
    const dayStart = startOf(date, zone);
    const dayEnd = startOf(addDays(date, 1) as CivilDate, zone);
    const awake = awakeSpans(dayStart, dayEnd, input.awake);
    // The sun days of the dates near the local date cover each time zone, from 14 hours west to 14 hours east of the solar time.
    const light: Span[] = [];
    for (let near = -2; near <= 2; near++) {
      const span = lightSpan(sunDay(input.point, addDays(date, near) as CivilDate, options));
      if (span !== undefined) light.push(span);
    }
    const awakeMs = awake.reduce((sum, [start, end]) => sum + end - start, 0);
    const darkMs = awakeMs - overlap(awake, union(light));
    days.push({ date, awakeHours: awakeMs / HOUR_MS, darkHours: Math.max(0, darkMs) / HOUR_MS });
  }
  const most = Math.max(...days.map((day) => day.darkHours));
  const mean = days.reduce((sum, day) => sum + day.darkHours, 0) / days.length;
  return { days, most, mean };
}

/**
 * This function gives the need of light of a household from its light hours: the dark awake hours of its worst day.
 * One light that is on in the dark awake hours is a choice of this model. A household with more lights gives more draws.
 */
export function lightNeed(hours: LightHours): DailyNeed {
  return {
    code: LIGHT_NEED,
    unit: "h",
    users: "household",
    rate: {
      read: true,
      perDay: { value: hours.most, unit: "h/d" },
      sources: [SUN_POSITION_SOURCE, SUNRISE_EQUATION_SOURCE],
      note:
        "The sources give the sunrise and the sunset at the point of the home on each date. " +
        "The awake window of the household is input data. The rate is the dark awake hours of the worst day of the plan. " +
        "One light that is on in those hours is a choice of this model, not of the sources.",
    },
  };
}
