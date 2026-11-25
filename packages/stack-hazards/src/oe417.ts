import { dispersionTest, kaplanMeier } from "@mark1russell7/rigor-statistics";
import { EAGLEI_NATION_CUSTOMERS } from "./eaglei-state-priors.ts";
import type { DurationLaw, HazardSource, PriorTable } from "./hazard.ts";
import { survivalOf, type SurvivalOptions } from "./law.ts";
import { OE417_ATTACK_EVENTS, OE417_FILES, OE417_YEARS } from "./oe417-events.ts";

// The law of the duration of a physical attack on the grid, from the events of the OE-417 annual summaries of DOE.

/** The annual summary of one year: its id at DOE, its format, its address and the archived copy that was read. */
export interface Oe417File {
  readonly id: number;
  readonly format: string;
  readonly url: string;
  /** The address of the archived copy that was read. The host of DOE did not answer the read. */
  readonly archive: string;
}

/** One event of an annual summary, as the summary prints it. */
export interface Oe417Event {
  /** The year of the summary. */
  readonly year: number;
  /** The local time at which the event began, as `YYYY-MM-DDTHH:MM`, or `null` when the summary gives no time. */
  readonly began: string | null;
  /** The local time of the restoration, as `YYYY-MM-DDTHH:MM`, or `null` when the summary gives no time. */
  readonly restored: string | null;
  readonly area: string;
  /** The type of the event, as the summary prints it. */
  readonly type: string;
  /** The count of the customers, as the summary prints it. */
  readonly customers: string;
  /** The loss of load in megawatts, as the summary prints it. */
  readonly megawatts: string;
}

/** The counts of the events of one annual summary. */
export interface Oe417Year {
  /** The count of the events that the summary prints. A second row of an event is not in this count. */
  readonly rows: number;
  /** The count of the second rows: rows equal to an earlier row of the summary, but with no start. */
  readonly copies: number;
  /** The count of the events whose type `oe417IsAttack` accepts. */
  readonly attacks: number;
  /** The count of the events of an attack with a loss of customers or load: the events of `OE417_ATTACK_EVENTS`. */
  readonly kept: number;
  /** The count of the events whose type matches `OE417_CYBER_TERMS`. */
  readonly cyber: number;
  /** The count of the cyber events with a loss of customers or load. */
  readonly cyberLoss: number;
  /** The count of the events whose type matches `OE417_SPACE_WEATHER_TERMS`. */
  readonly spaceWeather: number;
}

/** The terms of a type of an attack. Two of them are misspelled words that the summaries print. */
export const OE417_ATTACK_TERMS: RegExp = /physical|physcial|vandal|sabota|sabatoge|theft/iu;

/** The terms of a type that is not a proved attack: a suspicion, a threat, a possible attack or a cyber event. "Suspcious" is a misspelled word that a summary prints. */
export const OE417_NOT_ATTACK_TERMS: RegExp = /suspect|suspicious|suspcious|potential|threat|cyber/iu;

/** The terms of a type of a cyber event. */
export const OE417_CYBER_TERMS: RegExp = /cyber/iu;

/** The terms of a type of an event from space weather. */
export const OE417_SPACE_WEATHER_TERMS: RegExp = /geomag|solar|space weather|magnetic/iu;

/** The shortest duration that a law reads, in hours. It is 15 minutes, as for the outages of EAGLE-I. */
export const OE417_LEAST_HOURS = 0.25;

/** The source of the law of a physical attack: the OE-417 annual summaries of 2000 to 2023. */
export const OE417_SOURCE: HazardSource = {
  id: "doe.oe-417",
  title: "Electric Disturbance Events (OE-417) annual summaries, 2000 to 2023",
  url: "https://www.oe.netl.doe.gov/OE417_annual_summary.aspx",
  by: "U.S. Department of Energy, Office of Cybersecurity, Energy Security, and Emergency Response",
  license: "us-public-domain",
  terms: "https://www.copyright.gov/title17/92chap1.html#105",
  checked: "2026-11-24",
  regions: { scheme: "us-nation", codes: ["US"] },
};

/** This function tells if the type of an event is a proved attack: a physical attack, vandalism, sabotage or theft, and not a suspicion. */
export function oe417IsAttack(type: string): boolean {
  return OE417_ATTACK_TERMS.test(type) && !OE417_NOT_ATTACK_TERMS.test(type);
}

