import { describe, expect, it } from "vitest";
import type { CalorieTable } from "./calorie.ts";
import { checkCalorieTable, hasNeedsError } from "./check.ts";
import { CALORIE_TABLES, DGA_CALORIES, DGA_SOURCE } from "./data.ts";

const kcal = (value: number, unit = "kcal/d"): { value: number; unit: string } => ({ value, unit });

describe("the gate of a calorie table", () => {
  it("passes each table of the package, with the gate of the sources of guidebook at the date of the read", () => {
    for (const table of CALORIE_TABLES) expect(checkCalorieTable(table, { at: "2026-11-22" }), table.id).toEqual([]);
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
    expect([...source].sort()).toEqual(["bad-date", "bad-url", "empty-title", "needs-hash", "unknown-license"]);
    expect(faults.filter((fault) => fault.record === "row").map((fault) => fault.code)).toEqual(["needs-overlap", "needs-row", "needs-row", "needs-value", "needs-value"]);
  });
});
