import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";
import * as schema from "./schema.ts";

describe("the root entry", () => {
  it("has the format, the programs, the states, the gate, the steps and the sample", () => {
    expect(entry.SPEND_SCHEMA).toBe("spend/1");
    for (const name of ["IS_HARD", "HARD_COUNT", "HARD_LIMIT", "MONTH_MAX", "BOUNDED_TOTAL", "OPEN_SERVICES"] as const) {
      expect(entry[name]).toBeTypeOf("object");
    }
    for (const name of ["spendSpace", "evaluateService", "serviceStates", "monthTotal", "dayNumber", "checkSpend", "ownerSteps"] as const) {
      expect(entry[name]).toBeTypeOf("function");
    }
    expect(entry.SAMPLE_SPEND.schema).toBe(entry.SPEND_SCHEMA);
  });

  it("has no schema", () => {
    for (const name of ["spendSchema", "parseSpend"]) expect(entry).not.toHaveProperty(name);
  });
});

describe("the entry /schema", () => {
  it("has the schema and the read of a spend layer", () => {
    expect(Object.keys(schema).sort()).toEqual(["parseSpend", "spendSchema"]);
  });
});
