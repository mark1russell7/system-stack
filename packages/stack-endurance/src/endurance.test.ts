import { STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { caseStopped, drawDemand, enduranceOf, giftNeed, storeAmounts } from "./endurance.ts";
import { jointDays } from "./joint.ts";
import type { CaseCuts, Converter, EnduranceLayer, Gift } from "./layer.ts";
import { SAMPLE_ENDURANCE, SAMPLE_ENDURANCE_STACK } from "./sample.ts";

const AT = "2026-12-01";
const storm = SAMPLE_ENDURANCE.cases?.find((item) => item.case === "storm") as CaseCuts;
const fire = SAMPLE_ENDURANCE.cases?.find((item) => item.case === "fire") as CaseCuts;

describe("storeAmounts", () => {
  it("adds the stores of each resource, and leaves out a store on its due date and after it", () => {
    const amounts = storeAmounts(SAMPLE_ENDURANCE, AT);
    expect(amounts.get("water.stored")).toBeCloseTo(75.7, 9);
    expect(storeAmounts(SAMPLE_ENDURANCE, "2026-09-29").get("water.stored")).toBeCloseTo(95.7, 9);
    expect(storeAmounts(SAMPLE_ENDURANCE, "2026-09-30").get("water.stored")).toBeCloseTo(75.7, 9);
  });

  it("leaves out a store whose part stops", () => {
    const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, stores: [{ id: "tank", resource: "water.stored", amount: 10, part: "grid" }] };
    expect(storeAmounts(layer, AT, new Set(["grid"])).get("water.stored")).toBeUndefined();
    expect(storeAmounts(layer, AT).get("water.stored")).toBe(10);
  });

  it("throws a RangeError for a date that is not YYYY-MM-DD", () => {
    expect(() => storeAmounts(SAMPLE_ENDURANCE, "tomorrow")).toThrow(RangeError);
  });
});

describe("enduranceOf", () => {
  it("gives the days of each draw in the storm of the sample", () => {
    const result = enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT });
    expect(result.case).toBe("storm");
    expect(result.at).toBe(AT);
    expect(Object.keys(result.needs)).toEqual(["hydration.drink", "food.energy", "power.electric"]);
    expect(result.needs["hydration.drink"]?.days).toBeCloseTo(6.6667, 3);
    expect(result.needs["hydration.drink"]?.binding).toEqual(["water.stored"]);
    // The drinking water keeps back 6.667 days x 11.355 L, which is all the water. So the rice gives nothing, and the cans feed 4800 / 5400 days.
    expect(result.needs["food.energy"]?.days).toBeCloseTo(4800 / 5400, 9);
    expect(result.needs["food.energy"]?.binding).toEqual(["food.ready", "water.stored"]);
    expect(result.needs["power.electric"]?.days).toBeCloseTo(6.6667, 3);
    expect(result.needs["power.electric"]?.binding).toEqual(["energy.battery"]);
  });

  it("leaves out each draw whose supply works", () => {
    expect(enduranceOf(SAMPLE_ENDURANCE, fire, { at: AT }).needs).toEqual({});
  });

  it("gives nothing from a converter whose device is down", () => {
    const result = enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT, down: ["stove"] });
    expect(result.needs["food.energy"]?.days).toBeCloseTo(4800 / 5400, 9);
    expect(result.needs["food.energy"]?.binding).toEqual(["food.ready"]);
  });

  it("stops a device through the needs of the stack", () => {
    const stack: Stack = { ...SAMPLE_ENDURANCE_STACK, parts: SAMPLE_ENDURANCE_STACK.parts.map((part) => (part.id === "stove" ? { ...part, needs: ["grid"] } : part)) };
    expect(caseStopped(storm, { stack })).toEqual(new Set(["grid", "road", "water-main", "stove"]));
    expect(enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT, stack }).needs["food.energy"]?.days).toBeCloseTo(4800 / 5400, 9);
  });

  it("uses the factor of a case on the rate of a draw", () => {
    const hot: CaseCuts = { ...storm, factors: { "hydration.drink": 1.5 } };
    expect(enduranceOf(SAMPLE_ENDURANCE, hot, { at: AT }).needs["hydration.drink"]?.days).toBeCloseTo(75.7 / (11.355 * 1.5), 9);
  });

  it("gives 0 days and each input as binding when the stores are empty", () => {
    const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, stores: [] };
    const result = enduranceOf(layer, storm, { at: AT });
    expect(result.needs["hydration.drink"]).toMatchObject({ days: 0, binding: ["water.stored"] });
    expect(result.needs["food.energy"]).toMatchObject({ days: 0, binding: ["food.grain-dry", "food.ready", "fuel.propane", "water.stored"] });
  });

  it("gives a lower draw only what each higher draw leaves after its own days", () => {
    // The draw "net" takes x first, then w: 4 + 10 = 14 Wh at 2 Wh a day is 7 days. It keeps back all of x and w, so "host" holds 0 days.
    const layer: EnduranceLayer = {
      schema: SAMPLE_ENDURANCE.schema,
      levels: ["critical", "normal"],
      resources: [{ code: "w", unit: "Wh" }, { code: "x", unit: "Wh" }],
      stores: [{ id: "a", resource: "w", amount: 10 }, { id: "b", resource: "x", amount: 4 }],
      draws: [
        { need: "net", level: "critical", perDay: 2, supply: "grid" },
        { need: "host", level: "normal", perDay: 1, supply: "grid" },
      ],
      direct: [{ resource: "x", need: "net", amount: 1 }, { resource: "w", need: "host", amount: 1 }, { resource: "w", need: "net", amount: 1 }],
    };
    const cut: CaseCuts = { case: "c", title: "Cut", cuts: [{ part: "grid", title: "Grid", duration: [[0, 1], [1, 0]], source: "s" }] };
    const result = enduranceOf(layer, cut, { at: AT });
    expect(result.needs["net"]).toMatchObject({ days: expect.closeTo(7, 9), binding: ["w", "x"] });
    expect(result.needs["host"]).toMatchObject({ days: 0, binding: ["w"] });
    expect(result.needs["net"]?.takes["x"]).toBeCloseTo(4, 9);
    expect(result.needs["net"]?.takes["w"]).toBeCloseTo(10, 9);
    expect(result.needs["host"]?.takes).toEqual({});
    // With no use of w for "net", "net" holds 2 days on x. Then "host" has all of w, 10 days.
    const apart = enduranceOf({ ...layer, direct: layer.direct?.slice(0, 2) }, cut, { at: AT });
    expect(apart.needs["net"]?.days).toBeCloseTo(2, 9);
    expect(apart.needs["host"]?.days).toBeCloseTo(10, 9);
  });
});

