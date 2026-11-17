import { SAMPLE_STACK, STACK_SCHEMA, type Need, type Part, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { TOFU_SCHEMA, type Resource, type TofuLayer, type TofuObject } from "./layer.ts";
import { dependsOn, firstResources, neededParts, resourceCycles, resourceRefs, resourcesByPart } from "./queries.ts";
import { SAMPLE_TOFU } from "./sample.ts";

const part = (id: string, ...needs: Need[]): Part => ({ id, kind: "part", needs });
const stack = (...parts: Part[]): Stack => ({ schema: STACK_SCHEMA, parts });
const layer = (...resources: Resource[]): TofuLayer => ({ schema: TOFU_SCHEMA, resources });
const made = (of: string, values?: TofuObject, type: string = "example_thing"): Resource => ({ part: of, type, ...(values === undefined ? {} : { values }) });
const reads = (address: string): TofuObject => ({ from: { $ref: `${address}.id` } });

describe("firstResources", () => {
  it("keeps the first resource of each address", () => {
    const first = made("a", { n: 1 });
    const other = made("b");
    expect(firstResources(layer(first, made("a", { n: 2 }), other))).toEqual([first, other]);
  });
});

describe("resourcesByPart", () => {
  it("gives the sorted addresses of each part", () => {
    expect([...resourcesByPart(SAMPLE_TOFU)]).toEqual([
      ["cloud-host", ["example_disk.cloud-host", "example_firewall.cloud-host", "example_server.cloud-host"]],
      ["program-cloud", ["terraform_data.program-cloud"]],
    ]);
  });
});

describe("resourceRefs", () => {
  it("gives each address that the arguments read, one time, sorted", () => {
    const resource = made("a", { x: { $ref: "example_thing.c.id" }, y: [{ $ref: "example_thing.b.name" }, { $ref: "example_thing.c.size" }], z: { $var: "token" } });
    expect(resourceRefs(resource)).toEqual(["example_thing.b", "example_thing.c"]);
  });

  it("does not read a form that is not correct, and it does not read a text", () => {
    expect(resourceRefs(made("a", { x: { $ref: "b" }, y: "${example_thing.b.id}", z: { $ref: "example_thing.b.id", more: 1 } }))).toEqual([]);
    expect(resourceRefs(made("a"))).toEqual([]);
  });

  it("does not read the arguments as a whole when they have the form of a reference", () => {
    expect(resourceRefs(made("a", { $ref: "example_thing.b.id" }))).toEqual([]);
  });
});

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
  });

  it("gives no part for a part with no needs, and for no part of the stack", () => {
    expect(neededParts(needs, "c").size).toBe(0);
    expect(neededParts(needs, "missing").size).toBe(0);
  });
});

describe("dependsOn", () => {
  it("gives the resources of each part that the part of a resource needs", () => {
    const needs = stack(part("a", "b", "c"), part("b"), part("c"));
    expect(dependsOn(layer(made("a"), made("b"), made("c"), made("c", undefined, "example_other")), needs).get("example_thing.a")).toEqual([
      "example_other.c",
      "example_thing.b",
      "example_thing.c",
    ]);
  });

  it("goes on through a needed part with no resource, to the nearest parts with resources", () => {
    const needs = stack(part("a", "b"), part("b", "c"), part("c", "d"), part("d"));
    const depends = dependsOn(layer(made("a"), made("c"), made("d")), needs);
    expect(depends.get("example_thing.a")).toEqual(["example_thing.c"]);
    expect(depends.get("example_thing.c")).toEqual(["example_thing.d"]);
    expect(depends.get("example_thing.d")).toEqual([]);
  });

  it("does not give an address that the arguments of the resource read", () => {
    const needs = stack(part("a", "b", "c"), part("b"), part("c"));
    expect(dependsOn(layer(made("a", reads("example_thing.b")), made("b"), made("c")), needs).get("example_thing.a")).toEqual(["example_thing.c"]);
  });

  it("gives no dependence between the resources of one part", () => {
    const depends = dependsOn(layer(made("a"), made("a", undefined, "example_other")), stack(part("a")));
    expect([...depends.values()]).toEqual([[], []]);
  });

  it("ends for a stack with a cycle of needs", () => {
    const needs = stack(part("a", "b"), part("b", "a"));
    const depends = dependsOn(layer(made("a"), made("b")), needs);
    expect(depends.get("example_thing.a")).toEqual(["example_thing.b"]);
    expect(depends.get("example_thing.b")).toEqual(["example_thing.a"]);
  });

  it("gives the dependencies of the sample from the needs of the sample stack", () => {
    expect(dependsOn(SAMPLE_TOFU, SAMPLE_STACK).get("terraform_data.program-cloud")).toEqual(["example_disk.cloud-host", "example_firewall.cloud-host", "example_server.cloud-host"]);
    expect(dependsOn(SAMPLE_TOFU, SAMPLE_STACK).get("example_server.cloud-host")).toEqual([]);
  });
});

describe("resourceCycles", () => {
  it("gives no cycle for the sample", () => {
    expect(resourceCycles(SAMPLE_TOFU, SAMPLE_STACK)).toEqual([]);
  });

  it("gives a resource that reads its own attribute", () => {
    expect(resourceCycles(layer(made("a", reads("example_thing.a")), made("b")), stack(part("a"), part("b")))).toEqual([["example_thing.a"]]);
  });

  it("gives two resources that read each other", () => {
    const cycles = resourceCycles(layer(made("b", reads("example_thing.a")), made("a", reads("example_thing.b")), made("c")), stack(part("a"), part("b"), part("c")));
    expect(cycles).toEqual([["example_thing.a", "example_thing.b"]]);
  });

  it("gives a resource that reads a resource of a part that needs its part", () => {
    const needs = stack(part("a", "b"), part("b"));
    expect(resourceCycles(layer(made("a"), made("b", reads("example_thing.a"))), needs)).toEqual([["example_thing.a", "example_thing.b"]]);
  });

  it("gives the resources of the parts of a cycle of needs", () => {
    const needs = stack(part("a", "b"), part("b", "a"));
    expect(resourceCycles(layer(made("a"), made("b")), needs)).toEqual([["example_thing.a", "example_thing.b"]]);
  });

  it("gives no cycle for a reference to a resource that the layer does not have", () => {
    expect(resourceCycles(layer(made("a", reads("example_thing.missing"))), stack(part("a")))).toEqual([]);
  });
});