/** This function gives the first number of a count of a summary, for example 45000 for "45,000". It gives `NaN` for a text with no number, for example "Unknown". */
export function oe417Count(text: string): number {
  return Number(text.replace(/,/gu, "").match(/\d+(\.\d+)?/u)?.[0] ?? Number.NaN);
}

/**
 * This function gives the duration of an event in hours, from its local times.
 * It gives `undefined` when the event has no time of its start or of its restoration, or when the restoration is not after the start.
 * The times are local times, so an event across a change of the clock can be one hour off.
 */
export function oe417Hours(event: Oe417Event): number | undefined {
  if (event.began === null || event.restored === null) return undefined;
  const hours = (Date.parse(`${event.restored}Z`) - Date.parse(`${event.began}Z`)) / 3_600_000;
  return Number.isFinite(hours) && hours > 0 ? hours : undefined;
}

/**
 * This function gives the law of the time for which the customers of a physical attack on the grid have no power.
 * The law has one survival curve in days for the nation.
 *
 * - It reads only the events with more than 0 customers. A count of megawatts with no customers can be a load or a rating, not a loss of power at a home.
 * - It reads each event with a duration of 15 minutes or more as an end.
 * - An event with a start and no time of the restoration was most likely open when its form was sent. The law reads it as censored at the longest read duration: it lasts at least that long.
 * - Thus the curve has an open tail, which falls to 0 at the `end` of the options. To leave the open events out gives a lower curve, which is not safe for a plan.
 *
 * @param events - The events of the summaries, for example `OE417_ATTACK_EVENTS`
 * @param options - The form of the curve
 */
export function oe417AttackLaw(events: readonly Oe417Event[], options: SurvivalOptions = {}): DurationLaw {
  const homes = oe417LawEvents(events);
  const ends = homes.flatMap((event) => {
    const hours = oe417Hours(event);
    return hours !== undefined ? [hours / 24] : [];
  });
  if (ends.length === 0) throw new RangeError("oe417AttackLaw: no event with customers has a duration of 15 minutes or more.");
  const longest = Math.max(...ends);
  const open = homes.filter((event) => event.began !== null && event.restored === null).length;
  const estimate = kaplanMeier([...ends.map((time) => ({ time })), ...(open > 0 ? [{ time: longest, censored: true, count: open }] : [])]);
  return {
    read: true,
    source: "doe.oe-417",
    fit: {
      family: "kaplan-meier",
      method: `product limit of the events with customers; ${String(open)} events with no time of the restoration are censored at the longest read duration`,
      count: estimate.count,
    },
    scheme: "us-nation",
    curves: { US: survivalOf(estimate, options) },
  };
}

/** The law of the time for which the customers of a physical attack on the grid have no power. It reads the events of the summaries with customers. */
export const OE417_ATTACK_LAW: DurationLaw = oe417AttackLaw(OE417_ATTACK_EVENTS);

/**
 * This function gives the events that the law reads. Each has more than 0 customers. Each has a duration of 15 minutes or more, or no time of the restoration.
 * The prior counts the same events, so the prior and the law tell of one kind of event.
 */
export function oe417LawEvents(events: readonly Oe417Event[]): Oe417Event[] {
  return events.filter((event) => {
    if (!(oe417Count(event.customers) > 0)) return false;
    const hours = oe417Hours(event);
    return (hours !== undefined && hours >= OE417_LEAST_HOURS) || (event.began !== null && event.restored === null);
  });
}

/** The options of `oe417AttackPrior`. */
export interface Oe417PriorOptions {
  /** The first year of the rate. */
  readonly first: number;
  /** The last year of the rate. */
  readonly last: number;
  /** The customers of the nation, for example `EAGLEI_NATION_CUSTOMERS`. */
  readonly customers: number;
  /** A text that the method adds after its facts: the source of the customers and the reason for the years. */
  readonly note?: string | undefined;
}

/** The case of a physical attack on the grid. */
export const OE417_ATTACK_CASE = "infra.power.physical-attack";

/**
 * This function gives the yearly prior of a physical attack on the grid for the nation. The table has the scheme `us-nation` and the one code `US`.
 *
 * - `perYear` is the count of the events of `oe417LawEvents` from the year `first` to the year `last`, over the count of the years.
 * - `reach` is the mean of the customers of those events over the customers of the nation. Thus `perYear * reach` is the expected events at one customer in one year.
 * - A year with no event in the summaries counts as a year with no event.
 * - The method tells only what the function calculates. The option `note` adds the source of the customers and the reason for the years.
 *
 * @throws RangeError when the years are not whole numbers in order, when the customers are not above 0, or when the years have no event
 */
