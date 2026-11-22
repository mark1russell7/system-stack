import type { Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { enduranceOf } from "./endurance.ts";
import type { CaseCuts, Survival } from "./layer.ts";
import { SAMPLE_ENDURANCE, SAMPLE_ENDURANCE_STACK } from "./sample.ts";
import { curveFault } from "./check.ts";
import { caseShortfall, eventStop, INDEPENDENT_TOLERANCE, independentStop, longestStop, minimalStops, stopCurves, survivalAt, upperStop, survivalQuantile, tailDays, yearChance, yearRate, yearShortfall } from "./shortfall.ts";

const AT = "2026-12-01";
const ROAD: Survival = [[0, 1], [1, 0.6], [3, 0.2], [10, 0]];
const storm = SAMPLE_ENDURANCE.cases?.find((item) => item.case === "storm") as CaseCuts;
const GRID: Survival = storm.cuts.find((cut) => cut.part === "grid")?.duration ?? [];
const MAIN: Survival = storm.cuts.find((cut) => cut.part === "water-main")?.duration ?? [];
const DRINK = SAMPLE_ENDURANCE.draws.find((item) => item.need === "hydration.drink") as (typeof SAMPLE_ENDURANCE.draws)[number];
const TIMES = [0, 0.25, 0.5, 0.8, 1, 1.7, 2, 3, 4.5, 6.9, 7, 8, 12, 29, 31];
const MAIN_NEEDS_GRID: Stack = { ...SAMPLE_ENDURANCE_STACK, parts: SAMPLE_ENDURANCE_STACK.parts.map((part) => (part.id === "water-main" ? { ...part, needs: ["grid"] } : part)) };

describe("the survival curve", () => {
  it("is linear between its points, 1 before the start and 0 after the end", () => {
    expect(survivalAt(ROAD, -1)).toBe(1);
    expect(survivalAt(ROAD, 0.5)).toBeCloseTo(0.8, 12);
    expect(survivalAt(ROAD, 2)).toBeCloseTo(0.4, 12);
    expect(survivalAt(ROAD, 10)).toBe(0);
    expect(survivalAt(ROAD, 11)).toBe(0);
  });

  it("gives the exact chance at each point, and never a rounding below the lower point", () => {
    // Before 0.3.2, the line gave -1.1e-16 at the third point, and upperStop of this curve threw.
    const curve: Survival = [[0, 1], [0.023448894038205687, 0.9999999999999987], [0.062489255095649725, 0], [1.3218730114693862, 0]];
    for (const [days, chance] of curve) expect(survivalAt(curve, days)).toBe(chance);
    for (const days of [0.01, 0.03, 0.05, 0.0624892550956497, 0.5]) expect(survivalAt(curve, days)).toBeGreaterThanOrEqual(0);
    expect(survivalAt(upperStop([curve], [[0]]), 0.062489255095649725)).toBe(0);
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

  it("uses the longest cut when two cuts stop the supply, and their sum as the upper limit", () => {
    const curves = stopCurves(storm, DRINK, { stack: MAIN_NEEDS_GRID });
    for (const days of TIMES) {
      expect(survivalAt(curves?.event ?? [], days), String(days)).toBeCloseTo(Math.max(survivalAt(GRID, days), survivalAt(MAIN, days)), 9);
      expect(survivalAt(curves?.upper ?? [], days), String(days)).toBeCloseTo(Math.min(1, survivalAt(GRID, days) + survivalAt(MAIN, days)), 9);
    }
    // Independent cuts in series: the stop lasts while either cut is on.
    for (const days of [...TIMES, 0.37, 2.5, 6.1]) {
      const either = 1 - (1 - survivalAt(GRID, days)) * (1 - survivalAt(MAIN, days));
      expect(Math.abs(survivalAt(curves?.independent ?? [], days) - either), String(days)).toBeLessThanOrEqual(INDEPENDENT_TOLERANCE);
    }
    const alone = stopCurves(storm, DRINK);
    for (const days of TIMES) expect(survivalAt(alone?.independent ?? [], days)).toBeCloseTo(survivalAt(MAIN, days), 9);
    for (const days of TIMES) expect(survivalAt(alone?.event ?? [], days)).toBeCloseTo(survivalAt(MAIN, days), 9);
    for (const days of TIMES) expect(survivalAt(alone?.upper ?? [], days)).toBeCloseTo(survivalAt(MAIN, days), 9);
    // Without the stack, the grid cut does not stop the water main.
    expect(stopCurves({ ...storm, cuts: storm.cuts.filter((cut) => cut.part === "grid") }, DRINK)).toBeUndefined();
  });

  it("ends a stop through a need of any of two parts with the shorter of their cuts", () => {
    // The water main needs the grid or the road. The minimal sets are {main} and {grid, road}.
    const stack: Stack = { ...SAMPLE_ENDURANCE_STACK, parts: SAMPLE_ENDURANCE_STACK.parts.map((part) => (part.id === "water-main" ? { ...part, needs: [{ any: ["grid", "road"] }] } : part)) };
    const curves = stopCurves(storm, DRINK, { stack });
    const road = storm.cuts.find((cut) => cut.part === "road")?.duration ?? [];
    for (const days of TIMES) {
      const pair = Math.min(survivalAt(GRID, days), survivalAt(road, days));
      expect(survivalAt(curves?.event ?? [], days), String(days)).toBeCloseTo(Math.max(survivalAt(MAIN, days), pair), 9);
      expect(survivalAt(curves?.upper ?? [], days), String(days)).toBeCloseTo(Math.min(1, survivalAt(MAIN, days) + pair), 9);
      // Independent cuts: the main is on, or the grid and the road are on together.
      const both = survivalAt(GRID, days) * survivalAt(road, days);
      const independent = 1 - (1 - survivalAt(MAIN, days)) * (1 - both);
      expect(Math.abs(survivalAt(curves?.independent ?? [], days) - independent), String(days)).toBeLessThanOrEqual(INDEPENDENT_TOLERANCE);
    }
    // The road ends at 10 days, so the pair ends then: the grid cut alone does not stop the water after 10 days.
    expect(survivalAt(curves?.event ?? [], 12)).toBe(0);
    const shortfall = caseShortfall(SAMPLE_ENDURANCE, storm, enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT, stack }), { stack });
    expect(shortfall.upper["life"] ?? 0).toBeGreaterThanOrEqual(shortfall.levels["life"] ?? 0);
    expect(shortfall.upper["life"] ?? 0).toBeGreaterThanOrEqual((shortfall.independent["life"] ?? 0) - 1e-9);
    expect(shortfall.levels["life"] ?? 0).toBeGreaterThan(0.01);
  });

  it("gives a draw as no read when a cut with no curve can be part of its stop, and reads it when the cut cannot", () => {
    const bare = (part: string): CaseCuts => ({ ...storm, cuts: storm.cuts.map((cut) => (cut.part === part ? { part: cut.part, title: cut.title, source: cut.source } : cut)) });
    // The water main has no curve: the drinking water is no read, with and without the stack.
    for (const options of [{}, { stack: MAIN_NEEDS_GRID }]) {
      expect(stopCurves(bare("water-main"), DRINK, options)).toBeUndefined();
      const shortfall = caseShortfall(SAMPLE_ENDURANCE, bare("water-main"), enduranceOf(SAMPLE_ENDURANCE, bare("water-main"), { at: AT, ...options }), options);
      expect(shortfall.unread).toContain("hydration.drink");
      expect(shortfall.levels["life"]).toBe(0);
    }
    // The grid has no curve. The power is no read. Without the stack, the grid cannot stop the water, so the water keeps its curves.
    const noGrid = caseShortfall(SAMPLE_ENDURANCE, bare("grid"), enduranceOf(SAMPLE_ENDURANCE, bare("grid"), { at: AT }));
    expect(noGrid.unread).toEqual(["power.electric"]);
    expect(stopCurves(bare("grid"), DRINK)).toEqual(stopCurves(storm, DRINK));
    // With the stack, the grid cut alone stops the water: the water is no read.
    expect(stopCurves(bare("grid"), DRINK, { stack: MAIN_NEEDS_GRID })).toBeUndefined();
    // The water main needs the grid or the road, and the case does not cut the road. The grid is in no minimal set, so the water is read.
    const stack: Stack = { ...SAMPLE_ENDURANCE_STACK, parts: SAMPLE_ENDURANCE_STACK.parts.map((part) => (part.id === "water-main" ? { ...part, needs: [{ any: ["grid", "road"] }] } : part)) };
    const noRoad = (caseCuts: CaseCuts): CaseCuts => ({ ...caseCuts, cuts: caseCuts.cuts.filter((cut) => cut.part !== "road") });
    const read = stopCurves(noRoad(bare("grid")), DRINK, { stack });
    expect(read).toBeDefined();
    for (const days of TIMES) {
      expect(survivalAt(read?.event ?? [], days)).toBeCloseTo(survivalAt(MAIN, days), 9);
      expect(survivalAt(read?.independent ?? [], days)).toBeCloseTo(survivalAt(MAIN, days), 9);
      expect(survivalAt(read?.upper ?? [], days)).toBeCloseTo(survivalAt(MAIN, days), 9);
    }
  });

  it("gives a draw that only a part of down stops as no read", () => {
    const none: CaseCuts = { case: "none", title: "None", cuts: [] };
    const shortfall = caseShortfall(SAMPLE_ENDURANCE, none, enduranceOf(SAMPLE_ENDURANCE, none, { at: AT, down: ["water-main"] }), { down: ["water-main"] });
    expect(shortfall.unread).toEqual(["hydration.drink"]);
    expect(shortfall.levels["life"]).toBe(0);
  });

  it("counts only the cuts that can reach the supply, and gives an exact independent stop past 12 cuts", () => {
    // Thirteen cuts of parts that the water main does not need do not change its curves.
    const others = Array.from({ length: 13 }, (_, index) => ({ part: `other-${String(index)}`, title: "Other", duration: GRID, source: "s" }));
    const wide: CaseCuts = { ...storm, cuts: [...storm.cuts, ...others] };
    expect(stopCurves(wide, DRINK, { stack: MAIN_NEEDS_GRID })).toEqual(stopCurves(storm, DRINK, { stack: MAIN_NEEDS_GRID }));
    expect(stopCurves(wide, DRINK, { stack: MAIN_NEEDS_GRID })?.coarse).toBe(false);
    expect(caseShortfall(SAMPLE_ENDURANCE, wide, enduranceOf(SAMPLE_ENDURANCE, wide, { at: AT }), {}).coarse).toEqual([]);
    // When the water main needs each of 13 feeds, 14 cuts count. Each cut stops it alone, so upper is the sum of their curves.
    // Before 0.5.0, upper was coarse here. Before 0.6.0, the 14 cuts were more than MINIMAL_STOP_CUTS, so independent was upper.
    const feeds = others.map((cut) => cut.part);
    const stack: Stack = {
      ...SAMPLE_ENDURANCE_STACK,
      parts: [...SAMPLE_ENDURANCE_STACK.parts.map((part) => (part.id === "water-main" ? { ...part, needs: feeds } : part)), ...feeds.map((id) => ({ id, kind: "feed", name: id }))],
    };
    const curves = stopCurves(wide, DRINK, { stack });
    expect(curves?.coarse).toBe(false);
    expect(curves?.independentUpper).toBe(false);
    for (const days of TIMES) {
      const [grid, main] = [survivalAt(GRID, days), survivalAt(MAIN, days)];
      expect(survivalAt(curves?.upper ?? [], days)).toBeCloseTo(Math.min(1, main + 13 * grid), 9);
      expect(Math.abs(survivalAt(curves?.independent ?? [], days) - (1 - (1 - main) * (1 - grid) ** 13)), String(days)).toBeLessThanOrEqual(INDEPENDENT_TOLERANCE);
    }
    const shortfall = caseShortfall(SAMPLE_ENDURANCE, wide, enduranceOf(SAMPLE_ENDURANCE, wide, { at: AT, stack }), { stack });
    expect(shortfall.coarse).toEqual([]);
    expect(shortfall.independentUpper).toEqual([]);
  });

  it("gives exact curves from the needs of the stack past 12 cuts that count", () => {
    // The water main needs the grid, and 1 of 13 feeds or the road. The case does not cut the road.
    // Thus 15 cuts count, and the minimal sets are {water main} and {grid}. Before 0.5.0, upper was the sum of the 15 curves.
    const feeds = Array.from({ length: 13 }, (_, index) => `feed-${String(index)}`);
    const stack: Stack = {
      ...SAMPLE_ENDURANCE_STACK,
      parts: [...SAMPLE_ENDURANCE_STACK.parts.map((part) => (part.id === "water-main" ? { ...part, needs: ["grid", { any: [...feeds, "road"] }] } : part)), ...feeds.map((id) => ({ id, kind: "feed" }))],
    };
    const cuts = [...storm.cuts.filter((cut) => cut.part !== "road"), ...feeds.map((part) => ({ part, title: "Feed", duration: ROAD, source: "s" }))];
    const curves = stopCurves({ ...storm, cuts }, DRINK, { stack });
    expect(curves?.coarse).toBe(false);
    expect(curves?.independentUpper).toBe(false);
    for (const days of [...TIMES, 0.37, 2.5, 6.1]) {
      const [grid, main] = [survivalAt(GRID, days), survivalAt(MAIN, days)];
      expect(survivalAt(curves?.event ?? [], days), String(days)).toBeCloseTo(Math.max(grid, main), 9);
      expect(survivalAt(curves?.upper ?? [], days), String(days)).toBeCloseTo(Math.min(1, grid + main), 9);
      expect(Math.abs(survivalAt(curves?.independent ?? [], days) - (1 - (1 - grid) * (1 - main))), String(days)).toBeLessThanOrEqual(INDEPENDENT_TOLERANCE);
    }
  });

  it("gives an exact upper limit and an exact independent stop for 7 pairs of feeds", () => {
    // The water main needs 7 stages, and each stage needs 1 of 2 feeds. A stop needs the main, or the two feeds of a stage.
    const stages = Array.from({ length: 7 }, (_, index) => [`a-${String(index)}`, `b-${String(index)}`]);
    const stack: Stack = {
      ...SAMPLE_ENDURANCE_STACK,
      parts: [...SAMPLE_ENDURANCE_STACK.parts.map((part) => (part.id === "water-main" ? { ...part, needs: stages.map((any) => ({ any })) } : part)), ...stages.flat().map((id) => ({ id, kind: "feed" }))],
    };
    const cuts = [
      ...storm.cuts.filter((cut) => cut.part === "water-main"),
      ...stages.flatMap(([a, b]) => [
        { part: a ?? "", title: "Feed", duration: GRID, source: "s" },
        { part: b ?? "", title: "Feed", duration: ROAD, source: "s" },
      ]),
    ];
    const curves = stopCurves({ ...storm, cuts }, DRINK, { stack });
    expect(curves?.coarse).toBe(false);
    expect(curves?.independentUpper).toBe(false);
    for (const days of TIMES) {
      const [grid, road, main] = [survivalAt(GRID, days), survivalAt(ROAD, days), survivalAt(MAIN, days)];
      const pair = Math.min(grid, road);
      expect(survivalAt(curves?.upper ?? [], days), String(days)).toBeCloseTo(Math.min(1, main + 7 * pair), 9);
      expect(survivalAt(curves?.event ?? [], days), String(days)).toBeCloseTo(Math.max(main, pair), 9);
      expect(Math.abs(survivalAt(curves?.independent ?? [], days) - (1 - (1 - main) * (1 - grid * road) ** 7)), String(days)).toBeLessThanOrEqual(INDEPENDENT_TOLERANCE);
    }
  });

  it("keeps a coarse upper limit when the search of the needs passes its budget", () => {
    // 13 stages of 2 feeds have 2 to the power 13 path sets, more than the budget. The 27 cuts are more than MINIMAL_STOP_CUTS.
    const stages = Array.from({ length: 13 }, (_, index) => [`a-${String(index)}`, `b-${String(index)}`]);
    const stack: Stack = {
      ...SAMPLE_ENDURANCE_STACK,
      parts: [...SAMPLE_ENDURANCE_STACK.parts.map((part) => (part.id === "water-main" ? { ...part, needs: stages.map((any) => ({ any })) } : part)), ...stages.flat().map((id) => ({ id, kind: "feed" }))],
    };
    const cuts = [...storm.cuts.filter((cut) => cut.part === "water-main"), ...stages.flat().map((part) => ({ part, title: "Feed", duration: GRID, source: "s" }))];
    const curves = stopCurves({ ...storm, cuts }, DRINK, { stack });
    expect(curves?.coarse).toBe(true);
    expect(curves?.independentUpper).toBe(true);
    for (const days of TIMES) expect(survivalAt(curves?.upper ?? [], days)).toBeCloseTo(Math.min(1, survivalAt(MAIN, days) + 26 * survivalAt(GRID, days)), 9);
    // A feed with no curve can be part of the stop, and the query cannot tell. The water is no read.
    const bare = cuts.map((cut, index) => (index === 1 ? { part: cut.part, title: cut.title, source: cut.source } : cut));
    expect(stopCurves({ ...storm, cuts: bare }, DRINK, { stack })).toBeUndefined();
  });

  it("takes the budget of the search of the needs as the option maxSets", () => {
    // 7 stages of 2 feeds have 2 to the power 7 path sets. A budget of 64 sets is too small, and the 15 cuts are more than MINIMAL_STOP_CUTS.
    const stages = Array.from({ length: 7 }, (_, index) => [`a-${String(index)}`, `b-${String(index)}`]);
    const stack: Stack = {
      ...SAMPLE_ENDURANCE_STACK,
      parts: [...SAMPLE_ENDURANCE_STACK.parts.map((part) => (part.id === "water-main" ? { ...part, needs: stages.map((any) => ({ any })) } : part)), ...stages.flat().map((id) => ({ id, kind: "feed" }))],
    };
    const cuts = [...storm.cuts.filter((cut) => cut.part === "water-main"), ...stages.flat().map((part) => ({ part, title: "Feed", duration: GRID, source: "s" }))];
    expect(stopCurves({ ...storm, cuts }, DRINK, { stack })?.coarse).toBe(false);
    expect(stopCurves({ ...storm, cuts }, DRINK, { stack, maxSets: 64 })?.coarse).toBe(true);
    const exact = stopCurves({ ...storm, cuts }, DRINK, { stack, maxSets: 128 });
    expect(exact?.coarse).toBe(false);
    // The 15 cuts of the sets are more than MINIMAL_STOP_CUTS, and the expansion of independentStop is in its budget.
    expect(exact?.independentUpper).toBe(false);
    for (const days of TIMES) expect(survivalAt(exact?.upper ?? [], days)).toBeCloseTo(Math.min(1, survivalAt(MAIN, days) + 7 * survivalAt(GRID, days)), 9);
    // caseShortfall gives the option to the stop curves of each draw.
    const endurance = enduranceOf(SAMPLE_ENDURANCE, { ...storm, cuts }, { at: AT, stack });
    expect(caseShortfall(SAMPLE_ENDURANCE, { ...storm, cuts }, endurance, { stack, maxSets: 64 }).coarse).toContain("hydration.drink");
    expect(caseShortfall(SAMPLE_ENDURANCE, { ...storm, cuts }, endurance, { stack, maxSets: 128 }).coarse).toEqual([]);
    // A budget that is not a whole number from 1 is refused, also with no stack.
    for (const maxSets of [0, 1.5, Number.NaN]) {
      expect(() => stopCurves(storm, DRINK, { maxSets })).toThrow(RangeError);
      expect(() => caseShortfall(SAMPLE_ENDURANCE, storm, enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT }), { maxSets })).toThrow(RangeError);
      expect(() => yearShortfall(SAMPLE_ENDURANCE, "elsewhere", { at: AT, maxSets })).toThrow(RangeError);
    }
  });
});

