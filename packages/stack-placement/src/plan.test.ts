import { RISK_SCHEMA, worksChance } from "@mark1russell7/stack-risk";
import { riskAddOn } from "@mark1russell7/stack-risk/add-on";
import { monthTotal } from "@mark1russell7/stack-spend";
import { spendAddOn } from "@mark1russell7/stack-spend/add-on";
import { readLayer, type Stack, type StackJoiner } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { choiceOf, planPlacement, placementSpace, SAMPLE_BASE, SAMPLE_PLACEMENT, SAMPLE_TODAY, type BoundReading, type ChanceReading, type PlacementLayer, type PlanOptions } from "./index.ts";

// The test is the caller: it makes the measures from the add-ons of risk and spend. The add-on of placement knows neither.
const risk = riskAddOn({ today: SAMPLE_TODAY });
const spend = spendAddOn({ today: SAMPLE_TODAY });
const joiners = [risk, spend];

/** This function reads a layer of a placed stack. A layer with a fault of its form throws a `RangeError`, and the plan counts the break `measure`. */
function layerOf<Layer>(stack: Stack, addOn: StackJoiner<Layer>): Layer | undefined {
  const read = readLayer(stack, addOn);
  if (read === undefined) return undefined;
  if (!read.ok) throw new RangeError(read.errors.join(" "));
  return read.layer;
}

/** The chance measure: `worksChance` of `stack-risk` over the risk layer of the placed stack. */
function chance(stack: Stack, part: string): ChanceReading {
  const works = worksChance(layerOf(stack, risk) ?? { schema: RISK_SCHEMA, goals: [] }, stack, part);
  return works.kind === "exact" ? { value: works.value, importance: works.importance, assumed: works.assumed } : { value: Number.NaN };
}

/** The bound measure: `monthTotal` of `stack-spend` over the spend layer of the placed stack. */
function bound(stack: Stack): BoundReading {
  const layer = layerOf(stack, spend);
  return layer === undefined ? { bounded: 0, open: [] } : monthTotal(layer);
}