describe("the laws of enduranceOf", () => {
  const scale = fc.double({ min: 0.1, max: 10, noNaN: true });

  it("multiplies each days by k when each store is k times larger", () => {
    fc.assert(
      fc.property(scale, (k) => {
        const larger: EnduranceLayer = { ...SAMPLE_ENDURANCE, stores: SAMPLE_ENDURANCE.stores.map((store) => ({ ...store, amount: store.amount * k })) };
        const base = enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT });
        const got = enduranceOf(larger, storm, { at: AT });
        for (const [need, held] of Object.entries(base.needs)) expect(got.needs[need]?.days).toBeCloseTo(held.days * k, 6);
      }),
    );
  });

  it("keeps each days when each store and each rate are k times larger", () => {
    fc.assert(
      fc.property(scale, (k) => {
        const larger: EnduranceLayer = {
          ...SAMPLE_ENDURANCE,
          stores: SAMPLE_ENDURANCE.stores.map((store) => ({ ...store, amount: store.amount * k })),
          draws: SAMPLE_ENDURANCE.draws.map((draw) => ({ ...draw, perDay: draw.perDay * k })),
        };
        const base = enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT });
        const got = enduranceOf(larger, storm, { at: AT });
        for (const [need, held] of Object.entries(base.needs)) expect(got.needs[need]?.days).toBeCloseTo(held.days, 6);
      }),
    );
  });

  it("never gives the first draw less when a store is larger", () => {
    // A lower draw can get less: a higher draw that holds longer keeps back more of a shared input.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: SAMPLE_ENDURANCE.stores.length - 1 }), fc.double({ min: 0, max: 100, noNaN: true }), (index, more) => {
        const larger: EnduranceLayer = { ...SAMPLE_ENDURANCE, stores: SAMPLE_ENDURANCE.stores.map((store, at) => (at === index ? { ...store, amount: store.amount + more } : store)) };
        const base = enduranceOf(SAMPLE_ENDURANCE, storm, { at: AT });
        const got = enduranceOf(larger, storm, { at: AT });
        const [need, held] = Object.entries(base.needs)[0] ?? ["", { days: 0 }];
        expect(got.needs[need]?.days ?? 0).toBeGreaterThanOrEqual(held.days - 1e-6);
      }),
    );
  });
});

