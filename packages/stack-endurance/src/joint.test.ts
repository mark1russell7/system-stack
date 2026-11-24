import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { caseStopped, enduranceOf, storeAmounts } from "./endurance.ts";
import { jointDays } from "./joint.ts";
import { ENDURANCE_SCHEMA, type CaseCuts, type Converter, type DirectUse, type EnduranceLayer, type Store } from "./layer.ts";
import { SAMPLE_ENDURANCE } from "./sample.ts";

const AT = "2026-12-01";
const SEED = { seed: 20_261_124, numRuns: 60 };
const CURVE: [number, number][] = [[0, 1], [10, 0]];

/** A made-up case: it cuts the water main and the shop. */
const DRY: CaseCuts = {
  case: "dry",
  title: "No water and no shop",
  cuts: [
    { part: "main", title: "No water from the main", duration: CURVE, source: "test" },
    { part: "shop", title: "Closed shop", duration: CURVE, source: "test" },
  ],
};

/**
 * A made-up layer has 20 L of water. It has a drink of 3 L a day at the higher level. The food takes 2000 kcal a day.
 * Only a cook feeds the food. One run takes 1 L of water, 0.5 kg of grain and 0.125 kg of fuel, and gives 2000 kcal.
 * Together the two draws take 4 L of water a day, so the water holds 5 days for the two.
 */
const POT: EnduranceLayer = {
  schema: ENDURANCE_SCHEMA,
  levels: ["life", "health"],
  resources: [
    { code: "water", unit: "L" },
    { code: "grain", unit: "kg" },
    { code: "fuel", unit: "kg" },
  ],
  stores: [
    { id: "tank", resource: "water", amount: 20 },
    { id: "sack", resource: "grain", amount: 5 },
    { id: "can", resource: "fuel", amount: 2 },
  ],
  draws: [
    { need: "drink", level: "life", perDay: 3, supply: "main" },
    { need: "food", level: "health", perDay: 2000, supply: "shop" },
  ],
  direct: [{ resource: "water", need: "drink", amount: 1 }],
  converters: [
    {
      id: "cook",
      device: "stove",
      takes: [
        { resource: "water", amount: 1 },
        { resource: "grain", amount: 0.5 },
        { resource: "fuel", amount: 0.125 },
      ],
      gives: { need: "food", amount: 2000 },
    },
  ],
};

