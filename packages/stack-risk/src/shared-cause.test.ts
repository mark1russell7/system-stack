import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sharedCauseFit } from "./shared-cause.ts";

// The measured chances of a group from a known shared part and known own parts.
const measured = (shared: number, own: readonly number[]) => ({
  works: own.map((value) => shared * value),
  anyWorks: shared * (1 - own.reduce((none, value) => none * (1 - value), 1)),
});

describe("sharedCauseFit", () => {
  it("gives the exact value of two parts", () => {
    // Two copies that each work 0.95 of the time, and one or more works 0.97 of the time. Independent copies give 0.9975.
    const fit = sharedCauseFit({ works: [0.95, 0.95], anyWorks: 0.97 });
    expect(fit.shared).toBeCloseTo((0.95 * 0.95) / (0.95 + 0.95 - 0.97), 15);
    expect(fit.own[0]).toBeCloseTo(0.95 / fit.shared, 15);
  });

  it("finds the shared part and the own parts that made the chances", () => {
    const chance = fc.double({ min: 0.05, max: 1, noNaN: true });
    fc.assert(
      fc.property(chance, fc.array(fc.double({ min: 0.05, max: 0.999, noNaN: true }), { minLength: 2, maxLength: 6 }), (shared, own) => {
        const fit = sharedCauseFit(measured(shared, own));
        expect(fit.shared).toBeCloseTo(shared, 9);
        fit.own.forEach((value, at) => expect(value).toBeCloseTo(own[at] ?? 0, 9));
      }),
    );
  });

  it("agrees with the exact value of two parts when it halves the interval", () => {
    const two = sharedCauseFit({ works: [0.9, 0.8], anyWorks: 0.92 });
    // A third part that never works adds nothing: the halvings give the value of the two other parts.
    const three = sharedCauseFit({ works: [0.9, 0.8, 0], anyWorks: 0.92 });
    expect(three.shared).toBeCloseTo(two.shared, 12);
    expect(three.own).toEqual([expect.closeTo(two.own[0] ?? 0, 12), expect.closeTo(two.own[1] ?? 0, 12), 0]);
  });

  it("gives no shared part when the parts fail together less often than independent parts", () => {
    expect(sharedCauseFit({ works: [0.9, 0.8], anyWorks: 0.98 })).toEqual({ shared: 1, own: [0.9, 0.8] });
    expect(sharedCauseFit({ works: [0.9, 0.8], anyWorks: 0.99 })).toEqual({ shared: 1, own: [0.9, 0.8] });
  });

  it("puts all the failures in the shared part when the parts always fail together", () => {
    expect(sharedCauseFit({ works: [0.9, 0.9], anyWorks: 0.9 })).toEqual({ shared: 0.9, own: [1, 1] });
  });

  it("refuses a group that is not valid", () => {
    expect(() => sharedCauseFit({ works: [0.9], anyWorks: 0.9 })).toThrow(RangeError);
    expect(() => sharedCauseFit({ works: [0.9, 1.1], anyWorks: 0.99 })).toThrow(RangeError);
    expect(() => sharedCauseFit({ works: [0.9, Number.NaN], anyWorks: 0.99 })).toThrow(RangeError);
    expect(() => sharedCauseFit({ works: [0.9, 0.8], anyWorks: 0.85 })).toThrow(RangeError);
  });
});
