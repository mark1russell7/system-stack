import type { Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { enduranceOf } from "./endurance.ts";
import type { CaseCuts, Survival } from "./layer.ts";
import { SAMPLE_ENDURANCE, SAMPLE_ENDURANCE_STACK } from "./sample.ts";
import { curveFault } from "./check.ts";
import { caseShortfall, longestStop, stopCurve, survivalAt, survivalQuantile, tailDays, yearChance, yearRate, yearShortfall } from "./shortfall.ts";

const AT = "2026-12-01";
const ROAD: Survival = [[0, 1], [1, 0.6], [3, 0.2], [10, 0]];
const storm = SAMPLE_ENDURANCE.cases?.find((item) => item.case === "storm") as CaseCuts;
const GRID: Survival = storm.cuts.find((cut) => cut.part === "grid")?.duration ?? [];
const MAIN: Survival = storm.cuts.find((cut) => cut.part === "water-main")?.duration ?? [];
const MAIN_NEEDS_GRID: Stack = { ...SAMPLE_ENDURANCE_STACK, parts: SAMPLE_ENDURANCE_STACK.parts.map((part) => (part.id === "water-main" ? { ...part, needs: ["grid"] } : part)) };

describe("the survival curve", () => {
  it("is linear between its points, 1 before the start and 0 after the end", () => {
    expect(survivalAt(ROAD, -1)).toBe(1);
    expect(survivalAt(ROAD, 0.5)).toBeCloseTo(0.8, 12);
    expect(survivalAt(ROAD, 2)).toBeCloseTo(0.4, 12);
    expect(survivalAt(ROAD, 10)).toBe(0);
    expect(survivalAt(ROAD, 11)).toBe(0);
  });

  it("gives the mean duration as the tail from 0, and the tail after a time", () => {
    // The area: 0.8 + 0.8 + 0.7 = 2.3 days.
    expect(tailDays(ROAD, 0)).toBeCloseTo(2.3, 12);
    expect(tailDays(ROAD, 3)).toBeCloseTo(0.7, 12);
    expect(tailDays(ROAD, 10)).toBe(0);
  });

  it("stops the tail at a horizon", () => {
    // From 0 to 2: 0.8 + 0.5 = 1.3 days. From 1 to 5: 0.8 + the area from 3 to 5 (0.2 to 0.143) = 1.143 days.
    expect(tailDays(ROAD, 0, 2)).toBeCloseTo(1.3, 12);
    expect(tailDays(ROAD, 1, 5)).toBeCloseTo(0.8 + ((0.2 + 0.2 * (5 / 7)) / 2) * 2, 12);
    expect(tailDays(ROAD, 4, 4)).toBe(0);
    expect(tailDays(ROAD, 5, 3)).toBe(0);
    expect(tailDays(ROAD, 0, 100)).toBeCloseTo(tailDays(ROAD, 0), 12);
  });

  it("adds the tail of two intervals to the tail of their union", () => {
    const time = fc.double({ min: 0, max: 12, noNaN: true });
    fc.assert(
      fc.property(time, time, time, (a, b, c) => {
        const [x, y, z] = [a, b, c].sort((p, q) => p - q) as [number, number, number];
        expect(tailDays(ROAD, x, y) + tailDays(ROAD, y, z)).toBeCloseTo(tailDays(ROAD, x, z), 10);
      }),
    );
  });

  it("gives the 90th percentile and the median", () => {
    expect(survivalQuantile(ROAD, 0.1)).toBeCloseTo(6.5, 12);
    expect(survivalQuantile(ROAD, 0.5)).toBeCloseTo(1.5, 12);
    expect(survivalQuantile(ROAD, 1)).toBe(0);
    expect(survivalQuantile([[0, 1], [5, 0.5]], 0.1)).toBe(Infinity);
  });

  it("has a tail that falls by the chance at each time", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 9.9, noNaN: true }), (from) => {
        const step = 1e-4;
        const slope = (tailDays(ROAD, from) - tailDays(ROAD, from + step)) / step;
        expect(slope).toBeCloseTo(survivalAt(ROAD, from + step / 2), 3);
      }),
    );
  });
});

