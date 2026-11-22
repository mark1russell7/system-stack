import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";

describe("the entry", () => {
  it("has the data, the gate, the need and the join", () => {
    expect(entry.CALORIE_TABLES).toContain(entry.DGA_CALORIES);
    expect(entry.checkCalorieTable).toBeTypeOf("function");
    expect(entry.calorieNeed).toBeTypeOf("function");
    expect(entry.foodFragment).toBeTypeOf("function");
  });
});
