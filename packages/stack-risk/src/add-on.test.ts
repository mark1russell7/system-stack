import { checkStackLayers, readLayer, SAMPLE_STACK, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { riskAddOn } from "./add-on.ts";
import { checkRisk } from "./check.ts";
import { RISK_SCHEMA, type RiskLayer } from "./layer.ts";
import { SAMPLE_RISK, SAMPLE_TODAY } from "./sample.ts";

const options = { today: SAMPLE_TODAY };
const withLayer = (layer: unknown): Stack => ({ ...SAMPLE_STACK, layers: { [RISK_SCHEMA]: layer } });

describe("riskAddOn", () => {
  it("has the name of the risk layer", () => {
    expect(riskAddOn(options).schema).toBe("risk/1");
  });

  it("reads the layer of a stack", () => {
    expect(readLayer(withLayer(SAMPLE_RISK), riskAddOn(options))).toEqual({ ok: true, layer: SAMPLE_RISK });
    expect(readLayer(SAMPLE_STACK, riskAddOn(options))).toBeUndefined();
  });

  it("gives the faults of the gate, with the name of the layer", () => {
    // No record accepts a risk, so each single point of failure of the goal is a fault.
    const layer: RiskLayer = { ...SAMPLE_RISK, accepted: [] };
    const faults = checkRisk(layer, SAMPLE_STACK, options);
    expect(faults.length).toBeGreaterThan(0);
    expect(checkStackLayers(withLayer(layer), [riskAddOn(options)])).toEqual(faults.map((fault) => ({ ...fault, layer: RISK_SCHEMA })));
    expect(checkStackLayers(withLayer(SAMPLE_RISK), [riskAddOn(options)])).toEqual(checkRisk(SAMPLE_RISK, SAMPLE_STACK, options).map((fault) => ({ ...fault, layer: RISK_SCHEMA })));
  });

  it("gives the faults of the form of a layer, and starts no gate then", () => {
    const findings = checkStackLayers(withLayer({ ...SAMPLE_RISK, goals: [{ part: "alert", survives: "one" }] }), [riskAddOn(options)]);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(finding).toMatchObject({ layer: RISK_SCHEMA, level: "error", code: "layer-form" });
  });

  it("uses the limits of its options", () => {
    // With a limit of one set, the search of the goal has no result, so the gate does not pass.
    const findings = checkStackLayers(withLayer(SAMPLE_RISK), [riskAddOn({ ...options, maxSets: 1 })]);
    expect(findings.map((finding) => finding.code)).toContain("no-read");
  });

  it("refuses a date of a wrong form at once", () => {
    expect(() => riskAddOn({ today: "tomorrow" })).toThrow(RangeError);
  });
});
