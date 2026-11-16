import { describe, expect, it } from "vitest";
import { checkStack } from "./check.ts";
import { SAMPLE_STACK } from "./sample.ts";
import { formErrors, parseStack } from "./schema.ts";

describe("parseStack", () => {
  it("reads the sample from its JSON, with no change", () => {
    const read = parseStack(JSON.parse(JSON.stringify(SAMPLE_STACK)));
    expect(read).toEqual({ ok: true, stack: SAMPLE_STACK });
  });

  it("reads a stack with layers, and keeps each layer as it is", () => {
    const value = { schema: "stack/1", parts: [{ id: "a", kind: "service" }], layers: { "spend/1": { schema: "spend/1", any: [1, 2] } } };
    expect(parseStack(value)).toEqual({ ok: true, stack: value });
  });

  it("reads each form of a need", () => {
    const value = { schema: "stack/1", parts: [{ id: "a", kind: "x", needs: ["b", { all: ["b", { any: ["b", "c"], count: 2 }] }] }] };
    const read = parseStack(value);
    expect(read.ok).toBe(true);
    // The meaning is not the work of the schema: the check finds the two unknown parts.
    if (read.ok) expect(checkStack(read.stack).map((fault) => fault.code)).toEqual(["need-part", "need-part"]);
  });

  it("refuses a different format", () => {
    const read = parseStack({ schema: "stack/2", parts: [] });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.errors[0]).toContain('The record "stack/1" has a fault at "schema"');
  });

  it("refuses a field that the format does not have, and names its place", () => {
    const read = parseStack({ schema: "stack/1", parts: [{ id: "a", kind: "x", need: ["b"] }] });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.errors.join(" ")).toContain('"parts.0"');
  });

  it("refuses an empty id, an empty kind and a need that is no need", () => {
    for (const part of [{ id: "", kind: "x" }, { id: "a", kind: "" }, { id: "a", kind: "x", needs: [3] }, { id: "a", kind: "x", needs: [{ some: ["b"] }] }]) {
      expect(parseStack({ schema: "stack/1", parts: [part] }).ok).toBe(false);
    }
  });

  it("refuses a value that is no record", () => {
    for (const value of [undefined, null, 3, "stack/1", []]) {
      const read = parseStack(value);
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.errors[0]).toContain("the record");
    }
  });
});

describe("formErrors", () => {
  it("names the record and the place of each fault", () => {
    expect(formErrors("spend/1", [{ path: ["services", 0, "part"], message: "Too small" }, { path: [], message: "Not a record" }])).toEqual([
      'The record "spend/1" has a fault at "services.0.part": Too small',
      'The record "spend/1" has a fault at the record: Not a record',
    ]);
  });
});
