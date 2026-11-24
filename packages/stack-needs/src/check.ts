import { checkSources, type Finding, type FindingCode, type GateOptions } from "@mark1russell7/guidebook";
import { valueIn, type Quantity } from "@mark1russell7/quantity";
import { ACTIVITY_LEVELS, CALORIE_SEXES, type CalorieRow, type CalorieTable } from "./calorie.ts";

// The gate of a table of calorie needs: the gate of the sources of guidebook, the form of the hash, and the rows.

/**
 * These are the codes of the gate of the rows and the hash. Each code is an error. The gate of the sources of `@mark1russell7/guidebook` gives its own codes.
 *
 * - `needs-hash`: the hash of the source is not 64 lowercase hexadecimal digits.
 * - `needs-row`: a row has no age or a wrong sex. Or its range of months is not a range of whole numbers of 0 or more.
 * - `needs-overlap`: two rows of one sex have ages in common.
 * - `needs-gap`: the rows of one sex do not cover each month with no gap, from the first row to an open last row.
 * - `needs-value`: a need is not a finite number above 0 in a unit of energy for each day.
 * - `needs-change`: a change has no stage, no title or a wrong sex. Or a different change has its stage and sex. Or
 *   its value is not a finite number in a unit of energy for each day.
 */
export const NEEDS_CODES: readonly ["needs-hash", "needs-row", "needs-overlap", "needs-gap", "needs-value", "needs-change"] = ["needs-hash", "needs-row", "needs-overlap", "needs-gap", "needs-value", "needs-change"];

/** A code of the gate of a table of calorie needs. */
export type NeedsCode = (typeof NEEDS_CODES)[number];

/** A finding of the gate of a table of calorie needs: a finding of the gate of the sources, or a finding of a row. */
export type NeedsFinding = Finding<NeedsCode | FindingCode, "source" | "unit" | "row" | "change">;

/** This function tells if a need is a finite number in a unit of energy for each day, and above 0 when `positive` is true. */
function goodNeed(need: Quantity, positive = true): boolean {
  try {
    const value = valueIn(need, "kcal/d");
    return Number.isFinite(value) && (!positive || value > 0);
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
  const add = (code: NeedsCode, record: "source" | "row" | "change", id: string, message: string): void => {
    findings.push({ level: "error", code, record, id, message });
  };
  const { sha256 } = table.source;
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/u.test(sha256)) add("needs-hash", "source", table.source.id, `The hash of the source "${table.source.id}" is not 64 lowercase hexadecimal digits.`);

  const whole = (value: number | undefined): boolean => value === undefined || (Number.isSafeInteger(value) && value >= 0);
  const range = (row: CalorieRow): boolean => whole(row.from) && whole(row.to) && (row.to === undefined || row.to >= row.from);
  const idOf = (index: number): string => `${table.id}.rows[${String(index)}]`;
  table.rows.forEach((row, index) => {
    const id = idOf(index);
    if (row.age.trim() === "" || !(CALORIE_SEXES as readonly unknown[]).includes(row.sex)) add("needs-row", "row", id, `The row "${id}" has no age or a sex that is not a sex of the table.`);
    if (!range(row)) add("needs-row", "row", id, `The row "${id}" has a range of months that is not a range of whole numbers of 0 or more.`);
    const needs = row.need.levels === undefined ? [row.need.each] : ACTIVITY_LEVELS.map((level) => row.need.levels?.[level]);
    if (!needs.every((need) => need !== undefined && goodNeed(need))) add("needs-value", "row", id, `The row "${id}" has a need that is not a number above 0 in kcal/d.`);
    for (const other of table.rows.slice(0, index)) {
      if (other.sex !== row.sex) continue;
      if (row.from <= (other.to ?? Infinity) && other.from <= (row.to ?? Infinity)) add("needs-overlap", "row", id, `The row "${id}" (${row.sex}, ${row.age}) has ages in common with the row ${other.age}.`);
    }
  });

  // The rows of each sex, in the order of their first month, cover each month with no gap to an open last row. A row with a bad range has its own finding.
  for (const sex of CALORIE_SEXES) {
    const rows = table.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.sex === sex && range(row));
    rows.sort((a, b) => a.row.from - b.row.from);
    rows.slice(1).forEach(({ row, index }, at) => {
      const before = rows[at]?.row.to;
      if (before !== undefined && row.from > before + 1) add("needs-gap", "row", idOf(index), `The table has no row of a ${sex} for the months ${String(before + 1)} to ${String(row.from - 1)}.`);
    });
    const last = rows.at(-1);
    if (last !== undefined && last.row.to !== undefined) add("needs-gap", "row", idOf(last.index), `The last row of a ${sex} ends at ${String(last.row.to)} months. It is not an open row.`);
  }

  // The changes: a stage, a title and a sex of the table, one change for each stage and sex, and a finite value.
  const seen = new Set<string>();
  (table.changes ?? []).forEach((change, index) => {
    const id = `${table.id}.changes[${String(index)}]`;
    const stage = typeof change.stage === "string" ? change.stage.trim() : "";
    const title = typeof change.title === "string" ? change.title.trim() : "";
    if (stage === "" || title === "" || !(CALORIE_SEXES as readonly unknown[]).includes(change.sex)) add("needs-change", "change", id, `The change "${id}" has no stage, no title or a sex that is not a sex of the table.`);
    else if (seen.has(`${change.sex} ${stage}`)) add("needs-change", "change", id, `The change "${id}" has the stage ${stage} of a ${change.sex}, and a different change has it too.`);
    seen.add(`${String(change.sex)} ${stage}`);
    if (!goodNeed(change.change, false)) add("needs-change", "change", id, `The change "${id}" has a value that is not a finite number in kcal/d.`);
  });
  return findings;
}

/** This function tells if a list of findings has an error. */
export function hasNeedsError(findings: readonly NeedsFinding[]): boolean {
  return findings.some((finding) => finding.level === "error");
}
