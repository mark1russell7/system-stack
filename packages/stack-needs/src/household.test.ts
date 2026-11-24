import { SUPPLY_CATALOG } from "@mark1russell7/market/supplies";
import { checkEndurance, enduranceOf, hasEnduranceError, joinEndurance, type CaseCuts, type EnduranceLayer } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import type { Person } from "./calorie.ts";
import { DGA_CALORIES, NASEM_INFANT_CALORIES } from "./data.ts";
import { householdFragment, type HouseholdFragmentInput, type HouseholdFragmentRead } from "./household.ts";
import { FOOD_NEED, NO_COOK } from "./uses.ts";

/** Two made-up adults of 33 years. Sedentary, they need 2400 + 1800 = 4200 kcal each day. */
const adults: Person[] = [
  { sex: "male", ageMonths: 33 * 12, count: 1 },
  { sex: "female", ageMonths: 33 * 12, count: 1 },
];
const DAILY = 4200;

/** 4 kg of dry rice and 2 kg of peanut butter. The catalog gives 5980 kcal for each kg of peanut butter. */
const units = { "food.rice-white-1kg": 4, "food.peanut-butter-1kg": 2 };
const PEANUT_KCAL = 2 * 5980;

const input: HouseholdFragmentInput = { persons: adults, activity: "sedentary", catalog: SUPPLY_CATALOG, units, supply: "food.retail", level: "critical", levels: ["critical"] };

/** A case that stops the food shops. */
const foodCut: CaseCuts = { case: "test.food-cut", title: "A test stop of the food shops", cuts: [{ part: "food.retail", title: "No food shops", source: "test" }] };
const at = "2026-11-22";

/** A made-up infant of 6 months that eats the food of the household. The guidelines have no row below 12 months. The infant table gives 604 kcal/d. */
const infant: Person = { sex: "female", ageMonths: 6, count: 1, feeding: "food" };

/** This function gives the fragment of a call, and fails the test when the call gives no layer. */
function fragmentOf(of: HouseholdFragmentInput): HouseholdFragmentRead {
  const result = householdFragment(of);
  if (result.layer === undefined) throw new Error(result.why);
  return result;
}

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
  const result = householdFragment(input);
  if (result.layer === undefined) throw new Error(result.why);
  // The type gate of the copied shape: the fragment has the form of `EnduranceLayer` of stack-endurance.
  const food: EnduranceLayer = result.layer;
  const join = joinEndurance([{ from: "food", layer: food }, ...more.map((layer, index) => ({ from: `more-${String(index)}`, layer }))]);
  if (!join.ok) throw new Error(JSON.stringify(join.errors));
  expect(hasEnduranceError(checkEndurance(join.layer))).toBe(false);
  const days = enduranceOf(join.layer, foodCut, { at }).needs[FOOD_NEED]?.days;
  if (days === undefined) throw new Error("The food draw has no result.");
  return days;
}

