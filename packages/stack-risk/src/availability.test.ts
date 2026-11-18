import { sendChance, type Placement } from "@mark1russell7/algebra/availability";
import { STACK_SCHEMA, type Part, type Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { worksChance } from "./chance.ts";
import { RISK_SCHEMA, type Chance, type DelayPoint, type RiskLayer } from "./layer.ts";

// The chance of a stack agrees with `sendChance` of `@mark1russell7/algebra/availability` for each count of copies.
// A cause of the placement is a part that needs the causes that contain it. A copy is a part that needs its causes.
// The part `send` needs `atLeast` of the copies. The chance that a part works is 1 minus the chance that it fails on its own.

interface CauseSpec {
  readonly id: string;
  readonly down: number;
  readonly within: readonly string[];
}

interface CopySpec {
  readonly id: string;
  readonly needs: readonly string[];
  readonly down: number;
  readonly wait: number;
  readonly delay: readonly DelayPoint[];
}

interface Spec {
  readonly causes: readonly CauseSpec[];
  readonly copies: readonly CopySpec[];
  readonly atLeast: number;
}

const chance = fc.double({ min: 0, max: 1, noNaN: true });

/** Delay points with increasing whole times and chances that do not decrease. */
const delayPoints = fc.array(fc.tuple(fc.integer({ min: 0, max: 60 }), chance), { maxLength: 3 }).map((pairs) => {
  const times = [...new Set(pairs.map(([time]) => time))].sort((a, b) => a - b);
  const chances = pairs.map(([, value]) => value).sort((a, b) => a - b);
  return times.map((within, at) => ({ within, chance: chances[at] ?? 1 }));
});

/** Placements of up to 5 causes, each in some causes before it, up to 4 copies, and a count from 1 to the count of copies. */
const specs: fc.Arbitrary<Spec> = fc
  .record({
    causes: fc.array(fc.record({ down: chance, within: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }) }), { maxLength: 5 }),
    copies: fc.array(
      fc.record({ needs: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }), down: chance, wait: fc.constantFrom(0, 5, 30), delay: delayPoints }),
      { maxLength: 4 },
    ),
    count: fc.integer({ min: 1, max: 4 }),
  })
  .map(({ causes, copies, count }) => {
    const ids = causes.map((_, at) => `cause-${String(at)}`);
    return {
      causes: causes.map((cause, at) => ({ id: ids[at] ?? "", down: cause.down, within: ids.slice(0, at).filter((_, before) => cause.within[before] === true) })),
      copies: copies.map((copy, at) => ({ id: `copy-${String(at)}`, needs: ids.filter((_, index) => copy.needs[index] === true), down: copy.down, wait: copy.wait, delay: copy.delay })),
      atLeast: Math.min(count, Math.max(1, copies.length)),
    };
  });

/** The limits of time: whole seconds, to test the points at the limit, and no limit. */
const limits = fc.oneof(fc.integer({ min: 0, max: 120 }), fc.constant(Number.POSITIVE_INFINITY));

/** The placement of algebra. With `timed` false, the copies have no wait and no delay. */
function placementOf(spec: Spec, timed: boolean): Placement {
  return {
    causes: spec.causes.map((cause) => ({ id: cause.id, down: cause.down, within: cause.within })),
    copies: spec.copies.map((copy) => ({ id: copy.id, needs: copy.needs, down: copy.down, ...(timed ? { wait: copy.wait, delay: copy.delay } : {}) })),
  };
}

/** The stack and the risk layer of a placement. */
function stackOf(spec: Spec): { readonly stack: Stack; readonly layer: RiskLayer } {
  const parts: Part[] = [
    ...spec.causes.map((cause) => ({ id: cause.id, kind: "cause", needs: [...cause.within] })),
    ...spec.copies.map((copy) => ({ id: copy.id, kind: "copy", needs: [...copy.needs] })),
    { id: "send", kind: "function", needs: [{ any: spec.copies.map((copy) => copy.id), count: spec.atLeast }] },
  ];
  const chances: Chance[] = [
    ...spec.causes.map((cause) => ({ part: cause.id, works: 1 - cause.down })),
    ...spec.copies.map((copy) => ({ part: copy.id, works: 1 - copy.down, wait: copy.wait, delay: copy.delay })),
  ];
  return { stack: { schema: STACK_SCHEMA, parts }, layer: { schema: RISK_SCHEMA, goals: [], chances } };
}

/** This function gives the value of `worksChance` for the part `send`, and it throws when the result has no value. */
function valueOf(spec: Spec, within: number | undefined): number {
  const { stack, layer } = stackOf(spec);
  const result = worksChance(layer, stack, "send", within === undefined ? {} : { within });
  if (result.kind !== "exact") throw new Error("The calculation gave no value.");
  return result.value;
}

describe("the equivalence with algebra/availability", () => {
  it("gives the chance that the count of copies or more sends, with no limit of time", () => {
    fc.assert(
      fc.property(specs, (spec) => {
        const expected = sendChance(placementOf(spec, false), { atLeast: spec.atLeast });
        expect(expected.lo).toBe(expected.hi);
        expect(valueOf(spec, undefined)).toBeCloseTo(expected.lo, 10);
      }),
      { numRuns: 300 },
    );
  });

  it("gives the chance that the count of copies or more sends within each limit of time, with the waits and the delays", () => {
    fc.assert(
      fc.property(specs, limits, (spec, within) => {
        expect(valueOf(spec, within)).toBeCloseTo(sendChance(placementOf(spec, true), { atLeast: spec.atLeast, within }).lo, 10);
      }),
      { numRuns: 300 },
    );
  });

  it("agrees for a placement of two providers, a shared region and two copies of two ranks", () => {
    const spec: Spec = {
      atLeast: 1,
      causes: [
        { id: "provider-a", down: 0.001, within: [] },
        { id: "provider-b", down: 0.002, within: [] },
        { id: "region-a", down: 0.005, within: ["provider-a"] },
      ],
      copies: [
        { id: "home", needs: ["region-a"], down: 0.02, wait: 0, delay: [{ within: 5, chance: 0.9 }, { within: 30, chance: 0.999 }] },
        { id: "cloud", needs: ["provider-b"], down: 0.01, wait: 60, delay: [{ within: 5, chance: 0.95 }] },
      ],
    };
    for (const within of [0, 5, 30, 64, 65, 120]) {
      expect(valueOf(spec, within)).toBeCloseTo(sendChance(placementOf(spec, true), { atLeast: 1, within }).lo, 12);
    }
    const home = 0.999 * 0.995 * 0.98 * 0.999;
    const cloud = 0.998 * 0.99 * 0.95;
    expect(valueOf(spec, 65)).toBeCloseTo(1 - (1 - home) * (1 - cloud), 12);
  });
});
