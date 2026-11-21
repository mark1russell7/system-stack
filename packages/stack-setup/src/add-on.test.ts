import { checkStackLayers, readLayer, SAMPLE_STACK, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { setupAddOn } from "./add-on.ts";
import { checkSetup } from "./check.ts";
import { joinSetup } from "./join.ts";
import { SETUP_SCHEMA, type SetupLayer } from "./layer.ts";
import { SAMPLE_SETUP } from "./sample.ts";

const withLayer = (layer: unknown): Stack => ({ ...SAMPLE_STACK, layers: { [SETUP_SCHEMA]: layer } });

describe("setupAddOn", () => {
  it("has the name of the setup layer and the join", () => {
    expect(setupAddOn().schema).toBe("setup/1");
    expect(setupAddOn().join).toBe(joinSetup);
  });

  it("reads the layer of a stack", () => {
    expect(readLayer(withLayer(SAMPLE_SETUP), setupAddOn())).toEqual({ ok: true, layer: SAMPLE_SETUP });
    expect(readLayer(SAMPLE_STACK, setupAddOn())).toBeUndefined();
  });

  it("gives the faults of the gate, with the name of the layer", () => {
    const layer: SetupLayer = { ...SAMPLE_SETUP, profiles: [...SAMPLE_SETUP.profiles, { name: "extra", part: "nothing", hosts: ["cloud-host"], steps: [] }] };
    const faults = checkSetup(layer, SAMPLE_STACK);
    expect(faults.length).toBeGreaterThan(0);
    expect(checkStackLayers(withLayer(layer), [setupAddOn()])).toEqual(faults.map((fault) => ({ ...fault, layer: SETUP_SCHEMA })));
    expect(checkStackLayers(withLayer(SAMPLE_SETUP), [setupAddOn()])).toEqual([]);
  });

  it("gives the faults of the form of a layer, and starts no gate then", () => {
    const findings = checkStackLayers(withLayer({ ...SAMPLE_SETUP, profiles: [{ name: "p", part: "cloud-host", hosts: "cloud-host", steps: [] }] }), [setupAddOn()]);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(finding).toMatchObject({ layer: SETUP_SCHEMA, level: "error", code: "layer-form" });
  });
});
