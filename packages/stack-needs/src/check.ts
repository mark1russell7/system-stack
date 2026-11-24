import { checkSources, type Finding, type FindingCode, type GateOptions, type SourceField } from "@mark1russell7/guidebook";
import { valueIn, type Quantity } from "@mark1russell7/quantity";
import { ACTIVITY_LEVELS, CALORIE_SEXES, type CalorieRow, type CalorieTable, type CalorieTables } from "./calorie.ts";

// The gate of a table of calorie needs: the gate of the sources of guidebook, and the rows.

/**
 * These are the codes of the gate of the rows. Each code is an error. The gate of the sources of `@mark1russell7/guidebook` gives its own codes.
 *
 * - `needs-row`: a row has no age or a wrong sex. Or its range of months is not a range of whole numbers of 0 or more.
 * - `needs-overlap`: two rows of one sex have ages in common.
 * - `needs-gap`: the rows of one sex in a table have a gap between two rows. Or the rows of one sex in a chain of tables
 *   do not cover each month from 0 to an open last row.
 * - `needs-value`: a need is not a finite number above 0 in a unit of energy for each day.
 * - `needs-change`: a change has no stage, no title or a wrong sex, or a stage with a space at an end. Or a different
 *   change has its stage and sex. Or its value is not a finite number in a unit of energy for each day. Or its sum with
 *   the smallest need of its sex is not above 0.
 */
export const NEEDS_CODES: readonly ["needs-row", "needs-overlap", "needs-gap", "needs-value", "needs-change"] = ["needs-row", "needs-overlap", "needs-gap", "needs-value", "needs-change"];

/** A code of the gate of a table of calorie needs. */
export type NeedsCode = (typeof NEEDS_CODES)[number];

/** A finding of the gate of a table of calorie needs: a finding of the gate of the sources, or a finding of a row. */
export type NeedsFinding = Finding<NeedsCode | FindingCode, "source" | "unit" | "row" | "change" | "chain">;

/** This function tells if a need is a finite number in a unit of energy for each day, and above 0 when `positive` is true. */
function goodNeed(need: Quantity, positive = true): boolean {
  try {
    const value = valueIn(need, "kcal/d");
    return Number.isFinite(value) && (!positive || value > 0);
  } catch {
    return false;
  }
}

/** The fields that the source of each table must have: the credit, the evidence of the license and the hash of the file. */
const TABLE_FIELDS: readonly SourceField[] = ["by", "terms", "sha256"];

/**
 * This function gives each finding of a table of calorie needs. A list with no error tells that the gate passes.
 *
 * - The findings of the source come from `checkSources` of `@mark1russell7/guidebook`, with the options of the call and the rules of a table.
 * - The rules of a table: the source has a publisher (`by`), a page of its terms and a hash, and its addresses start with `https:`.
 * - The hash of the source is part of the gate of the sources (`bad-sha256`).
 * - The rows have the codes of `NEEDS_CODES`.
 *
 * The findings are in the order of the table. The function is pure.
 *
 * @param table - The table of calorie needs
 * @param options - The options of the gate of the sources, for example the date of the gate
 */
