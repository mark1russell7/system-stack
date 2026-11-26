import { checkStackLayers, joinStacks, readLayer, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { enduranceAddOn } from "./add-on.ts";
import { checkEndurance } from "./check.ts";
import { joinEndurance } from "./join.ts";
import { ENDURANCE_SCHEMA, type EnduranceLayer } from "./layer.ts";
import { SAMPLE_ENDURANCE, SAMPLE_ENDURANCE_STACK } from "./sample.ts";
import { parseEndurance } from "./schema.ts";

const withLayer = (layer: unknown): Stack => ({ ...SAMPLE_ENDURANCE_STACK, layers: { [ENDURANCE_SCHEMA]: layer } });

describe("enduranceAddOn", () => {
  it("has the name of the endurance layer and the join", () => {
    expect(enduranceAddOn().schema).toBe("endurance/1");
    expect(enduranceAddOn().join).toBe(joinEndurance);
  });

  it("reads the layer of a stack", () => {
    expect(readLayer(withLayer(SAMPLE_ENDURANCE), enduranceAddOn())).toEqual({ ok: true, layer: SAMPLE_ENDURANCE });
    expect(readLayer(SAMPLE_ENDURANCE_STACK, enduranceAddOn())).toBeUndefined();
  });

  it("gives the faults of the gate, with the name of the layer", () => {
    const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, stores: [...SAMPLE_ENDURANCE.stores, { id: "shed", resource: "water.stored", amount: 1, part: "shed" }] };
    const faults = checkEndurance(layer, SAMPLE_ENDURANCE_STACK);
    expect(faults.length).toBeGreaterThan(0);
    expect(checkStackLayers(withLayer(layer), [enduranceAddOn()])).toEqual(faults.map((fault) => ({ ...fault, layer: ENDURANCE_SCHEMA })));
    expect(checkStackLayers(withLayer(SAMPLE_ENDURANCE), [enduranceAddOn()])).toEqual([]);
  });

  it("gives the faults of the form of a layer, and starts no gate then", () => {
    const findings = checkStackLayers(withLayer({ ...SAMPLE_ENDURANCE, stores: [{ id: "s", resource: "w", amount: "1" }] }), [enduranceAddOn()]);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(finding).toMatchObject({ layer: ENDURANCE_SCHEMA, level: "error", code: "layer-form" });
  });
});

describe("parseEndurance", () => {
  it("reads the limit for each day and the count of devices of a converter, and refuses them as text", () => {
    const converter = SAMPLE_ENDURANCE.converters?.[0];
    if (converter === undefined) throw new Error("The sample has no converter.");
    const layer = { ...SAMPLE_ENDURANCE, converters: [{ ...converter, perDay: 3, devices: 2 }] };
    expect(parseEndurance(JSON.parse(JSON.stringify(layer)))).toEqual({ ok: true, layer });
    expect(parseEndurance({ ...layer, converters: [{ ...converter, devices: "2" }] }).ok).toBe(false);
  });

  it("reads the band of a cut, and refuses a band with no high end", () => {
    const storm = SAMPLE_ENDURANCE.cases?.[0];
    if (storm === undefined) throw new Error("The sample has no case.");
    const band = { low: [[0, 1], [1, 0]] as const, high: [[0, 1], [2, 0]] as const };
    const layer = { ...SAMPLE_ENDURANCE, cases: [{ ...storm, cuts: storm.cuts.map((cut, index) => (index === 0 ? { ...cut, band } : cut)) }] };
    expect(parseEndurance(JSON.parse(JSON.stringify(layer)))).toEqual({ ok: true, layer });
    const broken = { ...layer, cases: [{ ...storm, cuts: [{ ...storm.cuts[0], band: { low: band.low } }] }] };
    expect(parseEndurance(JSON.parse(JSON.stringify(broken))).ok).toBe(false);
  });

  it("reads the bound of a cut, and refuses a bound that is not a value of CUT_BOUNDS", () => {
    const storm = SAMPLE_ENDURANCE.cases?.[0];
    if (storm === undefined) throw new Error("The sample has no case.");
    const layer = { ...SAMPLE_ENDURANCE, cases: [{ ...storm, cuts: storm.cuts.map((cut, index) => (index === 0 ? { ...cut, bound: "upper" as const } : cut)) }] };
    expect(parseEndurance(JSON.parse(JSON.stringify(layer)))).toEqual({ ok: true, layer });
    expect(parseEndurance({ ...layer, cases: [{ ...storm, cuts: [{ ...storm.cuts[0], bound: "exact" }] }] }).ok).toBe(false);
  });

  it("reads the sample, and refuses a field that the format does not have", () => {
    expect(parseEndurance(JSON.parse(JSON.stringify(SAMPLE_ENDURANCE)))).toEqual({ ok: true, layer: SAMPLE_ENDURANCE });
    const read = parseEndurance({ ...SAMPLE_ENDURANCE, extra: 1 });
    expect(read.ok).toBe(false);
    const bad = parseEndurance({ ...SAMPLE_ENDURANCE, draws: [{ need: "n", level: "life", perDay: 1 }] });
    expect(bad.ok === false && bad.errors.some((error) => error.includes("draws.0.supply"))).toBe(true);
  });
});

