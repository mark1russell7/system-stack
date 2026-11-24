import { SUPPLY_CATALOG, type SupplyCatalog, type SupplyProduct } from "@mark1russell7/market/supplies";
import { checkEndurance, enduranceOf, hasEnduranceError, joinEndurance, type CaseCuts, type EnduranceLayer } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import type { Person } from "./calorie.ts";
import { DGA_CALORIES, FORMULA_FEEDS, FORMULA_LATER_LEAST, MILK_LATER, NASEM_INFANT_CALORIES } from "./data.ts";
import { FORMULA_DRAW_MONTHS, householdFragment, type HouseholdFragmentInput, type HouseholdFragmentRead } from "./household.ts";
import { BOTTLED_WATER, FOOD_NEED, FORMULA_NEED, FORMULA_READY, NO_COOK, STORED_WATER } from "./uses.ts";

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

/** This function gives the catalog with a made-up container of the 1 kg formula, in grams. */
function withContainer(grams: number): SupplyCatalog {
  const products = SUPPLY_CATALOG.products.map((each) =>
    each.id === "food.infant-formula-ready-1kg" && each.opened !== undefined ? { ...each, opened: { ...each.opened, container: { read: true as const, amount: grams, unit: "g", definition: "A test container." } } } : each,
  );
  return { ...SUPPLY_CATALOG, products };
}

/**
 * This function gives the catalog with the change of market 0.9.0: the resource `water.bottled`, and the jug of 1 gal gives it.
 * When stack-needs takes market 0.9.0, the copy has no effect.
 */