describe("the takes of a case", () => {
  /**
   * This function gives the need that the takes of a draw give: the direct takes times their amount, and the runs of each converter times its gift.
   * Each resource of the takes is in one way of the need only, so the takes tell the runs of each converter.
   */
  function given(layer: EnduranceLayer, need: string, takes: Readonly<Record<string, number>>): number {
    const direct = (layer.direct ?? []).filter((use) => use.need === need);
    const converters = (layer.converters ?? []).filter((converter) => giftNeed(converter) === need);
    let total = direct.reduce((sum, use) => sum + (takes[use.resource] ?? 0) * use.amount, 0);
    for (const converter of converters) {
      const runs = converter.takes.map((input) => (takes[input.resource] ?? 0) / input.amount);
      for (const run of runs) expect(run, converter.id).toBeCloseTo(runs[0] ?? 0, 6);
      total += (runs[0] ?? 0) * converter.gives.amount;
    }
    return total;
  }

  /** This function tells if the takes of all the draws of a case are not more than the stores, and if each draw gets its days times its demand. */
  function takesFit(layer: EnduranceLayer, caseCuts: CaseCuts, options: { stack?: Stack } = {}): void {
    const result = enduranceOf(layer, caseCuts, { at: AT, ...options });
    const stores = storeAmounts(layer, AT, caseStopped(caseCuts, options));
    const total = new Map<string, number>();
    for (const held of Object.values(result.needs)) for (const [resource, amount] of Object.entries(held.takes)) total.set(resource, (total.get(resource) ?? 0) + amount);
    for (const [resource, taken] of total) expect(taken, resource).toBeLessThanOrEqual((stores.get(resource) ?? 0) * (1 + 1e-9) + 1e-9);
    for (const draw of layer.draws) {
      const held = result.needs[draw.need];
      if (held === undefined) continue;
      const want = held.days * drawDemand(draw, caseCuts);
      expect(Math.abs(given(layer, draw.need, held.takes) - want), draw.need).toBeLessThanOrEqual(1e-6 * Math.max(1, want));
    }
  }

  it("never takes more than the stores in the storm, also when each store is smaller", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: SAMPLE_ENDURANCE.stores.length, maxLength: SAMPLE_ENDURANCE.stores.length }), (parts) => {
        takesFit({ ...SAMPLE_ENDURANCE, stores: SAMPLE_ENDURANCE.stores.map((store, at) => ({ ...store, amount: store.amount * (parts[at] ?? 1) })) }, storm);
      }),
    );
  });

  it("never takes more than the stores with draws out of level order, a shared converter input and a store on a cut part", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 20, noNaN: true }), fc.double({ min: 0, max: 20, noNaN: true }), fc.double({ min: 0, max: 20, noNaN: true }), (w, x, y) => {
        const layer: EnduranceLayer = {
          schema: SAMPLE_ENDURANCE.schema,
          levels: ["critical", "normal"],
          resources: [{ code: "w", unit: "Wh" }, { code: "x", unit: "Wh" }],
          stores: [{ id: "a", resource: "w", amount: w }, { id: "b", resource: "x", amount: x }, { id: "c", resource: "w", amount: y, part: "grid" }],
          draws: [
            { need: "host", level: "normal", perDay: 1, supply: "grid" },
            { need: "net", level: "critical", perDay: 2, supply: "grid" },
          ],
          direct: [{ resource: "w", need: "host", amount: 1 }],
          converters: [{ id: "mix", takes: [{ resource: "x", amount: 1 }, { resource: "w", amount: 1 }], gives: { need: "net", amount: 1 } }],
        };
        takesFit(layer, { case: "c", title: "Cut", cuts: [{ part: "grid", title: "Grid", duration: [[0, 1], [1, 0]], source: "s" }] });
      }),
    );
  });
});