describe("the household fragment", () => {
  it("has one draw of the food energy of the household, and a store for each gift of the buy list", () => {
    const result = fragmentOf(input);
    expect(result.needRead).toBe(true);
    expect(result.storesRead).toBe(true);
    expect(result.leftOut).toEqual([]);
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
    const result = fragmentOf({ ...input, units: { "water.jug-1gal": 2, "food.pasta-dry-1kg": 1, "food.flour-white-1kg": 3 } });
    const amounts = Object.fromEntries(result.layer.stores.map((store) => [store.resource, store.amount]));
    expect(amounts["water.stored"]).toBeCloseTo(2 * 3.785411784, 6);
    expect(amounts).toMatchObject({ "food.pasta-dry": 1, "food.flour": 3 });
    expect(result.layer.resources.find((resource) => resource.code === "water.stored")?.unit).toBe("L");
  });

  it("gives an infant the need of the infant table by default", () => {
    const result = fragmentOf({ ...input, persons: [...adults, infant] });
    expect(result.leftOut).toEqual([]);
    expect(result.layer.draws[0]).toMatchObject({ perDay: DAILY + 604, users: 3 });
    expect(result.need.lines[2]).toMatchObject({ read: true, table: NASEM_INFANT_CALORIES.id, row: "6-8" });
  });

  it("gives no layer for a household of only an infant with a table that has no row for the infant", () => {
    const result = householdFragment({ ...input, table: DGA_CALORIES, persons: [infant] });
    expect(result.layer).toBeUndefined();
    expect(result.needRead).toBe(false);
    if (result.layer === undefined) expect(result.noRow).toEqual([infant]);
  });

  it("gives no layer for two adults and an infant with no row, with no option", () => {
    const result = householdFragment({ ...input, table: DGA_CALORIES, persons: [...adults, infant] });
    expect(result.layer).toBeUndefined();
    if (result.layer === undefined) {
      expect(result.noRow).toEqual([infant]);
      expect(result.need?.read).toBe(false);
    }
  });

  it("leaves the infant out of the draw with the option, and lists the infant", () => {
    const result = fragmentOf({ ...input, table: DGA_CALORIES, persons: [...adults, infant], noRow: "leave-out" });
    expect(result.needRead).toBe(true);
    expect(result.leftOut).toEqual([infant]);
    expect(result.layer.draws[0]).toMatchObject({ perDay: DAILY, users: 2 });
  });

  it("refuses an infant with no feeding, and a feeding that is not a way", () => {
    expect(() => householdFragment({ ...input, persons: [...adults, { sex: "female", ageMonths: 6, count: 1 }] })).toThrow(/no feeding/);
    const bad = { sex: "female", ageMonths: 6, count: 1, feeding: "milk" } as unknown as Person;
    expect(() => householdFragment({ ...input, persons: [...adults, bad] })).toThrow(/not a way/);
    // A record with count 0 needs no feeding.
    expect(fragmentOf({ ...input, persons: [...adults, { sex: "female", ageMonths: 6, count: 0 }] }).layer.draws[0]).toMatchObject({ perDay: DAILY, users: 2 });
  });

  it("puts the energy of an infant on breast milk in the stage of lactation of the mother, not in the draw", () => {
    const mother: Person = { sex: "female", ageMonths: 33 * 12, count: 1, stage: "lactation-1" };
    const baby: Person = { sex: "male", ageMonths: 3, count: 1, feeding: "breast-milk" };
    const result = fragmentOf({ ...input, persons: [adults[0] as Person, mother, baby] });
    expect(result.layer.draws[0]).toMatchObject({ perDay: DAILY + 330, users: 2 });
    expect(result.breastMilk).toEqual([baby]);
    expect(result.leftOut).toEqual([]);
    expect(result.need.lines[2]).toMatchObject({ read: true, table: NASEM_INFANT_CALORIES.id });
    expect(result.need.need.value).toBeGreaterThan(DAILY + 330);
    expect(DGA_CALORIES.changes?.filter((change) => change.milk === true).map((change) => change.stage)).toEqual(["lactation-1", "lactation-2"]);
  });

  it("refuses an infant on breast milk when no person has a stage of lactation", () => {
    const baby: Person = { sex: "male", ageMonths: 3, count: 1, feeding: "breast-milk" };
    expect(() => householdFragment({ ...input, persons: [...adults, baby] })).toThrow(/stage of lactation/);
    const pregnant: Person = { sex: "female", ageMonths: 33 * 12, count: 1, stage: "pregnancy-2" };
    expect(() => householdFragment({ ...input, persons: [adults[0] as Person, pregnant, baby] })).toThrow(/stage of lactation/);
  });

  it("gives no layer for an infant on formula, and leaves the infant out with the option", () => {
    const baby: Person = { sex: "female", ageMonths: 4, count: 1, feeding: "formula" };
    const result = householdFragment({ ...input, persons: [...adults, baby] });
    expect(result.layer).toBeUndefined();
    if (result.layer === undefined) {
      expect(result.formula).toEqual([baby]);
      expect(result.noRow).toEqual([]);
      expect(result.why).toMatch(/formula/);
    }
    const left = fragmentOf({ ...input, persons: [...adults, baby], noRow: "leave-out" });
    expect(left.leftOut).toEqual([baby]);
    expect(left.layer.draws[0]).toMatchObject({ perDay: DAILY, users: 2 });
  });

  it("gives no layer for a draw of 0 kcal", () => {
    for (const persons of [[], [{ sex: "male", ageMonths: 396, count: 0 }]] satisfies Person[][]) {
      const result = householdFragment({ ...input, persons });
      expect(result.layer, JSON.stringify(persons)).toBeUndefined();
      expect(result.needRead).toBe(false);
    }
    expect(householdFragment({ ...input, table: DGA_CALORIES, persons: [infant], noRow: "leave-out" }).layer).toBeUndefined();
  });

  it("keeps a gift with no read out of the stores, and the food draw stays exact", () => {
    const result = fragmentOf({ ...input, units: { ...units, "power.anker-737": 1 } });
    expect(result.storesRead).toBe(false);
    expect(result.needRead).toBe(true);
    expect(result.noReads).toEqual([expect.objectContaining({ product: "power.anker-737", resource: "energy.battery" })]);
    expect(result.layer.stores.map((store) => store.resource)).toEqual(["food.grain-dry", NO_COOK]);
    expect(result.layer.draws[0]).toMatchObject({ perDay: DAILY, users: 2 });
  });

  it("uses the prefix of the store ids", () => {
    const result = fragmentOf({ ...input, prefix: "home" });
    expect(result.layer.stores.map((store) => store.id)).toEqual(["home:food.rice-white-1kg:food.grain-dry", "home:food.peanut-butter-1kg:food.no-cook"]);
  });

  it("refuses a catalog with no no-cook food in kcal", () => {
    const catalog = { ...SUPPLY_CATALOG, resources: SUPPLY_CATALOG.resources.filter((resource) => resource.code !== NO_COOK) };
    expect(() => householdFragment({ ...input, catalog, units: {} })).toThrow(RangeError);
  });
});

describe("the household fragment in the endurance query", () => {
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
