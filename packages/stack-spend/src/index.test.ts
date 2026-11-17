import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";
import * as schema from "./schema.ts";

describe("the root entry", () => {
  it("has the format, the programs, the states, the gates, the steps and the samples", () => {
    expect(entry.SPEND_SCHEMA).toBe("spend/1");
    for (const name of ["IS_HARD", "HARD_COUNT", "HARD_LIMIT", "MONTH_MAX", "BOUNDED_TOTAL", "OPEN_SERVICES", "MONTH_READS", "COUNT_USED", "PROVIDER_USED", "USED", "USE_SHARE", "USE_OVER", "USE_LEVEL", "READ_AGE"] as const) {
      expect(entry[name]).toBeTypeOf("object");
    }
    for (const name of ["spendSpace", "evaluateService", "serviceStates", "monthTotal", "dayNumber", "checkSpend", "ownerSteps", "useSpace", "useStates", "checkUse", "joinSpend"] as const) {
      expect(entry[name]).toBeTypeOf("function");
    }
    for (const name of ["planEnds", "endStops", "evaluateNext", "nextKey"] as const) expect(entry[name]).toBeTypeOf("function");
    for (const name of ["PLAN_MAX", "NEXT_PLANS"] as const) expect(entry[name]).toBeTypeOf("object");
    expect(entry.END_DAYS).toBe(30);
    expect(entry.SAMPLE_ENDS.schema).toBe(entry.SPEND_SCHEMA);
    expect(entry.SAMPLE_SPEND.schema).toBe(entry.SPEND_SCHEMA);
    expect(entry.SAMPLE_READS.length).toBeGreaterThan(0);
    expect(entry.USE_SOURCES).toEqual(["count", "provider"]);
    expect(entry.USE_LEVELS).toEqual([0.5, 0.8, 1]);
  });

  it("does not export the internal modules", () => {
    for (const name of ["usePlan", "monthOf", "READ_CODES", "numberOf", "booleanOf"]) expect(entry).not.toHaveProperty(name);
  });

  it("has no schema", () => {
    for (const name of ["spendSchema", "parseSpend", "readsSchema", "parseReads"]) expect(entry).not.toHaveProperty(name);
  });
});

describe("the entry /schema", () => {
  it("has the schema and the read of a spend layer and of a list of reads", () => {
    expect(Object.keys(schema).sort()).toEqual(["parseReads", "parseSpend", "readsSchema", "spendSchema"]);
  });
});
