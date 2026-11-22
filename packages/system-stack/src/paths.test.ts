import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_SETS, pathSets, smallestStop, stopSets } from "./paths.ts";
import { SAMPLE_STACK } from "./sample.ts";
import { STACK_SCHEMA, type Need, type Part, type Stack } from "./stack.ts";
import { works } from "./working.ts";

const stack = (...parts: Part[]): Stack => ({ schema: STACK_SCHEMA, parts });
const exact = (sets: string[][]): unknown => ({ kind: "exact", sets });

/** A function that needs 2 of 3 copies, `groups` times in sequence. It has 3 to the power `groups` path sets. */
const twoOfThree = (groups: number): Stack => {
  const copies = Array.from({ length: groups }, (_, group) => ["a", "b", "c"].map((name) => `${name}${String(group)}`));
  return stack(...copies.flat().map((id) => ({ id, kind: "copy" })), { id: "f", kind: "function", needs: copies.map((any) => ({ any, count: 2 })) });
};

describe("pathSets", () => {
  it("gives the empty set for a part with no needs", () => {
    expect(pathSets(stack({ id: "a", kind: "x" }), "a")).toEqual(exact([[]]));
  });

  it("gives no set for a part that is not in the stack, and for a part that is down", () => {
    const one = stack({ id: "a", kind: "x" });
    expect(pathSets(one, "b")).toEqual(exact([]));
    expect(pathSets(one, "a", { down: ["a"] })).toEqual(exact([]));
  });

  it("gives each path through an any need, from the smallest set", () => {
    const hosts = stack(
      { id: "power", kind: "power" },
      { id: "host-a", kind: "host", needs: ["power"] },
      { id: "host-b", kind: "host" },
      { id: "program", kind: "service", needs: [{ any: ["host-a", "host-b"] }] },
    );
    expect(pathSets(hosts, "program")).toEqual(exact([["host-b"], ["power", "host-a"]]));
    expect(pathSets(hosts, "program", { down: ["host-b"] })).toEqual(exact([["power", "host-a"]]));
    expect(pathSets(hosts, "program", { down: ["host-b", "power"] })).toEqual(exact([]));
  });

  it("gives the four paths of the sample alert, with the parts in the order of the stack", () => {
    const paths = pathSets(SAMPLE_STACK, "alert");
    expect(paths).toEqual(
      exact([
        ["reader", "phone", "card", "cloud-account", "cloud-host", "program-cloud", "push-account", "push"],
        ["reader", "phone", "card", "cloud-account", "cloud-host", "program-cloud", "call-account", "call"],
        ["reader", "phone", "home-power", "home-network", "home-host", "program-home", "push-account", "push"],
        ["reader", "phone", "card", "home-power", "home-network", "home-host", "program-home", "call-account", "call"],
      ]),
    );
  });

  it("reads the count of an any need", () => {
    const copies = (count: number): Stack => stack({ id: "a", kind: "x" }, { id: "b", kind: "x" }, { id: "c", kind: "x" }, { id: "f", kind: "function", needs: [{ any: ["a", "b", "c"], count }] });
    expect(pathSets(copies(2), "f")).toEqual(exact([["a", "b"], ["a", "c"], ["b", "c"]]));
    expect(pathSets(copies(3), "f")).toEqual(exact([["a", "b", "c"]]));
    expect(pathSets(copies(0), "f")).toEqual(exact([[]]));
    expect(pathSets(copies(4), "f")).toEqual(exact([]));
    expect(pathSets(copies(1.5), "f")).toEqual(exact([["a", "b"], ["a", "c"], ["b", "c"]]));
    expect(pathSets(copies(Number.NaN), "f")).toEqual(exact([]));
  });

  it("removes a set that has a smaller set as a subset", () => {
    const nested = stack({ id: "a", kind: "x" }, { id: "b", kind: "x" }, { id: "f", kind: "function", needs: [{ any: ["a", { all: ["a", "b"] }] }] });
    expect(pathSets(nested, "f")).toEqual(exact([["a"]]));
  });

  it("gives no set for two parts that need each other, and the other path for a part with one", () => {
    const ring = stack({ id: "a", kind: "x", needs: ["b"] }, { id: "b", kind: "x", needs: ["a"] }, { id: "c", kind: "x" }, { id: "f", kind: "function", needs: [{ any: ["a", "c"] }] });
    expect(pathSets(ring, "a")).toEqual(exact([]));
    expect(pathSets(ring, "f")).toEqual(exact([["c"]]));
    const exit = stack({ id: "r", kind: "x", needs: ["a"] }, { id: "a", kind: "x", needs: [{ any: ["r", "b"] }] }, { id: "b", kind: "x" });
    expect(pathSets(exit, "r")).toEqual(exact([["a", "b"]]));
    expect(pathSets(exit, "a")).toEqual(exact([["b"]]));
  });

  it("gives the result budget when a step passes maxSets, and each set below it", () => {
    const paths = pathSets(twoOfThree(5), "f");
    expect(paths.kind === "exact" && paths.sets.length).toBe(243);
    expect(pathSets(twoOfThree(5), "f", { maxSets: 242 })).toEqual({ kind: "budget" });
    expect(pathSets(twoOfThree(8), "f")).toEqual({ kind: "budget" });
    expect(DEFAULT_MAX_SETS).toBe(4096);
  });

  it("throws for a maxSets that is not a whole number from 1", () => {
    expect(() => pathSets(SAMPLE_STACK, "alert", { maxSets: 0 })).toThrow(RangeError);
    expect(() => pathSets(SAMPLE_STACK, "alert", { maxSets: 1.5 })).toThrow(RangeError);
  });
});

