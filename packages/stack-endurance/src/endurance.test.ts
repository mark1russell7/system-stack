import { STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { caseStopped, drawDemand, enduranceOf, storeAmounts } from "./endurance.ts";
import type { CaseCuts, EnduranceLayer } from "./layer.ts";
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
    const converters = (layer.converters ?? []).filter((converter) => converter.gives.need === need);
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

describe("a stack with no layer parts", () => {
  it("is a valid base stack for the queries", () => {
    const empty: Stack = { schema: STACK_SCHEMA, parts: [] };
    expect(caseStopped(storm, { stack: empty })).toEqual(new Set(["grid", "road", "water-main"]));
  });
});
