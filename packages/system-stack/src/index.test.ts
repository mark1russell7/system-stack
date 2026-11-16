import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";
import * as schema from "./schema.ts";

// The rules of `.dependency-cruiser.ts` hold the imports of the entries: only the entry `/schema` imports zod, and the
// root entry does not get to it.

describe("the root entry", () => {
  it("has the format, the question of what works, the check and the sample", () => {
    expect(entry.STACK_SCHEMA).toBe("stack/1");
    for (const name of ["needParts", "partNeeds", "partsById", "needHolds", "working", "works", "checkStack"] as const) {
      expect(entry[name]).toBeTypeOf("function");
    }
    expect(entry.SAMPLE_STACK.schema).toBe(entry.STACK_SCHEMA);
  });

  it("has no schema", () => {
    for (const name of ["stackSchema", "parseStack", "formErrors"]) expect(entry).not.toHaveProperty(name);
  });
});

describe("the entry /schema", () => {
  it("has the schemas and the read of a stack", () => {
    expect(Object.keys(schema).sort()).toEqual(["formErrors", "needSchema", "parseStack", "partSchema", "stackSchema"]);
  });
});
