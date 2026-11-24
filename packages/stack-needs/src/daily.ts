import { checkSources, type Finding, type FindingCode, type GateOptions, type Source } from "@mark1russell7/guidebook";
import { valueIn, type Quantity } from "@mark1russell7/quantity";

// The daily needs of the kit: light, the watch of an alert receiver and warmth.
// Each need has a cited daily rate, or a no read with its reason. A no read is not 0, and the list keeps it.
// The rate of a device, for example the watts of a radio in standby, is a fact of the device and not of the need.

/** The code of the need of light to see in the dark in a home, in hours. */
export const LIGHT_NEED = "light.see";
/** The code of the need of an alert receiver that is on, in hours. */
export const ALERT_WATCH_NEED = "alert.watch";
/** The code of the need of the space heat of a home, in `kWh`. The blankets and the sleeping bags of each person are gear, not this need. */
export const WARMTH_NEED = "warmth.shelter";

/** The users of a daily rate: each person, or each household. */
export type DailyNeedUsers = "person" | "household";

/** A daily rate with a read: an amount for each day, its sources and what the sources tell. */
export interface DailyRateRead {
  readonly read: true;
  /** The amount for each user each day, in the unit of the need for each day, for example `h/d`. */
  readonly perDay: Quantity;
  readonly sources: readonly Source[];
  /** This text tells how the sources give the amount. */
  readonly note: string;
}

/** A daily rate with no read, and the reason. A no read is not 0. */
export interface DailyRateNoRead {
  readonly read: false;
  readonly why: string;
}

/** A need of the kit, its unit, its users and its daily rate. */
export interface DailyNeed {
  /** The code of the need, in the form `<area>.<what>`. */
  readonly code: string;
  /** The unit of the need, in the grammar of `@mark1russell7/quantity`. */
  readonly unit: string;
  readonly users: DailyNeedUsers;
  readonly rate: DailyRateRead | DailyRateNoRead;
}

/** The page of the National Weather Service on the receivers of NOAA Weather Radio. It is a work of the United States federal government. */
export const NWS_RECEIVERS_SOURCE: Source = {
  id: "nws-nwr-receivers",
  title: "NOAA Weather Radio All Hazards: Receiver Information",
  url: "https://www.weather.gov/nwr/nwr_receivers",
  license: "us-public-domain",
  checked: "2026-11-24",
  by: "National Weather Service",
  terms: "https://www.weather.gov/disclaimer",
};

/** The page of the National Weather Service on the alarms of NOAA Weather Radio. It is a work of the United States federal government. */
export const NWS_ALARMS_SOURCE: Source = {
  id: "nws-nwr-alarms",
  title: "NOAA Weather Radio All Hazards: NWR Alarms",
  url: "https://www.weather.gov/nwr/nwr_warning",
  license: "us-public-domain",
  checked: "2026-11-24",
  by: "National Weather Service",
  terms: "https://www.weather.gov/disclaimer",
};

/**
 * The daily needs of the kit, with a cited rate or a no read.
 *
 * - `alert.watch`: 24 hours each day for each household. The sources give a standby mode that turns on at an alert, and warnings at night.
 *   Thus a receiver stays on at all hours to get a warning. One receiver for each home is a choice of this model.
 * - `light.see`: no read, for each household. The kit lists of official sources give a flashlight and extra batteries, but no hours of use.
 *   The count of lights of each person is a fact of the plan or the device. `lightNeed` gives a read from the point and the awake window.
 * - `warmth.shelter`: no read. The heat of a home changes with the weather, the building and the persons. It is space heat only.
 */
export const DAILY_NEEDS: readonly DailyNeed[] = [
  {
    code: ALERT_WATCH_NEED,
    unit: "h",
    users: "household",
    rate: {
      read: true,
      perDay: { value: 24, unit: "h/d" },
      sources: [NWS_RECEIVERS_SOURCE, NWS_ALARMS_SOURCE],
      note:
        "The alarms page tells that many receivers can stay in a muted standby mode and turn on when a warning comes. " +
        "The receivers page tells that the tone alarm is useful for warnings during the night. " +
        "Thus a receiver stays on and listens at all hours to get a warning, so 24 hours each day. " +
        "One receiver for each home is a choice of this model, not of the sources.",
    },
  },
  {
    code: LIGHT_NEED,
    unit: "h",
    users: "household",
    rate: {
      read: false,
      why:
        "The kit lists of Ready.gov give a flashlight and extra batteries, but no hours of use each day. " +
        "No official source that we found gives a daily amount. A user gives the hours as input data.",
    },
  },
  {
    code: WARMTH_NEED,
    unit: "kWh",
    users: "household",
    rate: {
      read: false,
      why:
        "The heat that a home needs changes with the weather, the building and the persons. " +
        "This need is space heat only. The blankets and the sleeping bags of each person are gear, not this need. " +
        "No official source that we found gives a daily amount. A user gives the heat as input data.",
    },
  },
];

