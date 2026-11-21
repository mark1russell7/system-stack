import { describe, expect, it } from "vitest";
import * as addOn from "./add-on.ts";
import * as entry from "./index.ts";
import * as schema from "./schema.ts";

describe("the root entry", () => {
  it("has the format, the queries, the gate, the join and the sample", () => {
    expect(entry.ENDURANCE_SCHEMA).toBe("endurance/1");
    for (const name of [
      "caseStopped",
      "storeAmounts",
      "drawDemand",
      "caseDraws",
      "enduranceOf",
      "survivalAt",
      "tailDays",
      "survivalQuantile",
      "yearChance",
      "caseShortfall",
      "yearShortfall",
      "curveFault",
      "checkEndurance",
      "hasEnduranceError",
      "joinEndurance",
    ] as const) {
      expect(entry[name], name).toBeTypeOf("function");
    }
    expect(entry.ENDURANCE_CODES).toContain("endurance-curve");
    expect(entry.SAMPLE_ENDURANCE.schema).toBe(entry.ENDURANCE_SCHEMA);
  });

  it("has no schema", () => {
    for (const name of ["enduranceSchema", "parseEndurance", "enduranceAddOn"]) expect(entry).not.toHaveProperty(name);
  });
});

describe("the entries /schema and /add-on", () => {
  it("have the schema, the read of a layer and the add-on", () => {
    expect(Object.keys(schema).sort()).toEqual(["enduranceSchema", "parseEndurance"]);
    expect(Object.keys(addOn)).toEqual(["enduranceAddOn"]);
  });
});