export function checkCalorieTable(table: CalorieTable, options?: GateOptions): NeedsFinding[] {
  const require = [...new Set([...(options?.require ?? []), ...TABLE_FIELDS])];
  const findings: NeedsFinding[] = [...checkSources([table.source], { ...options, require, https: true })];
  const add = (code: NeedsCode, record: "source" | "row" | "change", id: string, message: string): void => {
    findings.push({ level: "error", code, record, id, message });
  };

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

  // The rows of each sex, in the order of their first month, have no gap. A row with a bad range has its own finding.
  // A table can start after month 0 and end at a closed row: the gate of a chain checks the cover of all months.
  for (const sex of CALORIE_SEXES) {
    const rows = table.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.sex === sex && range(row));
    rows.sort((a, b) => a.row.from - b.row.from);
    rows.slice(1).forEach(({ row, index }, at) => {
      const before = rows[at]?.row.to;
      if (before !== undefined && row.from > before + 1) add("needs-gap", "row", idOf(index), `The table has no row of a ${sex} for the months ${String(before + 1)} to ${String(row.from - 1)}.`);
    });
  }

  // The changes: a stage, a title and a sex of the table, one change for each stage and sex, and a finite value.
  // A change with the smallest need of its sex stays above 0. A row with a bad need has its own finding.
  const smallest = (sex: string): number =>
    Math.min(
      ...table.rows
        .filter((row) => row.sex === sex)
        .flatMap((row) => (row.need.levels === undefined ? [row.need.each] : ACTIVITY_LEVELS.map((level) => row.need.levels?.[level])))
        .filter((need): need is Quantity => need !== undefined && goodNeed(need))
        .map((need) => valueIn(need, "kcal/d")),
    );
  const seen = new Set<string>();
  (table.changes ?? []).forEach((change, index) => {
    const id = `${table.id}.changes[${String(index)}]`;
    const stage = typeof change.stage === "string" ? change.stage.trim() : "";
    const title = typeof change.title === "string" ? change.title.trim() : "";
    if (stage === "" || stage !== change.stage || title === "" || !(CALORIE_SEXES as readonly unknown[]).includes(change.sex)) add("needs-change", "change", id, `The change "${id}" has no stage, no title, a stage with a space at an end or a sex that is not a sex of the table.`);
    else if (seen.has(`${change.sex} ${stage}`)) add("needs-change", "change", id, `The change "${id}" has the stage ${stage} of a ${change.sex}, and a different change has it too.`);
    seen.add(`${String(change.sex)} ${stage}`);
    if (!goodNeed(change.change, false)) add("needs-change", "change", id, `The change "${id}" has a value that is not a finite number in kcal/d.`);
    else if (smallest(change.sex) + valueIn(change.change, "kcal/d") <= 0) add("needs-change", "change", id, `The change "${id}" makes the smallest need of a ${change.sex} 0 or less.`);
  });
  return findings;
}

/**
 * This function gives each finding of a chain of tables. First come the findings of `checkCalorieTable` for each table,
 * in the order of the chain. Then come the findings of the cover. For each sex, the rows of all the tables cover each month from 0 to an
 * open last row (`needs-gap`, record `chain`). A row of a later table can overlap a row of an earlier table: the earlier
 * table gives the need. A list with no error tells that the gate passes. The function is pure.
 *
 * @param tables - One table, or tables in order
 * @param options - The options of the gate of the sources, for example the date of the gate
 */
export function checkCalorieChain(tables: CalorieTables, options?: GateOptions): NeedsFinding[] {
  const list = "rows" in tables ? [tables] : tables;
  const findings = list.flatMap((table) => checkCalorieTable(table, options));
  const id = list.map((table) => table.id).join(" + ");
  const add = (message: string): void => {
    findings.push({ level: "error", code: "needs-gap", record: "chain", id, message });
  };
  if (list.length === 0) add("The chain has no table.");
  for (const sex of CALORIE_SEXES) {
    const rows = list.flatMap((table) => table.rows).filter((row) => row.sex === sex && Number.isSafeInteger(row.from) && row.from >= 0);
    if (rows.length === 0) {
      add(`The tables have no row of a ${sex}.`);
      continue;
    }
    rows.sort((a, b) => a.from - b.from);
    // The first month with no row so far. It is Infinity after an open row.
    let next = 0;
    for (const row of rows) {
      if (row.from > next) add(`The tables have no row of a ${sex} for the months ${String(next)} to ${String(row.from - 1)}.`);
      next = Math.max(next, row.to === undefined ? Infinity : row.to + 1);
    }
    if (next !== Infinity) add(`The rows of a ${sex} end at ${String(next - 1)} months. The chain has no open last row.`);
  }
  return findings;
}

/** This function tells if a list of findings has an error. */
export function hasNeedsError(findings: readonly NeedsFinding[]): boolean {
  return findings.some((finding) => finding.level === "error");
}
