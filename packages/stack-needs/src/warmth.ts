import type { Source } from "@mark1russell7/guidebook";
import { WARMTH_NEED, type DailyNeed } from "./daily.ts";

// The space heat that a home needs each day in a cut: the heat loss of the building times the difference of the temperatures.
// The facts of the building, the indoor target and the outdoor temperatures are input data of the household. This file names no place.

/** The page "Thermal transmittance" of Wikipedia: the heat flow through an element is its area times its U-value times the difference of the temperatures. */
export const THERMAL_TRANSMITTANCE_SOURCE: Source = {
  id: "wikipedia-thermal-transmittance",
  title: "Thermal transmittance",
  url: "https://en.wikipedia.org/w/index.php?title=Thermal_transmittance&oldid=1326419561",
  license: "cc-by-sa-4.0",
  checked: "2026-11-24",
  by: "Wikipedia contributors",
  terms: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
};

/** The page "Degree day" of Wikipedia: the energy to keep the base temperature indoors is approximately in proportion to the degree days. */
export const DEGREE_DAY_SOURCE: Source = {
  id: "wikipedia-degree-day",
  title: "Degree day",
  url: "https://en.wikipedia.org/w/index.php?title=Degree_day&oldid=1358071209",
  license: "cc-by-sa-4.0",
  checked: "2026-11-24",
  by: "Wikipedia contributors",
  terms: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
};

/** The most days of one calculation of the warmth: three years. */
export const MAX_WARMTH_DAYS = 1096;

/** One element of the envelope of a home: a wall, a roof, a floor or a window. */
export interface EnvelopeElement {
  /** The area, in square metres. */
  readonly areaM2: number;
  /** The thermal transmittance (U-value), in watts for each square metre and each kelvin. */
  readonly uWm2K: number;
}

/**
 * This function gives the heat loss coefficient of a home, in watts for each kelvin. It is the sum of the area times the U-value of each element.
 * Air leaks are not in the sum. A caller adds them as an element, or uses `heatLossFromUse`.
 *
 * @throws RangeError - An area or a U-value is not a finite number of 0 or more, or the list is empty.
 */
export function heatLossOf(elements: readonly EnvelopeElement[]): number {
  if (elements.length === 0) throw new RangeError("The envelope has no element.");
  let sum = 0;
  for (const [index, element] of elements.entries()) {
    if (!(Number.isFinite(element.areaM2) && element.areaM2 >= 0)) throw new RangeError(`The area of element ${index} is not a finite number of 0 or more.`);
    if (!(Number.isFinite(element.uWm2K) && element.uWm2K >= 0)) throw new RangeError(`The U-value of element ${index} is not a finite number of 0 or more.`);
    sum += element.areaM2 * element.uWm2K;
  }
  return sum;
}

/**
 * This function gives the heat loss coefficient of a home from the heat of a past period, in watts for each kelvin.
 * The heat is the energy that the heaters gave, not the fuel. The degree days are on the balance temperature of the home.
 * The coefficient is the heat divided by the degree days times 24 hours.
 *
 * @param heatKWh - The heat of the period, in `kWh`, a finite number of 0 or more
 * @param degreeDaysKd - The heating degree days of the period on the balance temperature, in kelvin days, a finite number above 0
 * @throws RangeError - The heat or the degree days are out of range.
 */
export function heatLossFromUse(heatKWh: number, degreeDaysKd: number): number {
  if (!(Number.isFinite(heatKWh) && heatKWh >= 0)) throw new RangeError(`The heat ${heatKWh} kWh is not a finite number of 0 or more.`);
  if (!(Number.isFinite(degreeDaysKd) && degreeDaysKd > 0)) throw new RangeError(`The degree days ${degreeDaysKd} are not a finite number above 0.`);
  return (heatKWh * 1000) / (degreeDaysKd * 24);
}

