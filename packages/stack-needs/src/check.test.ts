import { describe, expect, it } from "vitest";
import type { CalorieTable } from "./calorie.ts";
import { checkCalorieChain, checkCalorieTable, hasNeedsError } from "./check.ts";
import { CALORIE_CHAIN, CALORIE_TABLES, DGA_CALORIES, DGA_SOURCE, NASEM_ENERGY_SOURCE, NASEM_INFANT_CALORIES } from "./data.ts";

const kcal = (value: number, unit = "kcal/d"): { value: number; unit: string } => ({ value, unit });

describe("the gate of a calorie table", () => {
  it("passes each table of the package, with the gate of the sources of guidebook at the date of the read", () => {
    for (const table of CALORIE_TABLES) expect(checkCalorieTable(table, { at: "2026-11-24" }), table.id).toEqual([]);
    expect(checkCalorieChain(CALORIE_CHAIN, { at: "2026-11-24" })).toEqual([]);
  });

  it("cites the PDF of the report of the National Academies with its hash, its tables and its pages", () => {
    expect(NASEM_ENERGY_SOURCE.url).toBe("https://nap.nationalacademies.org/26818");
    expect(NASEM_ENERGY_SOURCE.sha256).toMatch(/^e6a7d9c9[0-9a-f]{56}$/u);
    expect(NASEM_ENERGY_SOURCE.license).toBe("all-rights-reserved");
    expect(NASEM_ENERGY_SOURCE.note).toContain("10.17226/26818");
    expect(NASEM_INFANT_CALORIES.locator).toContain("Table 7-5 (boys of 0 to 35 months, page 160)");
    expect(NASEM_INFANT_CALORIES.locator).toContain("Table 7-6 (girls of 0 to 35 months, page 161)");
  });

  it("cites the PDF of the guidelines with its hash, its tables and its pages", () => {
    expect(DGA_SOURCE.url).toMatch(/^https:\/\/www\.dietaryguidelines\.gov\/.+\.pdf$/u);
    expect(DGA_SOURCE.sha256).toMatch(/^ceea04ce[0-9a-f]{56}$/u);
    expect(DGA_SOURCE.license).toBe("us-public-domain");
    expect(DGA_SOURCE.checked).toBe("2026-11-22");
    expect(DGA_CALORIES.locator).toContain("Table A2-1");
    expect(DGA_CALORIES.locator).toContain("Table A2-2");
    expect(DGA_CALORIES.locator).toContain("page 139");
    expect(DGA_CALORIES.locator).toContain("pages 140 and 141");
    expect(DGA_CALORIES.locator).toContain("Table A2-3 (pregnancy and lactation, page 141)");
  });

  it("finds the gap of a row of one age of one sex that is not in the table", () => {
    const rows = DGA_CALORIES.rows.filter((row) => !(row.sex === "female" && row.age === "36-40"));
    const faults = checkCalorieTable({ ...DGA_CALORIES, rows }, { at: "2026-11-22" });
    expect(faults.map((fault) => fault.code)).toEqual(["needs-gap"]);
    expect(faults[0]?.message).toContain("432 to 491");
  });

  it("finds the months that a chain does not cover, and a chain with no open last row", () => {
    const messages = (tables: Parameters<typeof checkCalorieChain>[0]): string[] =>
      checkCalorieChain(tables, { at: "2026-11-24" }).map((fault) => `${fault.code} ${fault.record} ${fault.message}`);
    // A table alone can start after month 0 or end at a closed row. The gate of a chain finds it.
    expect(checkCalorieTable(NASEM_INFANT_CALORIES, { at: "2026-11-24" })).toEqual([]);
    expect(messages(DGA_CALORIES)).toEqual([
      "needs-gap chain The tables have no row of a female for the months 0 to 11.",
      "needs-gap chain The tables have no row of a male for the months 0 to 11.",
    ]);
    expect(messages(NASEM_INFANT_CALORIES)).toEqual([
      "needs-gap chain The rows of a female end at 35 months. The chain has no open last row.",
      "needs-gap chain The rows of a male end at 35 months. The chain has no open last row.",
    ]);
    const rows = DGA_CALORIES.rows.map((row) => (row.sex === "male" && row.to === undefined ? { ...row, to: 1199 } : row));
    expect(messages([{ ...DGA_CALORIES, rows }, NASEM_INFANT_CALORIES])).toEqual(["needs-gap chain The rows of a male end at 1199 months. The chain has no open last row."]);
    expect(messages([])).toEqual(["needs-gap chain The chain has no table.", "needs-gap chain The tables have no row of a female.", "needs-gap chain The tables have no row of a male."]);
  });

  it("finds a bad source, a bad hash, a bad row, an overlap and a bad need", () => {
    const broken: CalorieTable = {
      id: "broken",
      title: "A broken table",
      source: { id: "broken", title: "", url: "ftp://example.com", license: "no-license" as never, checked: "2026-13-40", sha256: "CEEA" },
      locator: "Nowhere",
      rows: [
        { sex: "female", age: "20-30", from: 240, to: 371, need: { each: kcal(2000) } },
        { sex: "female", age: "25-35", from: 300, to: 431, need: { each: kcal(2000) } },
        { sex: "male", age: "", from: 10, to: 5, need: { each: kcal(0) } },
        { sex: "male", age: "40", from: 480, to: 491, need: { levels: { sedentary: kcal(2000), "moderately-active": kcal(2200, "kg"), active: kcal(2400) } } },
      ],
    };
    const faults = checkCalorieTable(broken);
    expect(hasNeedsError(faults)).toBe(true);
    const source = faults.filter((fault) => fault.record === "source").map((fault) => fault.code);
    // The source has no publisher and no page of its terms, so the rules of a table give two findings missing-field.
    expect([...source].sort()).toEqual(["bad-date", "bad-sha256", "bad-url", "empty-title", "missing-field", "missing-field", "unknown-license"]);
    expect(faults.filter((fault) => fault.record === "row").map((fault) => fault.code)).toEqual(["needs-overlap", "needs-row", "needs-row", "needs-value", "needs-value"]);
  });

  it("refuses a change with no stage, a change of a stage and sex two times, and a change that is not a finite number in kcal/d", () => {
    const [first, second] = DGA_CALORIES.changes ?? [];
    if (first === undefined || second === undefined) throw new Error("The table has no changes.");
    const codes = (changes: CalorieTable["changes"]): string[] => checkCalorieTable({ ...DGA_CALORIES, changes }, { at: "2026-11-22" }).map((fault) => `${fault.code} ${fault.id}`);
    expect(codes([{ ...first, stage: " " }])).toEqual(["needs-change dga.2020-2025:calorie-needs.changes[0]"]);
    expect(codes([first, { ...second, stage: first.stage }])).toEqual(["needs-change dga.2020-2025:calorie-needs.changes[1]"]);
    // The same stage for the other sex is a different change.
    expect(codes([first, { ...first, sex: "male" }])).toEqual([]);
    expect(codes([{ ...first, change: kcal(Number.NaN) }])).toEqual(["needs-change dga.2020-2025:calorie-needs.changes[0]"]);
    expect(codes([{ ...first, change: kcal(340, "kcal") }])).toEqual(["needs-change dga.2020-2025:calorie-needs.changes[0]"]);
    expect(codes([{ ...first, change: kcal(-100) }])).toEqual([]);
    // The smallest need of a female is 800 kcal/d, so a change of -800 makes it 0.
    expect(codes([{ ...first, change: kcal(-799) }])).toEqual([]);
    expect(codes([{ ...first, change: kcal(-800) }])).toEqual(["needs-change dga.2020-2025:calorie-needs.changes[0]"]);
    // A stage with a space at an end matches no person, so the gate refuses it.
    expect(codes([{ ...first, stage: "pregnancy-1 " }])).toEqual(["needs-change dga.2020-2025:calorie-needs.changes[0]"]);
  });
});