/**
 * These are the codes of the gate of the daily needs. Each code is an error. The gate of the sources of `@mark1russell7/guidebook` gives its own codes.
 *
 * - `daily-need-id`: a need has an empty code, or a different need has its code.
 * - `daily-need-unit`: the unit of a need is not a unit of `@mark1russell7/quantity`.
 * - `daily-need-rate`: a read has no source. Or its amount is not a finite number of 0 or more in the unit of the need for each day.
 *   Or a no read has no reason.
 */
export const DAILY_NEED_CODES: readonly ["daily-need-id", "daily-need-unit", "daily-need-rate"] = ["daily-need-id", "daily-need-unit", "daily-need-rate"];

/** A code of the gate of the daily needs. */
export type DailyNeedCode = (typeof DAILY_NEED_CODES)[number];

/** A finding of the gate of the daily needs: a finding of the gate of the sources, or a finding of a need. */
export type DailyNeedFinding = Finding<DailyNeedCode | FindingCode, "source" | "unit" | "need">;

/** This function tells if a text is a unit that `@mark1russell7/quantity` reads. */
function isUnit(unit: string): boolean {
  try {
    return Number.isFinite(valueIn({ value: 0, unit }, unit));
  } catch {
    return false;
  }
}

/** This function gives the amount of a rate in the unit of its need for each day, or `undefined` when the units do not convert. */
function amountOf(perDay: Quantity, unit: string): number | undefined {
  try {
    return valueIn(perDay, `${unit}/d`);
  } catch {
    return undefined;
  }
}

/**
 * This function gives each finding of a list of daily needs. `resultOf` of `@mark1russell7/guidebook` tells if the gate passes.
 *
 * Each source must have a publisher (`by`) and a page of its terms, with HTTPS addresses. The findings are in the order of the list. The function is pure.
 *
 * @param needs - The daily needs, for example `DAILY_NEEDS`
 * @param options - The options of the gate of the sources, for example the date of the gate
 */
export function checkDailyNeeds(needs: readonly DailyNeed[], options?: GateOptions): DailyNeedFinding[] {
  const sources = new Map<string, Source>();
  for (const need of needs) if (need.rate.read) for (const source of need.rate.sources) sources.set(source.id, source);
  const fields = [...new Set([...(options?.require ?? []), "by" as const, "terms" as const])];
  const findings: DailyNeedFinding[] = [...checkSources([...sources.values()], { ...options, require: fields, https: true })];
  const add = (code: DailyNeedCode, id: string, message: string): void => {
    findings.push({ level: "error", code, record: "need", id, message });
  };

  const seen = new Set<string>();
  needs.forEach((need, index) => {
    const id = need.code.trim() === "" ? `needs[${String(index)}]` : need.code;
    if (need.code.trim() === "") add("daily-need-id", id, `The need "${id}" has no code.`);
    else if (seen.has(need.code)) add("daily-need-id", id, `Two needs have the code "${id}".`);
    seen.add(need.code);
    if (!isUnit(need.unit)) add("daily-need-unit", id, `The unit "${need.unit}" of the need "${id}" is not a unit of quantity.`);
    if (need.rate.read) {
      const amount = amountOf(need.rate.perDay, need.unit);
      if (amount === undefined || !Number.isFinite(amount) || amount < 0) add("daily-need-rate", id, `The rate of the need "${id}" is not a finite number of 0 or more in ${need.unit}/d.`);
      if (need.rate.sources.length === 0) add("daily-need-rate", id, `The rate of the need "${id}" has no source.`);
    } else if (need.rate.why.trim() === "") add("daily-need-rate", id, `The no read of the need "${id}" has no reason.`);
  });
  return findings;
}

