import { SUPPLY_CATALOG } from "@mark1russell7/market/supplies";
import { checkEndurance, enduranceOf, hasEnduranceError, joinEndurance, type CaseCuts, type EnduranceLayer } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import type { Person } from "./calorie.ts";
import { FOOD_NEED, foodFragment, NO_COOK, type FoodFragmentInput } from "./food.ts";

/** Two made-up adults of 33 years. Sedentary, they need 2400 + 1800 = 4200 kcal each day. */
const adults: Person[] = [
  { sex: "male", ageMonths: 33 * 12, count: 1 },
  { sex: "female", ageMonths: 33 * 12, count: 1 },
];
const DAILY = 4200;

/** 4 kg of dry rice and 2 kg of peanut butter. The catalog gives 5980 kcal for each kg of peanut butter. */
const units = { "food.rice-white-1kg": 4, "food.peanut-butter-1kg": 2 };
const PEANUT_KCAL = 2 * 5980;

const input: FoodFragmentInput = { persons: adults, activity: "sedentary", catalog: SUPPLY_CATALOG, units, supply: "food.retail", level: "critical", levels: ["critical"] };

/** A case that stops the food shops. */
const foodCut: CaseCuts = { case: "test.food-cut", title: "A test stop of the food shops", cuts: [{ part: "food.retail", title: "No food shops", source: "test" }] };
const at = "2026-11-22";

/**
 * A cooking converter of the test, with water and fuel. TEST VALUES: the 2 L of water and the 0.1 kg of fuel for each kg of rice have no source.
 * The 3650 kcal of each kg of rice is the cited energy of the catalog.
 */
function cookFragment(waterL: number, fuelKg: number): EnduranceLayer {
  return {
    schema: "endurance/1",
    levels: [],
    resources: [
      { code: "water.stored", unit: "L" },
      { code: "fuel.test", unit: "kg" },
    ],
    stores: [
      { id: "test:water", resource: "water.stored", amount: waterL },
      { id: "test:fuel", resource: "fuel.test", amount: fuelKg },
    ],
    draws: [],
    converters: [
      {
        id: "test:cook-rice",
        takes: [
          { resource: "food.grain-dry", amount: 1 },
          { resource: "water.stored", amount: 2 },
          { resource: "fuel.test", amount: 0.1 },
        ],
        gives: { need: FOOD_NEED, amount: 3650 },
      },
    ],
  };
}

/** The days of the food draw, from the food fragment joined with more fragments. */
function foodDays(...more: EnduranceLayer[]): number {
  const food: EnduranceLayer = foodFragment(input).layer;
  const join = joinEndurance([{ from: "food", layer: food }, ...more.map((layer, index) => ({ from: `more-${String(index)}`, layer }))]);
  if (!join.ok) throw new Error(JSON.stringify(join.errors));
  expect(hasEnduranceError(checkEndurance(join.layer))).toBe(false);
  const days = enduranceOf(join.layer, foodCut, { at }).needs[FOOD_NEED]?.days;
  if (days === undefined) throw new Error("The food draw has no result.");
  return days;
}

describe("the food fragment", () => {
  it("has one draw of the food energy of the household, and a store for each gift of the buy list", () => {
    const result = foodFragment(input);
    expect(result.read).toBe(true);
    expect(result.layer.draws).toEqual([{ need: FOOD_NEED, level: "critical", perDay: DAILY, users: 2, supply: "food.retail" }]);
    expect(result.layer.stores).toEqual([
      { id: "buy:food.rice-white-1kg:food.grain-dry", resource: "food.grain-dry", amount: 4 },
      { id: "buy:food.peanut-butter-1kg:food.no-cook", resource: NO_COOK, amount: PEANUT_KCAL },
    ]);
    expect(result.layer.resources).toEqual([
      { code: "food.grain-dry", unit: "kg" },
      { code: NO_COOK, unit: "kcal" },
    ]);
    expect(result.layer.direct).toEqual([{ resource: NO_COOK, need: FOOD_NEED, amount: 1 }]);
    expect(result.energy.energy.value).toBeCloseTo(4 * 3650 + PEANUT_KCAL, 6);
    expect(checkEndurance(result.layer)).toEqual([]);
  });

  it("gives stores of water in L and of each dry food in kg", () => {
    const result = foodFragment({ ...input, units: { "water.jug-1gal": 2, "food.pasta-dry-1kg": 1, "food.flour-white-1kg": 3 } });
    const amounts = Object.fromEntries(result.layer.stores.map((store) => [store.resource, store.amount]));
    expect(amounts["water.stored"]).toBeCloseTo(2 * 3.785411784, 6);
    expect(amounts).toMatchObject({ "food.pasta-dry": 1, "food.flour": 3 });
    expect(result.layer.resources.find((resource) => resource.code === "water.stored")?.unit).toBe("L");
  });

  it("keeps a person with no row as a no read, and the rate is then a lower limit", () => {
    const result = foodFragment({ ...input, persons: [...adults, { sex: "female", ageMonths: 6, count: 1 }] });
    expect(result.read).toBe(false);
    expect(result.need.read).toBe(false);
    expect(result.layer.draws[0]).toMatchObject({ perDay: DAILY, users: 3 });
  });

  it("uses the prefix of the store ids", () => {
    const result = foodFragment({ ...input, prefix: "home" });
    expect(result.layer.stores.map((store) => store.id)).toEqual(["home:food.rice-white-1kg:food.grain-dry", "home:food.peanut-butter-1kg:food.no-cook"]);
  });

  it("refuses a catalog with no no-cook food in kcal", () => {
    const catalog = { ...SUPPLY_CATALOG, resources: SUPPLY_CATALOG.resources.filter((resource) => resource.code !== NO_COOK) };
    expect(() => foodFragment({ ...input, catalog, units: {} })).toThrow(RangeError);
  });
});

describe("the food fragment in the endurance query", () => {
  it("gives the days of the peanut butter alone with no converter: the worst case of no water and no fuel", () => {
    expect(foodDays()).toBeCloseTo(PEANUT_KCAL / DAILY, 6);
  });

  it("adds the days of the rice only while the water and the fuel of the test converter last", () => {
    // 100 L of water and 1 kg of fuel cook all 4 kg of rice.
    expect(foodDays(cookFragment(100, 1))).toBeCloseTo((PEANUT_KCAL + 4 * 3650) / DAILY, 6);
    // 2.5 L of water cook 1.25 kg of rice.
    expect(foodDays(cookFragment(2.5, 1))).toBeCloseTo((PEANUT_KCAL + 1.25 * 3650) / DAILY, 6);
    // 0.2 kg of fuel cook 2 kg of rice.
    expect(foodDays(cookFragment(100, 0.2))).toBeCloseTo((PEANUT_KCAL + 2 * 3650) / DAILY, 6);
    // With no water, the rice gives nothing.
    expect(foodDays(cookFragment(0, 1))).toBeCloseTo(PEANUT_KCAL / DAILY, 6);
  });
});
