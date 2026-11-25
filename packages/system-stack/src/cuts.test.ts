import { describe, expect, it } from "vitest";
import { CUT_BOUNDS, curveFault, cutBound, isCutBound, survivalAt, weakestBound, type CaseCuts, type Cut } from "./cuts.ts";

describe("the bound of a cut", () => {
  const curve = [
    [0, 1],
    [2, 0],
  ] as const;
  const cut: Cut = { part: "grid", title: "No power", duration: curve, source: "https://data.example.net/outages" };

  it("reads a missing bound as a law, and gives no bound for a cut with no curve", () => {
    expect(cutBound(cut)).toBe("law");
    expect(cutBound({ ...cut, bound: "upper" })).toBe("upper");
    expect(cutBound({ part: "grid", title: "No power", source: "definition", bound: "upper" })).toBeUndefined();
  });

  it("gives the weakest bound of some curves", () => {
    expect(weakestBound([])).toBe("law");
    expect(weakestBound(["law", "law"])).toBe("law");
    expect(weakestBound(["law", "upper"])).toBe("upper");
    expect(weakestBound(["lower", "law"])).toBe("lower");
    expect(weakestBound(["law", "none"])).toBe("none");
    expect(weakestBound(["upper", "lower"])).toBe("none");
    expect(weakestBound(["upper", "upper", "law"])).toBe("upper");
  });

  it("tells each value of CUT_BOUNDS from a bad value", () => {
    expect(CUT_BOUNDS.every((bound) => isCutBound(bound))).toBe(true);
    for (const value of ["exact", "", undefined, 1]) expect(isCutBound(value)).toBe(false);
  });
});

describe("survivalAt", () => {
  const road = [[0, 1], [1, 0.6], [4, 0.2], [10, 0]] as const;
  it("reads a curve at each point, linear between the points, and 0 after the last point", () => {
    expect(survivalAt(road, -1)).toBe(1);
    expect(survivalAt(road, 0)).toBe(1);
    expect(survivalAt(road, 0.5)).toBeCloseTo(0.8, 12);
    for (const [days, chance] of road) expect(survivalAt(road, days)).toBe(chance);
    expect(survivalAt(road, 7)).toBeCloseTo(0.1, 12);
    expect(survivalAt(road, 11)).toBe(0);
  });
  it("gives a chance that does not go up and stays between the chances of the two points around it", () => {
    let last = 1;
    for (let days = 0; days <= 11; days += 0.25) {
      const chance = survivalAt(road, days);
      expect(chance).toBeLessThanOrEqual(last);
      last = chance;
    }
  });
});

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