describe("a converter that gives a resource", () => {
  const GRID_CUT: CaseCuts = { case: "c", title: "Cut", cuts: [{ part: "grid", title: "Grid", duration: [[0, 1], [1, 0]], source: "s" }] };
  /** A generator changes 1 L of fuel into 3000 Wh of the battery. The power takes 1000 Wh each day from the battery. */
  function generatorLayer(fuel: number, battery: number): EnduranceLayer {
    return {
      schema: SAMPLE_ENDURANCE.schema,
      levels: ["critical", "normal"],
      resources: [{ code: "fuel", unit: "L" }, { code: "battery", unit: "Wh" }],
      stores: [{ id: "can", resource: "fuel", amount: fuel }, { id: "pack", resource: "battery", amount: battery }],
      draws: [
        { need: "power", level: "critical", perDay: 1000, supply: "grid" },
        { need: "warmth", level: "normal", perDay: 500, supply: "grid" },
      ],
      direct: [{ resource: "battery", need: "power", amount: 1 }],
      converters: [
        { id: "generator", device: "gen", takes: [{ resource: "fuel", amount: 1 }], gives: { resource: "battery", amount: 3000 } },
        { id: "heater", takes: [{ resource: "battery", amount: 1 }], gives: { need: "warmth", amount: 1 } },
      ],
    };
  }

  it("takes the stock of the battery first, then the fuel through the generator", () => {
    const result = enduranceOf(generatorLayer(10, 1000), GRID_CUT, { at: AT });
    // (1000 Wh + 10 L x 3000 Wh) / 1000 Wh a day = 31 days. The power takes all, so the warmth gets nothing.
    expect(result.needs["power"]?.days).toBeCloseTo(31, 9);
    expect(result.needs["power"]?.takes["battery"]).toBeCloseTo(1000, 9);
    expect(result.needs["power"]?.takes["fuel"]).toBeCloseTo(10, 9);
    expect(result.needs["power"]?.binding).toEqual(["battery", "fuel"]);
    expect(result.needs["warmth"]?.days).toBe(0);
    expect(result.needs["warmth"]?.binding).toEqual(["battery", "fuel"]);
  });

  it("runs a chain of two converters, and gives only the stock when the generator is down", () => {
    // With no power draw, the heater takes the battery and the generator: 31000 Wh / 500 Wh a day = 62 days.
    const layer = generatorLayer(10, 1000);
    const alone: EnduranceLayer = { ...layer, draws: layer.draws.filter((draw) => draw.need === "warmth") };
    expect(enduranceOf(alone, GRID_CUT, { at: AT }).needs["warmth"]?.days).toBeCloseTo(62, 9);
    expect(enduranceOf(alone, GRID_CUT, { at: AT, down: ["gen"] }).needs["warmth"]?.days).toBeCloseTo(2, 9);
    expect(enduranceOf(layer, GRID_CUT, { at: AT, down: ["gen"] }).needs["power"]).toMatchObject({ days: 1, binding: ["battery"] });
  });

  it("finds the runs when two inputs come from one resource", () => {
    // Each kit takes 1 a and 1 b, and each of them takes 1 L of fuel. So 10 L give 5 kits, not 10.
    const layer: EnduranceLayer = {
      schema: SAMPLE_ENDURANCE.schema,
      levels: ["critical"],
      resources: [{ code: "fuel", unit: "L" }, { code: "a", unit: "u" }, { code: "b", unit: "u" }],
      stores: [{ id: "can", resource: "fuel", amount: 10 }],
      draws: [{ need: "kit", level: "critical", perDay: 1, supply: "grid" }],
      converters: [
        { id: "make-a", takes: [{ resource: "fuel", amount: 1 }], gives: { resource: "a", amount: 1 } },
        { id: "make-b", takes: [{ resource: "fuel", amount: 1 }], gives: { resource: "b", amount: 1 } },
        { id: "kit", takes: [{ resource: "a", amount: 1 }, { resource: "b", amount: 1 }], gives: { need: "kit", amount: 1 } },
      ],
    };
    const result = enduranceOf(layer, GRID_CUT, { at: AT });
    expect(result.needs["kit"]?.days).toBeCloseTo(5, 6);
    expect(result.needs["kit"]?.takes["fuel"]).toBeCloseTo(10, 6);
    // a and b are made only by converters, with no store, so they are not binding.
    expect(result.needs["kit"]?.binding).toEqual(["fuel"]);
  });

  it("has a gift of a need or of a resource, not of the two", () => {
    // @ts-expect-error A gift has a need or a resource, not the two.
    const both: Gift = { need: "a", resource: "b", amount: 1 };
    expect(both.amount).toBe(1);
  });

  it("takes the makers in the order of the layer, which is a rule and not the best share", () => {
    // a comes from fuel first, then from wood. b comes only from fuel. The best share makes a from wood and gives 10 kits.
    // The order takes the fuel for a first, so a kit takes 2 L of fuel, and 10 L give 5 kits.
    const layer: EnduranceLayer = {
      schema: SAMPLE_ENDURANCE.schema,
      levels: ["critical"],
      resources: [{ code: "fuel", unit: "L" }, { code: "wood", unit: "kg" }, { code: "a", unit: "u" }, { code: "b", unit: "u" }],
      stores: [{ id: "can", resource: "fuel", amount: 10 }, { id: "pile", resource: "wood", amount: 10 }],
      draws: [{ need: "kit", level: "critical", perDay: 1, supply: "grid" }],
      converters: [
        { id: "a-from-fuel", takes: [{ resource: "fuel", amount: 1 }], gives: { resource: "a", amount: 1 } },
        { id: "a-from-wood", takes: [{ resource: "wood", amount: 1 }], gives: { resource: "a", amount: 1 } },
        { id: "b-from-fuel", takes: [{ resource: "fuel", amount: 1 }], gives: { resource: "b", amount: 1 } },
        { id: "kit", takes: [{ resource: "a", amount: 1 }, { resource: "b", amount: 1 }], gives: { need: "kit", amount: 1 } },
      ],
    };
    expect(enduranceOf(layer, GRID_CUT, { at: AT }).needs["kit"]?.days).toBeCloseTo(5, 6);
  });

  it("gives each draw its days times its demand, and takes no more than the stores, for each amount", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 50, noNaN: true }), fc.double({ min: 0, max: 50_000, noNaN: true }), (fuel, battery) => {
        const result = enduranceOf(generatorLayer(fuel, battery), GRID_CUT, { at: AT });
        const power = result.needs["power"];
        const warmth = result.needs["warmth"];
        if (power === undefined || warmth === undefined) throw new Error("The cut stops both draws.");
        const used = (resource: string): number => (power.takes[resource] ?? 0) + (warmth.takes[resource] ?? 0);
        expect(used("fuel")).toBeLessThanOrEqual(fuel * (1 + 1e-9) + 1e-9);
        expect(used("battery")).toBeLessThanOrEqual(battery * (1 + 1e-9) + 1e-9);
        // Each Wh of the draws comes from the battery stock or from 3000 Wh for each L of fuel.
        const given = (takes: Readonly<Record<string, number>>): number => (takes["battery"] ?? 0) + (takes["fuel"] ?? 0) * 3000;
        expect(given(power.takes)).toBeCloseTo(power.days * 1000, 4);
        expect(given(warmth.takes)).toBeCloseTo(warmth.days * 500, 4);
        expect(power.days).toBeCloseTo((battery + fuel * 3000) / 1000, 6);
      }),
    );
  });

  it("never gives the power fewer days with more fuel", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 50, noNaN: true }), fc.double({ min: 0, max: 50, noNaN: true }), (fuel, more) => {
        const days = (amount: number): number => enduranceOf(generatorLayer(amount, 500), GRID_CUT, { at: AT }).needs["power"]?.days ?? 0;
        expect(days(fuel + more)).toBeGreaterThanOrEqual(days(fuel) * (1 - 1e-9));
      }),
    );
  });
});