describe("stopSets", () => {
  it("gives each single point of failure of the sample alert", () => {
    expect(stopSets(SAMPLE_STACK, "alert")).toEqual(exact([["reader"], ["phone"]]));
  });

  it("gives the single points of failure that a failure makes", () => {
    expect(stopSets(SAMPLE_STACK, "alert", { down: ["program-cloud"] })).toEqual(exact([["reader"], ["phone"], ["home-power"], ["home-network"], ["home-host"], ["program-home"]]));
  });

  it("gives the sets of two parts with a size of 2, and no set with a smaller set in it", () => {
    const stops = stopSets(SAMPLE_STACK, "alert", { size: 2 });
    if (stops.kind !== "exact") throw new Error("The search has no result.");
    expect(stops.sets.slice(0, 2)).toEqual([["reader"], ["phone"]]);
    expect(stops.sets).toContainEqual(["card", "home-power"]);
    expect(stops.sets).toContainEqual(["card", "push"]);
    expect(stops.sets).toContainEqual(["push", "call"]);
    expect(stops.sets.some((set) => set.length === 2 && (set.includes("reader") || set.includes("phone")))).toBe(false);
  });

  it("gives the empty set for a part that does not work, and no set for a part with no needs", () => {
    expect(stopSets(SAMPLE_STACK, "alert", { down: ["phone"] })).toEqual(exact([[]]));
    expect(stopSets(SAMPLE_STACK, "alert", { size: 0 })).toEqual(exact([]));
    expect(stopSets(SAMPLE_STACK, "reader", { size: 3 })).toEqual(exact([]));
  });

  it("gives the result budget when the search passes maxSets", () => {
    expect(stopSets(twoOfThree(5), "f", { size: 2, maxSets: 4 })).toEqual({ kind: "budget" });
    expect(stopSets(twoOfThree(5), "f", { size: 2, maxSets: 242 })).toEqual({ kind: "budget" });
    const stops = stopSets(twoOfThree(5), "f", { size: 2 });
    expect(stops.kind === "exact" && stops.sets.length).toBe(15);
  });

  it("gives only the sets of the parts of among, and takes each other part as working", () => {
    expect(stopSets(SAMPLE_STACK, "alert", { size: 2, among: ["card", "push", "call", "phone"] })).toEqual(exact([["phone"], ["card", "push"], ["push", "call"]]));
    expect(stopSets(SAMPLE_STACK, "alert", { size: 2, among: ["home-power"] })).toEqual(exact([]));
    expect(stopSets(SAMPLE_STACK, "alert", { among: [] })).toEqual(exact([]));
    expect(stopSets(SAMPLE_STACK, "alert", { down: ["phone"], among: [] })).toEqual(exact([[]]));
  });

  it("finds the stop sets of a few cut parts where the full path family passes maxSets", () => {
    // 13 groups of 2 of 3 copies have 3 to the power 13 path sets. Only the copies of group 0 can fail.
    const among = ["a0", "b0", "c0"];
    expect(pathSets(twoOfThree(13), "f")).toEqual({ kind: "budget" });
    expect(stopSets(twoOfThree(13), "f", { size: 3, among })).toEqual(exact([["a0", "b0"], ["a0", "c0"], ["b0", "c0"]]));
  });

  it("throws for a size that is not a whole number from 0", () => {
    expect(() => stopSets(SAMPLE_STACK, "alert", { size: -1 })).toThrow(RangeError);
    expect(() => stopSets(SAMPLE_STACK, "alert", { size: 0.5 })).toThrow(RangeError);
    expect(() => stopSets(SAMPLE_STACK, "alert", { maxSets: 0 })).toThrow(RangeError);
  });
});