describe("joinEndurance", () => {
  const water: EnduranceLayer = { ...SAMPLE_ENDURANCE, stores: SAMPLE_ENDURANCE.stores.slice(0, 2), cases: undefined, priors: undefined };
  const food: EnduranceLayer = { schema: ENDURANCE_SCHEMA, levels: SAMPLE_ENDURANCE.levels, resources: [], stores: SAMPLE_ENDURANCE.stores.slice(2), draws: [] };

  it("joins the records of the fragments in their order", () => {
    const joined = joinEndurance([
      { from: "a", layer: water },
      { from: "b", layer: food },
    ]);
    expect(joined.ok && joined.layer.stores.map((store) => store.id)).toEqual(SAMPLE_ENDURANCE.stores.map((store) => store.id));
    expect(joined.ok && joined.layer.levels).toEqual(SAMPLE_ENDURANCE.levels);
    expect(joined.ok && "cases" in joined.layer).toBe(false);
  });

  it("refuses one key in two fragments and two lists of levels", () => {
    expect(joinEndurance([{ from: "a", layer: water }, { from: "b", layer: water }]).ok).toBe(false);
    expect(joinEndurance([{ from: "a", layer: water }, { from: "b", layer: { ...food, levels: ["other"] } }]).ok).toBe(false);
  });

  const bare: EnduranceLayer = { ...food, stores: [] };

  it("joins two equal resources of two fragments into one resource", () => {
    const tank: EnduranceLayer = { ...bare, resources: [{ code: "water.stored", unit: "L" }], stores: [{ id: "tank", resource: "water.stored", amount: 200 }] };
    const list: EnduranceLayer = { ...bare, resources: [{ unit: "L", code: "water.stored" }, { code: "food.no-cook", unit: "kcal" }] };
    const joined = joinEndurance([
      { from: "list", layer: list },
      { from: "tank", layer: tank },
    ]);
    expect(joined.ok && joined.layer.resources).toEqual([
      { code: "water.stored", unit: "L" },
      { code: "food.no-cook", unit: "kcal" },
    ]);
    expect(joined.ok && joined.layer.stores.map((store) => store.id)).toEqual(["tank"]);
    const all = joinEndurance([
      { from: "a", layer: water },
      { from: "b", layer: { ...food, resources: water.resources } },
    ]);
    expect(all.ok && all.layer.resources).toEqual(water.resources);
  });

  it("refuses one resource code with a different unit, and names the two fragments with the record of each", () => {
    const joined = joinEndurance([
      { from: "list", layer: { ...bare, resources: [{ code: "water.stored", unit: "L" }] } },
      { from: "tank", layer: { ...bare, resources: [{ code: "water.stored", unit: "gal" }] } },
    ]);
    expect(joined).toEqual({
      ok: false,
      errors: [
        [
          'The fragments "list", "tank" each have the resource "water.stored", and the records are not equal.',
          '  "list": {"code":"water.stored","unit":"L"}',
          '  "tank": {"code":"water.stored","unit":"gal"}',
        ].join("\n"),
      ],
    });
  });

  it("keeps a code that one fragment has two times, so the gate finds it", () => {
    const twice: EnduranceLayer = { ...bare, resources: [{ code: "water.stored", unit: "L" }, { code: "water.stored", unit: "L" }] };
    const joined = joinEndurance([
      { from: "a", layer: { ...bare, resources: [{ code: "water.stored", unit: "L" }] } },
      { from: "b", layer: twice },
    ]);
    expect(joined.ok && joined.layer.resources).toHaveLength(2);
  });

  it("refuses one store id in two fragments, also with equal resources", () => {
    const tank: EnduranceLayer = { ...bare, resources: [{ code: "water.stored", unit: "L" }], stores: [{ id: "tank", resource: "water.stored", amount: 200 }] };
    const joined = joinEndurance([
      { from: "a", layer: tank },
      { from: "b", layer: tank },
    ]);
    expect(joined).toEqual({ ok: false, errors: ['The fragments "a", "b" each have the store "tank".'] });
  });

  it("joins the stack documents of two owners through the core", () => {
    const joined = joinStacks(
      [
        { name: "a", stack: withLayer(water) },
        { name: "b", stack: { schema: SAMPLE_ENDURANCE_STACK.schema, parts: [], layers: { [ENDURANCE_SCHEMA]: food } } },
      ],
      [enduranceAddOn()],
    );
    expect(joined.ok).toBe(true);
  });
});
