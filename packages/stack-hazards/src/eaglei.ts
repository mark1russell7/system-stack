import type { OutageCount } from "./outages.ts";

// The reader of the files of EAGLE-I: the outages of each county of the United States, from Oak Ridge National Laboratory. This module does no fetch.
// An outage file has a line for each county with customers out at each time of the collection, every 15 minutes.
// The dataset has the license CC BY 4.0. A curve from it is a derived work, and it keeps the attribution of the source.

const TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u;
const AREA = /^\d{1,5}$/u;
const COUNT = /^\d+(\.\d+)?$/u;

/** The scheme of the region codes of a law from EAGLE-I: the 2-digit FIPS code of a state. */
export const EAGLE_SCHEME = "us-state-fips";

/** The interval of the collection of EAGLE-I, in seconds. */
export const EAGLE_INTERVAL = 900;

const bare = (field: string | undefined): string => (field ?? "").trim().replace(/^"(.*)"$/u, "$1");

/**
 * This function reads one line of an outage file of EAGLE-I. It gives `undefined` for the header and for a line that it cannot read.
 * The columns change from year to year. This function reads the FIPS code in the first column, the time and the count before the time.
 * A county name with a comma in quotes does not move these columns. The function reads each time as UTC.
 */
export function eagleLine(line: string): OutageCount | undefined {
  const fields = line.split(",");
  const area = bare(fields[0]);
  if (!AREA.test(area)) return undefined;
  for (let index = fields.length - 1; index >= 2; index -= 1) {
    const match = TIME.exec(bare(fields[index]));
    if (match === null) continue;
    const out = bare(fields[index - 1]);
    if (!COUNT.test(out)) return undefined;
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
    return { area: area.padStart(5, "0"), out: Number(out), time: Date.UTC(year, month - 1, day, hour, minute, second) / 1000 };
  }
  return undefined;
}

/** This function reads the file of the modeled customers of each county of EAGLE-I (`MCC.csv`). It gives the customers by the 5-digit FIPS code. */
export function eagleCustomers(text: string): Map<string, number> {
  const customers = new Map<string, number>();
  for (const line of text.replace(/^﻿/u, "").split(/\r?\n/u)) {
    const [area, count] = line.split(",").map(bare);
    if (area !== undefined && AREA.test(area) && count !== undefined && /^\d+$/u.test(count)) customers.set(area.padStart(5, "0"), Number(count));
  }
  return customers;
}

/** This function gives the region of a county of EAGLE-I: the 2-digit FIPS code of its state, in the scheme `us-state-fips`. */
export function eagleRegion(area: string): string {
  return area.slice(0, 2);
}
