import type { Fault } from "./check.ts";
import { dayNumber } from "./dates.ts";

// The known faults of a gate. The gate of a real stack can have faults that the owner knows and cannot correct at once.
// A known fault has a reason and a last date. Thus it is not debt with no end, and a new fault still stops the gate.

/** The format of a list of known faults. */
export const KNOWN_SCHEMA = "known/1";

/** A fault that the owner knows: the code and the record of the fault, the reason, and the last date. */
export interface KnownFault {
  /** The code of the fault, for example `limit-none`. */
  readonly code: string;
  /** The `id` of the record with the fault. */
  readonly at: string;
  /** The `id` of the second record of the fault. A fault of one record has none. */
  readonly other?: string | undefined;
  /** The reason that the fault stays open, and the next step, in plain words. */
  readonly reason: string;
  /** The last day of the acceptance, as `YYYY-MM-DD`. After this day, the fault is an error again. */
  readonly until: string;
}

/** A list of known faults, for example the file of one owner. */
export interface KnownList {
  readonly schema: typeof KNOWN_SCHEMA;
  readonly known: readonly KnownFault[];
}

/** These are the codes of the faults of a list of known faults. */
export const KNOWN_CODES: readonly ["known-date", "known-twice", "known-old", "known-unused"] = ["known-date", "known-twice", "known-old", "known-unused"];

/** A code of `KNOWN_CODES`. */
export type KnownCode = (typeof KNOWN_CODES)[number];

/** The options of `holdKnown`. */
export interface KnownOptions {
  /** The date of the check, as `YYYY-MM-DD`. The function has no clock: the caller gives the date. */
  readonly today: string;
}

/** This function gives the key of a fault or of a known fault: its code, its record and its second record. */
function keyOf(value: { readonly code: string; readonly at: string; readonly other?: string | undefined }): string {
  return JSON.stringify([value.code, value.at, value.other ?? null]);
}

/** This function gives a known-list fault at the record of a known fault. */
function listFault(code: KnownCode, record: KnownFault, message: string): Fault {
  return record.other === undefined ? { level: "error", code, at: record.at, message } : { level: "error", code, at: record.at, message, other: record.other };
}

/**
 * This function holds the faults of a gate against a list of known faults.
 *
 * - A fault matches a known fault with the same code, `at` and `other`.
 * - A matched error becomes a warning, while its last date is not before `today`. Its message tells the reason and the date.
 * - An error with no match stays an error. Thus a new fault stops the gate.
 * - A matched warning stays a warning.
 * - `known-date`: the last date of a known fault is not a date. The known fault has no effect.
 * - `known-twice`: two known faults have one key. The first one has the effect.
 * - `known-unused`: a known fault matches no fault. Remove it, so that the gate holds the gain.
 * - `known-old`: the last date of a known fault that matches a fault is before `today`. The fault stays an error.
 *
 * The faults are in the sequence of the input, then the faults of the list in the sequence of the list.
 * The function is pure, and it does not change the input.
 *
 * @throws RangeError when `today` is not a date
 */
export function holdKnown(faults: readonly Fault[], known: readonly KnownFault[], options: KnownOptions): Fault[] {
  const today = dayNumber(options.today);
  if (today === undefined) throw new RangeError(`The date of the check "${options.today}" is not a date YYYY-MM-DD.`);
  const entries = known.map((record) => ({ record, key: keyOf(record), last: dayNumber(record.until) }));
  const valid = new Map<string, { readonly record: KnownFault; readonly last: number }>();
  const twice = new Set<number>();
  for (const [index, entry] of entries.entries()) {
    if (entry.last === undefined) continue;
    if (valid.has(entry.key)) twice.add(index);
    else valid.set(entry.key, { record: entry.record, last: entry.last });
  }
  const used = new Set<string>();
  const held = faults.map((fault): Fault => {
    const key = keyOf(fault);
    const entry = valid.get(key);
    if (entry === undefined) return fault;
    used.add(key);
    if (fault.level !== "error" || entry.last < today) return fault;
    return { ...fault, level: "warning", message: `${fault.message} The owner knows this fault until ${entry.record.until}: ${entry.record.reason}` };
  });
  const listFaults = entries.flatMap(({ record, key, last }, index): Fault[] => {
    const what = `The known fault ${record.code} of "${record.at}"`;
    if (last === undefined) return [listFault("known-date", record, `${what} has the last date "${record.until}", which is not a date YYYY-MM-DD.`)];
    if (twice.has(index)) return [listFault("known-twice", record, `${what} is in the list two times. Only the first one has an effect.`)];
    if (!used.has(key)) return [listFault("known-unused", record, `${what} matches no fault. Remove it from the list.`)];
    if (last < today) return [listFault("known-old", record, `${what} ended on ${record.until}. Correct the fault, or give a new reason and a new date.`)];
    return [];
  });
  return [...held, ...listFaults];
}
