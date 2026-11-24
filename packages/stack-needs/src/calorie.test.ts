import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ACTIVITY_LEVELS, CALORIE_SEXES, calorieChange, calorieNeed, calorieRow, calorieRowOf, type ActivityLevel, type CalorieRow, type CalorieSex, type Person } from "./calorie.ts";
import { CALORIE_CHAIN, DGA_CALORIES, NASEM_INFANT_CALORIES } from "./data.ts";

const dga = DGA_CALORIES;
const years = (months: number): number => months * 12;

/** The need of a row at a level, in kcal/d. A toddler row has one need for each level. */
function rowNeed(row: CalorieRow, level: ActivityLevel): number {
  return row.need.levels === undefined ? row.need.each.value : row.need.levels[level].value;
}

/** The rows of Table A2-2: the ages of 2 years and more. */
const yearRows = dga.rows.filter((row) => row.from >= years(2));
const toddlerRows = dga.rows.filter((row) => row.from < years(2));
const rowsOf = (sex: CalorieSex, from: number, to: number): CalorieRow[] => dga.rows.filter((row) => row.sex === sex && row.from >= from && row.from <= to);
const needs = (rows: readonly CalorieRow[]): number[] => rows.flatMap((row) => ACTIVITY_LEVELS.map((level) => rowNeed(row, level)));
const range = (values: number[]): [number, number] => [Math.min(...values), Math.max(...values)];

/** Two made-up adults of 33 years. */
const adults: Person[] = [
  { sex: "male", ageMonths: years(33), count: 1 },
  { sex: "female", ageMonths: years(33), count: 1 },
];

describe("the data of the calorie table", () => {
  it("has 68 rows: 4 toddler rows and 30 rows of years for each sex, each need in kcal/d", () => {
    expect(dga.rows).toHaveLength(68);
    for (const sex of CALORIE_SEXES) {
      expect(toddlerRows.filter((row) => row.sex === sex), sex).toHaveLength(4);
      expect(yearRows.filter((row) => row.sex === sex), sex).toHaveLength(30);
    }
    for (const row of dga.rows) {
      // Table A2-1 gives one need for each age and sex of a toddler. Table A2-2 gives a need for each level.
      expect(row.need.each !== undefined, `${row.sex} ${row.age}`).toBe(row.from < years(2));
      for (const need of row.need.each === undefined ? Object.values(row.need.levels) : [row.need.each]) expect(need.unit).toBe("kcal/d");
    }
  });

  it("covers each age from 12 months with no gap and no overlap", () => {
    for (const sex of CALORIE_SEXES) {
      const rows = dga.rows.filter((row) => row.sex === sex).sort((a, b) => a.from - b.from);
      expect(rows[0]?.from).toBe(12);
      for (let index = 1; index < rows.length; index += 1) expect(rows[index]?.from, `${sex} ${String(index)}`).toBe((rows[index - 1]?.to ?? Infinity) + 1);
      expect(rows.at(-1)?.to).toBeUndefined();
    }
  });

  it("adds each column of Table A2-2 to the sum of the PDF text", () => {
    // The sums come from a machine read of the text of pages 140 and 141 of the PDF, apart from the values of the data.
    const sum = (sex: CalorieSex, level: ActivityLevel): number => yearRows.filter((row) => row.sex === sex).reduce((total, row) => total + rowNeed(row, level), 0);
    expect(ACTIVITY_LEVELS.map((level) => sum("male", level))).toEqual([57800, 65600, 74000]);
    expect(ACTIVITY_LEVELS.map((level) => sum("female", level))).toEqual([47400, 54000, 61200]);
  });

  it("holds the ranges of the text of Appendix 2", () => {
    // The text gives 700 to 1,000 calories for the toddlers. The lowest value of Table A2-1 is 800.
    expect(range(needs(toddlerRows))).toEqual([800, 1000]);
    const children = [...rowsOf("female", years(2), years(8)), ...rowsOf("male", years(2), years(8))];
    expect(range(needs(children))).toEqual([1000, 2000]);
    const teens = [...rowsOf("female", years(9), years(18)), ...rowsOf("male", years(9), years(18))];
    expect(range(needs(teens))).toEqual([1400, 3200]);
    expect(range(needs(rowsOf("female", years(19), Infinity)))).toEqual([1600, 2400]);
    expect(range(needs(rowsOf("male", years(19), Infinity)))).toEqual([2000, 3000]);
  });

  it("has the values of some rows of the tables", () => {
    const row = (sex: CalorieSex, ageMonths: number): number[] => {
      const found = calorieRow(dga, sex, ageMonths);
      if (found === undefined) throw new Error(`No row for ${sex} ${String(ageMonths)}`);
      return ACTIVITY_LEVELS.map((level) => rowNeed(found, level));
    };
    expect(row("male", 12)).toEqual([800, 800, 800]);
    expect(row("female", 18)).toEqual([900, 900, 900]);
    expect(row("male", years(3))).toEqual([1000, 1400, 1400]);
    expect(row("female", years(3))).toEqual([1000, 1200, 1400]);
    expect(row("male", years(16))).toEqual([2400, 2800, 3200]);
    expect(row("male", years(19))).toEqual([2600, 2800, 3000]);
    expect(row("female", years(26))).toEqual([1800, 2000, 2400]);
    expect(row("female", years(51))).toEqual([1600, 1800, 2200]);
    expect(row("male", years(61))).toEqual([2000, 2400, 2600]);
    expect(row("male", years(76))).toEqual([2000, 2200, 2400]);
    expect(row("female", years(90))).toEqual([1600, 1800, 2000]);
  });

  it("gives a need that does not decrease from sedentary to active in each row", () => {
    for (const row of yearRows) {
      const [sedentary = 0, moderate = 0, active = 0] = ACTIVITY_LEVELS.map((level) => rowNeed(row, level));
      expect(sedentary <= moderate && moderate <= active, `${row.sex} ${row.age}`).toBe(true);
    }
  });
});