export function oe417AttackPrior(events: readonly Oe417Event[], options: Oe417PriorOptions): PriorTable {
  const { first, last, customers, note } = options;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) throw new RangeError(`oe417AttackPrior: the years ${String(first)} to ${String(last)} are not whole numbers in order.`);
  if (!Number.isFinite(customers) || customers <= 0) throw new RangeError(`oe417AttackPrior: the customers are ${String(customers)}. They are a finite number above 0.`);
  const kept = oe417LawEvents(events).filter((event) => event.year >= first && event.year <= last);
  if (kept.length === 0) throw new RangeError(`oe417AttackPrior: no event with customers is in the years ${String(first)} to ${String(last)}.`);
  const years = last - first + 1;
  const reach = kept.reduce((sum, event) => sum + oe417Count(event.customers), 0) / kept.length / customers;
  return {
    source: OE417_SOURCE.id,
    asOf: `${String(last)}-12-31`,
    scheme: "us-nation",
    method:
      `perYear is the count of the events of a physical attack, vandalism, sabotage or theft with customers in the OE-417 annual summaries of ${String(first)} to ${String(last)}, over ${String(years)} years: ${String(kept.length)} events. ` +
      "An event is in the count when the law of its duration reads it: more than 0 customers, and a duration of 15 minutes or more or no time of the restoration. " +
      `reach is the mean of the customers of an event over ${String(customers)} customers of the nation. ` +
      "An event with no count of customers is not in the count, and that makes the rate too low." +
      (note === undefined ? "" : ` ${note}`),
    codes: ["US"],
    rates: { [OE417_ATTACK_CASE]: { US: [kept.length / years, reach] } },
  };
}

/** The options of `oe417PriorWindow`. */
export interface Oe417WindowOptions {
  /** The first year of the counts, a whole number. */
  readonly first: number;
  /** The last year of the counts and of each window, a whole number of `first` or more. */
  readonly last: number;
  /** The level of the test. The default is 0.05. */
  readonly level?: number | undefined;
  /** The count of the seeded draws of each test. The default is `OE417_WINDOW_DRAWS`. */
  readonly draws?: number | undefined;
  /** The seed of the draws. The default is `OE417_WINDOW_SEED`. */
  readonly seed?: number | string | undefined;
  /**
   * The method of the p value of each window, as in `dispersionTest`. The default is `auto`.
   * `auto` gives the exact p when the partitions of the total are few enough, and else seeded draws. `draws` always uses the draws. Since 0.7.5.
   */
  readonly method?: "draws" | "exact" | "auto" | undefined;
}

/** The window of a prior, with the test of each window. */
export interface Oe417Window {
  /** The first year of the window: the year after the last window that fails the test, or `first` when no window fails. */
  readonly first: number;
  /** The yearly counts of the events of the law, from `first` to `last` of the options. */
  readonly counts: readonly number[];
  /**
   * The p value of each window to `last`, by its first year. A window with fewer than 2 years or no event has p 1.
   * The field `exact` is true when the p value is exact: no draws were used (since 0.7.5).
   */
  readonly tests: readonly { readonly first: number; readonly p: number; readonly exact: boolean }[];
}

/**
 * The count of the draws of each test of `oe417PriorWindow` with the method `draws`. The method `auto` uses them when the exact sum is too large. With 10000 draws, the p value of the window from 2014 is
 * 2.6 standard errors from 0.05. With 100000 draws, it is more than 6 standard errors from 0.05.
 */
export const OE417_WINDOW_DRAWS = 100_000;

/** The seed of the draws of `oe417PriorWindow`. */
export const OE417_WINDOW_SEED = "oe417-attack-window";