describe("a converter with a limit for each day", () => {
  const GRID_CUT: CaseCuts = { case: "c", title: "Cut", cuts: [{ part: "grid", title: "Grid", duration: [[0, 1], [1, 0]], source: "s" }] };
  /**
   * The food takes 3000 kcal each day: 5000 kcal of peanut butter with no cooking, then the pots of a stove.
   * One pot takes 1 kg of rice and gives 1000 kcal.
   */
  function cookLayer(rice: number, stove: Partial<Converter> = {}): EnduranceLayer {
    return {
      schema: SAMPLE_ENDURANCE.schema,
      levels: ["critical"],
      resources: [{ code: "rice", unit: "kg" }, { code: "pb", unit: "kcal" }],
      stores: [{ id: "sack", resource: "rice", amount: rice }, { id: "jar", resource: "pb", amount: 5000 }],
      draws: [{ need: "food", level: "critical", perDay: 3000, supply: "grid" }],
      direct: [{ resource: "pb", need: "food", amount: 1 }],
      converters: [{ id: "stove", takes: [{ resource: "rice", amount: 1 }], gives: { need: "food", amount: 1000 }, ...stove }],
    };
  }

  it("gives the same result as before with no perDay and no devices, on the sample and on each layer of these tests", () => {
    const blank = (layer: EnduranceLayer): EnduranceLayer => ({
      ...layer,
      converters: layer.converters?.map((converter) => ({ ...converter, perDay: undefined, devices: undefined })),
    });
    for (const item of [storm, fire]) {
      const before = enduranceOf(SAMPLE_ENDURANCE, item, { at: AT });
      expect(enduranceOf(blank(SAMPLE_ENDURANCE), item, { at: AT })).toEqual(before);
      for (const need of Object.values(before.needs)) expect(need).not.toHaveProperty("capped");
    }
    expect(enduranceOf(blank(cookLayer(20)), GRID_CUT, { at: AT })).toEqual(enduranceOf(cookLayer(20), GRID_CUT, { at: AT }));
    const food = enduranceOf(cookLayer(20), GRID_CUT, { at: AT }).needs["food"];
    expect(food?.days).toBeCloseTo(25 / 3, 9);
    expect(food).toMatchObject({ binding: ["pb", "rice"], takes: { pb: 5000, rice: 20 } });
  });

  it("changes no days when the limit is more than the runs that the draws can take", () => {
    const wide = (layer: EnduranceLayer): EnduranceLayer => ({ ...layer, converters: layer.converters?.map((converter) => ({ ...converter, perDay: 1e9 })) });
    for (const item of [storm, fire]) {
      const before = enduranceOf(SAMPLE_ENDURANCE, item, { at: AT });
      const after = enduranceOf(wide(SAMPLE_ENDURANCE), item, { at: AT });
      for (const [need, result] of Object.entries(before.needs)) {
        expect(after.needs[need]?.days).toBeCloseTo(result.days, 6);
        expect(after.needs[need]?.binding).toEqual(result.binding);
        expect(after.needs[need]).not.toHaveProperty("capped");
      }
    }
  });

  it("stops the draw at the limit, while the stove has rice, and names the converter in capped", () => {
    // 2 pots a day give 2000 kcal, so the peanut butter gives the other 1000 kcal: 5000 / 1000 = 5 days. 10 kg of rice stay.
    const result = enduranceOf(cookLayer(20, { perDay: 2 }), GRID_CUT, { at: AT }).needs["food"];
    expect(result?.days).toBeCloseTo(5, 9);
    expect(result?.binding).toEqual(["pb"]);
    expect(result?.capped).toEqual(["stove"]);
    expect(result?.takes["rice"]).toBeCloseTo(10, 9);
  });

  it("multiplies the limit by the count of devices", () => {
    // 2 stoves give 4 pots a day, more than the draw needs. The rice and the peanut butter end together at 25 / 3 days.
    const result = enduranceOf(cookLayer(20, { perDay: 2, devices: 2 }), GRID_CUT, { at: AT }).needs["food"];
    expect(result?.days).toBeCloseTo(25 / 3, 9);
    expect(result?.binding).toEqual(["pb", "rice"]);
    expect(result).not.toHaveProperty("capped");
  });

  it("gives no runs with a limit of 0, and stops all the devices when the part of the device stops", () => {
    const zero = enduranceOf(cookLayer(20, { perDay: 0 }), GRID_CUT, { at: AT }).needs["food"];
    expect(zero?.days).toBeCloseTo(5 / 3, 9);
    expect(zero?.capped).toEqual(["stove"]);
    const down = enduranceOf(cookLayer(20, { device: "stove-1", perDay: 2, devices: 3 }), GRID_CUT, { at: AT, down: ["stove-1"] }).needs["food"];
    expect(down?.days).toBeCloseTo(5 / 3, 9);
    expect(down).not.toHaveProperty("capped");
  });

  it("shares the days of one device between its converters", () => {
    // A converter for rice and a converter for beans on one stove: 2 pots a day in all, not 2 pots of each.
    const layer = cookLayer(20, { device: "stove", perDay: 2 });
    const beans: EnduranceLayer = {
      ...layer,
      resources: [...layer.resources, { code: "beans", unit: "kg" }],
      stores: [...layer.stores, { id: "bag", resource: "beans", amount: 20 }],
      converters: [...(layer.converters ?? []), { id: "stove-beans", device: "stove", perDay: 2, takes: [{ resource: "beans", amount: 1 }], gives: { need: "food", amount: 1000 } }],
    };
    const result = enduranceOf(beans, GRID_CUT, { at: AT }).needs["food"];
    expect(result?.days).toBeCloseTo(5, 9);
    expect(result?.capped).toEqual(["stove", "stove-beans"]);
  });

  it("gives a higher draw its runs first, and keeps them back for all the days of a lower draw", () => {
    // The stove cooks milk for the child (critical) and rice for the adult (normal), 2 pots a day in all.
    // The child takes 1 pot a day for 10 days, so the adult gets 1 pot a day: 3000 T = 5000 + 1000 T gives T = 2.5.
    function family(milk: number): EnduranceLayer {
      const layer = cookLayer(100, { device: "stove", perDay: 2 });
      return {
        ...layer,
        levels: ["critical", "normal"],
        resources: [...layer.resources, { code: "milk", unit: "kg" }],
        stores: [...layer.stores, { id: "tin", resource: "milk", amount: milk }],
        draws: [
          { need: "child", level: "critical", perDay: 1000, supply: "grid" },
          { need: "food", level: "normal", perDay: 3000, supply: "grid" },
        ],
        converters: [...(layer.converters ?? []), { id: "stove-milk", device: "stove", perDay: 2, takes: [{ resource: "milk", amount: 1 }], gives: { need: "child", amount: 1000 } }],
      };
    }
    const result = enduranceOf(family(10), GRID_CUT, { at: AT });
    expect(result.needs["child"]?.days).toBeCloseTo(10, 9);
    expect(result.needs["child"]?.binding).toEqual(["milk"]);
    expect(result.needs["food"]?.days).toBeCloseTo(2.5, 9);
    expect(result.needs["food"]?.capped).toEqual(["stove"]);
    // With 1 kg of milk, the child holds 1 day, but its pot stays kept back for each day of the adult. This is the safe side.
    expect(enduranceOf(family(1), GRID_CUT, { at: AT }).needs["food"]?.days).toBeCloseTo(2.5, 9);
    // With no child, the adult gets 2 pots a day: 3000 T = 5000 + 2000 T gives T = 5.
    const alone = family(10);
    expect(enduranceOf({ ...alone, draws: alone.draws.filter((draw) => draw.need === "food") }, GRID_CUT, { at: AT }).needs["food"]?.days).toBeCloseTo(5, 9);
  });

  /** A stove boils raw water to make it safe, and cooks 1 kg of rice with 1 L of safe water. Peanut butter gives 5000 kcal. */
  function chainLayer(boil: Partial<Converter>, cook: Partial<Converter>): EnduranceLayer {
    const layer = cookLayer(100);
    return {
      ...layer,
      resources: [...layer.resources, { code: "raw", unit: "L" }, { code: "safe", unit: "L" }],
      stores: [...layer.stores, { id: "barrel", resource: "raw", amount: 100 }],
      converters: [
        { id: "boil", takes: [{ resource: "raw", amount: 1 }], gives: { resource: "safe", amount: 1 }, ...boil },
        { id: "cook", takes: [{ resource: "safe", amount: 1 }, { resource: "rice", amount: 1 }], gives: { need: "food", amount: 1000 }, ...cook },
      ],
    };
  }

  it("gives a maker and its taker on one device only the days of the device", () => {
    // One pot takes 1/4 + 1/4 of a day of the stove, so 2 pots a day: 5000 / (3000 - 2000) = 5 days.
    const even = enduranceOf(chainLayer({ device: "stove", perDay: 4 }, { device: "stove", perDay: 4 }), GRID_CUT, { at: AT }).needs["food"];
    expect(even?.days).toBeCloseTo(5, 6);
    expect(even?.capped).toEqual(["boil", "cook"]);
    // One pot takes 1/2 + 1/8 of a day, so 1.6 pots a day: 5000 / (3000 - 1600) = 25/7 days.
    const uneven = enduranceOf(chainLayer({ device: "stove", perDay: 2 }, { device: "stove", perDay: 8 }), GRID_CUT, { at: AT }).needs["food"];
    expect(uneven?.days).toBeCloseTo(25 / 7, 6);
    // With the boil on a kettle, the stove cooks 4 pots a day. The 100 L of raw water end at (5000 + 100000) / 3000 = 35 days.
    const kettle = enduranceOf(chainLayer({ device: "kettle", perDay: 4 }, { device: "stove", perDay: 4 }), GRID_CUT, { at: AT }).needs["food"];
    expect(kettle?.days).toBeCloseTo(35, 6);
    expect(kettle).not.toHaveProperty("capped");
  });

  it("never uses more days of a device than it has in a chain on one device", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 10, noNaN: true }), fc.double({ min: 0.1, max: 10, noNaN: true }), fc.integer({ min: 1, max: 3 }), (boil, cook, devices) => {
        const result = enduranceOf(chainLayer({ device: "stove", perDay: boil, devices }, { device: "stove", perDay: cook, devices }), GRID_CUT, { at: AT }).needs["food"];
        const days = result?.days ?? 0;
        // Each L of raw water is one boil, and each kg of rice is one pot.
        const used = (result?.takes["raw"] ?? 0) / boil + (result?.takes["rice"] ?? 0) / cook;
        expect(used).toBeLessThanOrEqual(devices * days * (1 + 1e-6) + 1e-9);
        expect(result?.takes["raw"] ?? 0).toBeLessThanOrEqual(100 * (1 + 1e-9));
      }),
    );
  });

  it("never gives more days with a limit, nor more days with fewer devices, and takes no more than the stores and the limit", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 60, noNaN: true }), fc.double({ min: 0, max: 5, noNaN: true }), fc.integer({ min: 1, max: 4 }), (rice, perDay, devices) => {
        const run = (stove: Partial<Converter>) => enduranceOf(cookLayer(rice, stove), GRID_CUT, { at: AT }).needs["food"];
        const one = run({ perDay, devices });
        const days = one?.days ?? 0;
        expect(days).toBeLessThanOrEqual((run({})?.days ?? 0) * (1 + 1e-9) + 1e-9);
        expect(days).toBeLessThanOrEqual((run({ perDay, devices: devices + 1 })?.days ?? 0) * (1 + 1e-9) + 1e-9);
        expect(one?.takes["rice"] ?? 0).toBeLessThanOrEqual(Math.min(rice, perDay * devices * days) * (1 + 1e-9) + 1e-9);
        expect(one?.takes["pb"] ?? 0).toBeLessThanOrEqual(5000 * (1 + 1e-9));
      }),
    );
  });
});

