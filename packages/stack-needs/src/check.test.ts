import { checkHazards, HAZARDS_SCHEMA, type Source as HazardSource } from "@mark1russell7/stack-hazards";
import { describe, expect, it } from "vitest";
import type { CalorieTable } from "./calorie.ts";
import { checkCalorieTable, hasNeedsError } from "./check.ts";
import { CALORIE_TABLES, DGA_CALORIES, DGA_SOURCE } from "./data.ts";

const kcal = (value: number, unit = "kcal/d"): { value: number; unit: string } => ({ value, unit });

describe("the gate of a calorie table", () => {
  it("passes each table of the package", () => {
    for (const table of CALORIE_TABLES) expect(checkCalorieTable(table), table.id).toEqual([]);
  });

  it("passes the source gate of stack-hazards", () => {
    // The source has the fields of a source of stack-hazards. The gate of that package examines it in a list with no case.
    const source: HazardSource = DGA_SOURCE;
    expect(checkHazards({ schema: HAZARDS_SCHEMA, sources: { "dga.2020-2025": source }, hazards: [] })).toEqual([]);
  });

  it("cites the PDF of the guidelines with its hash, its tables and its pages", () => {
    expect(DGA_SOURCE.url).toMatch(/^https:\/\/www\.dietaryguidelines\.gov\/.+\.pdf$/u);
    expect(DGA_SOURCE.sha256).toMatch(/^ceea04ce[0-9a-f]{56}$/u);
    expect(DGA_SOURCE.license.name).toMatch(/public domain/iu);
    expect(DGA_CALORIES.locator).toContain("Table A2-1");
    expect(DGA_CALORIES.locator).toContain("Table A2-2");
    expect(DGA_CALORIES.locator).toContain("page 139");
    expect(DGA_CALORIES.locator).toContain("pages 140 and 141");
  });

  it("finds a bad source, a bad license, a bad row, an overlap and a bad need", () => {
    const broken: CalorieTable = {
      id: "broken",
      title: "A broken table",
      source: { name: "", url: "http://example.com", publisher: "", license: { name: "", url: "" }, read: "2026-13-40", sha256: "CEEA" },
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
    expect(faults.map((fault) => fault.code)).toEqual([
      "needs-source",
      "needs-source",
      "needs-source",
      "needs-source",
      "needs-source",
      "needs-license",
      "needs-overlap",
      "needs-row",
      "needs-row",
      "needs-value",
      "needs-value",
    ]);
  });
});