describe("the calorie need of a household", () => {
  it("adds the need of each person for the days", () => {
    expect(calorieNeed(dga, adults, "sedentary", 1).need).toEqual({ value: 2400 + 1800, unit: "kcal" });
    expect(calorieNeed(dga, adults, "active", 14).need).toEqual({ value: (3000 + 2200) * 14, unit: "kcal" });
    expect(calorieNeed(dga, [{ sex: "female", ageMonths: years(8), count: 3 }], "moderately-active", 2).need.value).toBe(3 * 1600 * 2);
  });

  it("gives the row, the level and the count of each line", () => {
    const total = calorieNeed(dga, adults, "sedentary", 1);
    expect(total.read).toBe(true);
    expect(total.persons).toBe(2);
    expect(total.lines.map((line) => (line.read ? [line.row, line.level, line.need.value] : []))).toEqual([
      ["31-35", "sedentary", 2400],
      ["31-35", "sedentary", 1800],
    ]);
  });

  it("uses the level of a person before the level of the call", () => {
    const persons: Person[] = [
      { sex: "male", ageMonths: years(33), count: 1, level: "active" },
      { sex: "female", ageMonths: years(33), count: 1 },
    ];
    expect(calorieNeed(dga, persons, "sedentary", 1).need.value).toBe(3000 + 1800);
  });

  it("gives the one need of a toddler at each level", () => {
    for (const level of ACTIVITY_LEVELS) expect(calorieNeed(dga, [{ sex: "female", ageMonths: 15, count: 1 }], level, 1).need.value, level).toBe(800);
  });

  it("gives a line with no read for an age with no row, and a total that is a lower limit", () => {
    const total = calorieNeed(dga, [...adults, { sex: "female", ageMonths: 6, count: 1 }], "sedentary", 1);
    expect(total.read).toBe(false);
    expect(total.persons).toBe(3);
    expect(total.need.value).toBe(4200);
    expect(total.lines[2]).toMatchObject({ read: false });
  });

  it("is in proportion to the count of days", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 400 }), fc.constantFrom(...ACTIVITY_LEVELS), (a, b, level) => {
        const sum = calorieNeed(dga, adults, level, a).need.value + calorieNeed(dga, adults, level, b).need.value;
        expect(calorieNeed(dga, adults, level, a + b).need.value).toBeCloseTo(sum, 6);
      }),
      { numRuns: 100 },
    );
  });

  it("refuses a household with no person, a bad count or age, an unknown sex or level, and a bad count of days", () => {
    expect(() => calorieNeed(dga, [], "sedentary", 7)).toThrow(RangeError);
    expect(() => calorieNeed(dga, [{ sex: "male", ageMonths: years(33), count: 0 }], "sedentary", 7)).toThrow(RangeError);
    for (const count of [-1, 1.5, Number.NaN]) expect(() => calorieNeed(dga, [{ sex: "male", ageMonths: years(33), count }], "sedentary", 7), String(count)).toThrow(RangeError);
    for (const ageMonths of [-1, 12.5]) expect(() => calorieNeed(dga, [{ sex: "male", ageMonths, count: 1 }], "sedentary", 7), String(ageMonths)).toThrow(RangeError);
    expect(() => calorieNeed(dga, [{ sex: "other" as never, ageMonths: years(33), count: 1 }], "sedentary", 7)).toThrow(RangeError);
    expect(() => calorieNeed(dga, adults, "lazy" as never, 7)).toThrow(RangeError);
    expect(() => calorieNeed(dga, [{ sex: "male", ageMonths: years(33), count: 1, level: "lazy" as never }], "active", 7)).toThrow(RangeError);
    for (const days of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => calorieNeed(dga, adults, "sedentary", days), String(days)).toThrow(RangeError);
  });

  it("adds the change of Table A2-3 to the need of the row of a woman at a stage of pregnancy or lactation", () => {
    expect(dga.changes?.map((change) => [change.stage, change.change.value])).toEqual([
      ["pregnancy-1", 0],
      ["pregnancy-2", 340],
      ["pregnancy-3", 452],
      ["lactation-1", 330],
      ["lactation-2", 400],
    ]);
    for (const change of dga.changes ?? []) {
      expect(change.sex).toBe("female");
      expect(change.change.unit).toBe("kcal/d");
      expect(change.condition).toContain("healthy weight before the pregnancy");
    }
    // A made-up woman of 33 years: 1800 kcal/d at the level sedentary, and 452 kcal/d more in the third trimester.
    const woman = { sex: "female", ageMonths: years(33), count: 1 } as const;
    const third = calorieNeed(dga, [{ ...woman, stage: "pregnancy-3" }], "sedentary", 10);
    expect(third.need).toEqual({ value: 22520, unit: "kcal" });
    expect(third.lines[0]).toMatchObject({ read: true, row: "31-35", stage: "pregnancy-3" });
    expect(calorieNeed(dga, [{ ...woman, stage: "pregnancy-1" }], "sedentary", 1).need.value).toBe(1800);
    expect(calorieNeed(dga, [{ ...woman, stage: "lactation-1", count: 2 }], "active", 1).need.value).toBe(2 * (2200 + 330));
    // A record with no stage has no stage in its line.
    expect(calorieNeed(dga, [woman], "sedentary", 1).lines[0]).not.toHaveProperty("stage");
  });

  it("throws for a stage that the table does not have for the sex of the record, so no draw loses the persons", () => {
    const man = { sex: "male", ageMonths: years(33), count: 1, stage: "pregnancy-2" } as const;
    expect(calorieChange(dga, "male", "pregnancy-2")).toBeUndefined();
    expect(calorieChange(dga, "female", "pregnancy-2")?.title).toBe("Pregnancy: 2nd trimester");
    expect(() => calorieNeed(dga, [man], "sedentary", 1)).toThrow(/no change for the stage pregnancy-2/u);
    expect(() => calorieNeed(dga, [{ ...man, sex: "female", stage: "pregnancy-4" }], "sedentary", 1)).toThrow(RangeError);
    expect(() => calorieNeed({ ...dga, changes: undefined }, [{ ...man, sex: "female" }], "sedentary", 1)).toThrow(RangeError);
    // A change that makes the daily need 0 or less throws, so it cannot lower a total with no finding.
    const lower = { ...dga, changes: [{ stage: "test", title: "Test", sex: "female" as const, change: { value: -5000, unit: "kcal/d" } }] };
    expect(() => calorieNeed(lower, [{ ...man, sex: "female", stage: "test" }], "sedentary", 1)).toThrow(/must be above 0/u);
  });
});

