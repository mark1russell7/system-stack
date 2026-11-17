import { checkStackLayers, joinStacks, SAMPLE_STACK, STACK_SCHEMA, type LayerPiece, type Stack, type StackFragment } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { riskAddOn } from "./add-on.ts";
import { checkRisk } from "./check.ts";
import { joinRisk } from "./join.ts";
import { RISK_SCHEMA, type Accepted, type Chance, type Goal, type RiskLayer } from "./layer.ts";
import { SAMPLE_RISK, SAMPLE_TODAY } from "./sample.ts";
import { parseRisk } from "./schema.ts";

const options = { today: SAMPLE_TODAY };
const goal = (part: string, survives = 1): Goal => ({ part, survives });
const chance = (part: string, works = 0.99): Chance => ({ part, works });
const accept = (part: string, stop: readonly string[], reason = "A reason"): Accepted => ({ part, stop, reason });
const layer = (goals: readonly Goal[], more: Partial<RiskLayer> = {}): RiskLayer => ({ schema: RISK_SCHEMA, goals, ...more });
const piece = (from: string, value: RiskLayer): LayerPiece<RiskLayer> => ({ from, layer: value });
const sorted = (values: readonly unknown[]): string[] => values.map((value) => JSON.stringify(value)).sort();

describe("joinRisk", () => {
  it("gives the goals, the chance records and the accepted risks of each fragment, in the order of the fragments", () => {
    const a = layer([goal("one")], { chances: [chance("x"), chance("y")], accepted: [accept("one", ["x"])] });
    const b = layer([goal("two"), goal("three")], { chances: [chance("z")] });
    const c = layer([], { accepted: [accept("two", ["z"]), accept("one", ["y"])] });
    expect(joinRisk([piece("a", a), piece("b", b), piece("c", c)])).toEqual({
      ok: true,
      layer: layer([goal("one"), goal("two"), goal("three")], { chances: [chance("x"), chance("y"), chance("z")], accepted: [accept("one", ["x"]), accept("two", ["z"]), accept("one", ["y"])] }),
    });
  });

  it("has the fields chances and accepted only when a fragment has them", () => {
    expect(joinRisk([piece("a", layer([goal("one")])), piece("b", layer([goal("two")]))])).toEqual({ ok: true, layer: { schema: RISK_SCHEMA, goals: [goal("one"), goal("two")] } });
    const join = joinRisk([piece("a", layer([goal("one")], { chances: [] })), piece("b", layer([goal("two")], { accepted: [] }))]);
    expect(join).toEqual({ ok: true, layer: { schema: RISK_SCHEMA, goals: [goal("one"), goal("two")], chances: [], accepted: [] } });
    expect(joinRisk([])).toEqual({ ok: true, layer: { schema: RISK_SCHEMA, goals: [] } });
  });

  it("gives a fault for a goal or a chance record of one part in two or more fragments, also when the records are equal", () => {
    const a = layer([goal("one"), goal("two")], { chances: [chance("x")] });
    const b = layer([goal("two", 2)], { chances: [chance("y")] });
    const c = layer([goal("one")], { chances: [chance("x"), chance("y", 0.5)] });
    expect(joinRisk([piece("a", a), piece("b", b), piece("c", c)])).toEqual({
      ok: false,
      errors: [
        'The fragments "a", "c" each have the goal of the part "one".',
        'The fragments "a", "b" each have the goal of the part "two".',
        'The fragments "a", "c" each have the chance record of the part "x".',
        'The fragments "b", "c" each have the chance record of the part "y".',
      ],
    });
  });

  it("keeps two accepted risks of one set, and a record that one fragment has two times", () => {
    const a = layer([goal("one"), goal("one")], { accepted: [accept("one", ["x"], "The first reason")] });
    const b = layer([], { accepted: [accept("one", ["x"], "The second reason")] });
    expect(joinRisk([piece("a", a), piece("b", b)])).toEqual({
      ok: true,
      layer: layer([goal("one"), goal("one")], { accepted: [accept("one", ["x"], "The first reason"), accept("one", ["x"], "The second reason")] }),
    });
  });
});

/** This function gives the fragments of the sample: fragment `n` has the parts and the risk records that `owners` gives to it. */
function fragments(owners: readonly number[], count: number): StackFragment[] {
  return Array.from({ length: count }, (_, position) => {
    const mine = (index: number): boolean => (owners[index % owners.length] ?? 0) % count === position;
    const value: RiskLayer = {
      schema: RISK_SCHEMA,
      goals: SAMPLE_RISK.goals.filter((_, index) => mine(index + 3)),
      chances: (SAMPLE_RISK.chances ?? []).filter((_, index) => mine(index + 5)),
      accepted: (SAMPLE_RISK.accepted ?? []).filter((_, index) => mine(index + 11)),
    };
    const stack: Stack = { schema: STACK_SCHEMA, parts: SAMPLE_STACK.parts.filter((_, index) => mine(index)), layers: { [RISK_SCHEMA]: value } };
    return { name: `file-${String(position)}`, stack };
  });
}

describe("the join of a stack with risk layers", () => {
  const addOns = [riskAddOn(options)];
  const whole: Stack = { ...SAMPLE_STACK, layers: { [RISK_SCHEMA]: SAMPLE_RISK } };

  it("gives the findings of the whole sample for the sample in two files", () => {
    const join = joinStacks(fragments([0, 1], 2), addOns);
    if (!join.ok) throw new Error(JSON.stringify(join.findings));
    expect(parseRisk(join.stack.layers?.[RISK_SCHEMA])).toMatchObject({ ok: true });
    expect(sorted(checkStackLayers(join.stack, addOns))).toEqual(sorted(checkStackLayers(whole, addOns)));
  });

  it("gives the finding layer-join with the fragments for a chance record in two files", () => {
    const [first, second] = fragments([0, 1], 2) as [StackFragment, StackFragment];
    const twice: StackFragment = { name: "file-1", stack: { ...second.stack, layers: { [RISK_SCHEMA]: { schema: RISK_SCHEMA, goals: [], chances: SAMPLE_RISK.chances } } } };
    const join = joinStacks([first, twice], addOns);
    if (join.ok) throw new Error("The join has no finding.");
    expect(join.findings.length).toBeGreaterThan(0);
    for (const finding of join.findings) expect(finding).toMatchObject({ level: "error", code: "layer-join", layer: RISK_SCHEMA, from: ["file-0", "file-1"] });
  });

  it("gives the same records and the same faults for each split of the sample", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 2 }), { minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 3 }), (owners, count) => {
        const files = fragments(owners, count);
        const before = JSON.stringify(files);
        const join = joinStacks(files, addOns);
        if (!join.ok) throw new Error(JSON.stringify(join.findings));
        const joined = parseRisk(join.stack.layers?.[RISK_SCHEMA]);
        if (!joined.ok) throw new Error(joined.errors.join(" "));
        expect(sorted(joined.layer.goals)).toEqual(sorted(SAMPLE_RISK.goals));
        expect(sorted(joined.layer.chances ?? [])).toEqual(sorted(SAMPLE_RISK.chances ?? []));
        expect(sorted(joined.layer.accepted ?? [])).toEqual(sorted(SAMPLE_RISK.accepted ?? []));
        expect(sorted(checkRisk(joined.layer, join.stack, options))).toEqual(sorted(checkRisk(SAMPLE_RISK, SAMPLE_STACK, options)));
        expect(JSON.stringify(files)).toBe(before);
      }),
      { numRuns: 30 },
    );
  });
});
