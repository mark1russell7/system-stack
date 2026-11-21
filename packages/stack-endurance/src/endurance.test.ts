import { STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { caseStopped, enduranceOf, storeAmounts } from "./endurance.ts";
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
    expect(result.needs["hydration.drink"]).toEqual({ days: 0, binding: ["water.stored"] });
    expect(result.needs["food.energy"]).toEqual({ days: 0, binding: ["food.grain-dry", "food.ready", "fuel.propane", "water.stored"] });
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
    expect(result.needs["net"]).toEqual({ days: expect.closeTo(7, 9), binding: ["w", "x"] });
    expect(result.needs["host"]).toEqual({ days: 0, binding: ["w"] });
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
  /** This function replays the takes of the draws at their days, in the order of `enduranceOf`, and gives the take of each resource. */
  function totalTakes(layer: EnduranceLayer, caseCuts: CaseCuts): Map<string, number> {
    const result = enduranceOf(layer, caseCuts, { at: AT });
    const left = storeAmounts(layer, AT);
    const start = new Map(left);
    for (const draw of layer.draws) {
      const held = result.needs[draw.need];
      if (held === undefined) continue;
      let rest = held.days * draw.perDay * (caseCuts.factors?.[draw.need] ?? 1);
      for (const use of (layer.direct ?? []).filter((item) => item.need === draw.need)) {
        const got = Math.min(rest, (left.get(use.resource) ?? 0) * use.amount);
        left.set(use.resource, (left.get(use.resource) ?? 0) - got / use.amount);
        rest -= got;
      }
      for (const converter of (layer.converters ?? []).filter((item) => item.gives.need === draw.need)) {
        let runs = rest / converter.gives.amount;
        for (const input of converter.takes) runs = Math.min(runs, (left.get(input.resource) ?? 0) / input.amount);
        for (const input of converter.takes) left.set(input.resource, (left.get(input.resource) ?? 0) - runs * input.amount);
        rest -= runs * converter.gives.amount;
      }
      expect(rest, draw.need).toBeLessThanOrEqual(1e-6 * Math.max(1, held.days * draw.perDay));
    }
    return new Map([...start].map(([resource, amount]) => [resource, amount - (left.get(resource) ?? 0)]));
  }

  it("never takes more than the stores in the storm, also when each store is smaller", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: SAMPLE_ENDURANCE.stores.length, maxLength: SAMPLE_ENDURANCE.stores.length }), (parts) => {
        const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, stores: SAMPLE_ENDURANCE.stores.map((store, at) => ({ ...store, amount: store.amount * (parts[at] ?? 1) })) };
        const stores = storeAmounts(layer, AT);
        for (const [resource, taken] of totalTakes(layer, storm)) expect(taken).toBeLessThanOrEqual((stores.get(resource) ?? 0) * (1 + 1e-6) + 1e-9);
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