describe("yearChance", () => {
  it("gives the chance of one or more events in a year", () => {
    expect(yearChance({ case: "c", place: "p", perYear: 0.8, reach: 1, source: "s", asOf: AT })).toBeCloseTo(1 - Math.exp(-0.8), 12);
    expect(yearChance({ case: "c", place: "p", perYear: 2, reach: 0, source: "s", asOf: AT })).toBe(0);
  });
});

describe("caseShortfall", () => {
  it("gives the user-days of each level in one storm", () => {
    const shortfall = caseShortfall(SAMPLE_ENDURANCE, storm, enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT }));
    expect(shortfall.unread).toEqual([]);
    expect(Object.keys(shortfall.levels)).toEqual(["life", "health", "comfort"]);
    // The water holds 20/3 days. The main stops longer with a chance of 0.3 (7 - 20/3) / 5 = 0.02. The tail is 0.02 / 2 x 1/3 = 1/300 days, for 3 users.
    expect(shortfall.levels["life"]).toBeCloseTo(0.01, 9);
  });

  it("uses the curve of a cut that stops the supply through the stack", () => {
    const gridOnly: CaseCuts = { ...storm, cuts: storm.cuts.filter((cut) => cut.part === "grid") };
    const endurance = enduranceOf(SAMPLE_ENDURANCE, gridOnly, { at: AT, stack: MAIN_NEEDS_GRID });
    const shortfall = caseShortfall(SAMPLE_ENDURANCE, gridOnly, endurance, { stack: MAIN_NEEDS_GRID });
    expect(shortfall.unread).toEqual([]);
    // The grid curve at 20/3 days is 0.36 - 0.347 x 17/18 = 0.03228. The tail is 0.00755 to 7 days and 0.1495 after 7 days: 0.15705 days, for 3 users.
    expect(shortfall.levels["life"]).toBeCloseTo(0.4711, 4);
  });

  it("uses the longest cut when two cuts stop the supply", () => {
    const drink = SAMPLE_ENDURANCE.draws.find((item) => item.need === "hydration.drink");
    if (drink === undefined) throw new Error("The sample has no drink draw.");
    expect(stopCurve(storm, drink, { stack: MAIN_NEEDS_GRID })).toEqual(longestStop([GRID, MAIN]));
    expect(stopCurve(storm, drink)).toEqual(MAIN);
    // Without the stack, the grid cut does not stop the water main.
    expect(stopCurve({ ...storm, cuts: storm.cuts.filter((cut) => cut.part === "grid") }, drink)).toBeUndefined();
  });

  it("gives a draw that only a part of down stops as no read", () => {
    const none: CaseCuts = { case: "none", title: "None", cuts: [] };
    const shortfall = caseShortfall(SAMPLE_ENDURANCE, none, enduranceOf(SAMPLE_ENDURANCE, none, { at: AT, down: ["water-main"] }), { down: ["water-main"] });
    expect(shortfall.unread).toEqual(["hydration.drink"]);
    expect(shortfall.levels["life"]).toBe(0);
  });
});

describe("longestStop", () => {
  const curve = fc
    .array(fc.tuple(fc.double({ min: 0.01, max: 5, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true })), { minLength: 1, maxLength: 5 })
    .map((steps): Survival => {
      let t = 0;
      let p = 1;
      const out: [number, number][] = [[0, 1]];
      for (const [dt, keep] of steps) {
        t += dt;
        p *= keep;
        out.push([t, p]);
      }
      out.push([t + 1, 0]);
      return out;
    });

  it("gives at each time the largest chance of the curves, and a curve that the gate passes", () => {
    fc.assert(
      fc.property(fc.array(curve, { minLength: 1, maxLength: 4 }), fc.double({ min: 0, max: 30, noNaN: true }), (curves, days) => {
        const longest = longestStop(curves);
        expect(survivalAt(longest, days)).toBeCloseTo(Math.max(...curves.map((item) => survivalAt(item, days))), 9);
        expect(curveFault(longest)).toBeUndefined();
        for (const item of curves) expect(tailDays(longest, days)).toBeGreaterThanOrEqual(tailDays(item, days) - 1e-9);
      }),
    );
  });

  it("refuses an empty list", () => {
    expect(() => longestStop([])).toThrow(RangeError);
  });
});

