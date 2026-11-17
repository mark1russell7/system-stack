import { checkStackLayers, readLayer, SAMPLE_STACK, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { tofuAddOn } from "./add-on.ts";
import { checkTofu } from "./check.ts";
import { TOFU_SCHEMA, type TofuLayer } from "./layer.ts";
import { SAMPLE_BUDGETS, SAMPLE_TOFU } from "./sample.ts";

const options = { budgets: SAMPLE_BUDGETS };
const withLayer = (layer: unknown): Stack => ({ ...SAMPLE_STACK, layers: { [TOFU_SCHEMA]: layer } });

describe("tofuAddOn", () => {
  it("has the name of the OpenTofu layer", () => {
    expect(tofuAddOn().schema).toBe("tofu/1");
  });

  it("reads the layer of a stack", () => {
    expect(readLayer(withLayer(SAMPLE_TOFU), tofuAddOn(options))).toEqual({ ok: true, layer: SAMPLE_TOFU });
    expect(readLayer(SAMPLE_STACK, tofuAddOn(options))).toBeUndefined();
  });

  it("gives the faults of the gate, with the name of the layer", () => {
    // A resource names no part of the stack, so the gate has a fault.
    const layer: TofuLayer = { ...SAMPLE_TOFU, resources: [...SAMPLE_TOFU.resources, { part: "nothing", type: "terraform_data" }] };
    const faults = checkTofu(layer, SAMPLE_STACK, options);
    expect(faults.length).toBeGreaterThan(0);
    expect(checkStackLayers(withLayer(layer), [tofuAddOn(options)])).toEqual(faults.map((fault) => ({ ...fault, layer: TOFU_SCHEMA })));
    expect(checkStackLayers(withLayer(SAMPLE_TOFU), [tofuAddOn(options)])).toEqual(checkTofu(SAMPLE_TOFU, SAMPLE_STACK, options).map((fault) => ({ ...fault, layer: TOFU_SCHEMA })));
  });

  it("gives the faults of the form of a layer, and starts no gate then", () => {
    const findings = checkStackLayers(withLayer({ ...SAMPLE_TOFU, resources: [{ part: "cloud-host", type: 5 }] }), [tofuAddOn(options)]);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(finding).toMatchObject({ layer: TOFU_SCHEMA, level: "error", code: "layer-form" });
  });

  it("uses the budgets of its options", () => {
    // With no budgets, the gate has no read of the limit of the account, so it does not pass.
    const findings = checkStackLayers(withLayer(SAMPLE_TOFU), [tofuAddOn()]);
    expect(findings.map((finding) => finding.code)).toContain("budget-none");
    expect(checkStackLayers(withLayer(SAMPLE_TOFU), [tofuAddOn(options)]).filter((finding) => finding.level === "error")).toEqual([]);
  });
});
