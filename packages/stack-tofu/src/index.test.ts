import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";
import * as schema from "./schema.ts";

describe("the root entry", () => {
  it("has the format, the queries, the cost, the gates, the generator and the sample", () => {
    expect(entry.TOFU_SCHEMA).toBe("tofu/1");
    for (const name of ["resourceAddress", "renderValue", "dependsOn", "resourceCycles", "accountStates", "plannedTotal", "checkTofu", "generateTofu", "documentText", "checkPlan", "joinTofu"] as const) {
      expect(entry[name]).toBeTypeOf("function");
    }
    expect(entry.TOFU_CODES).toContain("cost-over");
    expect(entry.PLAN_CODES).toContain("plan-destroy");
    expect(entry.DOCUMENT_FILE).toBe("main.tf.json");
    expect(entry.SAMPLE_TOFU.schema).toBe(entry.TOFU_SCHEMA);
    expect(entry.SAMPLE_BUDGETS).toHaveLength(1);
    expect(entry.SAMPLE_PLAN.format_version).toBe("1.2");
  });

  it("has no function that gives a document without the gate", () => {
    expect(Object.keys(entry).filter((name) => /render|document|generate/i.test(name)).sort()).toEqual(["DOCUMENT_COMMENT", "DOCUMENT_FILE", "documentText", "generateTofu", "renderValue"]);
  });

  it("has no schema", () => {
    for (const name of ["tofuSchema", "parseTofu", "planSchema", "parsePlan"]) expect(entry).not.toHaveProperty(name);
  });
});

describe("the entry /schema", () => {
  it("has the schema and the read of a layer and of a plan", () => {
    expect(Object.keys(schema).sort()).toEqual(["parsePlan", "parseTofu", "planSchema", "tofuSchema"]);
  });
});