function withBottled(base: SupplyCatalog): SupplyCatalog {
  const water = base.resources.find((resource) => resource.code === STORED_WATER);
  if (water === undefined) throw new Error(`The catalog has no resource ${STORED_WATER}.`);
  const resources = base.resources.some((resource) => resource.code === BOTTLED_WATER)
    ? base.resources
    : [...base.resources, { ...water, code: BOTTLED_WATER, title: "Drinking water, commercially bottled and sealed" }];
  const products = base.products.map((product) =>
    product.id === "water.jug-1gal" ? { ...product, gives: product.gives.map((gift) => (gift.resource === STORED_WATER ? { ...gift, resource: BOTTLED_WATER } : gift)) } : product,
  );
  return { ...base, resources, products };
}

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
    const result = fragmentOf({ ...input, catalog: withBottled(SUPPLY_CATALOG), units: { "water.jug-1gal": 2, "water.container-1gal": 1, "food.pasta-dry-1kg": 1, "food.flour-white-1kg": 3 } });
    const amounts = Object.fromEntries(result.layer.stores.map((store) => [store.resource, store.amount]));
    expect(amounts[BOTTLED_WATER]).toBeCloseTo(2 * 3.785411784, 6);
    expect(amounts[STORED_WATER]).toBeCloseTo(3.785411784, 6);
    expect(amounts).toMatchObject({ "food.pasta-dry": 1, "food.flour": 3 });
    expect(result.layer.resources.find((resource) => resource.code === STORED_WATER)?.unit).toBe("L");
    expect(result.layer.resources.find((resource) => resource.code === BOTTLED_WATER)?.unit).toBe("L");
  });

  it("gives the subset converter of the bottled water, so a draw of stored water also uses it", () => {
    const result = fragmentOf({ ...input, catalog: withBottled(SUPPLY_CATALOG), units: { "water.jug-1gal": 2 } });
    expect(result.layer.converters).toEqual([{ id: `buy:subset:${BOTTLED_WATER}`, takes: [{ resource: BOTTLED_WATER, amount: 1 }], gives: { resource: STORED_WATER, amount: 1 } }]);
    // The gift of the converter is a resource of the layer, also with no store of it.
    expect(result.layer.resources.map((resource) => resource.code)).toContain(STORED_WATER);
    expect(hasEnduranceError(checkEndurance(result.layer))).toBe(false);
    expect(fragmentOf({ ...input, catalog: withBottled(SUPPLY_CATALOG), units: { "water.container-1gal": 2 } }).layer.converters).toEqual([]);
    expect(fragmentOf({ ...input, catalog: withBottled(SUPPLY_CATALOG), units: { "water.jug-1gal": 2 }, subsets: [] }).layer.converters).toEqual([]);
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

  it("refuses breast milk and formula from 12 months", () => {
    const mother: Person = { sex: "female", ageMonths: 33 * 12, count: 1, stage: "lactation-2" };
    const man = adults[0] as Person;
    for (const [ageMonths, feeding] of [[12, "breast-milk"], [14, "breast-milk"], [12, "formula"], [14, "formula"]] as const) {
      expect(() => householdFragment({ ...input, persons: [man, mother, { sex: "female", ageMonths, count: 1, feeding }] }), `${String(ageMonths)} ${feeding}`).toThrow(/Give feeding: food/);
    }
    expect(() => householdFragment({ ...input, persons: [{ ...man, feeding: "breast-milk" }, mother] })).toThrow(/only for an infant/);
    expect(fragmentOf({ ...input, persons: [man, mother, { sex: "female", ageMonths: 5, count: 1, feeding: "breast-milk" }] }).layer.draws[0]).toMatchObject({ perDay: DAILY + 400, users: 2 });
    expect(fragmentOf({ ...input, persons: [man, mother, { sex: "female", ageMonths: 14, count: 1, feeding: "food" }] }).layer.draws[0]).toMatchObject({ perDay: DAILY + 400 + 800, users: 3 });
  });

  it("puts the need of an infant on breast milk from 6 months minus the milk energy in the food draw", () => {
    // The infant table gives 604 kcal/d for the girls of 6 to 8 months and 745 kcal/d for the boys of 9 to 11 months.
    // Table 5-14 of the NASEM report gives 381 kcal/d of milk energy from 6 months, and the stage lactation-2 adds 400 kcal/d.
    const man = adults[0] as Person;
    const mother: Person = { sex: "female", ageMonths: 33 * 12, count: 1, stage: "lactation-2" };
    const girl: Person = { sex: "female", ageMonths: 6, count: 1, feeding: "breast-milk" };
    const result = fragmentOf({ ...input, persons: [man, mother, girl] });
    expect(result.layer.draws).toEqual([{ need: FOOD_NEED, level: "critical", perDay: DAILY + 400 + (604 - MILK_LATER.perDay), users: 3, supply: "food.retail" }]);
    expect(result.breastMilk).toEqual([girl]);
    const boy: Person = { sex: "male", ageMonths: 11, count: 1, feeding: "breast-milk" };
    expect(fragmentOf({ ...input, persons: [man, mother, boy] }).layer.draws[0]).toMatchObject({ perDay: DAILY + 400 + (745 - 381), users: 3 });
    // The rule of one infant for each person with a stage of lactation holds from 6 months.
    const twins = householdFragment({ ...input, persons: [man, mother, { ...boy, count: 2 }] });
    expect(twins.layer === undefined ? twins.why : "").toMatch(/2 infants drink breast milk, but the draw has 1 persons/);
  });

  it("gives no layer when the infants on breast milk are more than the persons of the draw with a stage of lactation", () => {
    const man = adults[0] as Person;
    const mother: Person = { sex: "female", ageMonths: 33 * 12, count: 1, stage: "lactation-1" };
    const twins: Person = { sex: "male", ageMonths: 3, count: 2, feeding: "breast-milk" };
    for (const noRow of [undefined, "leave-out"] as const) {
      const result = householdFragment({ ...input, persons: [man, mother, twins], noRow });
      expect(result.layer).toBeUndefined();
      expect(result.layer === undefined ? result.why : "").toMatch(/2 infants drink breast milk, but the draw has 1 persons/);
    }
    const two = fragmentOf({ ...input, persons: [man, { ...mother, count: 2 }, twins] });
    expect(two.layer.draws[0]).toMatchObject({ perDay: 2400 + 2 * (1800 + 330), users: 3 });
    // A mother that the draw leaves out does not count.
    const noWomen = { ...DGA_CALORIES, rows: DGA_CALORIES.rows.filter((row) => row.sex !== "female") };
    const left = householdFragment({ ...input, table: [NASEM_INFANT_CALORIES, noWomen], persons: [man, mother, { ...twins, count: 1 }], noRow: "leave-out" });
    expect(left.layer).toBeUndefined();
    expect(left.layer === undefined ? left.why : "").toMatch(/the draw has 0 persons/);
  });

  it("refuses an infant on breast milk when no person has a stage of lactation", () => {
    const baby: Person = { sex: "male", ageMonths: 3, count: 1, feeding: "breast-milk" };
    expect(() => householdFragment({ ...input, persons: [...adults, baby] })).toThrow(/stage of lactation/);
    const pregnant: Person = { sex: "female", ageMonths: 33 * 12, count: 1, stage: "pregnancy-2" };
    expect(() => householdFragment({ ...input, persons: [adults[0] as Person, pregnant, baby] })).toThrow(/stage of lactation/);
  });

  it("puts an infant on formula below 6 months in a draw of formula, with the whole need of its row", () => {
    // A made-up infant of 4 months. The infant table gives 546 kcal/d for the girls of 3 to 5 months.
    const baby: Person = { sex: "female", ageMonths: 4, count: 1, feeding: "formula" };
    const result = fragmentOf({ ...input, persons: [...adults, baby] });
    expect(result.leftOut).toEqual([]);
    expect(result.formula).toEqual([baby]);
    expect(result.layer.draws).toEqual([
      { need: FOOD_NEED, level: "critical", perDay: DAILY, users: 2, supply: "food.retail" },
      { need: FORMULA_NEED, level: "critical", perDay: 546, users: 1, supply: "food.retail" },
    ]);
    expect(result.layer.direct).toEqual([
      { resource: NO_COOK, need: FOOD_NEED, amount: 1 },
      { resource: FORMULA_READY, need: FORMULA_NEED, amount: 1 },
    ]);
    expect(result.layer.resources).toContainEqual({ code: FORMULA_READY, unit: "kcal" });
  });

  it("gives 0 days of formula for a buy list with no formula, and the days of the formula of the list", () => {
    const baby: Person = { sex: "male", ageMonths: 1, count: 1, feeding: "formula" };
    const daysOf = (more: Record<string, number>): number | undefined => {
      const layer: EnduranceLayer = fragmentOf({ ...input, persons: [...adults, baby], units: { ...units, ...more }, cold: true }).layer;
      expect(hasEnduranceError(checkEndurance(layer))).toBe(false);
      return enduranceOf(layer, foodCut, { at }).needs[FORMULA_NEED]?.days;
    };
    // The peanut butter and the rice of the list do not feed the infant.
    expect(daysOf({})).toBe(0);
    // The catalog gives 630 kcal for each kg of ready-to-feed formula, and the infant table gives 566 kcal/d for the boys of 0 to 2 months.
    expect(daysOf({ "food.infant-formula-ready-1kg": 9 })).toBeCloseTo((9 * 630) / 566, 9);
  });

  it("gives no store of the 1 kg formula with no cold storage, because its container size is no read", () => {
    const baby: Person = { sex: "male", ageMonths: 1, count: 1, feeding: "formula" };
    const result = fragmentOf({ ...input, persons: [...adults, baby], units: { ...units, "food.infant-formula-ready-1kg": 9 } });
    expect(result.layer.stores.map((store) => store.resource)).not.toContain(FORMULA_READY);
    expect(result.storesRead).toBe(false);
    expect(result.noReads).toEqual([
      { product: "food.infant-formula-ready-1kg", resource: FORMULA_READY, why: expect.stringMatching(/^With no cold storage, an opened container serves one feed \(fact wic\.formula-opened\)\. The size of a container is no read: /) },
    ]);
    expect(result.waste).toEqual([]);
    expect(enduranceOf(result.layer, foodCut, { at }).needs[FORMULA_NEED]?.days).toBe(0);
  });

  it("gives one feed for each opened container with no cold storage, and the rest as waste", () => {
    // TEST VALUES: made-up containers of 250 g and of 50 g. The catalog gives 63 kcal in 100 g.
    // The infant table gives 566 kcal/d for the boys of 0 to 2 months, so the smallest feed is 566 / 8 kcal.
    const baby: Person = { sex: "male", ageMonths: 1, count: 1, feeding: "formula" };
    const feed = 566 / FORMULA_FEEDS.perDay;
    const run = (grams: number, cold?: boolean) => {
      const catalog = withContainer(grams);
      const result = fragmentOf({ ...input, catalog, persons: [...adults, baby], units: { ...units, "food.infant-formula-ready-1kg": 9 }, cold });
      return { result, days: enduranceOf(result.layer, foodCut, { at }).needs[FORMULA_NEED]?.days };
    };
    // A container of 250 g gives 157.5 kcal, more than a feed: 36 containers give 36 feeds, thus 36 / 8 days.
    const big = run(250);
    expect(big.days).toBeCloseTo(36 / 8, 9);
    expect(big.result.storesRead).toBe(true);
    expect(big.result.waste).toEqual([
      { product: "food.infant-formula-ready-1kg", resource: FORMULA_READY, containers: 36, container: expect.closeTo(157.5, 9), feed: expect.closeTo(feed, 9), used: expect.closeTo(36 * feed, 9), waste: expect.closeTo(9 * 630 - 36 * feed, 9) },
    ]);
    // A container of 50 g gives 31.5 kcal. A feed takes 3 containers, so each container gives a third of a feed.
    const small = run(50);
    expect(small.result.waste[0]?.containers).toBe(180);
    expect(small.days).toBeCloseTo(180 / 3 / 8, 9);
    // With cold storage, the store is the whole energy of the list.
    const cold = run(250, true);
    expect(cold.days).toBeCloseTo((9 * 630) / 566, 9);
    expect(cold.result.waste).toEqual([]);
  });

  it("keeps the formula store when no infant is on formula, and refuses opened containers of a resource that feeds no formula draw", () => {
    const keep = fragmentOf({ ...input, catalog: withContainer(250), units: { ...units, "food.infant-formula-ready-1kg": 2 } });
    expect(keep.layer.stores).toContainEqual({ id: "buy:food.infant-formula-ready-1kg:food.infant-formula-ready", resource: FORMULA_READY, amount: 2 * 630 });
    expect(keep.waste).toEqual([]);
    const peanut = SUPPLY_CATALOG.products.find((each) => each.id === "food.peanut-butter-1kg")!;
    const opened: SupplyProduct = { ...peanut, opened: { container: { read: true, amount: 1, unit: "kg", size: true }, noCold: "wic.formula-opened" } };
    const catalog: SupplyCatalog = { ...SUPPLY_CATALOG, products: SUPPLY_CATALOG.products.map((each) => (each.id === opened.id ? opened : each)) };
    expect(() => householdFragment({ ...input, catalog })).toThrow(/food\.peanut-butter-1kg spoils after its container is opened, and its resource food\.no-cook feeds no formula draw/);
    expect(householdFragment({ ...input, catalog, cold: true }).layer).toBeDefined();
  });

  it("puts the whole need of an infant on formula from 6 months in the formula draw with formulaLater: whole", () => {
    // The infant table gives 604 kcal/d for the girls of 6 to 8 months.
    const girl: Person = { sex: "female", ageMonths: 7, count: 1, feeding: "formula" };
    const without = householdFragment({ ...input, persons: [...adults, girl] });
    expect(without.layer).toBeUndefined();
    const whole = fragmentOf({ ...input, persons: [...adults, girl], formulaLater: "whole" });
    expect(whole.layer.draws).toEqual([
      { need: FOOD_NEED, level: "critical", perDay: DAILY, users: 2, supply: "food.retail" },
      { need: FORMULA_NEED, level: "critical", perDay: 604, users: 1, supply: "food.retail" },
    ]);
    expect(whole.leftOut).toEqual([]);
    expect(whole.formula).toEqual([girl]);
  });

  it("puts the least formula of an infant from 6 months in the formula draw and the rest in the food draw with formulaLater: least", () => {
    // The infant table gives 604 kcal/d for the girls of 6 to 8 months. The least formula is 24 fl oz at 19.152 kcal/fl oz.
    const girls: Person = { sex: "female", ageMonths: 7, count: 2, feeding: "formula" };
    const least = fragmentOf({ ...input, persons: [...adults, girls], formulaLater: "least" });
    expect(FORMULA_LATER_LEAST.perDay).toBeCloseTo(459.648, 9);
    expect(least.layer.draws).toEqual([
      { need: FOOD_NEED, level: "critical", perDay: expect.closeTo(DAILY + 2 * (604 - 459.648), 9), users: 4, supply: "food.retail" },
      { need: FORMULA_NEED, level: "critical", perDay: expect.closeTo(2 * 459.648, 9), users: 2, supply: "food.retail" },
    ]);
    expect(least.leftOut).toEqual([]);
    // The low and the high give the same total energy. Only the split between the draws differs.
    const whole = fragmentOf({ ...input, persons: [...adults, girls], formulaLater: "whole" });
    const total = (layer: EnduranceLayer): number => layer.draws.reduce((sum, draw) => sum + draw.perDay, 0);
    expect(total(least.layer)).toBeCloseTo(total(whole.layer), 9);
  });

  it("gives only the draw of formula for a household of infants on formula", () => {
    const babies: Person = { sex: "female", ageMonths: 0, count: 2, feeding: "formula" };
    const { layer } = fragmentOf({ ...input, persons: [babies] });
    expect(layer.draws).toEqual([{ need: FORMULA_NEED, level: "critical", perDay: 2 * 531, users: 2, supply: "food.retail" }]);
    expect(layer.direct).toEqual([{ resource: FORMULA_READY, need: FORMULA_NEED, amount: 1 }]);
  });

  it("gives no layer for an infant on formula from 6 months, and leaves the infant out with the option", () => {
    expect(FORMULA_DRAW_MONTHS).toBe(6);
    const baby: Person = { sex: "female", ageMonths: 6, count: 1, feeding: "formula" };
    const result = householdFragment({ ...input, persons: [...adults, baby] });
    expect(result.layer).toBeUndefined();
    if (result.layer === undefined) {
      expect(result.formula).toEqual([baby]);
      expect(result.noRow).toEqual([]);
      expect(result.why).toMatch(/6 months or more are on formula/);
    }
    const left = fragmentOf({ ...input, persons: [...adults, baby], noRow: "leave-out" });
    expect(left.leftOut).toEqual([baby]);
    expect(left.formula).toEqual([baby]);
    expect(left.layer.draws).toEqual([{ need: FOOD_NEED, level: "critical", perDay: DAILY, users: 2, supply: "food.retail" }]);
  });

  it("gives a need of formula below 6 months that 32 fl oz of ready-to-feed formula covers", () => {
    // A cross-check, not a rule. The CDC tells that infants on about 32 fl oz of formula each day need no more vitamin D.
    // TEST VALUE: the test takes 1 g for each mL of formula, with no source. The catalog gives 63 kcal in 100 g.
    const covered = (32 * 29.5735295625 * 63) / 100;
    for (const row of NASEM_INFANT_CALORIES.rows.filter((item) => item.from < FORMULA_DRAW_MONTHS)) {
      expect(row.need.each?.value, `${row.sex} ${row.age}`).toBeLessThan(covered);
    }
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
