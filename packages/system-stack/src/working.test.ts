import { describe, expect, it } from "vitest";
import { SAMPLE_STACK } from "./sample.ts";
import { STACK_SCHEMA, type Part, type Stack } from "./stack.ts";
import { needHolds, stopped, working, works } from "./working.ts";

const stack = (...parts: Part[]): Stack => ({ schema: STACK_SCHEMA, parts });

describe("needHolds", () => {
  const up = new Set(["a", "b"]);

  it("holds for a part that works", () => {
    expect(needHolds("a", up)).toBe(true);
    expect(needHolds("c", up)).toBe(false);
  });

  it("holds for all when each need holds, and an empty list holds", () => {
    expect(needHolds({ all: ["a", "b"] }, up)).toBe(true);
    expect(needHolds({ all: ["a", "c"] }, up)).toBe(false);
    expect(needHolds({ all: [] }, up)).toBe(true);
  });

  it("holds for any when the count of the needs holds, with a default count of 1", () => {
    expect(needHolds({ any: ["c", "a"] }, up)).toBe(true);
    expect(needHolds({ any: ["c", "d"] }, up)).toBe(false);
    expect(needHolds({ any: ["a", "b", "c"], count: 2 }, up)).toBe(true);
    expect(needHolds({ any: ["a", "c", "d"], count: 2 }, up)).toBe(false);
    expect(needHolds({ any: [] }, up)).toBe(false);
  });

  it("holds for a need in a need", () => {
    expect(needHolds({ any: [{ all: ["a", "c"] }, { all: ["a", "b"] }] }, up)).toBe(true);
  });
});

describe("working", () => {
  it("gives each part of the sample when no part is down", () => {
    expect([...working(SAMPLE_STACK)].sort()).toEqual(SAMPLE_STACK.parts.map((part) => part.id).sort());
  });

  it("gives the parts in the order in which they start", () => {
    expect([...working(stack({ id: "c", kind: "x", needs: ["b"] }, { id: "b", kind: "x", needs: ["a"] }, { id: "a", kind: "x" }))]).toEqual(["a", "b", "c"]);
  });

  it("takes down each part that needs a part that is down", () => {
    const up = working(SAMPLE_STACK, ["home-power"]);
    for (const id of ["home-power", "home-network", "home-host", "program-home"]) expect(up.has(id)).toBe(false);
    for (const id of ["program-cloud", "alert"]) expect(up.has(id)).toBe(true);
  });

  it("keeps a function with one of two copies, and stops it with none", () => {
    expect(works(SAMPLE_STACK, "alert", ["program-home"])).toBe(true);
    expect(works(SAMPLE_STACK, "alert", ["program-cloud"])).toBe(true);
    expect(works(SAMPLE_STACK, "alert", ["program-home", "program-cloud"])).toBe(false);
  });

  it("shows a shared cause: the card stops the cloud copy and the call service together", () => {
    const up = working(SAMPLE_STACK, ["card"]);
    expect(up.has("program-cloud")).toBe(false);
    expect(up.has("call")).toBe(false);
    expect(up.has("alert")).toBe(true);
    expect(works(SAMPLE_STACK, "alert", ["card", "home-power"])).toBe(false);
  });

  it("stops a function when a part with no copy is down", () => {
    expect(works(SAMPLE_STACK, "alert", ["phone"])).toBe(false);
  });

  it("gives no part of a cycle: two parts that need each other cannot start", () => {
    const up = working(stack({ id: "a", kind: "x", needs: ["b"] }, { id: "b", kind: "x", needs: ["a"] }, { id: "c", kind: "x", needs: ["a"] }, { id: "d", kind: "x" }));
    expect([...up]).toEqual(["d"]);
  });

  it("starts a part of a cycle through a different need of an any list", () => {
    const up = working(stack({ id: "a", kind: "x", needs: [{ any: ["b", "c"] }] }, { id: "b", kind: "x", needs: ["a"] }, { id: "c", kind: "x" }));
    expect([...up].sort()).toEqual(["a", "b", "c"]);
  });

  it("does not hold a need that names no part", () => {
    expect([...working(stack({ id: "a", kind: "x", needs: ["none"] }))]).toEqual([]);
  });

  it("holds 2 of 3 with one part down, and not with two parts down", () => {
    const parts = stack({ id: "a", kind: "x" }, { id: "b", kind: "x" }, { id: "c", kind: "x" }, { id: "f", kind: "function", needs: [{ any: ["a", "b", "c"], count: 2 }] });
    expect(works(parts, "f", ["a"])).toBe(true);
    expect(works(parts, "f", ["a", "c"])).toBe(false);
  });

  it("does not change its arguments", () => {
    const down = ["card"];
    const before = JSON.stringify(SAMPLE_STACK);
    working(SAMPLE_STACK, down);
    expect(JSON.stringify(SAMPLE_STACK)).toBe(before);
    expect(down).toEqual(["card"]);
  });

  it("keeps working a monotone function: a larger down set never adds a part", () => {
    const ids = SAMPLE_STACK.parts.map((part) => part.id);
    for (const first of ids) {
      const one = working(SAMPLE_STACK, [first]);
      for (const second of ids) {
        for (const id of working(SAMPLE_STACK, [first, second])) expect(one.has(id)).toBe(true);
      }
    }
  });
});

describe("stopped", () => {
  it("gives the parts of down that work, and each part that cannot work without them, in the order of the parts", () => {
    expect(stopped(SAMPLE_STACK, ["call-account"])).toEqual(["call-account", "call"]);
    expect(stopped(SAMPLE_STACK, ["home-power"])).toEqual(["home-power", "home-network", "home-host", "program-home"]);
    expect(stopped(SAMPLE_STACK, ["call", "push-account"])).toEqual(["push-account", "push", "call", "alert"]);
  });

  it("gives nothing when no part is down, or when the down part is no part of the stack", () => {
    expect(stopped(SAMPLE_STACK, [])).toEqual([]);
    expect(stopped(SAMPLE_STACK, ["none"])).toEqual([]);
  });

  it("does not give a part that did not work before", () => {
    const parts = stack({ id: "a", kind: "x", needs: ["none"] }, { id: "b", kind: "x", needs: ["a"] }, { id: "c", kind: "x" }, { id: "d", kind: "x", needs: ["c"] });
    expect(stopped(parts, ["a", "c"])).toEqual(["c", "d"]);
  });

  it("gives an id one time for a stack with two parts of one id", () => {
    const parts = stack({ id: "a", kind: "x" }, { id: "a", kind: "x" }, { id: "b", kind: "x", needs: ["a"] });
    expect(stopped(parts, ["a"])).toEqual(["a", "b"]);
  });

  it("is the difference of two results of working, for each pair of parts of the sample", () => {
    const ids = SAMPLE_STACK.parts.map((part) => part.id);
    const before = working(SAMPLE_STACK);
    for (const first of ids) {
      for (const second of ids) {
        const after = working(SAMPLE_STACK, [first, second]);
        expect(stopped(SAMPLE_STACK, [first, second])).toEqual(ids.filter((id) => before.has(id) && !after.has(id)));
      }
    }
  });

  it("does not change its arguments", () => {
    const down = ["card"];
    const before = JSON.stringify(SAMPLE_STACK);
    stopped(SAMPLE_STACK, down);
    expect(JSON.stringify(SAMPLE_STACK)).toBe(before);
    expect(down).toEqual(["card"]);
  });
});
