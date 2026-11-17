import { SAMPLE_STACK, STACK_SCHEMA, works, type Need, type Part, type Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { worksChance, type WorksChance } from "./chance.ts";
import { RISK_SCHEMA, type RiskLayer } from "./layer.ts";
import { SAMPLE_RISK } from "./sample.ts";

const stack = (...parts: Part[]): Stack => ({ schema: STACK_SCHEMA, parts });
const layer = (chances: Record<string, number>): RiskLayer => ({ schema: RISK_SCHEMA, goals: [], chances: Object.entries(chances).map(([part, value]) => ({ part, works: value })) });
const exact = (result: WorksChance): Extract<WorksChance, { kind: "exact" }> => {
  if (result.kind !== "exact") throw new Error("The calculation gave no value.");
  return result;
};

// The part `a` needs one of `b` and `c`.
const pair = stack({ id: "b", kind: "x" }, { id: "c", kind: "x" }, { id: "a", kind: "function", needs: [{ any: ["b", "c"] }] });
// The parts `b` and `c` each need the shared part `d`.
const shared = (needs: Need[]): Stack => stack({ id: "d", kind: "x" }, { id: "b", kind: "x", needs: ["d"] }, { id: "c", kind: "x", needs: ["d"] }, { id: "a", kind: "function", needs });

describe("worksChance", () => {
  it("gives the chance of the part itself for a part with no needs", () => {
    const result = exact(worksChance(layer({ a: 0.9 }), stack({ id: "a", kind: "x" }), "a"));
    expect(result.value).toBeCloseTo(0.9, 12);
    expect(result.importance.map((entry) => entry.part)).toEqual(["a"]);
    expect(result.importance[0]?.importance).toBeCloseTo(1, 12);
    expect(result.assumed).toEqual([]);
  });

  it("uses the chance 1 for the part itself when it has no record, and does not put it in assumed", () => {
    expect(worksChance(layer({}), stack({ id: "a", kind: "x" }), "a")).toEqual({ kind: "exact", value: 1, importance: [{ part: "a", importance: 1 }], assumed: [] });
  });

  it("gives the chance that one of two parts works, and the importance of each part", () => {
    const result = exact(worksChance(layer({ b: 0.9, c: 0.8 }), pair, "a"));
    expect(result.value).toBeCloseTo(0.98, 12);
    expect(result.importance.map((entry) => entry.part)).toEqual(["a", "b", "c"]);
    expect(result.importance.map((entry) => entry.importance)[0]).toBeCloseTo(0.98, 12);
    expect(result.importance.map((entry) => entry.importance)[1]).toBeCloseTo(0.2, 12);
    expect(result.importance.map((entry) => entry.importance)[2]).toBeCloseTo(0.1, 12);
    expect(result.assumed).toEqual([]);
  });

  it("counts a shared part one time", () => {
    const chances = layer({ b: 0.9, c: 0.9, d: 0.9 });
    // Each of b, c and d must work: 0.9 * 0.9 * 0.9, and not 0.9 to the power 4.
    expect(exact(worksChance(chances, shared(["b", "c"]), "a")).value).toBeCloseTo(0.729, 12);
    // The part d must work, and one of b and c: 0.9 * (1 - 0.1 * 0.1).
    expect(exact(worksChance(chances, shared([{ any: ["b", "c"] }]), "a")).value).toBeCloseTo(0.891, 12);
  });

  it("gives 0 and two empty lists for a part that cannot work", () => {
    const none = { kind: "exact", value: 0, importance: [], assumed: [] };
    expect(worksChance(layer({ b: 0.9 }), pair, "not-a-part")).toEqual(none);
    expect(worksChance(layer({ b: 0.9 }), pair, "a", { down: ["a"] })).toEqual(none);
    expect(worksChance(layer({ b: 0.9 }), pair, "a", { down: ["b", "c"] })).toEqual(none);
    expect(worksChance(layer({}), stack({ id: "a", kind: "x", needs: ["not-a-part"] }), "a")).toEqual(none);
  });

  it("removes each path through a part that is down", () => {
    const result = exact(worksChance(layer({ b: 0.9, c: 0.8 }), pair, "a", { down: ["b"] }));
    expect(result.value).toBeCloseTo(0.8, 12);
    // The part a has no record, so its chance is 1: the importance of c is 1, and the importance of a is 0.8.
    expect(result.importance.map((entry) => entry.part)).toEqual(["c", "a"]);
  });

  it("puts the parts with one importance in the sequence of the stack, after the part itself", () => {
    const chances = layer({ b: 0.9, c: 0.9 });
    const needs = { id: "a", kind: "function", needs: ["b", "c"] };
    const parts = (result: WorksChance): string[] => exact(result).importance.map((entry) => entry.part);
    expect(parts(worksChance(chances, stack({ id: "c", kind: "x" }, { id: "b", kind: "x" }, needs), "a"))).toEqual(["c", "b", "a"]);
    expect(parts(worksChance(chances, stack(needs, { id: "b", kind: "x" }, { id: "c", kind: "x" }), "a"))).toEqual(["b", "c", "a"]);
    // With no chance record, each of the three parts has the importance 1.
    expect(parts(worksChance(layer({}), stack({ id: "c", kind: "x" }, { id: "b", kind: "x" }, needs), "a"))).toEqual(["a", "c", "b"]);
  });

  it("names each part of the paths with no chance record, and uses the chance 1 for it", () => {
    const result = exact(worksChance(layer({ b: 0.9 }), pair, "a"));
    expect(result.value).toBeCloseTo(1, 12);
    expect(result.assumed).toEqual(["c"]);
    // The names are in the sequence of the stack.
    const both = stack({ id: "c", kind: "x" }, { id: "b", kind: "x" }, { id: "a", kind: "function", needs: ["b", "c"] });
    expect(exact(worksChance(layer({}), both, "a")).assumed).toEqual(["c", "b"]);
  });

  it("uses the first chance record of a part", () => {
    const twice: RiskLayer = { schema: RISK_SCHEMA, goals: [], chances: [{ part: "a", works: 0.5 }, { part: "a", works: 0.9 }] };
    expect(exact(worksChance(twice, stack({ id: "a", kind: "x" }), "a")).value).toBeCloseTo(0.5, 12);
  });

  it("gives the chance of the sample alert", () => {
    const of = (part: string): number => SAMPLE_RISK.chances?.find((entry) => entry.part === part)?.works ?? 1;
    const either = (a: number, b: number): number => 1 - (1 - a) * (1 - b);
    // The card is a part of the cloud path and of the call path. The calculation by hand has one case for each state of the card.
    const home = of("program-home") * of("home-host") * of("home-power") * of("home-network");
    const cloud = of("program-cloud") * of("cloud-host") * of("cloud-account");
    const push = of("push") * of("push-account");
    const call = of("call") * of("call-account");
    const expected = of("reader") * of("phone") * (of("card") * either(home, cloud) * either(push, call) + (1 - of("card")) * home * push);
    const result = exact(worksChance(SAMPLE_RISK, SAMPLE_STACK, "alert"));
    expect(result.value).toBeCloseTo(expected, 12);
    expect(result.value).toBeLessThan(0.99);
    expect(result.assumed).toEqual([]);
    // The parts that each path has are the most important parts.
    expect(result.importance.slice(0, 3).map((entry) => entry.part).sort()).toEqual(["alert", "phone", "reader"]);
    expect(result.importance).toHaveLength(15);
  });

  it("throws for a chance that is not from 0 to 1", () => {
    expect(() => worksChance(layer({ b: 1.5 }), pair, "a")).toThrow(RangeError);
    expect(() => worksChance(layer({ b: -0.1 }), pair, "a")).toThrow(RangeError);
  });

  it("gives the result budget when the search of the paths or the calculation passes its limit", () => {
    expect(worksChance(layer({ b: 0.9, c: 0.8 }), pair, "a", { maxSets: 1 })).toEqual({ kind: "budget" });
    expect(worksChance(SAMPLE_RISK, SAMPLE_STACK, "alert", { maxSteps: 1 })).toEqual({ kind: "budget" });
  });

  it("throws for a limit that is not valid", () => {
    expect(() => worksChance(layer({}), pair, "a", { maxSets: 0 })).toThrow(RangeError);
    expect(() => worksChance(layer({}), pair, "a", { maxSteps: -1 })).toThrow(RangeError);
  });
});

// Generated stacks: each need names a part of the stack, or a part that is not in it. The needs can go round.
const IDS = ["p0", "p1", "p2", "p3", "p4", "p5"];
const needArbitrary: fc.Arbitrary<Need> = fc.letrec<{ need: Need }>((tie) => ({
  need: fc.oneof(
    { maxDepth: 2 },
    fc.constantFrom(...IDS, "not-a-part"),
    fc.record({ all: fc.array(tie("need"), { maxLength: 3 }) }),
    fc.record({ any: fc.array(tie("need"), { maxLength: 3 }) }),
    fc.record({ any: fc.array(tie("need"), { maxLength: 3 }), count: fc.integer({ min: 0, max: 3 }) }),
  ),
})).need;
const stackArbitrary: fc.Arbitrary<Stack> = fc
  .tuple(fc.integer({ min: 1, max: IDS.length }), fc.array(fc.array(needArbitrary, { maxLength: 2 }), { minLength: IDS.length, maxLength: IDS.length }))
  .map(([count, needs]) => stack(...IDS.slice(0, count).map((id, index) => ({ id, kind: "x", needs: needs[index] ?? [] }))));
// The chance of each part, or `undefined` for a part with no record.
const chancesArbitrary = fc.array(fc.option(fc.constantFrom(0, 0.25, 0.5, 0.9, 1), { nil: undefined }), { minLength: IDS.length, maxLength: IDS.length });
const caseArbitrary = fc.tuple(stackArbitrary, fc.constantFrom(...IDS), fc.subarray(IDS), chancesArbitrary);

/** This function gives each subset of a list. */
const subsets = (list: readonly string[]): string[][] => list.reduce<string[][]>((sets, item) => [...sets, ...sets.map((set) => [...set, item])], [[]]);

/** This function gives the chance that a part works as a sum over each state of the parts: the calculation with no path. */
const bySum = (generated: Stack, root: string, down: readonly string[], chance: (id: string) => number): number => {
  const free = generated.parts.map((part) => part.id).filter((id) => !down.includes(id));
  let total = 0;
  for (const up of subsets(free)) {
    const off = free.filter((id) => !up.includes(id));
    if (!works(generated, root, [...down, ...off])) continue;
    total += up.reduce((product, id) => product * chance(id), 1) * off.reduce((product, id) => product * (1 - chance(id)), 1);
  }
  return total;
};

describe("the chance of generated stacks", () => {
  it("agrees with the sum over each state of the parts, and each importance agrees too", () => {
    fc.assert(
      fc.property(caseArbitrary, ([generated, root, down, values]) => {
        const records = Object.fromEntries(IDS.flatMap((id, index) => (values[index] === undefined ? [] : [[id, values[index]]]))) as Record<string, number>;
        const chance = (id: string): number => records[id] ?? 1;
        const result = worksChance(layer(records), generated, root, { down });
        if (result.kind !== "exact") throw new Error("A small stack gave no result.");
        expect(result.value).toBeCloseTo(bySum(generated, root, down, chance), 9);
        for (const entry of result.importance) {
          const fixed = (value: number) => (id: string): number => (id === entry.part ? value : chance(id));
          expect(entry.importance).toBeCloseTo(bySum(generated, root, down, fixed(1)) - bySum(generated, root, down, fixed(0)), 9);
        }
        expect(result.assumed.every((id) => !(id in records) && id !== root)).toBe(true);
      }),
      { seed: 20261116, numRuns: 300 },
    );
  });

  it("gives the same value and the same importances, to the last digit, for each sequence of the parts", () => {
    // These chances have no short binary form, so a different sequence of the multiplications changes the last digits.
    const odd = fc.array(fc.constantFrom(0.3, 0.9, 0.97, 0.995, 0.999), { minLength: IDS.length, maxLength: IDS.length });
    fc.assert(
      fc.property(stackArbitrary, fc.constantFrom(...IDS), odd, fc.array(fc.nat(), { minLength: IDS.length, maxLength: IDS.length }), (generated, root, values, keys) => {
        const records = Object.fromEntries(IDS.map((id, index) => [id, values[index] ?? 1]));
        // The parts in a second sequence, from the generated keys.
        const moved = stack(...generated.parts.map((part, index) => ({ part, key: keys[index] ?? 0 })).sort((a, b) => a.key - b.key).map((entry) => entry.part));
        const first = worksChance(layer(records), generated, root);
        const second = worksChance(layer(records), moved, root);
        if (first.kind !== "exact" || second.kind !== "exact") throw new Error("A small stack gave no result.");
        expect(second.value).toBe(first.value);
        const byPart = (result: typeof first): [string, number][] => result.importance.map((entry): [string, number] => [entry.part, entry.importance]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
        expect(byPart(second)).toEqual(byPart(first));
      }),
      { seed: 20261117, numRuns: 300 },
    );
  });

  it("gives the same chance of the sample alert for each start of the sequence of its parts", () => {
    const result = exact(worksChance(SAMPLE_RISK, SAMPLE_STACK, "alert"));
    const value = result.value;
    // The README of the package shows these values, to the last digit.
    expect(value).toBe(0.9649835920528091);
    expect(result.importance.slice(0, 4)).toEqual([
      { part: "reader", importance: 0.9948284454152673 },
      { part: "phone", importance: 0.9698327558319689 },
      { part: "alert", importance: 0.9649835920528091 },
      { part: "card", importance: 0.02187312796942623 },
    ]);
    for (let start = 1; start < SAMPLE_STACK.parts.length; start += 1) {
      const moved: Stack = { ...SAMPLE_STACK, parts: [...SAMPLE_STACK.parts.slice(start), ...SAMPLE_STACK.parts.slice(0, start)] };
      expect(exact(worksChance(SAMPLE_RISK, moved, "alert")).value).toBe(value);
    }
  });
});