/** The input of `warmthHeat`. */
export interface WarmthInput {
  /** The heat loss coefficient of the home, in watts for each kelvin. `heatLossOf` and `heatLossFromUse` give it. */
  readonly heatLossWK: number;
  /** The indoor temperature that the household keeps in a cut, in degrees Celsius. It is a choice of the household. */
  readonly indoorC: number;
  /** The mean outdoor temperature of each day of the plan, in degrees Celsius, for example a cold week of the place. */
  readonly outdoorC: readonly number[];
  /** The heat that the persons and the devices give in the cut, in watts. The default is 0. */
  readonly gainsW?: number | undefined;
}

/** The heat of one day of the plan. */
export interface WarmthDay {
  readonly outdoorC: number;
  /** The heat that the heaters must give on the day, in `kWh`. */
  readonly heatKWh: number;
}

/** The result of `warmthHeat`: each day, and the most and the mean of the heat of a day. */
export interface WarmthHeat {
  readonly days: readonly WarmthDay[];
  /** The heat of the worst day, in `kWh`. */
  readonly most: number;
  /** The mean heat of the days, in `kWh`. */
  readonly mean: number;
}

/**
 * This function gives the heat that a home needs on each day of a plan, in `kWh`.
 *
 * - The heat flow is the heat loss coefficient times the indoor temperature minus the outdoor temperature, minus the gains.
 * - A day with a flow of 0 or less needs no heat. The heat of a day is the flow times 24 hours.
 *
 * @throws RangeError - A value is not a finite number, or the coefficient or the gains are less than 0. Or the count of days is not from 1 to `MAX_WARMTH_DAYS`.
 */
export function warmthHeat(input: WarmthInput): WarmthHeat {
  const gains = input.gainsW ?? 0;
  if (!(Number.isFinite(input.heatLossWK) && input.heatLossWK >= 0)) throw new RangeError(`The heat loss ${input.heatLossWK} W/K is not a finite number of 0 or more.`);
  if (!Number.isFinite(input.indoorC)) throw new RangeError(`The indoor temperature ${input.indoorC} is not a finite number.`);
  if (!(Number.isFinite(gains) && gains >= 0)) throw new RangeError(`The gains ${gains} W are not a finite number of 0 or more.`);
  if (input.outdoorC.length < 1 || input.outdoorC.length > MAX_WARMTH_DAYS) throw new RangeError(`The plan has ${input.outdoorC.length} days, not from 1 to ${MAX_WARMTH_DAYS}.`);
  const days = input.outdoorC.map((outdoorC, index): WarmthDay => {
    if (!Number.isFinite(outdoorC)) throw new RangeError(`The outdoor temperature of day ${index} is not a finite number.`);
    const flowW = Math.max(0, input.heatLossWK * (input.indoorC - outdoorC) - gains);
    return { outdoorC, heatKWh: (flowW * 24) / 1000 };
  });
  const most = Math.max(...days.map((day) => day.heatKWh));
  const mean = days.reduce((sum, day) => sum + day.heatKWh, 0) / days.length;
  return { days, most, mean };
}

/**
 * This function gives the need of space heat of a household from its heat: the heat of its worst day, in `kWh` each day.
 * The facts of the building, the indoor target and the outdoor temperatures are input data. The sources give the method.
 */
export function warmthNeed(heat: WarmthHeat): DailyNeed {
  return {
    code: WARMTH_NEED,
    unit: "kWh",
    users: "household",
    rate: {
      read: true,
      perDay: { value: heat.most, unit: "kWh/d" },
      sources: [THERMAL_TRANSMITTANCE_SOURCE, DEGREE_DAY_SOURCE],
      note:
        "The heat flow through each element is its area times its U-value times the difference of the temperatures. " +
        "The energy of a past period gives the same coefficient through its degree days. " +
        "The indoor target, the outdoor temperatures and the facts of the building are input data. The rate is the heat of the worst day of the plan.",
    },
  };
}
