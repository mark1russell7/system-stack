import { riskAddOn } from "@mark1russell7/stack-risk/add-on";
import { spendAddOn } from "@mark1russell7/stack-spend/add-on";
import { describe, expect, it } from "vitest";
import { choiceOf, planPlacement, placementSpace, SAMPLE_BASE, SAMPLE_PLACEMENT, SAMPLE_TODAY, type PlacementLayer } from "./index.ts";

const joiners = [riskAddOn({ today: SAMPLE_TODAY }), spendAddOn({ today: SAMPLE_TODAY })];

// The chances of the sample, by hand: a copy works when its host and its provider work.
const X = 0.99 * 0.999;
const Y = 0.98 * 0.995;
const BOTH_X = 0.999 * (1 - 0.01 * 0.01);
const MIXED = 1 - (1 - X) * (1 - Y);

describe("placementSpace", () => {
  it("gives one stage for each slot and one option for each candidate", () => {
    const space = placementSpace(SAMPLE_PLACEMENT);
    expect(space.stages.map((stage) => [stage.name, stage.options.map((option) => option.id), stage.optional ?? false])).toEqual([
      ["copy-a", ["small-x", "small-y"], false],
      ["copy-b", ["small-x", "small-y"], true],
    ]);
  });

  it("gives the value null for a stage with no option", () => {
    expect(choiceOf({ space: "stack-placement", stages: { "copy-a": { option: "small-x" }, "copy-b": null } })).toEqual({ "copy-a": "small-x", "copy-b": null });
  });
});

describe("planPlacement", () => {
  it("gives the front of cost against chance over each choice of a small space", () => {
    const plan = planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { joiners });
    expect(plan.method).toBe("grid");
    expect(plan.size).toBe("6");
    expect(plan.evaluations).toBe(6);
    // The two mixed choices give one true chance. Their floats differ by a rounding error, and the steps of the search make them tie.
    expect(plan.counts).toEqual({ feasible: 6, breaks: 0, unread: 0, front: 4 });
    expect(plan.front.map((row) => row.cost)).toEqual([5, 10, 11, 11]);
    expect(plan.front[0]?.choice).toEqual({ "copy-a": "small-x", "copy-b": null });
    expect(plan.front[0]?.chance).toBeCloseTo(X, 12);
    expect(plan.front[1]?.choice).toEqual({ "copy-a": "small-x", "copy-b": "small-x" });
    expect(plan.front[1]?.chance).toBeCloseTo(BOTH_X, 12);
    expect(plan.front[2]?.chance).toBeCloseTo(MIXED, 12);
    expect(plan.front[3]?.chance).toBeCloseTo(MIXED, 12);
    expect(new Set(plan.front.slice(2).map((row) => `${String(row.choice["copy-a"])}+${String(row.choice["copy-b"])}`))).toEqual(new Set(["small-x+small-y", "small-y+small-x"]));
    expect(plan.breaks).toEqual({});
  });

  it("counts a shared provider one time, so two copies of one provider are not two independent copies", () => {
    const plan = planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { joiners });
    const both = plan.front[1];
    expect(both?.shared).toEqual(["provider-x"]);
    expect(both?.chance).toBeLessThan(1 - (1 - X) * (1 - X));
  });

  it("gives the sources, the bound of the spend layer and the most important parts of a row", () => {
    const row = planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { joiners, importance: 2 }).front[0];
    expect(row?.sources).toEqual({ "copy-a": "offer-small-x" });
    expect(row?.bound).toBe(5);
    expect(row?.open).toEqual([]);
    expect(row?.assumed).toEqual([]);
    expect(row?.importance.map((item) => item.part)).toEqual(["copy-a", "provider-x"]);
    expect(row?.importance[0]?.importance).toBeCloseTo(0.999, 12);
  });

  it("keeps a choice that breaks a limit off the front, and counts each break", () => {
    const layer: PlacementLayer = { ...SAMPLE_PLACEMENT, limits: { cost: 10, chance: 0.99 } };
    const plan = planPlacement(layer, SAMPLE_BASE, { joiners });
    expect(plan.front.map((row) => row.choice)).toEqual([{ "copy-a": "small-x", "copy-b": "small-x" }]);
    expect(plan.breaks).toEqual({ cost: 3, chance: 2 });
    expect(plan.counts.breaks).toBe(5);
  });

  it("breaks the limit bound for a cost above the bound and for a service with no bound", () => {
    const layer: PlacementLayer = { ...SAMPLE_PLACEMENT, limits: { bound: 5 } };
    expect(planPlacement(layer, SAMPLE_BASE, { joiners }).front.map((row) => row.choice)).toEqual([{ "copy-a": "small-x", "copy-b": null }]);
    const first = SAMPLE_PLACEMENT.slots[0];
    if (first === undefined) throw new Error("The sample has no slot.");
    const metered = first.candidates.map((candidate) => ({
      ...candidate,
      stack: { ...candidate.stack, layers: { ...candidate.stack.layers, "spend/1": { schema: "spend/1", currency: "USD", kinds: [], proofDays: 30, services: [{ part: "copy-a", billing: "metered" }] } } },
    }));
    const open: PlacementLayer = { ...SAMPLE_PLACEMENT, slots: [{ ...first, candidates: metered }], limits: { bound: 100 } };
    const plan = planPlacement(open, SAMPLE_BASE, { joiners });
    expect(plan.front).toEqual([]);
    expect(plan.breaks).toEqual({ bound: 2 });
  });

  it("breaks a choice whose fragments do not join, and a choice with a chance out of range", () => {
    const first = SAMPLE_PLACEMENT.slots[0];
    if (first === undefined) throw new Error("The sample has no slot.");
    const [x, y] = first.candidates;
    if (x === undefined || y === undefined) throw new Error("The sample has no candidates.");
    const twice = { ...x, stack: { ...x.stack, parts: [...x.stack.parts, { id: "provider-x", kind: "provider" }] } };
    const bad = { ...y, stack: { ...y.stack, layers: { ...y.stack.layers, "risk/1": { schema: "risk/1", goals: [], chances: [{ part: "copy-a", works: 1.5 }] } } } };
    const layer: PlacementLayer = { ...SAMPLE_PLACEMENT, slots: [{ ...first, candidates: [twice, bad] }] };
    const plan = planPlacement(layer, SAMPLE_BASE, { joiners });
    expect(plan.front).toEqual([]);
    expect(plan.breaks).toEqual({ join: 1, layer: 1 });
  });

  it("searches a large space with a seeded genetic search, and one seed gives one plan", () => {
    const options = { joiners, evaluations: 4, seed: "test" };
    const plan = planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, options);
    expect(plan.method).toBe("evolve");
    expect(plan.evaluations).toBeLessThanOrEqual(4);
    expect(planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, options)).toEqual(plan);
    for (const row of plan.front) expect(row.cost).toBeGreaterThan(0);
  });

  it("refuses bad options and a slot with no candidate", () => {
    expect(() => planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { joiners: [joiners[0] as (typeof joiners)[number]] })).toThrow(RangeError);
    expect(() => planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { joiners, evaluations: 0 })).toThrow(RangeError);
    const empty: PlacementLayer = { ...SAMPLE_PLACEMENT, slots: [{ id: "copy-a", candidates: [] }] };
    expect(() => planPlacement(empty, SAMPLE_BASE, { joiners })).toThrow(RangeError);
  });
});