const measures: PlanOptions = { joiners, chance, bound };

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
    const plan = planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, measures);
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
    const plan = planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, measures);
    const both = plan.front[1];
    expect(both?.shared).toEqual(["provider-x"]);
    expect(both?.chance).toBeLessThan(1 - (1 - X) * (1 - X));
  });

  it("gives the sources, the bound of the spend layer and the most important parts of a row", () => {
    const row = planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { ...measures, importance: 2 }).front[0];
    expect(row?.sources).toEqual({ "copy-a": "offer-small-x" });
    expect(row?.bound).toEqual({ bounded: 5, open: [] });
    expect(row?.assumed).toEqual([]);
    expect(row?.importance.map((item) => item.part)).toEqual(["copy-a", "provider-x"]);
    expect(row?.importance[0]?.importance).toBeCloseTo(0.999, 12);
  });

  it("keeps a choice that breaks a limit off the front, and counts each break", () => {
    const layer: PlacementLayer = { ...SAMPLE_PLACEMENT, limits: { cost: 10, chance: 0.99 } };
    const plan = planPlacement(layer, SAMPLE_BASE, measures);
    expect(plan.front.map((row) => row.choice)).toEqual([{ "copy-a": "small-x", "copy-b": "small-x" }]);
    expect(plan.breaks).toEqual({ cost: 3, chance: 2 });
    expect(plan.counts.breaks).toBe(5);
  });

  it("breaks the limit bound for a cost above the bound and for a service with no bound", () => {
    const layer: PlacementLayer = { ...SAMPLE_PLACEMENT, limits: { bound: 5 } };
    expect(planPlacement(layer, SAMPLE_BASE, measures).front.map((row) => row.choice)).toEqual([{ "copy-a": "small-x", "copy-b": null }]);
    const first = SAMPLE_PLACEMENT.slots[0];
    if (first === undefined) throw new Error("The sample has no slot.");
    const metered = first.candidates.map((candidate) => ({
      ...candidate,
      stack: { ...candidate.stack, layers: { ...candidate.stack.layers, "spend/1": { schema: "spend/1", currency: "USD", kinds: [], proofDays: 30, services: [{ part: "copy-a", billing: "metered" }] } } },
    }));
    const open: PlacementLayer = { ...SAMPLE_PLACEMENT, slots: [{ ...first, candidates: metered }], limits: { bound: 100 } };
    const plan = planPlacement(open, SAMPLE_BASE, measures);
    expect(plan.front).toEqual([]);
    expect(plan.breaks).toEqual({ bound: 2 });
  });

  it("breaks a choice whose fragments do not join, and a choice whose risk layer the measure refuses", () => {
    const first = SAMPLE_PLACEMENT.slots[0];
    if (first === undefined) throw new Error("The sample has no slot.");
    const [x, y] = first.candidates;
    if (x === undefined || y === undefined) throw new Error("The sample has no candidates.");
    const twice = { ...x, stack: { ...x.stack, parts: [...x.stack.parts, { id: "provider-x", kind: "provider" }] } };
    const bad = { ...y, stack: { ...y.stack, layers: { ...y.stack.layers, "risk/1": { schema: "risk/1", goals: [], chances: [{ part: "copy-a", works: 1.5 }] } } } };
    const layer: PlacementLayer = { ...SAMPLE_PLACEMENT, slots: [{ ...first, candidates: [twice, bad] }] };
    const plan = planPlacement(layer, SAMPLE_BASE, measures);
    expect(plan.front).toEqual([]);
    expect(plan.breaks).toEqual({ join: 1, measure: 1 });
  });

  it("searches a large space with a seeded genetic search, and one seed gives one plan", () => {
    const options = { ...measures, evaluations: 4, seed: "test" };
    const plan = planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, options);
    expect(plan.method).toBe("evolve");
    expect(plan.evaluations).toBeLessThanOrEqual(4);
    expect(planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, options)).toEqual(plan);
    for (const row of plan.front) expect(row.cost).toBeGreaterThan(0);
  });

  it("refuses bad options and a slot with no candidate", () => {
    expect(() => planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { joiners } as unknown as PlanOptions)).toThrow(/The measure "chance" is not a function/);
    expect(() => planPlacement({ ...SAMPLE_PLACEMENT, limits: { bound: 5 } }, SAMPLE_BASE, { joiners, chance })).toThrow(/no bound measure/);
    expect(() => planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { ...measures, evaluations: 0 })).toThrow(RangeError);
    const empty: PlacementLayer = { ...SAMPLE_PLACEMENT, slots: [{ id: "copy-a", candidates: [] }] };
    expect(() => planPlacement(empty, SAMPLE_BASE, measures)).toThrow(RangeError);
  });
  it("takes a plain number from a chance measure, and a cost measure in place of the costs of the layer", () => {
    // Each choice has the chance 0.5, and its cost is its count of parts. Thus the front has the choices with the fewest parts.
    const plan = planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { joiners, chance: () => 0.5, cost: (stack) => stack.parts.length });
    expect(plan.front.map((row) => `${String(row.choice["copy-a"])}+${String(row.choice["copy-b"])} ${String(row.cost)} ${String(row.chance)}`).sort()).toEqual([
      "small-x+null 3 0.5",
      "small-y+null 3 0.5",
    ]);
    expect(plan.front[0]?.bound).toBeNull();
    expect(plan.front[0]?.importance).toEqual([]);
    expect(plan.front[0]?.assumed).toEqual([]);
  });

  it("counts a chance of NaN as unread, and a value out of range or a RangeError as the break measure", () => {
    const unread = planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { joiners, chance: () => Number.NaN });
    expect(unread.front).toEqual([]);
    expect(unread.counts.unread).toBe(6);
    expect(unread.breaks).toEqual({});
    for (const options of [
      { joiners, chance: () => 1.5 },
      { joiners, chance: () => 0.5, cost: () => -1 },
      { joiners, chance: () => 0.5, bound: (): BoundReading => ({ bounded: Number.POSITIVE_INFINITY, open: [] }) },
      { joiners, chance: (): number => { throw new RangeError("The measure refuses the stack."); } },
    ]) {
      expect(planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, options).breaks).toEqual({ measure: 6 });
    }
  });

  it("lets an error of a measure that is not a RangeError go to the caller", () => {
    const chanceOf = (): number => { throw new TypeError("A fault of the measure."); };
    expect(() => planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { joiners, chance: chanceOf })).toThrow(TypeError);
  });
});
