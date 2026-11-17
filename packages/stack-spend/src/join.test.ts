import { checkStackLayers, joinStacks, SAMPLE_STACK, STACK_SCHEMA, type LayerPiece, type Stack, type StackFragment } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { spendAddOn } from "./add-on.ts";
import { checkSpend } from "./check.ts";
import { joinSpend } from "./join.ts";
import { SPEND_SCHEMA, type Service, type SpendLayer } from "./layer.ts";
import { SAMPLE_SPEND, SAMPLE_TODAY } from "./sample.ts";
import { parseSpend } from "./schema.ts";

const options = { today: SAMPLE_TODAY };
const proof = { date: "2026-11-10", by: "The owner" };
const free = (part: string): Service => ({ part, billing: "free", proof });
const layer = (services: readonly Service[], more: Partial<SpendLayer> = {}): SpendLayer => ({ schema: SPEND_SCHEMA, currency: "USD", kinds: ["account"], proofDays: 90, services, ...more });
const piece = (from: string, value: SpendLayer): LayerPiece<SpendLayer> => ({ from, layer: value });
const sorted = (values: readonly unknown[]): string[] => values.map((value) => JSON.stringify(value)).sort();

describe("joinSpend", () => {
  it("gives the cost records of each fragment, in the order of the fragments", () => {
    const join = joinSpend([piece("a", layer([free("one"), free("two")])), piece("b", layer([])), piece("c", layer([free("three")]))]);
    expect(join).toEqual({ ok: true, layer: layer([free("one"), free("two"), free("three")]) });
  });

  it("gives each kind of the fragments one time, in the order of the fragments", () => {
    const join = joinSpend([piece("a", layer([], { kinds: ["account", "host"] })), piece("b", layer([], { kinds: ["license", "account"] }))]);
    expect(join).toEqual({ ok: true, layer: layer([], { kinds: ["account", "host", "license"] }) });
  });

  it("gives a fault for a part with a record in two or more fragments, also when the records are equal", () => {
    const join = joinSpend([piece("a", layer([free("one"), free("two")])), piece("b", layer([free("two")])), piece("c", layer([{ ...free("one"), plan: "A plan" }, free("two")]))]);
    expect(join).toEqual({
      ok: false,
      errors: ['The fragments "a", "c" each have the cost record of the part "one".', 'The fragments "a", "b", "c" each have the cost record of the part "two".'],
    });
  });

  it("keeps a part that one fragment has two times, so the gate gives its fault", () => {
    const join = joinSpend([piece("a", layer([free("one"), free("one")])), piece("b", layer([free("two")]))]);
    expect(join).toEqual({ ok: true, layer: layer([free("one"), free("one"), free("two")]) });
  });

  it("gives a fault for a fragment with a different currency or a different age of a proof", () => {
    const join = joinSpend([piece("a", layer([free("one")])), piece("b", layer([free("two")], { currency: "EUR", proofDays: 30 })), piece("c", layer([free("one")], { proofDays: 30 }))]);
    expect(join).toEqual({
      ok: false,
      errors: [
        'The fragment "a" has the currency "USD", and the fragment "b" has "EUR".',
        'The fragment "a" has the largest age of a proof in days 90, and the fragment "b" has 30.',
        'The fragment "a" has the largest age of a proof in days 90, and the fragment "c" has 30.',
        'The fragments "a", "c" each have the cost record of the part "one".',
      ],
    });
  });

  it("gives a fault for no layer, and the layer for one layer", () => {
    expect(joinSpend([])).toEqual({ ok: false, errors: ["The join of spend layers got no layer."] });
    expect(joinSpend([piece("a", SAMPLE_SPEND)])).toEqual({ ok: true, layer: SAMPLE_SPEND });
  });
});

/** This function gives the fragments of the sample: fragment `n` has the parts and the cost records that `owners` gives to it. */
function fragments(owners: readonly number[], count: number): StackFragment[] {
  return Array.from({ length: count }, (_, position) => {
    const mine = (index: number): boolean => (owners[index % owners.length] ?? 0) % count === position;
    const parts = SAMPLE_STACK.parts.filter((_, index) => mine(index));
    const services = SAMPLE_SPEND.services.filter((_, index) => mine(index + 7));
    const stack: Stack = { schema: STACK_SCHEMA, parts, layers: { [SPEND_SCHEMA]: { ...SAMPLE_SPEND, services } } };
    return { name: `file-${String(position)}`, stack };
  });
}

describe("the join of a stack with spend layers", () => {
  const addOns = [spendAddOn(options)];
  const whole: Stack = { ...SAMPLE_STACK, layers: { [SPEND_SCHEMA]: SAMPLE_SPEND } };

  it("gives the faults of the whole sample for the sample in two files", () => {
    const join = joinStacks(fragments([0, 1], 2), addOns);
    if (!join.ok) throw new Error(JSON.stringify(join.findings));
    expect(parseSpend(join.stack.layers?.[SPEND_SCHEMA])).toMatchObject({ ok: true });
    expect(sorted(checkStackLayers(join.stack, addOns))).toEqual(sorted(checkStackLayers(whole, addOns)));
    expect(checkStackLayers(whole, addOns).length).toBeGreaterThan(0);
  });

  it("gives the finding layer-join with the fragments for a cost record in two files", () => {
    const [first, second] = fragments([0, 1], 2) as [StackFragment, StackFragment];
    const twice: StackFragment = { name: "file-1", stack: { ...second.stack, layers: { [SPEND_SCHEMA]: SAMPLE_SPEND } } };
    const join = joinStacks([first, twice], addOns);
    if (join.ok) throw new Error("The join has no finding.");
    expect(join.findings.length).toBeGreaterThan(0);
    for (const finding of join.findings) expect(finding).toMatchObject({ level: "error", code: "layer-join", layer: SPEND_SCHEMA, from: ["file-0", "file-1"] });
  });

  it("gives the same records and the same faults for each split of the sample", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 2 }), { minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 3 }), (owners, count) => {
        const files = fragments(owners, count);
        const before = JSON.stringify(files);
        const join = joinStacks(files, addOns);
        if (!join.ok) throw new Error(JSON.stringify(join.findings));
        const joined = parseSpend(join.stack.layers?.[SPEND_SCHEMA]);
        if (!joined.ok) throw new Error(joined.errors.join(" "));
        expect(sorted(joined.layer.services)).toEqual(sorted(SAMPLE_SPEND.services));
        expect(sorted(join.stack.parts)).toEqual(sorted(SAMPLE_STACK.parts));
        expect(sorted(checkSpend(joined.layer, join.stack, options))).toEqual(sorted(checkSpend(SAMPLE_SPEND, SAMPLE_STACK, options)));
        expect(JSON.stringify(files)).toBe(before);
      }),
    );
  });
});
