import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";

describe("the entry", () => {
  it("has the data, the gate and the bind", () => {
    expect(entry.HAZARD_LIST.schema).toBe(entry.HAZARDS_SCHEMA);
    expect(entry.checkHazards).toBeTypeOf("function");
    expect(entry.hazardCase).toBeTypeOf("function");
  });
});
