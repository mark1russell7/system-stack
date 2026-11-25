import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bestEndurance } from "./best.ts";
import { caseStopped, enduranceOf, storeAmounts } from "./endurance.ts";
import { jointDays } from "./joint.ts";
import { ENDURANCE_SCHEMA, type CaseCuts, type EnduranceLayer } from "./layer.ts";
import { SAMPLE_ENDURANCE } from "./sample.ts";
import { caseShortfall } from "./shortfall.ts";

const AT = "2026-12-01";
const SEED = { seed: 20_261_125, numRuns: 20 };
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

/** This function gives a made-up layer with the levels life and health, a unit of `u` for each resource, and the draws of `draws`. */
function layerOf(stores: Record<string, number>, draws: EnduranceLayer["draws"], rest: Pick<EnduranceLayer, "direct" | "converters">): EnduranceLayer {
  return {
    schema: ENDURANCE_SCHEMA,
    levels: ["life", "health"],
    resources: Object.keys(stores).map((code) => ({ code, unit: "u" })),
    stores: Object.entries(stores).map(([resource, amount]) => ({ id: resource, resource, amount })),
    draws,
    ...rest,
  };
}

describe("bestEndurance", () => {
  it("gives two draws of one level the leximin share, where the take order gives one draw all the water", () => {
    // The draw a can drink water or juice. The draw b can drink only water.
    const layer = layerOf(
      { water: 10, juice: 10 },
      [
        { need: "a", level: "life", perDay: 1, supply: "main" },
        { need: "b", level: "life", perDay: 1, supply: "main" },
      ],
      { direct: [{ resource: "water", need: "a", amount: 1 }, { resource: "juice", need: "a", amount: 1 }, { resource: "water", need: "b", amount: 1 }] },
    );
    const ordered = enduranceOf(layer, DRY, { at: AT });
    expect(ordered.needs["a"]?.days).toBeCloseTo(20, 9);
    expect(ordered.needs["b"]?.days).toBeCloseTo(0, 9);
    const best = bestEndurance(layer, DRY, { at: AT });
    expect(best.needs).toEqual({
      a: { days: 10, binding: ["juice", "water"], takes: { juice: 10 } },
      b: { days: 10, binding: ["water"], takes: { water: 10 } },
    });
  });

  it("keeps for a lower level the store that a higher draw does not need", () => {
    // The tea stops the drink at 5 days. It can brew with water or with juice. The wash needs water.
    const layer = layerOf(
      { tea: 5, water: 5, juice: 10 },
      [
        { need: "drink", level: "life", perDay: 1, supply: "main" },
        { need: "wash", level: "health", perDay: 1, supply: "main" },
      ],
      {
        direct: [{ resource: "water", need: "wash", amount: 1 }],
        converters: [
          { id: "brew-water", takes: [{ resource: "tea", amount: 1 }, { resource: "water", amount: 1 }], gives: { need: "drink", amount: 1 } },
          { id: "brew-juice", takes: [{ resource: "tea", amount: 1 }, { resource: "juice", amount: 1 }], gives: { need: "drink", amount: 1 } },
        ],
      },
    );
    const ordered = enduranceOf(layer, DRY, { at: AT });
    expect(ordered.needs["drink"]?.days).toBeCloseTo(5, 9);
    expect(ordered.needs["wash"]?.days).toBeCloseTo(0, 9);
    const best = bestEndurance(layer, DRY, { at: AT });
    expect(best.needs["drink"]).toEqual({ days: 5, binding: ["tea", "water"], takes: { tea: 5, juice: 5 } });
    expect(best.needs["wash"]).toEqual({ days: 5, binding: ["water"], takes: { water: 5 } });
  });

  it("gives a draw with its own store its own days after the floor of its level", () => {
    const layer = layerOf(
      { water: 10, pills: 30 },
      [
        { need: "drink", level: "life", perDay: 1, supply: "main" },
        { need: "medicine", level: "life", perDay: 1, supply: "shop" },
      ],
      { direct: [{ resource: "water", need: "drink", amount: 1 }, { resource: "pills", need: "medicine", amount: 1 }] },
    );
    const best = bestEndurance(layer, DRY, { at: AT });
    expect(best.needs["drink"]?.days).toBe(10);
    expect(best.needs["medicine"]?.days).toBe(30);
    expect(jointDays(layer, DRY, { at: AT }, ["drink", "medicine"]).days).toBe(10);
  });

  it("shares a device and a stock between two draws of one level", () => {
    // One stove makes 2 meals a day. Each draw needs 1 meal a day. The grain gives 100 meals.
    const layer = layerOf(
      { grain: 100 },
      [
        { need: "a", level: "life", perDay: 1, supply: "shop" },
        { need: "b", level: "life", perDay: 1, supply: "shop" },
      ],
      {
        converters: [
          { id: "cook-a", device: "stove", perDay: 2, takes: [{ resource: "grain", amount: 1 }], gives: { need: "a", amount: 1 } },
          { id: "cook-b", device: "stove", perDay: 2, takes: [{ resource: "grain", amount: 1 }], gives: { need: "b", amount: 1 } },
        ],
      },
    );
    const best = bestEndurance(layer, DRY, { at: AT });
    expect(best.needs["a"]).toEqual({ days: 50, binding: ["grain"], takes: { grain: 50 }, capped: ["cook-a"] });
    expect(best.needs["b"]).toEqual({ days: 50, binding: ["grain"], takes: { grain: 50 }, capped: ["cook-b"] });
  });

  it("keeps the device-days of a higher draw for all the days of a lower draw, as enduranceOf does", () => {
    // The stove makes 1 meal a day. The higher draw uses it for its 10 days, so the lower draw gets no meal.
    const layer = layerOf(
      { grain: 10, rice: 100 },
      [
        { need: "hot", level: "life", perDay: 1, supply: "shop" },
        { need: "warm", level: "health", perDay: 1, supply: "shop" },
      ],
      {
        converters: [
          { id: "cook-hot", device: "stove", perDay: 1, takes: [{ resource: "grain", amount: 1 }], gives: { need: "hot", amount: 1 } },
          { id: "cook-warm", device: "stove", perDay: 1, takes: [{ resource: "rice", amount: 1 }], gives: { need: "warm", amount: 1 } },
        ],
      },
    );
    const best = bestEndurance(layer, DRY, { at: AT });
    const ordered = enduranceOf(layer, DRY, { at: AT });
    expect(best.needs["hot"]?.days).toBe(10);
    expect(best.needs["warm"]?.days).toBe(0);
    expect(ordered.needs["hot"]?.days).toBeCloseTo(10, 9);
    expect(ordered.needs["warm"]?.days).toBeCloseTo(0, 9);
  });

  it("does not run a converter with a limit of 0", () => {
    const layer = layerOf(
      { grain: 10 },
      [{ need: "hot", level: "life", perDay: 1, supply: "shop" }],
      { converters: [{ id: "cook", device: "stove", perDay: 0, takes: [{ resource: "grain", amount: 1 }], gives: { need: "hot", amount: 1 } }] },
    );
    expect(bestEndurance(layer, DRY, { at: AT }).needs["hot"]).toEqual({ days: 0, binding: [], takes: {} });
  });

  it("gives Infinity to a draw with no end, and the other draws their days", () => {
    // The gate refuses this cycle. The function does not apply the gate, so the drink has no end.
    const layer = layerOf(
      { x: 1, water: 6 },
      [
        { need: "drink", level: "life", perDay: 1, supply: "main" },
        { need: "wash", level: "health", perDay: 2, supply: "main" },
      ],
      {
        direct: [{ resource: "y", need: "drink", amount: 1 }, { resource: "water", need: "wash", amount: 1 }],
        converters: [
          { id: "double", takes: [{ resource: "x", amount: 1 }], gives: { resource: "y", amount: 2 } },
          { id: "back", takes: [{ resource: "y", amount: 1 }], gives: { resource: "x", amount: 1 } },
        ],
      },
    );
    const best = bestEndurance(layer, DRY, { at: AT });
    expect(best.needs["drink"]).toEqual({ days: Infinity, binding: [], takes: {} });
    expect(best.needs["wash"]?.days).toBe(3);
  });

  it("leaves out a draw whose supply works, as enduranceOf does", () => {
    const layer = layerOf({ water: 10 }, [{ need: "drink", level: "life", perDay: 1, supply: "well" }], { direct: [{ resource: "water", need: "drink", amount: 1 }] });
    expect(bestEndurance(layer, DRY, { at: AT })).toEqual({ case: "dry", at: AT, needs: {} });
  });
});