describe("yearShortfall", () => {
  it("gives the user-days of each level in one year at a place", () => {
    const year = yearShortfall(SAMPLE_ENDURANCE, "home", { at: AT });
    expect(year.place).toBe("home");
    expect(year.unread).toEqual([]);
    // The storm comes 0.8 times a year. The food holds only 0.889 days, because the drinking water keeps back all the water.
    expect(year.levels["life"]).toBeCloseTo(0.008, 3);
    expect(year.levels["health"]).toBeCloseTo(3.7659, 3);
    expect(year.levels["comfort"]).toBeCloseTo(0.3769, 3);
    expect(year.cases.map((item) => item.rate)).toEqual([0.8, 0.003]);
    expect(yearRate({ case: "storm", place: "home", perYear: 0.8, reach: 0.5, source: "s", asOf: "2026-01-01" })).toBeCloseTo(0.4, 12);
    expect(year.cases.map((item) => item.case)).toEqual(["storm", "fire"]);
    expect(year.cases[1]?.shortfall.levels).toEqual({ life: 0, health: 0, comfort: 0 });
  });

  it("counts only the days up to the horizon", () => {
    const full = yearShortfall(SAMPLE_ENDURANCE, "home", { at: AT });
    // Each cut of the sample ends at 30 days or before, so a horizon of 30 days changes nothing.
    const month = yearShortfall(SAMPLE_ENDURANCE, "home", { at: AT, horizon: 30 });
    for (const level of SAMPLE_ENDURANCE.levels) expect(month.levels[level]).toBeCloseTo(full.levels[level] ?? 0, 12);
    // The power outage lasts up to 30 days. With 14 days, the power counts less, and the water and the food do not change.
    const short = yearShortfall(SAMPLE_ENDURANCE, "home", { at: AT, horizon: 14 });
    expect(short.levels["comfort"] ?? 0).toBeLessThan(full.levels["comfort"] ?? 0);
    expect(short.levels["life"]).toBeCloseTo(full.levels["life"] ?? 0, 12);
    expect(short.levels["health"]).toBeCloseTo(full.levels["health"] ?? 0, 12);
    // A horizon at the endurance of the water gives no shortfall for the water.
    const water = enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT }).needs["hydration.drink"]?.days ?? 0;
    expect(caseShortfall(SAMPLE_ENDURANCE, storm, enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT }), { horizon: water }).levels["life"]).toBe(0);
    const two = yearShortfall(SAMPLE_ENDURANCE, "home", { at: AT, horizon: 2 });
    for (const level of SAMPLE_ENDURANCE.levels) expect(two.levels[level] ?? 0).toBeLessThanOrEqual(full.levels[level] ?? 0);
  });

  it("refuses a horizon that is not more than 0", () => {
    expect(() => yearShortfall(SAMPLE_ENDURANCE, "home", { at: AT, horizon: 0 })).toThrow(RangeError);
    expect(() => caseShortfall(SAMPLE_ENDURANCE, storm, enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT }), { horizon: Number.NaN })).toThrow(RangeError);
  });

  it("gives 0 at a place with no prior", () => {
    expect(yearShortfall(SAMPLE_ENDURANCE, "elsewhere", { at: AT })).toEqual({ place: "elsewhere", levels: { life: 0, health: 0, comfort: 0 }, unread: [], cases: [] });
  });
});
