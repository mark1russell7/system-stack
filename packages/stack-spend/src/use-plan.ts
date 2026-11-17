import { dayNumber } from "@mark1russell7/system-stack";
import type { SpendLayer } from "./layer.ts";
import { USE_LEVELS, type UseOptions, type UseRead } from "./reads.ts";

// The examination of the options and of each read. This module is internal: no entry exports it.
// `useSpace` and `checkUse` use it, so the tree and the gate agree on the reads with a fault.

/** These are the codes of the faults of one read. */
export const READ_CODES: readonly ["read-part", "read-amount", "read-date"] = ["read-part", "read-amount", "read-date"];

/** A code of a fault of one read. */
export type ReadCode = (typeof READ_CODES)[number];

/** The options with their defaults, and the fault of each read. */
export interface UsePlan {
  /** The number of the day of the check. */
  readonly today: number;
  /** The month of the check, as `YYYY-MM`. */
  readonly month: string;
  readonly levels: readonly number[];
  readonly readDays: number | undefined;
  /** The fault of each read, in the sequence of the reads. A read with no fault has `undefined`. */
  readonly codes: readonly (ReadCode | undefined)[];
  /** The age of each read in days, in the sequence of the reads. A read with a fault of its date has `undefined`. */
  readonly ages: readonly (number | undefined)[];
}

/** This function gives the month of a date `YYYY-MM-DD`, as `YYYY-MM`. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * This function examines the options and each read.
 *
 * - `read-part`: the read names a part with no cost record.
 * - `read-amount`: the amount is less than 0 or not finite.
 * - `read-date`: the date is not a date, or it is after the date of the check.
 *
 * A read has one code at most: the first fault of this list.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`, or `levels` or `readDays` is not valid
 */
export function usePlan(layer: SpendLayer, reads: readonly UseRead[], options: UseOptions): UsePlan {
  const today = dayNumber(options.today);
  if (today === undefined) throw new RangeError(`The date "${options.today}" is not a date of the form YYYY-MM-DD.`);
  const levels = options.levels ?? USE_LEVELS;
  for (const level of levels) {
    if (!Number.isFinite(level) || level <= 0) throw new RangeError(`The level ${String(level)} is not a finite number above 0.`);
  }
  const readDays = options.readDays;
  if (readDays !== undefined && (!Number.isFinite(readDays) || readDays < 0)) throw new RangeError(`The largest age ${String(readDays)} of a read is less than 0 or not finite.`);
  const parts = new Set(layer.services.map((service) => service.part));
  const days = reads.map((read) => dayNumber(read.date));
  const ages = days.map((day) => (day === undefined || day > today ? undefined : today - day));
  const codes = reads.map((read, index): ReadCode | undefined => {
    if (!parts.has(read.part)) return "read-part";
    if (!Number.isFinite(read.amount) || read.amount < 0) return "read-amount";
    return ages[index] === undefined ? "read-date" : undefined;
  });
  return { today, month: monthOf(options.today), levels, readDays, codes, ages };
}