describe("the laws of bestEndurance", () => {
  const storm = SAMPLE_ENDURANCE.cases?.find((item) => item.case === "storm") as CaseCuts;
  // The factors are multiples of 1/8, so the exact rationals stay small and each case is fast.
  const factors = fc.array(fc.integer({ min: 0, max: 16 }).map((n) => n / 8), { minLength: SAMPLE_ENDURANCE.stores.length, maxLength: SAMPLE_ENDURANCE.stores.length });

  it("keeps the takes under the stocks, gives the first floor of jointDays, and is not worse than enduranceOf for the first level", () => {
    fc.assert(
      fc.property(factors, (scale) => {
        const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, stores: SAMPLE_ENDURANCE.stores.map((store, at) => ({ ...store, amount: store.amount * (scale[at] ?? 1) })) };
        const best = bestEndurance(layer, storm, { at: AT });
        const stock = storeAmounts(layer, AT, caseStopped(storm, {}));
        const total = new Map<string, number>();
        for (const result of Object.values(best.needs)) for (const [resource, amount] of Object.entries(result.takes)) total.set(resource, (total.get(resource) ?? 0) + amount);
        for (const [resource, taken] of total) expect(taken, resource).toBeLessThanOrEqual((stock.get(resource) ?? 0) * (1 + 1e-12));
        const ordered = enduranceOf(layer, storm, { at: AT });
        const first = layer.draws.filter((draw) => draw.level === layer.levels[0] && draw.need in best.needs).map((draw) => draw.need);
        if (first.length === 0) return;
        const floor = Math.min(...first.map((need) => best.needs[need]?.days ?? 0));
        expect(floor).toBeCloseTo(jointDays(layer, storm, { at: AT }, first).days, 9);
        const orderedFloor = Math.min(...first.map((need) => ordered.needs[need]?.days ?? 0));
        expect(floor).toBeGreaterThanOrEqual(orderedFloor * (1 - 1e-9));
        for (const need of Object.keys(best.needs)) expect(best.needs[need]?.days, need).toBeLessThanOrEqual(jointDays(layer, storm, { at: AT }, [need]).days * (1 + 1e-12));
        expect(caseShortfall(layer, storm, best).unread).toEqual([]);
      }),
      SEED,
    );
  });
});
