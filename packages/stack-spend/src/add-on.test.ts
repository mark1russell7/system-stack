import { checkStackLayers, readLayer, SAMPLE_STACK, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { spendAddOn } from "./add-on.ts";
import { checkSpend } from "./check.ts";
import { SPEND_SCHEMA, type SpendLayer } from "./layer.ts";
import { SAMPLE_SPEND, SAMPLE_TODAY } from "./sample.ts";

const options = { today: SAMPLE_TODAY };
const withLayer = (layer: unknown): Stack => ({ ...SAMPLE_STACK, layers: { [SPEND_SCHEMA]: layer } });

describe("spendAddOn", () => {
  it("has the name of the spend layer", () => {
    expect(spendAddOn(options).schema).toBe("spend/1");
  });

  it("reads the layer of a stack", () => {
    expect(readLayer(withLayer(SAMPLE_SPEND), spendAddOn(options))).toEqual({ ok: true, layer: SAMPLE_SPEND });
    expect(readLayer(SAMPLE_STACK, spendAddOn(options))).toBeUndefined();
  });

  it("gives the faults of the gate, with the name of the layer", () => {
    // A part with a cost loses its record, so the gate has a fault.
    const layer: SpendLayer = { ...SAMPLE_SPEND, services: SAMPLE_SPEND.services.slice(1) };
    const faults = checkSpend(layer, SAMPLE_STACK, options);
    expect(faults.length).toBeGreaterThan(0);
    expect(checkStackLayers(withLayer(layer), [spendAddOn(options)])).toEqual(faults.map((fault) => ({ ...fault, layer: SPEND_SCHEMA })));
    expect(checkStackLayers(withLayer(SAMPLE_SPEND), [spendAddOn(options)])).toEqual(checkSpend(SAMPLE_SPEND, SAMPLE_STACK, options).map((fault) => ({ ...fault, layer: SPEND_SCHEMA })));
  });

  it("gives the faults of the form of a layer, and starts no gate then", () => {
    const findings = checkStackLayers(withLayer({ ...SAMPLE_SPEND, currency: 5, more: true }), [spendAddOn(options)]);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(finding).toMatchObject({ layer: SPEND_SCHEMA, level: "error", code: "layer-form" });
  });

  it("uses the date of its options", () => {
    // In a later year, each proof of the sample is too old.
    const later = checkStackLayers(withLayer(SAMPLE_SPEND), [spendAddOn({ today: "2030-01-01" })]);
    expect(later.map((finding) => finding.code)).toContain("proof-old");
  });

  it("refuses a date of a wrong form at once", () => {
    expect(() => spendAddOn({ today: "16-11-2026" })).toThrow(RangeError);
  });
});