describe("smallestStop", () => {
  it("gives one part for a function with a single point of failure", () => {
    expect(smallestStop(SAMPLE_STACK, "alert")).toEqual({ kind: "exact", parts: ["reader"] });
  });

  it("gives the parts in the order of the stack", () => {
    const copies = stack({ id: "a", kind: "x" }, { id: "b", kind: "x" }, { id: "c", kind: "x" }, { id: "f", kind: "function", needs: [{ any: ["c", "b", "a"], count: 2 }] });
    const stop = smallestStop(copies, "f");
    expect(stop.kind === "exact" && stop.parts.length).toBe(2);
    expect(stop.kind === "exact" && [...stop.parts].sort()).toEqual(stop.kind === "exact" ? stop.parts : []);
  });

  it("gives the empty set for a part that does not work, and none for a part with no needs", () => {
    expect(smallestStop(SAMPLE_STACK, "alert", { down: ["reader"] })).toEqual({ kind: "exact", parts: [] });
    expect(smallestStop(SAMPLE_STACK, "reader")).toEqual({ kind: "none" });
  });

  it("gives the result budget when the path search passes maxSets", () => {
    expect(smallestStop(twoOfThree(5), "f", { maxSets: 8 })).toEqual({ kind: "budget" });
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
const caseArbitrary = fc.tuple(stackArbitrary, fc.constantFrom(...IDS), fc.subarray(IDS));

/** This function gives each subset of a list. */
const subsets = (list: readonly string[]): string[][] => list.reduce<string[][]>((sets, item) => [...sets, ...sets.map((set) => [...set, item])], [[]]);
const within = (set: readonly string[], all: readonly string[]): boolean => set.every((id) => all.includes(id));
const noSubset = (sets: readonly (readonly string[])[]): boolean => sets.every((a) => sets.every((b) => a === b || !within(a, b)));

describe("the path sets and the stop sets of generated stacks", () => {
  it("agree with working for each set of parts that are down", () => {
    fc.assert(
      fc.property(caseArbitrary, ([generated, root, down]) => {
        const others = generated.parts.map((part) => part.id).filter((id) => id !== root && !down.includes(id));
        const paths = pathSets(generated, root, { down });
        const stops = stopSets(generated, root, { down, size: IDS.length });
        const least = smallestStop(generated, root, { down });
        if (paths.kind !== "exact" || stops.kind !== "exact" || least.kind === "budget") throw new Error("A small stack gave no result.");
        expect(noSubset(paths.sets)).toBe(true);
        expect(noSubset(stops.sets)).toBe(true);
        expect(paths.sets.every((set) => within(set, others))).toBe(true);
        expect(stops.sets.every((set) => within(set, others))).toBe(true);
        for (const up of subsets(others)) {
          const off = others.filter((id) => !up.includes(id));
          const result = works(generated, root, [...down, ...off]);
          expect(paths.sets.some((set) => within(set, up))).toBe(result);
          expect(stops.sets.some((set) => within(set, off))).toBe(!result);
        }
        const sizes = stops.sets.map((set) => set.length);
        if (least.kind === "none") expect(stops.sets).toEqual([]);
        else {
          expect(least.parts.length).toBe(Math.min(...sizes));
          expect(works(generated, root, [...down, ...least.parts])).toBe(false);
        }
        for (const size of [0, 1, 2]) {
          expect(stopSets(generated, root, { down, size })).toEqual({ kind: "exact", sets: stops.sets.filter((set) => set.length <= size) });
        }
      }),
      { seed: 20261116, numRuns: 400 },
    );
  });

  it("keep with among each stop set of the parts of among, and no other set", () => {
    fc.assert(
      fc.property(caseArbitrary, fc.subarray(IDS), ([generated, root, down], among) => {
        const stops = stopSets(generated, root, { down, size: IDS.length });
        const some = stopSets(generated, root, { down, size: IDS.length, among });
        if (stops.kind !== "exact") throw new Error("A small stack gave no result.");
        // A smallest set of the parts of among is a smallest set of all parts. Thus among keeps the sets that it holds.
        expect(some).toEqual({ kind: "exact", sets: stops.sets.filter((set) => within(set, among)) });
      }),
      { seed: 20261122, numRuns: 400 },
    );
  });
});
