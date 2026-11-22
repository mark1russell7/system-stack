import { describe, expect, it } from "vitest";
import { curveFault } from "../src/check.ts";
import { independentStop, MINIMAL_STOP_CUTS, minimalStops } from "../src/shortfall.ts";
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

  it("give the sets of minimalStops up to 12 cuts, in its order, and have cases past 12 cuts", () => {
    for (const cuts of BENCH_CUTS.filter((count) => count <= MINIMAL_STOP_CUTS)) {
      const input = independentInput(cuts);
      const stops = (on: readonly number[]): boolean => input.sets.some((set) => set.every((index) => on.includes(index)));
      expect(minimalStops(cuts, stops), String(cuts)).toEqual(input.sets);
    }
    expect(BENCH_CUTS).toContain(MINIMAL_STOP_CUTS);
    expect(Math.max(...BENCH_CUTS)).toBeGreaterThan(MINIMAL_STOP_CUTS);
    expect(() => independentInput(1)).toThrow(RangeError);
  });

  it("give a curve of independentStop at 4 and 14 cuts, and pass the default budget at 16 cuts", () => {
    // At 16 cuts, the expansion has 17662 steps at more than 4000 points of the curve, so it passes INDEPENDENT_MAX_WORK.
    const wide = independentInput(16);
    expect(independentStop(wide.curves, wide.sets)).toBeUndefined();
    for (const cuts of [4, 14]) {
      const input = independentInput(cuts);
      const curve = independentStop(input.curves, input.sets);
      expect(curve, String(cuts)).toBeDefined();
      expect(curveFault(curve ?? [])).toBeUndefined();
    }
  });

  it("name each case by its count of cuts", () => {
    expect(BENCH_CUTS.map((cuts) => cutsOf(caseId(cuts)))).toEqual([...BENCH_CUTS]);
    expect(cutsOf("m5")).toBeUndefined();
    expect(cutsOf("12")).toBeUndefined();
  });
});
