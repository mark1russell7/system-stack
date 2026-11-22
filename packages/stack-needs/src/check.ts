import { valueIn, type Quantity } from "@mark1russell7/quantity";
import { dayNumber, type Fault } from "@mark1russell7/system-stack";
import { ACTIVITY_LEVELS, CALORIE_SEXES, type CalorieTable } from "./calorie.ts";
import type { Source } from "./source.ts";

// The gate of a table of calorie needs: the source has a license, and each row has a valid range and a need.

/**
 * These are the codes of the gate. Each code is an error.
 *
 * - `needs-source`: the source has no name, no HTTPS URL, no publisher or a wrong date. Or its hash is not a SHA-256 hash.
 * - `needs-license`: the source has no license name or no license URL.
 * - `needs-row`: a row has no age or a wrong sex. Or its range of months is not a range of whole numbers of 0 or more.
 * - `needs-overlap`: two rows of one sex have ages in common.
 * - `needs-value`: a need is not a finite number above 0 in a unit of energy for each day.
 */
export const NEEDS_CODES: readonly ["needs-source", "needs-license", "needs-row", "needs-overlap", "needs-value"] = ["needs-source", "needs-license", "needs-row", "needs-overlap", "needs-value"];

/** A code of the gate of a table of calorie needs. */
export type NeedsCode = (typeof NEEDS_CODES)[number];

/** A fault of a table of calorie needs. */
export interface NeedsFault extends Fault {
  readonly code: NeedsCode;
}

/** This function gives the faults of the fields of a source, as the ends of sentences. */
function sourceFaults(source: Source): string[] {
  const faults: string[] = [];
  if (source.name.trim() === "") faults.push("has no name");
  if (!/^https:\/\/\S+$/u.test(source.url)) faults.push("has no HTTPS URL");
  if (source.publisher.trim() === "") faults.push("has no publisher");
  if (dayNumber(source.read) === undefined) faults.push("has a date of the read that is not a date YYYY-MM-DD");
  if (source.updated !== undefined && dayNumber(source.updated) === undefined) faults.push("has a date of the last change that is not a date YYYY-MM-DD");
  if (source.sha256 !== undefined && !/^[0-9a-f]{64}$/u.test(source.sha256)) faults.push("has a hash that is not 64 lowercase hexadecimal digits");
  return faults;
}

/** This function tells if a need is a finite number above 0 in a unit of energy for each day. */
function goodNeed(need: Quantity): boolean {
  try {
    const value = valueIn(need, "kcal/d");
    return Number.isFinite(value) && value > 0;
  } catch {
    return false;
  }
}

/**
 * This function gives each fault of a table of calorie needs. A list with no error tells that the gate passes.
 * The source rules are the rules of the sources of `@mark1russell7/stack-hazards`. The faults are in the order of the table. The function is pure.
 */
export function checkCalorieTable(table: CalorieTable): NeedsFault[] {
  const faults: NeedsFault[] = [];
  const add = (code: NeedsCode, at: string, message: string): void => {
    faults.push({ level: "error", code, at, message });
  };
  const source = table.source;
  for (const fault of sourceFaults(source)) add("needs-source", `${table.id}.source`, `The source of the table "${table.id}" ${fault}.`);
  if (source.license.name.trim() === "" || source.license.url.trim() === "") add("needs-license", `${table.id}.source`, `The source of the table "${table.id}" has no license name or no license URL.`);

  const whole = (value: number | undefined): boolean => value === undefined || (Number.isSafeInteger(value) && value >= 0);
  table.rows.forEach((row, index) => {
    const at = `${table.id}.rows[${String(index)}]`;
    if (row.age.trim() === "" || !(CALORIE_SEXES as readonly unknown[]).includes(row.sex)) add("needs-row", at, `The row "${at}" has no age or a sex that is not a sex of the table.`);
    if (!whole(row.from) || !whole(row.to) || (row.to !== undefined && row.to < row.from)) add("needs-row", at, `The row "${at}" has a range of months that is not a range of whole numbers of 0 or more.`);
    const needs = row.need.levels === undefined ? [row.need.each] : ACTIVITY_LEVELS.map((level) => row.need.levels?.[level]);
    if (!needs.every((need) => need !== undefined && goodNeed(need))) add("needs-value", at, `The row "${at}" has a need that is not a number above 0 in kcal/d.`);
    for (const other of table.rows.slice(0, index)) {
      if (other.sex !== row.sex) continue;
      const end = row.to ?? Infinity;
      const otherEnd = other.to ?? Infinity;
      if (row.from <= otherEnd && other.from <= end) add("needs-overlap", at, `The row "${at}" (${row.sex}, ${row.age}) has ages in common with the row ${other.age}.`);
    }
  });
  return faults;
}

/** This function tells if a list of faults has an error. */
export function hasNeedsError(faults: readonly NeedsFault[]): boolean {
  return faults.some((fault) => fault.level === "error");
}
