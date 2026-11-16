import { describe, expect, it } from "vitest";
import { checkStack, STACK_CODES } from "./check.ts";
import { SAMPLE_STACK } from "./sample.ts";
import { STACK_SCHEMA, type Part, type Stack } from "./stack.ts";

const stack = (...parts: Part[]): Stack => ({ schema: STACK_SCHEMA, parts });
const codes = (value: Stack): string[] => checkStack(value).map((fault) => `${fault.code} ${fault.at}`);

describe("checkStack", () => {
  it("finds no fault in the sample", () => {
    expect(checkStack(SAMPLE_STACK)).toEqual([]);
  });

  it("finds two parts with one id", () => {
    expect(codes(stack({ id: "a", kind: "x" }, { id: "a", kind: "y" }))).toEqual(["id-duplicate a"]);
  });

  it("finds a need that names no part, at each depth", () => {
    const faults = checkStack(stack({ id: "a", kind: "x", needs: [{ any: ["b", { all: ["none"] }] }] }, { id: "b", kind: "x" }));
    expect(faults).toEqual([{ level: "error", code: "need-part", at: "a", other: "none", message: 'The part "a" needs "none", which is no part of the stack.' }]);
  });

  it("finds a count that is not from 1 to the size of the list", () => {
    const bad = (count: number): Stack => stack({ id: "a", kind: "x" }, { id: "f", kind: "x", needs: [{ any: ["a"], count }] });
    for (const count of [0, 2, 1.5, -1, Number.NaN]) expect(codes(bad(count))).toContain("need-count f");
    expect(codes(bad(1))).toEqual([]);
  });

  it("finds an any need with an empty list", () => {
    expect(codes(stack({ id: "f", kind: "x", needs: [{ all: [{ any: [] }] }] }))).toEqual(["need-count f"]);
  });

  it("finds an owner that is no part", () => {
    expect(codes(stack({ id: "a", kind: "x", owner: "nobody" }))).toEqual(["owner-part a"]);
  });

  it("finds a cycle one time, and names its parts", () => {
    const faults = checkStack(stack({ id: "a", kind: "x", needs: ["b"] }, { id: "b", kind: "x", needs: ["c"] }, { id: "c", kind: "x", needs: ["a"] }, { id: "d", kind: "x", needs: ["a"] }));
    expect(faults.map((fault) => fault.code)).toEqual(["need-cycle"]);
    expect(faults[0]?.at).toBe("a");
    expect(faults[0]?.message).toBe('The parts "a", "b", "c" need each other, so none of them can start.');
  });

  it("finds a part that needs itself", () => {
    const faults = checkStack(stack({ id: "a", kind: "x", needs: ["a"] }));
    expect(faults.map((fault) => fault.message)).toEqual(['The part "a" needs itself, so it cannot start.']);
  });

  it("finds no cycle when a different need of an any list lets the part start", () => {
    expect(checkStack(stack({ id: "a", kind: "x", needs: [{ any: ["b", "c"] }] }, { id: "b", kind: "x", needs: ["a"] }, { id: "c", kind: "x" }))).toEqual([]);
  });

  it("finds no cycle for a part that only waits for an unknown part", () => {
    expect(codes(stack({ id: "a", kind: "x", needs: ["none"] }, { id: "b", kind: "x", needs: ["a"] }))).toEqual(["need-part a"]);
  });

  it("gives the faults in the order of the parts", () => {
    const faults = codes(stack({ id: "a", kind: "x", owner: "nobody" }, { id: "b", kind: "x", needs: ["none"] }, { id: "a", kind: "x" }));
    expect(faults).toEqual(["owner-part a", "id-duplicate a", "need-part b"]);
  });

  it("uses only its own codes", () => {
    const value = stack({ id: "a", kind: "x", needs: ["a", "none", { any: [], count: 3 }], owner: "nobody" }, { id: "a", kind: "x" });
    for (const fault of checkStack(value)) expect(STACK_CODES).toContain(fault.code);
  });
});
