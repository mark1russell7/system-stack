import * as layers from "@mark1russell7/coeval/layers";
import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";
import * as schema from "./schema.ts";

// The rules of `.dependency-cruiser.ts` hold the imports of the entries: only the entry `/schema` imports zod, and the
// root entry does not get to it.

describe("the root entry", () => {
  it("has the format, the question of what works, the check and the sample", () => {
    expect(entry.STACK_SCHEMA).toBe("stack/1");
    for (const name of ["needParts", "partNeeds", "partsById", "needHolds", "working", "works", "stopped", "checkStack"] as const) {
      expect(entry[name]).toBeTypeOf("function");
    }
    expect(entry.SAMPLE_STACK.schema).toBe(entry.STACK_SCHEMA);
  });

  it("has the join of stacks, with the tools for the join of a layer", () => {
    for (const name of ["joinStacks", "joinRecords", "joinSetting"] as const) expect(entry[name]).toBeTypeOf("function");
    expect(entry.STACK_JOIN_CODES).toEqual(["fragment-name", "part-twice"]);
    // The tools are the functions of the layer contract, not a second copy.
    expect(entry.joinRecords).toBe(layers.joinRecords);
    expect(entry.joinSetting).toBe(layers.joinSetting);
  });

  it("has the hold of known faults", () => {
    expect(entry.KNOWN_SCHEMA).toBe("known/1");
    expect(entry.holdKnown).toBeTypeOf("function");
    expect(entry.KNOWN_CODES).toEqual(["known-date", "known-twice", "known-old", "known-unused"]);
  });

  it("has no schema", () => {
    for (const name of ["stackSchema", "parseStack", "formErrors", "knownListSchema", "parseKnown"]) expect(entry).not.toHaveProperty(name);
  });
});

describe("the entry /schema", () => {
  it("has the schemas and the reads of a stack and of a list of known faults", () => {
    expect(Object.keys(schema).sort()).toEqual(["formErrors", "knownFaultSchema", "knownListSchema", "needSchema", "parseKnown", "parseStack", "partSchema", "stackSchema"]);
  });
});
