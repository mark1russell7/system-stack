import { kaplanMeier } from "@mark1russell7/rigor-statistics";
import type { DurationLaw, Source } from "./hazard.ts";
import { survivalOf, type SurvivalOptions } from "./law.ts";
import { OE417_ATTACK_EVENTS, OE417_FILES } from "./oe417-events.ts";

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

/** The shortest duration that a law reads, in hours. It is 15 minutes, as for the outages of EAGLE-I. */
export const OE417_LEAST_HOURS = 0.25;

/** The source of the law of a physical attack: the OE-417 annual summaries of 2000 to 2023. */
export const OE417_SOURCE: Source = {
  name: "Electric Disturbance Events (OE-417) annual summaries, 2000 to 2023",
  url: "https://www.oe.netl.doe.gov/OE417_annual_summary.aspx",
  publisher: "U.S. Department of Energy, Office of Cybersecurity, Energy Security, and Emergency Response",
  license: { name: "Public domain (a work of the United States federal government)", url: "https://www.copyright.gov/title17/92chap1.html#105" },
  read: "2026-11-24",
  regions: { scheme: "us-nation", codes: ["US"] },
};

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
 * This function gives the law of the duration of a physical attack on the grid: one survival curve in days for the nation.
 * It reads each event with a duration of 15 minutes or more. The time of the restoration in a summary is the end of the event, so no event is censored.
 *
 * @param events - The events of the summaries, for example `OE417_ATTACK_EVENTS`
 * @param options - The form of the curve
 */
export function oe417AttackLaw(events: readonly Oe417Event[], options: SurvivalOptions = {}): DurationLaw {
  const times = events.flatMap((event) => {
    const hours = oe417Hours(event);
    return hours !== undefined && hours >= OE417_LEAST_HOURS ? [{ time: hours / 24, censored: false }] : [];
  });
  if (times.length === 0) throw new RangeError("oe417AttackLaw: no event has a duration of 15 minutes or more.");
  const estimate = kaplanMeier(times);
  return {
    read: true,
    source: "doe.oe-417",
    fit: { family: "kaplan-meier", method: "product limit, with no censored event", count: estimate.count },
    scheme: "us-nation",
    curves: { US: survivalOf(estimate, options) },
  };
}

/** The law of the duration of the grid cut of a physical attack, from the 113 events of the summaries. */
export const OE417_ATTACK_LAW: DurationLaw = oe417AttackLaw(OE417_ATTACK_EVENTS);

export { OE417_ATTACK_EVENTS, OE417_FILES };
