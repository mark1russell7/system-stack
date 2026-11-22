import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { enduranceOf } from "./endurance.ts";
import { fitTries, largestFit, TOLERANCE } from "./fit.ts";
import type { CaseCuts, Converter, EnduranceLayer } from "./layer.ts";
import { SAMPLE_ENDURANCE } from "./sample.ts";

/** A try whose shortfall is `slope` times the amount above `zero`. */
function linear(zero: number, slope: number, rate: number) {
  return (x: number) => ({ short: Math.max(0, slope * (x - zero)), need: rate * x, value: x });
}

describe("largestFit", () => {
  it("gives the upper limit when it fits, and 0 when nothing above 0 fits", () => {
    expect(largestFit(7, linear(10, 1, 1))).toEqual({ x: 7, value: 7 });
    const none = largestFit(7, (x) => ({ short: 1, need: x, value: x }));
    expect(none.x).toBeLessThanOrEqual(4 * TOLERANCE * 7);
    expect(none.value).toBeUndefined();
  });

  it("does not end below the zero on a shortfall of rounding", () => {
    // Below 5, a rounding of 1 ulp of the need stays. A bisection step there fits, but it is not in the band above the zero.
    const fit = largestFit(10, (x) => ({ short: x > 5 ? 0.01 * (x - 5) : x * Number.EPSILON, need: x, value: x }));
    expect(fit.x).toBeCloseTo(5, 9);
  });

  it("finds the zero of a linear shortfall in a few tries", () => {
    fitTries.count = 0;
    const fit = largestFit(100, linear(37.5, 2, 2));
    expect(fit.x).toBeCloseTo(37.5, 9);
    expect(fitTries.count).toBeLessThanOrEqual(5);
  });

  it("finds the zero of a shortfall that is linear in parts, for each zero and slope", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 0.99, noNaN: true }), fc.double({ min: 0.01, max: 100, noNaN: true }), (part, slope) => {
        const zero = 50 * part;
        // Two pieces: a slow slope to 1.2 times the zero, then a slope 10 times faster.
        const attempt = (x: number) => {
          const above = Math.max(0, x - zero);
          const knee = 0.2 * zero;
          return { short: slope * Math.min(above, knee) + 10 * slope * Math.max(0, above - knee), need: x, value: x };
        };
        fitTries.count = 0;
        const fit = largestFit(50, attempt);
        expect(fit.x).toBeLessThanOrEqual(zero * (1 + 1e-9));
        expect(fit.x).toBeGreaterThanOrEqual(zero * (1 - 1e-9));
        // A bisection takes approximately 43 tries. The safeguard keeps the count below twice that.
        expect(fitTries.count).toBeLessThanOrEqual(90);
      }),
    );
  });
});

const CUT: CaseCuts = { case: "c", title: "Cut", cuts: [{ part: "grid", title: "Grid", duration: [[0, 1], [1, 0]], source: "s" }] };

/** A chain of `depth` steps. At each step, two converters split one resource, and a third joins their outputs. 100 u give 100 / 2^depth days. */
function sharedChain(depth: number): EnduranceLayer {
  const resources = [{ code: "k0", unit: "u" }];
  const converters: Converter[] = [];
  for (let step = 1; step <= depth; step += 1) {
    resources.push({ code: `a${step}`, unit: "u" }, { code: `b${step}`, unit: "u" }, { code: `k${step}`, unit: "u" });
    converters.push(
      { id: `a${step}`, takes: [{ resource: `k${step - 1}`, amount: 1 }], gives: { resource: `a${step}`, amount: 1 } },
      { id: `b${step}`, takes: [{ resource: `k${step - 1}`, amount: 1 }], gives: { resource: `b${step}`, amount: 1 } },
      { id: `k${step}`, takes: [{ resource: `a${step}`, amount: 1 }, { resource: `b${step}`, amount: 1 }], gives: { resource: `k${step}`, amount: 1 } },
    );
  }
  converters.push({ id: "use", takes: [{ resource: `k${depth}`, amount: 1 }], gives: { need: "kit", amount: 1 } });
  return {
    schema: SAMPLE_ENDURANCE.schema,
    levels: ["critical"],
    resources,
    stores: [{ id: "can", resource: "k0", amount: 100 }],
    draws: [{ need: "kit", level: "critical", perDay: 1, supply: "grid" }],
    converters,
  };
}

/**
 * A kit takes `bulk` of an ample resource a, and 1 b and 1 c. A maker gives `per` b (or c) for `per` L of fuel.
 * A second converter after it makes 1 kit from 1 spare. So the exact days are fuel / 2 + spare.
 */
function twoWayLayer(fuel: number, per: number, bulk: number, spare: number): EnduranceLayer {
  return {
    schema: SAMPLE_ENDURANCE.schema,
    levels: ["critical"],
    resources: [{ code: "fuel", unit: "L" }, { code: "a", unit: "u" }, { code: "b", unit: "u" }, { code: "c", unit: "u" }, { code: "spare", unit: "u" }],
    stores: [{ id: "can", resource: "fuel", amount: fuel }, { id: "tank", resource: "a", amount: 1e9 }, { id: "box", resource: "spare", amount: spare }],
    draws: [{ need: "kit", level: "critical", perDay: 1, supply: "grid" }],
    converters: [
      { id: "make-b", takes: [{ resource: "fuel", amount: per }], gives: { resource: "b", amount: per } },
      { id: "make-c", takes: [{ resource: "fuel", amount: per }], gives: { resource: "c", amount: per } },
      { id: "kit", takes: [{ resource: "a", amount: bulk }, { resource: "b", amount: 1 }, { resource: "c", amount: 1 }], gives: { need: "kit", amount: 1 } },
      { id: "kit-from-spare", takes: [{ resource: "spare", amount: 1 }], gives: { need: "kit", amount: 1 } },
    ],
  };
}

describe("a shared chain and a second way", () => {
  it("gives the exact days, fuel / 2 + spare, for each amount", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 100, noNaN: true }),
        fc.constantFrom(1, 3, 7, 0.1, 1 / 3),
        fc.constantFrom(0, 1, 100, 1e4),
        fc.double({ min: 0.1, max: 50, noNaN: true }),
        (fuel, per, bulk, spare) => {
          const days = enduranceOf(twoWayLayer(fuel, per, bulk, spare), CUT, { at: "2026-12-01" }).needs["kit"]?.days ?? Number.NaN;
          const exact = fuel / 2 + spare;
          expect(Math.abs(days - exact)).toBeLessThanOrEqual(1e-9 * exact);
        },
      ),
    );
    // The cases of the review of 0.3.1, which were 13 % to 22 % short.
    for (const [fuel, per, bulk, spare] of [[7, 0.1, 1, 0.7], [10, 0.1, 100, 3], [13.7, 0.1, 1e4, 0.7]] as const) {
      expect(enduranceOf(twoWayLayer(fuel, per, bulk, spare), CUT, { at: "2026-12-01" }).needs["kit"]?.days).toBeCloseTo(fuel / 2 + spare, 9);
    }
  });
});

describe("the cost of a shared chain", () => {
  it("gives the days of a shared chain of depth 3 with fewer than 5000 tries", () => {
    // Before 0.3.1, each fit was a bisection of approximately 43 tries, so depth 3 took approximately 43^4 tries (more than 220 s).
    fitTries.count = 0;
    const days = enduranceOf(sharedChain(3), CUT, { at: "2026-12-01" }).needs["kit"]?.days;
    expect(days).toBeCloseTo(12.5, 6);
    expect(fitTries.count).toBeLessThan(5000);
  });
});
