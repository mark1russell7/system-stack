import { quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import type { Source } from "@mark1russell7/guidebook";

// The energy need of the persons of a household, from a cited table of estimated calorie needs.
// The package names no person. The persons and their activity level are input data.
// A person record has a sex, an age in months and a count. Each table finds its own row from its own age ranges.

/** The activity levels of the table, as the source names them: sedentary, moderately active and active. */
export const ACTIVITY_LEVELS: readonly ["sedentary", "moderately-active", "active"] = ["sedentary", "moderately-active", "active"];

/** An activity level of the table. */
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/** The sexes of the table. */
export const CALORIE_SEXES: readonly ["female", "male"] = ["female", "male"];

/** A sex of the table. */
export type CalorieSex = (typeof CALORIE_SEXES)[number];

/**
 * The estimated calorie need of one person of a row for each day. A row gives a need for each activity level, or one need for all levels.
 * The table of the toddlers gives one need for each age and sex only. Each need has a unit of energy for each day, for example `{ "value": 2000, "unit": "kcal/d" }`.
 */
export type CalorieNeed = { readonly levels: Readonly<Record<ActivityLevel, Quantity>>; readonly each?: never } | { readonly each: Quantity; readonly levels?: never };

/** A row of a table of calorie needs: a sex, a range of ages in months, and the need. */
export interface CalorieRow {
  readonly sex: CalorieSex;
  /** The age as the source names it, for example `19-20` (years) or `21 through 23 months`. */
  readonly age: string;
  /** The first age of the row, in whole months. */
  readonly from: number;
  /** The last age of the row, in whole months. Without it, the row applies to each larger age. */
  readonly to?: number | undefined;
  readonly need: CalorieNeed;
}

/**
 * A change of the daily need of a person at a stage, for example the second trimester of a pregnancy. The change adds
 * to the need of the row of the person. It can be 0.
 */
export interface CalorieChange {
  /** The id of the stage, for example `pregnancy-2`. */
  readonly stage: string;
  /** The stage as the source names it, for example `Pregnancy: 2nd trimester`. */
  readonly title: string;
  /** The sex of the persons of the stage. */
  readonly sex: CalorieSex;
  /** The change of the need for each day, in a unit of energy for each day, for example `{ "value": 340, "unit": "kcal/d" }`. */
  readonly change: Quantity;
  /** The condition of the source for the change, for example a healthy weight before the pregnancy. */
  readonly condition?: string | undefined;
}

/** A table of estimated calorie needs from one source. */
export interface CalorieTable {
  /** The id, for example `dga.2020-2025:calorie-needs`. */
  readonly id: string;
  readonly title: string;
  readonly source: Source;
  /** The place of the tables in the source: the tables and their pages. */
  readonly locator: string;
  /** The rows of the table. The age ranges of the rows of one sex do not overlap. */
  readonly rows: readonly CalorieRow[];
  /** The changes of the need at each stage. The stage and the sex of each change are unique. */
  readonly changes?: readonly CalorieChange[] | undefined;
}

/**
 * One table, or tables in order. For each person, the first table with a row for the age gives the need.
 * An example is `CALORIE_CHAIN`: the guidelines from 12 months, and the infant table below 12 months.
 */
export type CalorieTables = CalorieTable | readonly CalorieTable[];

/** A group of persons of the same sex and age, and their count. */
export interface Person {
  readonly sex: CalorieSex;
  /** The age, in whole months, for example 420 for 35 years. */
  readonly ageMonths: number;
  readonly count: number;
  /** The activity level of the persons. Without it, the level of the call applies. */
  readonly level?: ActivityLevel | undefined;
  /** The stage of the persons, for example `pregnancy-2`: the stage of a change of the table. Without it, no change applies. */
  readonly stage?: string | undefined;
}

/** The need of one person record for the days, or no read when the table has no row for the age. */
export type CalorieNeedLine =
  | { readonly person: Person; readonly read: true; readonly level: ActivityLevel; readonly table: string; readonly row: string; readonly stage?: string | undefined; readonly need: Quantity }
  | { readonly person: Person; readonly read: false; readonly why: string };

/** The energy need of the persons of a household for a count of days. */
export interface CalorieNeedTotal {
  /** The need of each person record, in the order of the input. */
  readonly lines: readonly CalorieNeedLine[];
  /** True when each line has a read. When it is false, `need` is a lower limit. */
  readonly read: boolean;
  /** The sum of the needs of the lines with a read, in `kcal`. */
  readonly need: Quantity;
  /** The count of the persons of all the records, also of the records with no read. */
  readonly persons: number;
}

/** The unit of each food energy. */
const ENERGY_UNIT = "kcal";
/** The unit of each daily need. */
const DAILY_UNIT = "kcal/d";

/** This function tells if a value is an activity level of the table. */
export function isActivityLevel(level: unknown): level is ActivityLevel {
  return (ACTIVITY_LEVELS as readonly unknown[]).includes(level);
}

/**
 * This function gives the row of a table for a sex and an age in months, or `undefined` when the table has no row.
 *
 * @param table - The table of calorie needs
 * @param sex - The sex
 * @param ageMonths - The age, in whole months
 */
export function calorieRow(table: CalorieTable, sex: CalorieSex, ageMonths: number): CalorieRow | undefined {
  return table.rows.find((row) => row.sex === sex && ageMonths >= row.from && (row.to === undefined || ageMonths <= row.to));
}

/**
 * This function gives the first table with a row for a sex and an age in months, and its row.
 * It gives `undefined` when no table has a row.
 *
 * @param tables - One table, or tables in order
 * @param sex - The sex
 * @param ageMonths - The age, in whole months
 */
export function calorieRowOf(tables: CalorieTables, sex: CalorieSex, ageMonths: number): { readonly table: CalorieTable; readonly row: CalorieRow } | undefined {
  for (const table of tableList(tables)) {
    const row = calorieRow(table, sex, ageMonths);
    if (row !== undefined) return { table, row };
  }
  return undefined;
}

/** This function gives the tables of the input as a list. */
function tableList(tables: CalorieTables): readonly CalorieTable[] {
  return "rows" in tables ? [tables] : tables;
}

/**
 * This function gives the change of a table for a sex and a stage, or `undefined` when the table has no such change.
 *
 * @param table - The table of calorie needs
 * @param sex - The sex
 * @param stage - The id of the stage, for example `pregnancy-2`
 */
export function calorieChange(table: CalorieTable, sex: CalorieSex, stage: string): CalorieChange | undefined {
  return table.changes?.find((change) => change.sex === sex && change.stage === stage);
}

/**
 * This function gives the energy need of the persons of a household for a count of days, in `kcal`.
 * It adds the need of each person at the activity level of that person. The first table with a row for the age of a person gives the row.
 *
 * - An age with no row in the tables gives a line with no read, for example 6 months in `DGA_CALORIES` alone. Then the total is a lower limit.
 * - Each line with a read has the `id` of the table of its row.
 * - The table of the toddlers gives one need for each age and sex. Thus the level does not change the need of a toddler.
 * - A record with a stage adds the change of the stage to the need of its row, for example 340 kcal/d in the second trimester. The change comes from the table of the row.
 * - One stage holds for each day of the call. For a period that crosses stages, the planner selects the stage, for example the stage with the largest change.
 *
 * The activity level is an explicit input. This package has no default level. The planner selects it, also for the worst case of a long power cut.
 * In that case, work can make the level higher, for example the carry of water. The function is pure.
 *
 * @param tables - The table of calorie needs, or tables in order
 * @param persons - The person records of the household: a sex, an age in months, a count and, as an option, a level
 * @param level - The activity level of each record with no level of its own
 * @param days - The count of days, a finite number of 0 or more
 * @throws RangeError when a count of persons or an age is not a whole number of 0 or more, or when the household has no person
 * @throws RangeError when a level is not a level of the table, or when a sex is not a sex of the table
 * @throws RangeError when the count of days is not a finite number of 0 or more, or when the list of tables is empty
 * @throws RangeError when no table has the change for the stage and the sex of a record
 * @throws RangeError when the table of the row of a record has no change for the stage and the sex of the record
 * @throws RangeError when the daily need of a record, with the change of its stage, is not above 0
 */
export function calorieNeed(tables: CalorieTables, persons: readonly Person[], level: ActivityLevel, days: number): CalorieNeedTotal {
  if (!(Number.isFinite(days) && days >= 0)) throw new RangeError(`The count of days is ${String(days)}. It must be a finite number of 0 or more.`);
  if (!isActivityLevel(level)) throw new RangeError(`The activity level ${String(level)} is not a level of the table.`);
  const list = tableList(tables);
  if (list.length === 0) throw new RangeError("The list of tables is empty.");
  const ids = list.map((table) => table.id).join(", ");
  let count = 0;
  const lines = persons.map((person): CalorieNeedLine => {
    const name = `${String(person.sex)} of ${String(person.ageMonths)} months`;
    if (!(Number.isSafeInteger(person.count) && person.count >= 0)) throw new RangeError(`The count of the persons ${name} is ${String(person.count)}. It must be a whole number of 0 or more.`);
    if (!(Number.isSafeInteger(person.ageMonths) && person.ageMonths >= 0)) throw new RangeError(`The age of the persons ${name} is not a whole number of months of 0 or more.`);
    if (!(CALORIE_SEXES as readonly unknown[]).includes(person.sex)) throw new RangeError(`The sex ${String(person.sex)} is not a sex of the table.`);
    const own = person.level ?? level;
    if (!isActivityLevel(own)) throw new RangeError(`The activity level ${String(own)} of the persons ${name} is not a level of the table.`);
    // A stage that the table does not have is an error, not a no read: the option leave-out would remove the persons from a draw.
    const { stage } = person;
    if (stage !== undefined && list.every((table) => calorieChange(table, person.sex, stage) === undefined)) throw new RangeError(`The tables ${ids} have no change for the stage ${String(stage)} of the persons ${name}.`);
    count += person.count;
    const found = calorieRowOf(list, person.sex, person.ageMonths);
    if (found === undefined) return { person, read: false, why: `The tables ${ids} have no row for a ${name}.` };
    const { table, row } = found;
    const change = stage === undefined ? undefined : calorieChange(table, person.sex, stage);
    if (stage !== undefined && change === undefined) throw new RangeError(`The table ${table.id} of the row of the persons ${name} has no change for the stage ${String(stage)}.`);
    const daily = valueIn(row.need.levels === undefined ? row.need.each : row.need.levels[own], DAILY_UNIT) + (change === undefined ? 0 : valueIn(change.change, DAILY_UNIT));
    if (!(daily > 0)) throw new RangeError(`The daily need of the persons ${name} at the stage ${String(person.stage)} is ${String(daily)} kcal/d. It must be above 0.`);
    const line = { person, read: true as const, level: own, table: table.id, row: row.age, need: quantity(person.count * daily * days, ENERGY_UNIT) };
    return change === undefined ? line : { ...line, stage: change.stage };
  });
  if (count === 0) throw new RangeError("The household has no person.");
  const total = lines.reduce((sum, line) => sum + (line.read ? line.need.value : 0), 0);
  return { lines, read: lines.every((line) => line.read), need: quantity(total, ENERGY_UNIT), persons: count };
}
