import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";
import * as schema from "./schema.ts";

describe("the root entry", () => {
  it("has the format, the states, the chance, the gate and the sample", () => {
    expect(entry.RISK_SCHEMA).toBe("risk/1");
    for (const name of ["firstGoals", "chancesByPart", "isChance", "goalStates", "worksChance", "checkRisk"] as const) {
      expect(entry[name]).toBeTypeOf("function");
    }
    expect(entry.RISK_CODES).toContain("no-read");
    expect(entry.SAMPLE_RISK.schema).toBe(entry.RISK_SCHEMA);
    expect(entry.SAMPLE_TODAY).toBe("2026-11-16");
  });

  it("has no schema", () => {
    for (const name of ["riskSchema", "parseRisk"]) expect(entry).not.toHaveProperty(name);
  });
});

describe("the entry /schema", () => {
  it("has the schema and the read of a risk layer", () => {
    expect(Object.keys(schema).sort()).toEqual(["parseRisk", "riskSchema"]);
  });
});