describe("jointDays", () => {
  it("gives 5 days to the drink and the food together, where the take order gives the food 0 days", () => {
    const joint = jointDays(POT, DRY, { at: AT }, ["drink", "food"]);
    expect(joint.case).toBe("dry");
    expect(joint.at).toBe(AT);
    expect(joint.days).toBe(5);
    expect(joint.plan).toEqual(["drink", "food"]);
    expect(joint.holds).toEqual([]);
    expect(joint.takes).toEqual({ drink: { water: 15 }, food: { water: 5, grain: 2.5, fuel: 0.625 } });
    expect(joint.binding).toEqual(["water"]);
    expect(joint.runs).toEqual({ cook: 5 });
    expect(joint.capped).toEqual([]);

    // The take order: the drink keeps back 20 / 3 days x 3 L, which is all the water. So the cook gets no water.
    const ordered = enduranceOf(POT, DRY, { at: AT });
    expect(ordered.needs["drink"]?.days).toBeCloseTo(20 / 3, 9);
    expect(ordered.needs["drink"]?.takes).toEqual({ water: 20 });
    expect(ordered.needs["food"]?.days).toBeCloseTo(0, 9);
  });

  it("gives each draw alone its own days, and the joint days are not more", () => {
    expect(jointDays(POT, DRY, { at: AT }, ["drink"]).days).toBe(20 / 3);
    const food = jointDays(POT, DRY, { at: AT }, ["food"]);
    expect(food.days).toBe(10);
    expect(food.binding).toEqual(["grain"]);
    expect(food.takes).toEqual({ food: { water: 10, grain: 5, fuel: 1.25 } });
  });

  it("keeps the runs of a device under its limit, also when the stores give more", () => {
    // 40 L of water and 6000 kcal of cans. The stove cooks 0.5 pots a day, so the cook gives 1000 kcal a day and the cans the rest.
    const layer: EnduranceLayer = {
      ...POT,
      resources: [...POT.resources, { code: "cans", unit: "kcal" }],
      stores: [{ id: "tank", resource: "water", amount: 40 }, ...POT.stores.slice(1), { id: "box", resource: "cans", amount: 6000 }],
      direct: [...(POT.direct ?? []), { resource: "cans", need: "food", amount: 1 }],
    };
    // With no limit, the water and the grain give 10.75 days.
    expect(jointDays(layer, DRY, { at: AT }, ["drink", "food"]).days).toBe(10.75);
    const slow: EnduranceLayer = { ...layer, converters: (layer.converters ?? []).map((converter) => ({ ...converter, perDay: 0.5 })) };
    const joint = jointDays(slow, DRY, { at: AT }, ["drink", "food"]);
    expect(joint.days).toBe(6);
    expect(joint.runs).toEqual({ cook: 3 });
    expect(joint.capped).toEqual(["cook"]);
    expect(joint.binding).toEqual(["cans"]);
    expect(joint.takes).toEqual({ drink: { water: 18 }, food: { water: 3, grain: 1.5, fuel: 0.375, cans: 6000 } });
    // Two stoves give twice the runs. Then the limit does not bind, and the water and the cans give the 10.75 days of no limit.
    const two = jointDays({ ...slow, converters: (slow.converters ?? []).map((converter) => ({ ...converter, devices: 2 })) }, DRY, { at: AT }, ["drink", "food"]);
    expect(two.days).toBe(10.75);
    expect(two.binding).toEqual(["cans", "water"]);
    expect(two.capped).toEqual([]);
    // A limit of 0 stops the cook, so the cans alone feed the food for 3 days.
    const none = jointDays({ ...layer, converters: (layer.converters ?? []).map((converter) => ({ ...converter, perDay: 0 })) }, DRY, { at: AT }, ["drink", "food"]);
    expect(none.days).toBe(3);
    expect(none.runs).toEqual({});
    expect(none.capped).toEqual(["cook"]);
  });

  it("shares one limit between the converters of one device", () => {
    // Two pots on one stove of 1 run a day: 2000 kcal a day from the two together, so the food holds with no other way.
    const layer: EnduranceLayer = {
      ...POT,
      stores: [{ id: "tank", resource: "water", amount: 1000 }, { id: "sack", resource: "grain", amount: 1000 }, { id: "can", resource: "fuel", amount: 1000 }],
      draws: [{ need: "food", level: "health", perDay: 4000, supply: "shop" }],
      converters: [
        { ...(POT.converters?.[0] as Converter), id: "a", perDay: 1 },
        { ...(POT.converters?.[0] as Converter), id: "b", perDay: 1 },
      ],
    };
    // One stove gives 1 run a day of 2000 kcal, half of the demand. So the days are 0.
    expect(jointDays(layer, DRY, { at: AT }, ["food"]).days).toBe(0);
    const apart = { ...layer, converters: (layer.converters ?? []).map((converter, i) => ({ ...converter, device: `stove${i}` })) };
    expect(jointDays(apart, DRY, { at: AT }, ["food"]).days).toBe(1000 / 2);
  });

  it("gives a free maker only the runs that the plan uses, and does not name it in capped", () => {
    // A loop of two makers gives water back for each liter that it takes, so its runs cost no stock. The gate refuses such a loop.
    // Only such a loop has runs with no cost, so only the third objective decides its runs. The simplex also gives 0 runs without it.
    // A still with a limit of 0 makes a resource that the plan does not use.
    const layer: EnduranceLayer = {
      ...POT,
      resources: [...POT.resources, { code: "sky", unit: "L" }, { code: "spirit", unit: "L" }],
      converters: [
        ...(POT.converters ?? []),
        { id: "catch", device: "roof", perDay: 100, takes: [{ resource: "sky", amount: 1 }], gives: { resource: "water", amount: 1 } },
        { id: "lift", takes: [{ resource: "water", amount: 1 }], gives: { resource: "sky", amount: 1 } },
        { id: "still", device: "still", perDay: 0, takes: [{ resource: "fuel", amount: 1 }], gives: { resource: "spirit", amount: 1 } },
      ],
    };
    const joint = jointDays(layer, DRY, { at: AT }, ["drink", "food"]);
    expect(joint.days).toBe(5);
    // The loop gives no water to the plan, so the plan uses 0 runs of it.
    expect(joint.runs).toEqual({ cook: 5 });
    expect(joint.capped).toEqual([]);
    expect(joint.takes).toEqual({ drink: { water: 15 }, food: { water: 5, grain: 2.5, fuel: 0.625 } });
  });

  it("does not run a converter that takes nothing, as enduranceOf does", () => {
    // A catcher with no inputs could give water at no cost. canRun refuses it, so a free maker cannot run in the program.
    const layer: EnduranceLayer = {
      ...POT,
      converters: [...(POT.converters ?? []), { id: "catch", device: "roof", perDay: 100, takes: [], gives: { resource: "water", amount: 1 } }],
    };
    const joint = jointDays(layer, DRY, { at: AT }, ["drink", "food"]);
    expect(joint.days).toBe(5);
    expect(joint.runs).toEqual({ cook: 5 });
    expect(joint.capped).toEqual([]);
  });

  it("does not use a converter whose device stops", () => {
    const joint = jointDays(POT, DRY, { at: AT, down: ["stove"] }, ["drink", "food"]);
    expect(joint.days).toBe(0);
    expect(joint.runs).toEqual({});
    expect(joint.takes).toEqual({ drink: {}, food: {} });
    expect(jointDays(POT, DRY, { at: AT, down: ["stove"] }, ["drink"]).days).toBe(20 / 3);
  });

  it("leaves out a store on its due date and after it, as enduranceOf does", () => {
    const layer: EnduranceLayer = { ...POT, stores: [...POT.stores, { id: "old", resource: "water", amount: 100, due: AT }] };
    expect(jointDays(layer, DRY, { at: AT }, ["drink", "food"]).days).toBe(5);
    // The day before, the old water counts: 120 L hold 30 days for the two, so the 5 kg of grain limit the food to 10 days.
    const before = jointDays(layer, DRY, { at: "2026-11-30" }, ["drink", "food"]);
    expect(before.days).toBe(10);
    expect(before.binding).toEqual(["grain"]);
  });

  it("gives Infinity for a demand of 0, and puts the draw in holds", () => {
    const joint = jointDays(POT, { ...DRY, factors: { food: 0 } }, { at: AT }, ["food"]);
    expect(joint).toEqual({ case: "dry", at: AT, days: Infinity, plan: [], holds: ["food"], takes: {}, binding: [], runs: {}, capped: [] });
    expect(jointDays(POT, { ...DRY, factors: { food: 0 } }, { at: AT }, ["drink", "food"]).days).toBe(20 / 3);
  });

  it("gives Infinity for an empty set", () => {
    expect(jointDays(POT, DRY, { at: AT }, []).days).toBe(Infinity);
  });

  it("puts a draw whose supply works in holds, as enduranceOf leaves it out", () => {
    const water: CaseCuts = { ...DRY, cuts: DRY.cuts.slice(0, 1) };
    const joint = jointDays(POT, water, { at: AT }, ["food", "drink"]);
    expect(joint.plan).toEqual(["drink"]);
    expect(joint.holds).toEqual(["food"]);
    expect(joint.days).toBe(20 / 3);
    expect(enduranceOf(POT, water, { at: AT }).needs["food"]).toBeUndefined();
  });

  it("throws a RangeError for a need that is not the need of a draw", () => {
    expect(() => jointDays(POT, DRY, { at: AT }, ["drink", "fun"])).toThrow(RangeError);
    expect(() => jointDays(POT, DRY, { at: AT }, ["drink", "fun"])).toThrow(/"fun"/);
  });

  it("gives Infinity when a chain of converters makes more than it takes", () => {
    // The gate refuses this cycle. The function does not apply the gate, so the program is unbounded.
    const layer: EnduranceLayer = {
      ...POT,
      resources: [...POT.resources, { code: "x", unit: "kg" }, { code: "y", unit: "kg" }],
      stores: [{ id: "x", resource: "x", amount: 1 }],
      direct: [{ resource: "y", need: "drink", amount: 1 }],
      converters: [
        { id: "double", takes: [{ resource: "x", amount: 1 }], gives: { resource: "y", amount: 2 } },
        { id: "back", takes: [{ resource: "y", amount: 1 }], gives: { resource: "x", amount: 1 } },
      ],
    };
    expect(jointDays(layer, DRY, { at: AT }, ["drink"]).days).toBe(Infinity);
  });

  it("uses a maker of a resource for the draws of the plan, and counts its inputs in the takes", () => {
    const layer: EnduranceLayer = {
      ...POT,
      resources: [...POT.resources, { code: "ice", unit: "kg" }],
      stores: [...POT.stores, { id: "box", resource: "ice", amount: 4 }],
      converters: [...(POT.converters ?? []), { id: "melt", takes: [{ resource: "ice", amount: 1 }], gives: { resource: "water", amount: 1 } }],
    };
    const joint = jointDays(layer, DRY, { at: AT }, ["drink", "food"]);
    expect(joint.days).toBe(6);
    expect(joint.binding).toEqual(["ice", "water"]);
    expect(joint.runs).toEqual({ cook: 6, melt: 4 });
    const water = (joint.takes["drink"]?.["water"] ?? 0) + (joint.takes["food"]?.["water"] ?? 0);
    const ice = (joint.takes["drink"]?.["ice"] ?? 0) + (joint.takes["food"]?.["ice"] ?? 0);
    expect(water).toBe(20);
    expect(ice).toBe(4);
  });
});

