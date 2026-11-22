import { describe, expect, it } from "vitest";
import { curveFault } from "../src/check.ts";
import { independentStop, MINIMAL_STOP_CUTS } from "../src/shortfall.ts";
import { BENCH_CUTS, caseId, cutsOf, independentInput } from "./inputs.ts";

describe("the inputs of the bench", () => {
  it("are the same for the same seed and count, and differ for another seed", () => {
    expect(independentInput(8)).toEqual(independentInput(8));
    expect(independentInput(8, "another seed")).not.toEqual(independentInput(8));
  });

  it("give valid curves, and minimal sets that use each cut", () => {
    for (const cuts of BENCH_CUTS) {
      const input = independentInput(cuts);
      expect(input.curves).toHaveLength(cuts);
      for (const curve of input.curves) expect(curveFault(curve)).toBeUndefined();
      expect(new Set(input.sets.flat()).size).toBe(cuts);
      for (const set of input.sets) expect(set).toHaveLength(2);
    }
  });

  it("go up to the largest count of the sum over the states of independentStop", () => {
    expect(Math.max(...BENCH_CUTS)).toBe(MINIMAL_STOP_CUTS);
    expect(() => independentInput(1)).toThrow(RangeError);
    expect(() => independentInput(MINIMAL_STOP_CUTS + 1)).toThrow(RangeError);
  });

  it("give a curve of independentStop at 4 cuts", () => {
    const input = independentInput(4);
    const curve = independentStop(input.curves, input.sets);
    expect(curve).toBeDefined();
    expect(curveFault(curve ?? [])).toBeUndefined();
  });

  it("name each case by its count of cuts", () => {
    expect(BENCH_CUTS.map((cuts) => cutsOf(caseId(cuts)))).toEqual([...BENCH_CUTS]);
    expect(cutsOf("m5")).toBeUndefined();
    expect(cutsOf("12")).toBeUndefined();
  });
});
