import { riskAddOn } from "@mark1russell7/stack-risk/add-on";
import { spendAddOn } from "@mark1russell7/stack-spend/add-on";
import { checkStackLayers, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { placementAddOn } from "./add-on.ts";
import { checkPlacement, joinPlacement, PLACEMENT_SCHEMA, placedStack, SAMPLE_BASE, SAMPLE_PLACEMENT, SAMPLE_STACK, SAMPLE_TODAY, type PlacementLayer } from "./index.ts";
import { parsePlacement } from "./schema.ts";

const joiners = [riskAddOn({ today: SAMPLE_TODAY }), spendAddOn({ today: SAMPLE_TODAY })];

/** This function gives the codes of a list of faults or findings. */
function codes(list: readonly { readonly code: string }[]): string[] {
  return list.map((item) => item.code);
}

describe("placedStack", () => {
  it("joins the base, the chosen candidates and each used shared fragment one time", () => {
    const placed = placedStack(SAMPLE_PLACEMENT, SAMPLE_BASE, { "copy-a": "small-x", "copy-b": "small-x" }, joiners);
    if (!placed.ok) throw new Error(JSON.stringify(placed.findings));
    expect(placed.stack.parts.map((part) => part.id)).toEqual(["send", "copy-a", "copy-b", "provider-x"]);
    expect(placed.cost).toBe(10);
    expect(placed.shared).toEqual(["provider-x"]);
    const risk = placed.stack.layers?.["risk/1"] as { chances: { part: string }[] };
    expect(risk.chances.map((chance) => chance.part)).toEqual(["copy-a", "copy-b", "provider-x"]);
  });

  it("leaves the placement layer out of the placed stack", () => {
    const placed = placedStack(SAMPLE_PLACEMENT, SAMPLE_STACK, { "copy-a": "small-y" }, joiners);
    if (!placed.ok) throw new Error(JSON.stringify(placed.findings));
    expect(Object.keys(placed.stack.layers ?? {})).toEqual(["risk/1", "spend/1"]);
  });

  it("gives the faults of a choice before a join", () => {
    const empty = placedStack(SAMPLE_PLACEMENT, SAMPLE_BASE, { "copy-a": null }, joiners);
    expect(empty.ok ? [] : codes(empty.findings)).toEqual(["slot-empty"]);
    const unknown = placedStack(SAMPLE_PLACEMENT, SAMPLE_BASE, { "copy-a": "large", "copy-c": "small-x" }, joiners);
    expect(unknown.ok ? [] : codes(unknown.findings)).toEqual(["slot-unknown", "candidate-unknown"]);
    const layer: PlacementLayer = { ...SAMPLE_PLACEMENT, shared: [] };
    const missing = placedStack(layer, SAMPLE_BASE, { "copy-a": "small-x" }, joiners);
    expect(missing.ok ? [] : codes(missing.findings)).toEqual(["shared-unknown"]);
  });

  it("gives the findings of the join, for example a part of two fragments", () => {
    const first = SAMPLE_PLACEMENT.slots[0];
    const x = first?.candidates[0];
    if (first === undefined || x === undefined) throw new Error("The sample has no candidate.");
    const twice = { ...x, stack: { ...x.stack, parts: [...x.stack.parts, { id: "provider-x", kind: "provider" }] } };
    const layer: PlacementLayer = { ...SAMPLE_PLACEMENT, slots: [{ ...first, candidates: [twice] }] };
    const placed = placedStack(layer, SAMPLE_BASE, { "copy-a": "small-x" }, joiners);
    expect(placed.ok ? [] : codes(placed.findings)).toContain("part-twice");
  });
});

describe("checkPlacement", () => {
  it("passes the sample", () => {
    expect(checkPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE)).toEqual([]);
  });

  it("gives each fault of a bad layer", () => {
    const first = SAMPLE_PLACEMENT.slots[0];
    const x = first?.candidates[0];
    if (first === undefined || x === undefined) throw new Error("The sample has no candidate.");
    const layer: PlacementLayer = {
      ...SAMPLE_PLACEMENT,
      part: "receive",
      currency: "EUR",
      slots: [
        { id: "send", candidates: [] },
        { id: "copy-a", candidates: [x, { ...x, cost: -1, uses: ["provider-z"], stack: SAMPLE_BASE }] },
        { id: "copy-a", candidates: [x] },
        { id: "copy-c", candidates: [{ ...x, uses: [] }] },
      ],
      shared: [...(SAMPLE_PLACEMENT.shared ?? []), { id: "provider-x", stack: SAMPLE_BASE, cost: Number.NaN }],
      limits: { cost: -1, chance: 2 },
    };
    const base: Stack = { ...SAMPLE_BASE, layers: { "spend/1": { schema: "spend/1", currency: "USD", kinds: [], proofDays: 30, services: [] } } };
    expect(codes(checkPlacement(layer, base))).toEqual([
      "part-unknown",
      "slot-twice",
      "slot-part",
      "slot-no-candidate",
      "candidate-twice",
      "candidate-part",
      "cost-range",
      "shared-unknown",
      "slot-unneeded",
      "candidate-part",
      "shared-twice",
      "shared-unused",
      "cost-range",
      "limit-range",
      "limit-range",
      "currency",
    ]);
  });
});