describe("the size of the program", () => {
  // A layer of 10 draws and 20 resources: the scale of a real plan. The time limit is loose. CI holds the timed runs.
  it("solves 10 draws and 20 resources in less than 10 s", () => {
    const resources = Array.from({ length: 20 }, (_, j) => ({ code: `r${j}`, unit: "u" }));
    const stores: Store[] = resources.map((resource, j) => ({ id: `s${j}`, resource: resource.code, amount: 100 + 7 * j }));
    const draws = Array.from({ length: 10 }, (_, i) => ({ need: `n${i}`, level: i % 2 === 0 ? "life" : "health", perDay: 1 + (i % 3), supply: "main" }));
    const direct: DirectUse[] = draws.flatMap((draw, i) => [
      { resource: `r${i}`, need: draw.need, amount: 1 },
      { resource: `r${i + 10}`, need: draw.need, amount: 0.5 },
    ]);
    const converters: Converter[] = [
      ...draws
        .filter((_, i) => i % 2 === 0)
        .map((draw, k) => ({
          id: `cook${k}`,
          takes: [{ resource: `r${(2 * k + 1) % 20}`, amount: 1 }, { resource: `r${(2 * k + 5) % 20}`, amount: 0.25 }],
          gives: { need: draw.need, amount: 4 },
        })),
      ...[0, 1, 2].map((k) => ({ id: `make${k}`, device: `d${k}`, perDay: 10, takes: [{ resource: `r${15 + k}`, amount: 1 }], gives: { resource: `r${k}`, amount: 1 } })),
    ];
    const layer: EnduranceLayer = { schema: ENDURANCE_SCHEMA, levels: ["life", "health"], resources, stores, draws, direct, converters };
    const cut: CaseCuts = { ...DRY, cuts: DRY.cuts.slice(0, 1) };
    const start = performance.now();
    const joint = jointDays(layer, cut, { at: AT }, draws.map((draw) => draw.need));
    const seconds = (performance.now() - start) / 1000;
    console.log(`jointDays: 10 draws and 20 resources in ${seconds.toFixed(3)} s, ${joint.days} days`);
    expect(seconds).toBeLessThan(10);
    expect(joint.plan).toHaveLength(10);
    expect(joint.days).toBeGreaterThan(0);
    expect(Number.isFinite(joint.days)).toBe(true);
    const total = new Map<string, number>();
    for (const takes of Object.values(joint.takes)) for (const [resource, amount] of Object.entries(takes)) total.set(resource, (total.get(resource) ?? 0) + amount);
    for (const [resource, taken] of total) expect(taken, resource).toBeLessThanOrEqual((stores.find((store) => store.resource === resource)?.amount ?? 0) * (1 + 1e-12));
  }, 20_000);
});