describe("minimalStops", () => {
  it("gives each minimal set that stops, and nothing for too many cuts", () => {
    // Cut 0 stops alone. Cuts 1 and 2 stop together. Cut 3 does nothing.
    const stops = (cuts: readonly number[]): boolean => cuts.includes(0) || (cuts.includes(1) && cuts.includes(2));
    expect(minimalStops(4, stops)).toEqual([[0], [1, 2]]);
    expect(minimalStops(13, stops)).toBeUndefined();
  });
});

describe("eventStop and upperStop", () => {
  it("give 0 at each time when no set stops, and a sum of all curves with no sets", () => {
    expect(eventStop([GRID, MAIN], () => false)).toEqual([[0, 0]]);
    const upper = upperStop([GRID, MAIN], undefined);
    for (const days of TIMES) expect(survivalAt(upper, days)).toBeCloseTo(Math.min(1, survivalAt(GRID, days) + survivalAt(MAIN, days)), 9);
  });
});

describe("independentStop", () => {
  const curve = fc
    .array(fc.double({ min: 0.01, max: 5, noNaN: true }), { minLength: 1, maxLength: 3 })
    .chain((gaps) => fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: gaps.length - 1, maxLength: gaps.length - 1 }).map((falls) => ({ gaps, falls })))
    .map(({ gaps, falls }): Survival => {
      const chances = [...falls.sort((x, y) => y - x), 0];
      let days = 0;
      return [[0, 1], ...gaps.map((gap, index): [number, number] => [(days += gap), chances[index] ?? 0])];
    });

  it("lies within the tolerance of the exact chance, and between the chance of one set and upperStop, for each curve and set", () => {
    fc.assert(
      fc.property(fc.array(curve, { minLength: 1, maxLength: 5 }), fc.array(fc.integer({ min: 1, max: 31 }), { minLength: 1, maxLength: 4 }), (curves, rawSets) => {
        const sets = [...new Set(rawSets.map((mask) => mask & ((1 << curves.length) - 1)).filter((mask) => mask > 0))].map((mask) =>
          curves.flatMap((_, index) => ((mask >> index) & 1 ? [index] : [])),
        );
        if (sets.length === 0) return;
        const independent = independentStop(curves, sets) ?? [];
        const upper = upperStop(curves, sets);
        expect(curveFault(independent)).toBeUndefined();
        // The reads of the test: fixed times, and 15 fractions of each piece of the result, with the value of its line.
        const reads: [number, number][] = [0, 0.3, 1, 2.2, 4, 7.5, 12, 20].map((days) => [days, survivalAt(independent, days)]);
        for (const [index, [t1, c1]] of independent.slice(1).entries()) {
          const [t0, c0] = independent[index] ?? [0, 1];
          for (let step = 1; step < 16; step += 1) reads.push([t0 + ((t1 - t0) * step) / 16, c0 + ((c1 - c0) * step) / 16]);
        }
        const masks = Array.from({ length: 1 << curves.length }, (_, mask) => sets.some((set) => set.every((index) => (mask >> index) & 1)));
        let worst = 0;
        let worstAt = 0;
        let faults = 0;
        for (const [days, value] of reads) {
          const on = curves.map((item) => survivalAt(item, days));
          // The exact chance: sum over each state of the cuts that contains a set.
          let exact = 0;
          for (const [mask, stops] of masks.entries()) {
            if (stops) exact += on.reduce((product, chance, index) => product * ((mask >> index) & 1 ? chance : 1 - chance), 1);
          }
          if (Math.abs(value - exact) > worst) [worst, worstAt] = [Math.abs(value - exact), days];
          if (value > survivalAt(upper, days) + INDEPENDENT_TOLERANCE) faults += 1;
          for (const set of sets) if (value < set.reduce((product, index) => product * (on[index] ?? 0), 1) - INDEPENDENT_TOLERANCE) faults += 1;
        }
        expect(worst, String(worstAt)).toBeLessThanOrEqual(INDEPENDENT_TOLERANCE);
        expect(faults).toBe(0);
      }),
      { numRuns: 400 },
    );
  }, 30_000);

  it("gives a curve with no two points at one time when two bend times are next to each other", () => {
    const curves: Survival[] = [[[0, 1], [0.18848476106898124, 0]], [[0, 1], [0.04644542849054632, 4.180786278414646e-219], [2.135038516073287, 0], [2.145846001067972, 0]], [[0, 1], [0.01, 0]]];
    expect(curveFault(independentStop(curves, [[1], [0]]) ?? [])).toBeUndefined();
  });

  it("keeps each piece within the tolerance where the error is not at the middle of the piece", () => {
    // Under the midpoint rule of the first version, this case was 1.14e-6 off at 0.0294 days.
    const curves: Survival[] = [[[0, 1], [0.04958005580156582, 0], [0.05958005580156582, 0]], [[0, 1], [0.05593706829136056, 0], [0.06593706829136056, 0]], [[0, 1], [0.06122488094294064, 0], [0.07122488094294063, 0]], [[0, 1], [4.608966653311293, 0]]];
    const independent = independentStop(curves, [[3], [0, 1, 2]]) ?? [];
    let worst = 0;
    for (const [index, [t1, c1]] of independent.slice(1).entries()) {
      const [t0, c0] = independent[index] ?? [0, 1];
      for (let step = 1; step < 16; step += 1) {
        const days = t0 + ((t1 - t0) * step) / 16;
        const [a, b, c, d] = curves.map((curve) => survivalAt(curve, days)) as [number, number, number, number];
        const exact = 1 - (1 - d) * (1 - a * b * c);
        worst = Math.max(worst, Math.abs(c0 + ((c1 - c0) * step) / 16 - exact));
      }
    }
    expect(worst).toBeLessThanOrEqual(INDEPENDENT_TOLERANCE);
  });

  it("gives nothing with no sets, and a chance of 0 with an empty list of sets", () => {
    expect(independentStop([GRID, MAIN], undefined)).toBeUndefined();
    expect(independentStop([GRID, MAIN], [])).toEqual(eventStop([GRID, MAIN], () => false));
    expect(curveFault(independentStop(Array.from({ length: 13 }, () => GRID), [[0], [12]]) ?? [])).toBeUndefined();
  });

  it("past 12 cuts, lies within the tolerance of the exact chance for each curve and set", () => {
    fc.assert(
      fc.property(fc.array(curve, { minLength: 13, maxLength: 13 }), fc.array(fc.integer({ min: 1, max: (1 << 13) - 1 }), { minLength: 1, maxLength: 5 }), (curves, rawMasks) => {
        // The set of all cuts puts each cut in a set, so the 13 cuts are past MINIMAL_STOP_CUTS.
        const masks = [...new Set([...rawMasks, (1 << 13) - 1])];
        const sets = masks.map((mask) => curves.flatMap((_, index) => ((mask >> index) & 1 ? [index] : [])));
        const independent = independentStop(curves, sets) ?? [];
        expect(curveFault(independent)).toBeUndefined();
        const stopping = Array.from({ length: 1 << 13 }, (_, state) => masks.some((mask) => (mask & state) === mask));
        const reads: [number, number][] = [0, 0.3, 1, 2.2, 4, 7.5, 12, 20].map((days) => [days, survivalAt(independent, days)]);
        // The middle of each 50th piece of the result, with the value of its line.
        for (let index = 0; index + 1 < independent.length; index += 50) {
          const [[t0, c0], [t1, c1]] = [independent[index] ?? [0, 1], independent[index + 1] ?? [0, 0]];
          reads.push([(t0 + t1) / 2, (c0 + c1) / 2]);
        }
        let worst = 0;
        for (const [days, value] of reads) {
          const on = curves.map((item) => survivalAt(item, days));
          let exact = 0;
          for (const [state, stops] of stopping.entries()) {
            if (stops) exact += on.reduce((product, chance, index) => product * ((state >> index) & 1 ? chance : 1 - chance), 1);
          }
          worst = Math.max(worst, Math.abs(value - exact));
        }
        expect(worst).toBeLessThanOrEqual(INDEPENDENT_TOLERANCE);
      }),
      { numRuns: 25 },
    );
  }, 60_000);

  it("past 12 cuts, gives the closed forms of a set of all cuts, of pairs from two feeds and of 20 stages", () => {
    const all = independentStop(Array.from({ length: 13 }, () => GRID), [Array.from({ length: 13 }, (_, index) => index)]) ?? [];
    // Two feeds of 7 cuts: a stop needs one cut of each feed, so the 49 sets are each pair (a, b).
    const feeds = [...Array.from({ length: 7 }, () => GRID), ...Array.from({ length: 7 }, () => ROAD)];
    const pairs = independentStop(feeds, Array.from({ length: 49 }, (_, index) => [Math.floor(index / 7), 7 + (index % 7)])) ?? [];
    // 20 stages of 2 feeds: a stop needs the two feeds of one stage.
    const stages = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? GRID : ROAD));
    const wide = independentStop(stages, Array.from({ length: 20 }, (_, index) => [2 * index, 2 * index + 1])) ?? [];
    for (const days of [...TIMES, 0.37, 2.5, 6.1]) {
      const [grid, road] = [survivalAt(GRID, days), survivalAt(ROAD, days)];
      expect(Math.abs(survivalAt(all, days) - grid ** 13), String(days)).toBeLessThanOrEqual(INDEPENDENT_TOLERANCE);
      expect(Math.abs(survivalAt(pairs, days) - (1 - (1 - grid) ** 7) * (1 - (1 - road) ** 7)), String(days)).toBeLessThanOrEqual(INDEPENDENT_TOLERANCE);
      expect(Math.abs(survivalAt(wide, days) - (1 - (1 - grid * road) ** 20)), String(days)).toBeLessThanOrEqual(INDEPENDENT_TOLERANCE);
    }
  });

  it("gives nothing when the expansion of a group past 12 cuts passes the budget maxWork, and refuses a bad budget", () => {
    const feeds = [...Array.from({ length: 7 }, () => GRID), ...Array.from({ length: 7 }, () => ROAD)];
    const pairs = Array.from({ length: 49 }, (_, index) => [Math.floor(index / 7), 7 + (index % 7)]);
    expect(independentStop(feeds, pairs)).toBeDefined();
    expect(independentStop(feeds, pairs, 1)).toBeUndefined();
    // 7 stages of 2 feeds are 7 groups of 2 cuts, so the sum over the states needs no budget.
    const stages = Array.from({ length: 7 }, (_, index) => [2 * index, 2 * index + 1]);
    expect(independentStop(feeds, stages, 1)).toBeDefined();
    for (const maxWork of [0, 1.5, Number.NaN]) expect(() => independentStop(feeds, pairs, maxWork)).toThrow(RangeError);
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
    expect(yearShortfall(SAMPLE_ENDURANCE, "elsewhere", { at: AT })).toEqual({ place: "elsewhere", levels: { life: 0, health: 0, comfort: 0 }, independent: { life: 0, health: 0, comfort: 0 }, upper: { life: 0, health: 0, comfort: 0 }, unread: [], coarse: [], independentUpper: [], cases: [] });
  });
});
