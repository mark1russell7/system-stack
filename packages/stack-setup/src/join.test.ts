import { describe, expect, it } from "vitest";
import { joinSetup } from "./join.ts";
import { SETUP_SCHEMA, type Profile, type SetupLayer } from "./layer.ts";

const profile = (name: string): Profile => ({ name, part: "a", hosts: ["a"], steps: [] });

describe("joinSetup", () => {
  it("joins the variables and the profiles in the order of the fragments", () => {
    const one: SetupLayer = { schema: SETUP_SCHEMA, variables: [{ name: "A" }], profiles: [profile("p")] };
    const two: SetupLayer = { schema: SETUP_SCHEMA, profiles: [profile("q"), profile("r")] };
    expect(
      joinSetup([
        { from: "one", layer: one },
        { from: "two", layer: two },
      ]),
    ).toEqual({ ok: true, layer: { schema: SETUP_SCHEMA, variables: [{ name: "A" }], profiles: [profile("p"), profile("q"), profile("r")] } });
  });

  it("has no field variables when no fragment has it", () => {
    expect(joinSetup([{ from: "one", layer: { schema: SETUP_SCHEMA, profiles: [profile("p")] } }])).toEqual({ ok: true, layer: { schema: SETUP_SCHEMA, profiles: [profile("p")] } });
  });

  it("refuses a profile or a variable in two fragments, also when the records are equal", () => {
    const layer: SetupLayer = { schema: SETUP_SCHEMA, variables: [{ name: "A" }], profiles: [profile("p")] };
    const result = joinSetup([
      { from: "one", layer },
      { from: "two", layer },
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok ? 0 : result.errors.length).toBe(2);
  });
});
