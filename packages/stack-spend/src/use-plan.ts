import { dayNumber } from "@mark1russell7/system-stack";
import type { SpendLayer } from "./layer.ts";
import { RATE_DAYS, USE_LEVELS, type UseOptions, type UseRead } from "./reads.ts";

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
  readonly rateDays: number;
  /** The count of days of the month of the check. */
  readonly monthDays: number;
  /** The fault of each read, in the sequence of the reads. A read with no fault has `undefined`. */
  readonly codes: readonly (ReadCode | undefined)[];
  /** The age of each read in days, in the sequence of the reads. A read with a fault of its date has `undefined`. */
  readonly ages: readonly (number | undefined)[];
  /** The day of each read in the month of the check, in the sequence of the reads. The first day of the month is 1. */
  readonly days: readonly (number | undefined)[];
}

/** This function gives the month of a date `YYYY-MM-DD`, as `YYYY-MM`. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** This function gives the count of days of a month `YYYY-MM` of the Gregorian calendar. */
export function daysOf(month: string): number {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  if (index === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(index) ? 30 : 31;
}

/**
 * This function examines the options and each read.
 *
 * - `read-part`: the read names a part with no cost record.
 * - `read-amount`: the amount is less than 0 or not finite. Or the gross amount is less than the amount or not finite.
 * - `read-date`: the date is not a date, or it is after the date of the check.
 *
 * A read has one code at most: the first fault of this list.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`, or `levels`, `readDays` or `rateDays` is not valid
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
  const rateDays = options.rateDays ?? RATE_DAYS;
  if (!Number.isFinite(rateDays) || rateDays < 1) throw new RangeError(`The count of days ${String(rateDays)} of the rate is less than 1 or not finite.`);
  const parts = new Set(layer.services.map((service) => service.part));
  const days = reads.map((read) => dayNumber(read.date));
  const ages = days.map((day) => (day === undefined || day > today ? undefined : today - day));
  const codes = reads.map((read, index): ReadCode | undefined => {
    if (!parts.has(read.part)) return "read-part";
    if (!Number.isFinite(read.amount) || read.amount < 0) return "read-amount";
    if (read.gross !== undefined && (!Number.isFinite(read.gross) || read.gross < read.amount)) return "read-amount";
    return ages[index] === undefined ? "read-date" : undefined;
  });
  const month = monthOf(options.today);
  // The day before the first day of the month of the check, as a day number.
  const before = today - Number(options.today.slice(8, 10));
  return { today, month, levels, readDays, rateDays, monthDays: daysOf(month), codes, ages, days: days.map((day) => (day === undefined ? undefined : day - before)) };
}