describe("joinPlacement", () => {
  const [a, b] = SAMPLE_PLACEMENT.slots;
  if (a === undefined || b === undefined) throw new Error("The sample has no slots.");
  const left: PlacementLayer = { ...SAMPLE_PLACEMENT, slots: [a], limits: { cost: 20 } };
  const right: PlacementLayer = { ...SAMPLE_PLACEMENT, slots: [b], shared: [] };

  it("joins the slots of two fragments, and takes each limit from the fragment that gives it", () => {
    const joined = joinPlacement([
      { from: "left", layer: left },
      { from: "right", layer: right },
    ]);
    if (!joined.ok) throw new Error(joined.errors.join(" "));
    expect(joined.layer.slots.map((slot) => slot.id)).toEqual(["copy-a", "copy-b"]);
    expect(joined.layer.shared?.map((item) => item.id)).toEqual(["provider-x", "provider-y"]);
    expect(joined.layer.limits).toEqual({ cost: 20 });
  });

  it("refuses a slot of two fragments and a different currency", () => {
    const joined = joinPlacement([
      { from: "left", layer: left },
      { from: "again", layer: { ...left, currency: "EUR", shared: [] } },
    ]);
    expect(joined.ok).toBe(false);
    expect(joined.ok ? [] : joined.errors.length).toBe(2);
  });
});

describe("the entries /schema and /add-on", () => {
  it("reads the sample, and names the place of a fault of the form", () => {
    expect(parsePlacement(SAMPLE_PLACEMENT)).toEqual({ ok: true, layer: SAMPLE_PLACEMENT });
    const bad = parsePlacement({ ...SAMPLE_PLACEMENT, slots: [{ id: "copy-a", candidates: [{ key: "x", stack: SAMPLE_BASE, cost: "5" }] }] });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? "" : bad.errors.join(" ")).toContain("slots.0.candidates.0.cost");
  });

  it("gives the add-on of the layer contract, and the core checks the sample stack with it", () => {
    const addOn = placementAddOn();
    expect(addOn.schema).toBe(PLACEMENT_SCHEMA);
    const findings = checkStackLayers(SAMPLE_STACK, [addOn]);
    expect(findings.filter((finding) => finding.layer === PLACEMENT_SCHEMA)).toEqual([]);
    // The base stack is not whole before a placement: the core gives a fault for each slot that a need names.
    expect(findings.map((finding) => [finding.layer, finding.code, finding.other])).toEqual([
      ["stack/1", "need-part", "copy-a"],
      ["stack/1", "need-part", "copy-b"],
    ]);
  });
});
