import { checkSources, type Finding, type FindingCode, type GateOptions } from "@mark1russell7/guidebook";
import { valueIn, type Quantity } from "@mark1russell7/quantity";
import { ACTIVITY_LEVELS, CALORIE_SEXES, type CalorieTable } from "./calorie.ts";

// The gate of a table of calorie needs: the gate of the sources of guidebook, the form of the hash, and the rows.

/**
 * These are the codes of the gate of the rows and the hash. Each code is an error. The gate of the sources of `@mark1russell7/guidebook` gives its own codes.
 *
 * - `needs-hash`: the hash of the source is not 64 lowercase hexadecimal digits.
 * - `needs-row`: a row has no age or a wrong sex. Or its range of months is not a range of whole numbers of 0 or more.
 * - `needs-overlap`: two rows of one sex have ages in common.
 * - `needs-value`: a need is not a finite number above 0 in a unit of energy for each day.
 */
export const NEEDS_CODES: readonly ["needs-hash", "needs-row", "needs-overlap", "needs-value"] = ["needs-hash", "needs-row", "needs-overlap", "needs-value"];

/** A code of the gate of a table of calorie needs. */
export type NeedsCode = (typeof NEEDS_CODES)[number];

/** A finding of the gate of a table of calorie needs: a finding of the gate of the sources, or a finding of a row. */
export type NeedsFinding = Finding<NeedsCode | FindingCode, "source" | "unit" | "row">;

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
 * This function gives each finding of a table of calorie needs. A list with no error tells that the gate passes.
 *
 * - The findings of the source come from `checkSources` of `@mark1russell7/guidebook`, with the options of the call.
 * - The form of the hash and the rows have the codes of `NEEDS_CODES`.
 *
 * The findings are in the order of the table. The function is pure.
 *
 * @param table - The table of calorie needs
 * @param options - The options of the gate of the sources, for example the date of the gate
 */
export function checkCalorieTable(table: CalorieTable, options?: GateOptions): NeedsFinding[] {
  const findings: NeedsFinding[] = [...checkSources([table.source], options)];
  const add = (code: NeedsCode, record: "source" | "row", id: string, message: string): void => {
    findings.push({ level: "error", code, record, id, message });
  };
  const { sha256 } = table.source;
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/u.test(sha256)) add("needs-hash", "source", table.source.id, `The hash of the source "${table.source.id}" is not 64 lowercase hexadecimal digits.`);

  const whole = (value: number | undefined): boolean => value === undefined || (Number.isSafeInteger(value) && value >= 0);
  table.rows.forEach((row, index) => {
    const id = `${table.id}.rows[${String(index)}]`;
    if (row.age.trim() === "" || !(CALORIE_SEXES as readonly unknown[]).includes(row.sex)) add("needs-row", "row", id, `The row "${id}" has no age or a sex that is not a sex of the table.`);
    if (!whole(row.from) || !whole(row.to) || (row.to !== undefined && row.to < row.from)) add("needs-row", "row", id, `The row "${id}" has a range of months that is not a range of whole numbers of 0 or more.`);
    const needs = row.need.levels === undefined ? [row.need.each] : ACTIVITY_LEVELS.map((level) => row.need.levels?.[level]);
    if (!needs.every((need) => need !== undefined && goodNeed(need))) add("needs-value", "row", id, `The row "${id}" has a need that is not a number above 0 in kcal/d.`);
    for (const other of table.rows.slice(0, index)) {
      if (other.sex !== row.sex) continue;
      if (row.from <= (other.to ?? Infinity) && other.from <= (row.to ?? Infinity)) add("needs-overlap", "row", id, `The row "${id}" (${row.sex}, ${row.age}) has ages in common with the row ${other.age}.`);
    }
  });
  return findings;
}

/** This function tells if a list of findings has an error. */
export function hasNeedsError(findings: readonly NeedsFinding[]): boolean {
  return findings.some((finding) => finding.level === "error");
}