describe("two limited converters of one device", () => {
  const GRID_CUT: CaseCuts = { case: "c", title: "Cut", cuts: [{ part: "grid", title: "Grid", duration: [[0, 1], [1, 0]], source: "s" }] };
  /**
   * The food takes 3000 kcal each day: 5000 kcal of peanut butter, then the pots of one stove. One pot gives 1000 kcal.
   * The stove cooks `slow` pots of oats or `fast` pots of rice in a day. The oats come first in the list.
   */
  function stoveLayer(oats: number, slow: number, fast: number, rice = 100): EnduranceLayer {
    return {
      schema: SAMPLE_ENDURANCE.schema,
      levels: ["critical"],
      resources: [{ code: "oats", unit: "kg" }, { code: "rice", unit: "kg" }, { code: "pb", unit: "kcal" }],
      stores: [{ id: "tin", resource: "oats", amount: oats }, { id: "sack", resource: "rice", amount: rice }, { id: "jar", resource: "pb", amount: 5000 }],
      draws: [{ need: "food", level: "critical", perDay: 3000, supply: "grid" }],
      direct: [{ resource: "pb", need: "food", amount: 1 }],
      converters: [
        { id: "oats", device: "stove", perDay: slow, takes: [{ resource: "oats", amount: 1 }], gives: { need: "food", amount: 1000 } },
        { id: "rice", device: "stove", perDay: fast, takes: [{ resource: "rice", amount: 1 }], gives: { need: "food", amount: 1000 } },
      ],
    };
  }

  it("gives the device-days to the faster converter, not to the first converter of the list", () => {
    // The take order gave the stove to the oats first: 1 pot a day, so 5000 / (3000 - 1000) = 2.5 days.
    // The best share cooks only rice: 2 pots a day, so 5000 / (3000 - 2000) = 5 days.
    const result = enduranceOf(stoveLayer(10, 1, 2), GRID_CUT, { at: AT }).needs["food"];
    expect(result?.days).toBe(5);
    expect(result?.binding).toEqual(["pb"]);
    expect(result?.takes).toEqual({ pb: 5000, rice: 10 });
    expect(result?.capped).toEqual(["oats", "rice"]);
    // With 1 kg of oats, the take order gave 4 days. The best share also gives 5 days.
    expect(enduranceOf(stoveLayer(1, 1, 2), GRID_CUT, { at: AT }).needs["food"]?.days).toBe(5);
  });

  it("gives the days of the best share for one draw, and never fewer days with more stock or a larger limit", () => {
    fc.assert(
      fc.property(
        // The values are in tenths: the exact simplex keeps small rationals, and each case solves in a short time.
        fc.integer({ min: 0, max: 200 }).map((n) => n / 10),
        fc.integer({ min: 1, max: 50 }).map((n) => n / 10),
        fc.integer({ min: 1, max: 50 }).map((n) => n / 10),
        fc.integer({ min: 0, max: 400 }).map((n) => n / 10),
        (oats, slow, fast, rice) => {
          const days = (layer: EnduranceLayer): number => enduranceOf(layer, GRID_CUT, { at: AT }).needs["food"]?.days ?? Number.NaN;
          const base = days(stoveLayer(oats, slow, fast, rice));
          expect(base).toBeCloseTo(jointDays(stoveLayer(oats, slow, fast, rice), GRID_CUT, { at: AT }, ["food"]).days, 9);
          expect(days(stoveLayer(oats + 1, slow, fast, rice))).toBeGreaterThanOrEqual(base * (1 - 1e-12));
          expect(days(stoveLayer(oats, slow, fast, rice + 1))).toBeGreaterThanOrEqual(base * (1 - 1e-12));
          expect(days(stoveLayer(oats, slow, fast * 2, rice))).toBeGreaterThanOrEqual(base * (1 - 1e-12));
        },
      ),
      { seed: 20_261_124, numRuns: 60 },
    );
  });

  it("keeps back the device-days of a higher draw for a lower draw with a shared stove", () => {
    // The child (critical) takes 1 pot of milk a day for 10 days, so the food gets 1 day of the stove each day, not 2.
    // The rice cooks 2 pots in that day, more than the oats: 5000 / (3000 - 2000) = 5 days with a stove of 2 devices.
    const layer = stoveLayer(10, 1, 2);
    const family: EnduranceLayer = {
      ...layer,
      levels: ["critical", "normal"],
      resources: [...layer.resources, { code: "milk", unit: "kg" }],
      stores: [...layer.stores, { id: "can", resource: "milk", amount: 10 }],
      draws: [{ need: "child", level: "critical", perDay: 1000, supply: "grid" }, { need: "food", level: "normal", perDay: 3000, supply: "grid" }],
      converters: [
        ...(layer.converters ?? []).map((converter) => ({ ...converter, devices: 2 })),
        { id: "milk", device: "stove", devices: 2, perDay: 1, takes: [{ resource: "milk", amount: 1 }], gives: { need: "child", amount: 1000 } },
      ],
    };
    const result = enduranceOf(family, GRID_CUT, { at: AT });
    expect(result.needs["child"]?.days).toBeCloseTo(10, 9);
    expect(result.needs["food"]?.days).toBe(5);
    expect(result.needs["food"]?.takes).toEqual({ pb: 5000, rice: 10 });
  });
});

describe("a stack with no layer parts", () => {
  it("is a valid base stack for the queries", () => {
    const empty: Stack = { schema: STACK_SCHEMA, parts: [] };
    expect(caseStopped(storm, { stack: empty })).toEqual(new Set(["grid", "road", "water-main"]));
  });
});
