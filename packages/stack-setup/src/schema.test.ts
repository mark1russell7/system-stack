import { describe, expect, it } from "vitest";
import { SETUP_SCHEMA } from "./layer.ts";
import { SAMPLE_SETUP } from "./sample.ts";
import { parseSetup, setupSchema } from "./schema.ts";

describe("parseSetup", () => {
  it("reads the sample layer, and its JSON", () => {
    expect(parseSetup(SAMPLE_SETUP)).toEqual({ ok: true, layer: SAMPLE_SETUP });
    expect(parseSetup(JSON.parse(JSON.stringify(SAMPLE_SETUP)))).toEqual({ ok: true, layer: SAMPLE_SETUP });
    expect(setupSchema.safeParse(SAMPLE_SETUP).success).toBe(true);
  });

  it("reads each kind of step and each form of a text", () => {
    const layer = {
      schema: SETUP_SCHEMA,
      profiles: [
        {
          name: "p",
          part: "a",
          hosts: ["a"],
          steps: [
            { kind: "file", id: "one", path: "/a", text: "x" },
            { kind: "file", id: "two", path: "/b", text: { $var: "A" } },
            { kind: "file", id: "three", path: "/c", text: ["x=", { $var: "A" }] },
            { kind: "command", id: "four", run: ["true"], check: ["true"], as: "app" },
          ],
        },
      ],
    };
    expect(parseSetup(layer)).toEqual({ ok: true, layer });
  });

  it("refuses a field that the format does not have, and names its place", () => {
    const result = parseSetup({ ...SAMPLE_SETUP, extra: 1 });
    expect(result.ok).toBe(false);
    const step = parseSetup({ schema: SETUP_SCHEMA, profiles: [{ name: "p", part: "a", hosts: ["a"], steps: [{ kind: "swap", id: "s", path: "/s", mib: 1, size: 2 }] }] });
    expect(step.ok ? [] : step.errors).toEqual([expect.stringContaining('"profiles.0.steps.0"')]);
  });

  it("refuses a kind of step that is not known, and a different format", () => {
    const kind = parseSetup({ schema: SETUP_SCHEMA, profiles: [{ name: "p", part: "a", hosts: ["a"], steps: [{ kind: "reboot", id: "r" }] }] });
    expect(kind.ok).toBe(false);
    expect(parseSetup({ schema: "setup/2", profiles: [] }).ok).toBe(false);
    expect(parseSetup({ schema: SETUP_SCHEMA, profiles: [], variables: [{ name: "A", value: "secret" }] }).ok).toBe(false);
  });

  it("refuses a variable read with an extra field, and a text of a wrong type", () => {
    const text = (value: unknown): boolean => parseSetup({ schema: SETUP_SCHEMA, profiles: [{ name: "p", part: "a", hosts: ["a"], steps: [{ kind: "file", id: "f", path: "/a", text: value }] }] }).ok;
    expect(text({ $var: "A", default: "x" })).toBe(false);
    expect(text(5)).toBe(false);
    expect(text([["nested"]])).toBe(false);
  });
});
