import { describe, expect, it } from "vitest";
import { curveFault, type CaseCuts } from "./cuts.ts";

describe("curveFault", () => {
  it("gives the first fault of a curve", () => {
    expect(curveFault([[0, 1], [1, 0]])).toBeUndefined();
    expect(curveFault([])).toBe("The curve does not start at [0, 1].");
    expect(curveFault([[0, 0.9], [1, 0]])).toBe("The curve does not start at [0, 1].");
    expect(curveFault([[0, 1], [0, 0]])).toMatch(/days of the point 1/);
    expect(curveFault([[0, 1], [1, 0.5], [2, 0.6], [3, 0]])).toMatch(/chance of the point 2/);
    expect(curveFault([[0, 1], [1, 0.5]])).toBe("The curve does not end at a chance of 0.");
  });

  it("takes a cut with no curve", () => {
    const storm: CaseCuts = { case: "met.winter.storm", title: "Winter storm", cuts: [{ part: "grid", title: "No power", source: "definition" }] };
    expect(storm.cuts[0]?.duration).toBeUndefined();
  });
});
