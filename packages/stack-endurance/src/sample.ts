import { STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import { ENDURANCE_SCHEMA, type EnduranceLayer } from "./layer.ts";

// A sample: a building with 3 users, and a storm that cuts the grid, the road and the water main.
// Each name and each value is an example, except the grid curve (NREL, technical report 83092). The tests, the README files and the site use it.

/** The base stack of the sample: the supplies of the building and a camp stove. */
export const SAMPLE_ENDURANCE_STACK: Stack = {
  schema: STACK_SCHEMA,
  parts: [
    { id: "grid", kind: "power", name: "The power grid" },
    { id: "water-main", kind: "water", name: "The water main" },
    { id: "road", kind: "road", name: "The local road to the shops" },
    { id: "stove", kind: "device", name: "The camp stove" },
  ],
};

/**
 * The endurance layer of the sample.
 *
 * - The drinking water holds 75.7 L / 11.355 L a day = 6.667 days.
 * - The food holds 4800 / 5400 = 0.889 days. The rice needs 2 L of water for each kg, and the drinking water keeps back all the water.
 * - The power holds 1000 Wh / 150 Wh a day = 6.667 days.
 * - The filled bottles are past their due date, so they give nothing.
 */
export const SAMPLE_ENDURANCE: EnduranceLayer = {
  schema: ENDURANCE_SCHEMA,
  levels: ["life", "health", "comfort"],
  resources: [
    { code: "water.stored", unit: "L" },
    { code: "food.ready", unit: "kcal" },
    { code: "food.grain-dry", unit: "kg" },
    { code: "fuel.propane", unit: "kg" },
    { code: "energy.battery", unit: "Wh" },
  ],
  stores: [
    { id: "jugs", resource: "water.stored", amount: 75.7, due: "2028-06-01" },
    { id: "bottles", resource: "water.stored", amount: 20, due: "2026-09-30" },
    { id: "cans", resource: "food.ready", amount: 4800, due: "2028-10-01" },
    { id: "rice", resource: "food.grain-dry", amount: 9, due: "2036-09-28" },
    { id: "propane", resource: "fuel.propane", amount: 0.908, due: "2036-10-01" },
    { id: "battery", resource: "energy.battery", amount: 1000, due: "2031-10-01" },
  ],
  draws: [
    { need: "hydration.drink", level: "life", perDay: 11.355, users: 3, supply: "water-main" },
    { need: "food.energy", level: "health", perDay: 5400, users: 3, supply: "road" },
    { need: "power.electric", level: "comfort", perDay: 150, users: 3, supply: "grid" },
  ],
  direct: [
    { resource: "water.stored", need: "hydration.drink", amount: 1 },
    { resource: "food.ready", need: "food.energy", amount: 1 },
    { resource: "energy.battery", need: "power.electric", amount: 1 },
  ],
  converters: [
    {
      id: "cook-rice",
      device: "stove",
      takes: [
        { resource: "food.grain-dry", amount: 1 },
        { resource: "water.stored", amount: 2 },
        { resource: "fuel.propane", amount: 0.05 },
      ],
      gives: { need: "food.energy", amount: 3600 },
    },
  ],
  cases: [
    {
      case: "storm",
      title: "Winter storm",
      cuts: [
        { part: "grid", title: "Power outage", duration: [[0, 1], [0.5, 0.5], [1, 0.36], [7, 0.013], [30, 0]], source: "nrel-83092" },
        { part: "road", title: "Closed local road", duration: [[0, 1], [1, 0.6], [3, 0.2], [10, 0]], source: "sample" },
        { part: "water-main", title: "No water from the main", duration: [[0, 1], [2, 0.3], [7, 0]], source: "sample" },
      ],
      leadSeconds: 86_400,
    },
    { case: "fire", title: "Fire", cuts: [] },
  ],
  priors: [
    { case: "storm", place: "home", perYear: 0.8, reach: 1, source: "sample", asOf: "2025-12-01" },
    { case: "fire", place: "home", perYear: 0.003, reach: 1, source: "sample", asOf: "2025-12-01" },
  ],
};