describe("the infant table and the chain of tables", () => {
  const nasem = NASEM_INFANT_CALORIES;
  const each = (sex: CalorieSex): number[] => nasem.rows.filter((row) => row.sex === sex).map((row) => rowNeed(row, "sedentary"));

  it("has the 24 rows of Tables 7-5 and 7-6: 12 groups of 3 months for each sex, from 0 to 35 months", () => {
    expect(nasem.rows).toHaveLength(24);
    for (const sex of CALORIE_SEXES) {
      const rows = nasem.rows.filter((row) => row.sex === sex);
      expect(rows.map((row) => [row.from, row.to])).toEqual(Array.from({ length: 12 }, (_, index) => [3 * index, 3 * index + 2]));
      for (const row of rows) expect(row.need.each?.unit).toBe("kcal/d");
    }
    expect(each("male")).toEqual([566, 589, 675, 745, 821, 881, 952, 1027, 1058, 1136, 1183, 1213]);
    expect(each("female")).toEqual([531, 546, 604, 689, 780, 817, 881, 956, 1011, 1051, 1122, 1192]);
  });

  it("gives an infant the need of the infant table, and a toddler the need of the guidelines, which come first", () => {
    const persons: Person[] = [
      { sex: "female", ageMonths: 0, count: 1 },
      { sex: "male", ageMonths: 10, count: 2 },
      { sex: "male", ageMonths: 12, count: 1 },
    ];
    const total = calorieNeed(CALORIE_CHAIN, persons, "active", 1);
    expect(total.read).toBe(true);
    expect(total.lines.map((line) => (line.read ? [line.table, line.row, line.need.value] : []))).toEqual([
      [nasem.id, "Birth-2", 531],
      [nasem.id, "9-11", 2 * 745],
      [dga.id, "12 months", 800],
    ]);
    // In the other order, the infant table gives the need of 12 months.
    expect(calorieNeed([nasem, dga], [{ sex: "male", ageMonths: 12, count: 1 }], "active", 1).need.value).toBe(821);
    expect(calorieRowOf([nasem, dga], "male", years(33))?.table.id).toBe(dga.id);
    expect(calorieRowOf(nasem, "male", 36)).toBeUndefined();
  });

  it("gives a row for each age of 0 to 100 years, for each sex", () => {
    for (const sex of CALORIE_SEXES) {
      const missing = Array.from({ length: years(100) + 1 }, (_, ageMonths) => ageMonths).filter((ageMonths) => calorieRowOf(CALORIE_CHAIN, sex, ageMonths) === undefined);
      expect(missing, sex).toEqual([]);
    }
  });

  it("takes the change of a stage from the table of the row, and refuses an empty list of tables", () => {
    const woman = { sex: "female", ageMonths: years(33), count: 1, stage: "lactation-1" } as const;
    expect(calorieNeed(CALORIE_CHAIN, [woman], "sedentary", 1).need.value).toBe(1800 + 330);
    // The infant table has no changes, so a stage of a person of its rows is an error.
    expect(() => calorieNeed(CALORIE_CHAIN, [{ ...woman, ageMonths: 6 }], "sedentary", 1)).toThrow(/of the row of the persons female of 6 months has no change/u);
    expect(() => calorieNeed(nasem, [{ ...woman, ageMonths: 6 }], "sedentary", 1)).toThrow(/have no change for the stage/u);
    expect(() => calorieNeed([], [woman], "sedentary", 1)).toThrow(/list of tables is empty/u);
  });
});