/**
 * This function gives the first year of a prior: the longest window to the last year that passes the test.
 * Each shorter window to the last year must pass too.
 * The test of a window asks if its yearly counts agree with one rate.
 *
 * - The counts are the events of the law of each year (`oe417LawEvents`), with 0 for a year with no event.
 * - The test of each window is `dispersionTest` of `@mark1russell7/rigor-statistics`: the Pearson statistic given the total.
 * - With the method `auto` (the default), the p value is exact when the partitions of the total are few enough. Else it comes from seeded draws.
 * - The window starts in the year after the last window that fails the test at `level`.
 *
 * A new summary changes the counts, so it can move the window. The function is pure.
 *
 * @param events - The events
 * @param options - The years of the counts, the level, the count of draws and the seed
 * @throws RangeError when a year is not a whole number, when `last` is before `first`, or when the level is not between 0 and 1
 * @throws RangeError from `dispersionTest` when the draws times the events of a window are more than 2 ** 26. It also throws for the method `exact` with too many partitions.
 *   With the default draws, a window of more than 671 events that needs draws gives this error.
 */
export function oe417PriorWindow(events: readonly Oe417Event[], options: Oe417WindowOptions): Oe417Window {
  const { first, last, level = 0.05, draws = OE417_WINDOW_DRAWS, seed = OE417_WINDOW_SEED, method = "auto" } = options;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) throw new RangeError(`oe417PriorWindow: the years ${String(first)} to ${String(last)} are not a range of whole years.`);
  if (!(level > 0 && level < 1)) throw new RangeError(`oe417PriorWindow: the level ${String(level)} is not between 0 and 1.`);
  const law = oe417LawEvents(events);
  const counts = Array.from({ length: last - first + 1 }, (_, index) => law.filter((event) => event.year === first + index).length);
  const tests = counts.map((_, index) => {
    const window = counts.slice(index);
    const total = window.reduce((sum, count) => sum + count, 0);
    if (window.length < 2 || total === 0) return { first: first + index, p: 1, exact: true };
    const test = dispersionTest(window, { draws, seed, method });
    return { first: first + index, p: test.p, exact: test.exact };
  });
  const fails = tests.filter((test) => test.p < level);
  return { first: fails.length === 0 ? first : (fails.at(-1)?.first ?? first) + 1, counts, tests };
}

/** The last year of the summaries of `OE417_YEARS`, 2023 at this time. The prior and its window end in this year. */
export const OE417_LAST_YEAR: number = Math.max(...Object.keys(OE417_YEARS).map(Number));

/** The first year with an event of the law, 2011 at this time. The counts of the window of the prior start in this year. */
export const OE417_COUNTS_FIRST: number = Math.min(...oe417LawEvents(OE417_ATTACK_EVENTS).map((event) => event.year));

/** The yearly counts of the events of the law, from `OE417_COUNTS_FIRST` to `OE417_LAST_YEAR`. */
const PRIOR_COUNTS = Array.from({ length: OE417_LAST_YEAR - OE417_COUNTS_FIRST + 1 }, (_, index) => oe417LawEvents(OE417_ATTACK_EVENTS).filter((event) => event.year === OE417_COUNTS_FIRST + index).length);

/**
 * The first year of `OE417_NATION_PRIORS`, from the rule of `oe417PriorWindow` at 5%.
 * A test calculates it again from the events of `OE417_COUNTS_FIRST` to `OE417_LAST_YEAR`.
 * A new summary changes the counts. Then the test fails until this constant agrees with the new window.
 */
export const OE417_PRIOR_FIRST = 2015;

/**
 * The yearly prior of a physical attack on the grid for the nation, from `OE417_PRIOR_FIRST` to `OE417_LAST_YEAR` (2015 to 2023 at this time).
 * The earlier years have fewer events (4 in 2011 to 2014), so one rate of all the years is too low for each later year.
 */
export const OE417_NATION_PRIORS: PriorTable = oe417AttackPrior(OE417_ATTACK_EVENTS, {
  first: OE417_PRIOR_FIRST,
  last: OE417_LAST_YEAR,
  customers: EAGLEI_NATION_CUSTOMERS,
  note:
    "The customers of the nation are the sum of the customers of each observed county of EAGLE-I (CC BY 4.0). " +
    `The years are the longest window to ${String(OE417_LAST_YEAR)} that passes a dispersion test of the yearly counts at 5%, with each shorter window. ` +
    `The counts of the years ${String(OE417_COUNTS_FIRST)} to ${String(OE417_LAST_YEAR)} are ${PRIOR_COUNTS.join(", ")}. ` +
    `The window from ${String(OE417_PRIOR_FIRST - 1)} fails the test, and the window from ${String(OE417_PRIOR_FIRST)} passes it. ` +
    `The summaries before ${String(OE417_COUNTS_FIRST)} list no such event.`,
});

export { OE417_ATTACK_EVENTS, OE417_FILES, OE417_YEARS };
