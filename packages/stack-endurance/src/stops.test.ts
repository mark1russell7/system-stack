import { STACK_SCHEMA, type Need, type Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { caseStopped } from "./endurance.ts";
import { minimalStops } from "./shortfall.ts";
import { stackStops } from "./stops.ts";

const stack = (parts: Stack["parts"]): Stack => ({ schema: STACK_SCHEMA, parts });

/** The check: `minimalStops` examines each set of cuts with `caseStopped`, as `stopCurves` does with no stack. */
function bruteStops(generated: Stack, supply: string, parts: readonly string[], down: readonly string[]): number[][] | undefined {
  const stops = (cuts: readonly number[]): boolean =>
    caseStopped({ case: "c", title: "C", cuts: cuts.map((index) => ({ part: parts[index] ?? "", title: "Cut", source: "s" })) }, { stack: generated, down }).has(supply);
  return minimalStops(parts.length, stops);
}

describe("stackStops", () => {
  it("gives a cut of the supply alone, each choice of one cut for each part, and the order of minimalStops", () => {
    const generated = stack([{ id: "a" }, { id: "b" }, { id: "s", needs: [{ any: ["a", "b"] }] }].map((part) => ({ kind: "x", ...part })));
    // The cuts 0 and 3 are of the part a, and the cut 2 is of the supply.
    const parts = ["a", "b", "s", "a"];
    expect(stackStops(generated, "s", parts)).toEqual([[2], [0, 1], [1, 3]]);
    expect(stackStops(generated, "s", parts)).toEqual(bruteStops(generated, "s", parts, []));
  });

  it("gives only the cuts of the supply when the supply does not work in the base stack, or is not in it", () => {
    const generated = stack([{ id: "a", kind: "x", needs: ["missing"] }, { id: "s", kind: "x", needs: ["a"] }]);
    expect(stackStops(generated, "s", ["a", "s"])).toEqual([[1]]);
    // A part that needs itself does not work in the base stack, and the check gives the same sets.
    const loop = stack([{ id: "p", kind: "x", needs: [{ all: ["p"] }] }]);
    expect(stackStops(loop, "p", ["p"])).toEqual([[0]]);
    expect(bruteStops(loop, "p", ["p"], [])).toEqual([[0]]);
    expect(stackStops(generated, "elsewhere", ["a", "elsewhere"])).toEqual([[1]]);
  });

  it("gives undefined when the search of the needs passes its budget", () => {
    // 13 stages of 2 copies have 2 to the power 13 path sets, more than DEFAULT_MAX_SETS.
    const copies = Array.from({ length: 13 }, (_, stage) => [`a${String(stage)}`, `b${String(stage)}`]);
    const generated = stack([...copies.flat().map((id) => ({ id, kind: "copy" })), { id: "s", kind: "x", needs: copies.map((any) => ({ any })) }]);
    expect(stackStops(generated, "s", copies.flat())).toBeUndefined();
    // With the cuts of one stage only, the other copies work, and the search is small.
    expect(stackStops(generated, "s", ["a0", "b0"])).toEqual([[0, 1]]);
    // With the cuts of 7 stages, 2 to the power 7 path sets pass a budget of 64. A budget of 128 ends the search: each stage is a minimal set.
    const seven = copies.slice(0, 7);
    expect(stackStops(generated, "s", seven.flat(), [], 64)).toBeUndefined();
    expect(stackStops(generated, "s", seven.flat(), [], 128)).toEqual(seven.map((_, stage) => [2 * stage, 2 * stage + 1]));
  });

  it("keeps the sets of cuts in the budget", () => {
    // Two cuts of each copy of one stage give 4 sets of cuts. A budget of 3 cannot hold them.
    const copies = Array.from({ length: 2 }, (_, stage) => [`a${String(stage)}`, `b${String(stage)}`]);
    const generated = stack([...copies.flat().map((id) => ({ id, kind: "copy" })), { id: "s", kind: "x", needs: copies.map((any) => ({ any })) }]);
    expect(stackStops(generated, "s", ["a0", "a0", "b0", "b0"], [], 4)).toEqual([[0, 2], [1, 2], [0, 3], [1, 3]]);
    expect(stackStops(generated, "s", ["a0", "a0", "b0", "b0"], [], 3)).toBeUndefined();
  });

  // Generated stacks: each need names a part of the stack, or a part that is not in it. The needs can go round.
  const IDS = ["p0", "p1", "p2", "p3", "p4", "p5"];
  const need: fc.Arbitrary<Need> = fc.letrec<{ need: Need }>((tie) => ({
    need: fc.oneof(
      { maxDepth: 2 },
      fc.constantFrom(...IDS, "not-a-part"),
      fc.record({ all: fc.array(tie("need"), { maxLength: 3 }) }),
      fc.record({ any: fc.array(tie("need"), { maxLength: 3 }) }),
      fc.record({ any: fc.array(tie("need"), { maxLength: 3 }), count: fc.integer({ min: 0, max: 3 }) }),
    ),
  })).need;
  const generatedStack = fc
    .tuple(fc.integer({ min: 1, max: IDS.length }), fc.array(fc.array(need, { maxLength: 2 }), { minLength: IDS.length, maxLength: IDS.length }))
    .map(([count, needs]) => stack(IDS.slice(0, count).map((id, index) => ({ id, kind: "x", needs: needs[index] ?? [] }))));
  // Up to 10 cuts. Two cuts can have one part, and a cut can be of a part that is not in the stack.
  const generatedCase = fc.tuple(generatedStack, fc.constantFrom(...IDS), fc.array(fc.constantFrom(...IDS, "not-a-part"), { maxLength: 10 }), fc.subarray(IDS));

  it("equals the sets of minimalStops for each generated stack of 10 cuts or fewer", () => {
    let compared = 0;
    let downCut = 0;
    fc.assert(
      fc.property(generatedCase, ([generated, supply, parts, down]) => {
        const brute = bruteStops(generated, supply, parts, down);
        const stops = (cuts: readonly string[]): boolean => caseStopped({ case: "c", title: "C", cuts: cuts.map((part) => ({ part, title: "Cut", source: "s" })) }, { stack: generated, down }).has(supply);
        // stopCurves asks only when the parts of down do not stop the supply, and the cuts together do.
        if (stops([]) || !stops(parts)) return;
        compared += 1;
        if (parts.some((part) => down.includes(part))) downCut += 1;
        expect(stackStops(generated, supply, parts, down)).toEqual(brute);
      }),
      { seed: 20261122, numRuns: 300 },
    );
    expect(compared).toBeGreaterThan(50);
    // A cut of a part that is down for the full event is in no set. The generated cases must have it.
    expect(downCut).toBeGreaterThan(20);
  });
});