describe("the laws of jointDays", () => {
  const storm = SAMPLE_ENDURANCE.cases?.find((item) => item.case === "storm") as CaseCuts;
  // The factors are multiples of 1/8, so the exact rationals stay small and each case is fast.
  const parts = (count: number) => fc.array(fc.integer({ min: 0, max: 16 }).map((n) => n / 8), { minLength: count, maxLength: count });
  const LAWS = { ...SEED, numRuns: 30 };

  function scaled(layer: EnduranceLayer, factors: readonly number[]): EnduranceLayer {
    return { ...layer, stores: layer.stores.map((store, at) => ({ ...store, amount: store.amount * (factors[at] ?? 1) })) };
  }

  /** This function tells if the joint days are not more than the days of each draw alone. It also tells if the takes are not more than the stocks. */
  function laws(layer: EnduranceLayer, caseCuts: CaseCuts): void {
    const needs = layer.draws.map((draw) => draw.need);
    const joint = jointDays(layer, caseCuts, { at: AT }, needs);
    for (const need of joint.plan) expect(joint.days, need).toBeLessThanOrEqual(jointDays(layer, caseCuts, { at: AT }, [need]).days * (1 + 1e-12));
    const stock = storeAmounts(layer, AT, caseStopped(caseCuts, {}));
    const total = new Map<string, number>();
    for (const takes of Object.values(joint.takes)) for (const [resource, amount] of Object.entries(takes)) total.set(resource, (total.get(resource) ?? 0) + amount);
    for (const [resource, taken] of total) expect(taken, resource).toBeLessThanOrEqual((stock.get(resource) ?? 0) * (1 + 1e-12));
  }

  it("keeps the joint days under the days alone, and the takes under the stocks, in the storm of the sample", () => {
    fc.assert(fc.property(parts(SAMPLE_ENDURANCE.stores.length), (factors) => laws(scaled(SAMPLE_ENDURANCE, factors), storm)), LAWS);
  });

  it("keeps the joint days under the days alone, and the takes under the stocks, with the cook", () => {
    fc.assert(fc.property(parts(POT.stores.length), (factors) => laws(scaled(POT, factors), DRY)), LAWS);
  });

  it("gives the days of enduranceOf to a set of one draw that alone takes its inputs", () => {
    // Each way of the draw has its own resources, so the take order is the best share. A higher draw takes only its own resource.
    const half = fc.integer({ min: 1, max: 8 }).map((n) => n / 2);
    const quarter = fc.integer({ min: 1, max: 8 }).map((n) => n / 4);
    const amount = fc.integer({ min: 0, max: 60 });
    const cook = fc.record({ inputs: fc.array(fc.record({ each: quarter, stock: amount }), { minLength: 1, maxLength: 2 }), gives: half });
    const shape = fc.record({
      direct: fc.array(fc.record({ each: half, stock: amount }), { maxLength: 2 }),
      cooks: fc.array(cook, { maxLength: 2 }),
      maker: fc.option(fc.record({ each: half, gives: half, stock: amount }), { nil: undefined }),
      perDay: fc.integer({ min: 1, max: 5 }),
      other: amount,
    });
    fc.assert(
      fc.property(shape, (spec) => {
        const stores: Store[] = [{ id: "other", resource: "other", amount: spec.other }];
        const direct: DirectUse[] = [{ resource: "other", need: "drink", amount: 1 }];
        const converters: Converter[] = [];
        spec.direct.forEach((use, j) => {
          stores.push({ id: `d${j}`, resource: `d${j}`, amount: use.stock });
          direct.push({ resource: `d${j}`, need: "food", amount: use.each });
        });
        spec.cooks.forEach((one, c) => {
          one.inputs.forEach((input, t) => stores.push({ id: `c${c}i${t}`, resource: `c${c}i${t}`, amount: input.stock }));
          converters.push({ id: `cook${c}`, takes: one.inputs.map((input, t) => ({ resource: `c${c}i${t}`, amount: input.each })), gives: { need: "food", amount: one.gives } });
        });
        if (spec.maker !== undefined && spec.direct.length > 0) {
          stores.push({ id: "m", resource: "m", amount: spec.maker.stock });
          converters.push({ id: "maker", takes: [{ resource: "m", amount: spec.maker.each }], gives: { resource: "d0", amount: spec.maker.gives } });
        }
        const layer: EnduranceLayer = {
          schema: ENDURANCE_SCHEMA,
          levels: ["life", "health"],
          resources: stores.map((store) => ({ code: store.resource, unit: "u" })),
          stores,
          draws: [
            { need: "drink", level: "life", perDay: 1, supply: "main" },
            { need: "food", level: "health", perDay: spec.perDay, supply: "shop" },
          ],
          direct,
          converters,
        };
        const ordered = enduranceOf(layer, DRY, { at: AT }).needs["food"];
        const joint = jointDays(layer, DRY, { at: AT }, ["food"]);
        const want = ordered?.days ?? 0;
        expect(Math.abs(joint.days - want)).toBeLessThanOrEqual(1e-9 * Math.max(1, want));
        const takes = joint.takes["food"] ?? {};
        for (const resource of new Set([...Object.keys(takes), ...Object.keys(ordered?.takes ?? {})])) {
          const got = takes[resource] ?? 0;
          const expected = ordered?.takes[resource] ?? 0;
          expect(Math.abs(got - expected), resource).toBeLessThanOrEqual(1e-9 * Math.max(1, expected));
        }
      }),
      SEED,
    );
  });
});
