import { describe, expect, it } from "vitest";
import { bestEndurance } from "./best.ts";
import { ENDURANCE_SCHEMA, type CaseCuts, type Converter, type EnduranceLayer } from "./layer.ts";
import { drawBlock, partsOf, Program } from "./program.ts";

const AT = "2026-12-01";
const CURVE: [number, number][] = [[0, 1], [10, 0]];

/** A made-up case: it cuts the water main, the shop and the grid. */
const DARK: CaseCuts = {
  case: "dark",
  title: "No water, no shop and no grid",
  cuts: ["main", "shop", "grid"].map((part) => ({ part, title: `No ${part}`, duration: CURVE, source: "test" })),
};

const COOK: Converter = { id: "cook", takes: [{ resource: "rice", amount: 1 }, { resource: "water", amount: 2 }, { resource: "gas", amount: 1 }], gives: { need: "food", amount: 1 } };
const FILTER: Converter = { id: "filter", takes: [{ resource: "rain", amount: 1 }], gives: { resource: "water", amount: 1 } };
const CHARGER: Converter = { id: "charger", takes: [{ resource: "gas", amount: 1 }], gives: { resource: "battery", amount: 10 } };

/** A made-up layer: the drink takes water, the food is cooked, and the light takes the battery. The filter and the charger are makers. */
function layerOf(extra = 0): EnduranceLayer {
  const stores: Record<string, number> = { water: 10, rice: 20, gas: 6, rain: 4, battery: 5 };
  for (let index = 0; index < extra; index += 1) stores[`own${index}`] = 3;
  return {
    schema: ENDURANCE_SCHEMA,
    levels: ["life", "health"],
    resources: Object.keys(stores).map((code) => ({ code, unit: "u" })),
    stores: Object.entries(stores).map(([resource, amount]) => ({ id: resource, resource, amount })),
    draws: [
      { need: "drink", level: "life", perDay: 1, supply: "main" },
      { need: "food", level: "health", perDay: 1, supply: "shop" },
      { need: "light", level: "health", perDay: 2, supply: "grid" },
      ...Array.from({ length: extra }, (_, index) => ({ need: `own${index}`, level: "health", perDay: 1, supply: "grid" })),
    ],
    direct: [
      { resource: "water", need: "drink", amount: 1 },
      { resource: "battery", need: "light", amount: 1 },
      ...Array.from({ length: extra }, (_, index) => ({ resource: `own${index}`, need: `own${index}`, amount: 1 })),
    ],
    converters: [COOK, FILTER, CHARGER],
  };
}

describe("drawBlock", () => {
  const stock = new Map([["water", 10], ["rice", 20], ["gas", 6], ["rain", 4], ["battery", 5], ["spare", 9]]);
  const direct = [
    { resource: "water", need: "drink", amount: 1 },
    { resource: "battery", need: "light", amount: 1 },
  ];
  const parts = partsOf(stock, direct, [COOK], [FILTER, CHARGER]);

  it("gives a draw columns only for the resources and the makers that it can use", () => {
    const block = (need: string): ReturnType<typeof drawBlock> => drawBlock(new Program(), parts, { need, level: "life", perDay: 1, supply: "main" });
    const drink = block("drink");
    expect([...drink.shares.keys()]).toEqual(["rain", "water"]);
    expect([...drink.runs.keys()].map((converter) => converter.id)).toEqual(["filter"]);
    const food = block("food");
    expect([...food.shares.keys()]).toEqual(["gas", "rain", "rice", "water"]);
    expect([...food.runs.keys()].map((converter) => converter.id)).toEqual(["cook", "filter"]);
    const light = block("light");
    expect([...light.shares.keys()]).toEqual(["battery", "gas"]);
    expect([...light.runs.keys()].map((converter) => converter.id)).toEqual(["charger"]);
  });

  it("gives a draw the same count of columns with more resources that it cannot use", () => {
    const program = new Program();
    drawBlock(program, parts, { need: "drink", level: "life", perDay: 1, supply: "main" });
    const wide = new Map([...stock, ...Array.from({ length: 20 }, (_, index) => [`other${index}`, 1] as const)]);
    const wider = new Program();
    drawBlock(wider, partsOf(wide, [...direct, ...Array.from({ length: 20 }, (_, index) => ({ resource: `other${index}`, need: `other${index}`, amount: 1 }))], [COOK], [FILTER, CHARGER]), {
      need: "drink",
      level: "life",
      perDay: 1,
      supply: "main",
    });
    expect(wider.count).toBe(program.count);
    expect(wider.rows.length).toBe(program.rows.length);
  });
});

describe("bestEndurance with draws that share no resource", () => {
  it("gives each draw the same days with more draws of their own resources", () => {
    const base = bestEndurance(layerOf(), DARK, { at: AT, horizon: 30 });
    const wide = bestEndurance(layerOf(6), DARK, { at: AT, horizon: 30 });
    for (const need of ["drink", "food", "light"]) expect(wide.needs[need]).toEqual(base.needs[need]);
    for (let index = 0; index < 6; index += 1) expect(wide.needs[`own${index}`]?.days).toBe(3);
  });
});
