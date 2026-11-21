import { describe, expect, it } from "vitest";
import { neededParts, STACK_SCHEMA, type Need, type Part, type Stack } from "./stack.ts";

const part = (id: string, ...needs: Need[]): Part => ({ id, kind: "part", needs });
const stack = (...parts: Part[]): Stack => ({ schema: STACK_SCHEMA, parts });

describe("neededParts", () => {
  const needs = stack(part("a", "b", { any: ["c", { all: ["d"] }] }), part("b", "e"), part("c"), part("d"), part("e", "a"), part("f", "a"));

  it("gives each part that a part needs, directly or through other parts", () => {
    expect([...neededParts(needs, "f")].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("does not give the part itself, also in a cycle of needs", () => {
    expect([...neededParts(needs, "a")].sort()).toEqual(["b", "c", "d", "e"]);
  });

  it("gives a need that names no part of the stack", () => {
    expect([...neededParts(stack(part("a", "missing")), "a")]).toEqual(["missing"]);
    expect([...neededParts(stack(part("a", "b"), part("b", "missing")), "a")].sort()).toEqual(["b", "missing"]);
  });

  it("gives no part for a part with no needs, and for no part of the stack", () => {
    expect(neededParts(needs, "c").size).toBe(0);
    expect(neededParts(needs, "missing").size).toBe(0);
  });

  it("uses the needs of the first part of an id that two parts have", () => {
    expect([...neededParts(stack(part("a", "b"), part("a", "c"), part("b"), part("c")), "a")]).toEqual(["b"]);
  });

  it("gives a part that is a need of itself as no need", () => {
    expect(neededParts(stack(part("a", "a")), "a").size).toBe(0);
  });
});
