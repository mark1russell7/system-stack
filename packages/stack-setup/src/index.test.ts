import { describe, expect, it } from "vitest";
import * as addOn from "./add-on.ts";
import * as entry from "./index.ts";
import * as schema from "./schema.ts";

describe("the root entry", () => {
  it("has the format, the order, the gate, the join, the generator and the sample", () => {
    expect(entry.SETUP_SCHEMA).toBe("setup/1");
    for (const name of ["stepAddress", "isVariableRead", "textParts", "textVariables", "stepTexts", "stepPaths", "unitPath", "setupHosts", "hostProfiles", "profilesBefore", "profileOrder", "checkSetup", "hasSetupError", "joinSetup", "shellWord", "setupScript"] as const) {
      expect(entry[name], name).toBeTypeOf("function");
    }
    expect(entry.STEP_KINDS).toEqual(["package", "user", "file", "download", "archive", "swap", "service", "command"]);
    expect(entry.SETUP_CODES).toContain("setup-archive");
    expect(entry.SETUP_CODES).toContain("setup-secret-exposed");
    expect(entry.SETUP_EXIT).toEqual({ ok: 0, failed: 1, changes: 2, usage: 64 });
    expect(entry.SAMPLE_SETUP.schema).toBe(entry.SETUP_SCHEMA);
  });

  it("has no schema and no forms", () => {
    for (const name of ["setupSchema", "parseSetup", "setupAddOn", "NAME_FORM", "isPath"]) expect(entry).not.toHaveProperty(name);
  });
});

describe("the entries /schema and /add-on", () => {
  it("have the schema, the read of a layer and the add-on", () => {
    expect(Object.keys(schema).sort()).toEqual(["parseSetup", "setupSchema"]);
    expect(Object.keys(addOn)).toEqual(["setupAddOn"]);
  });
});
