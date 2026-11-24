import { checkSources } from "@mark1russell7/guidebook";
import { SUPPLY_CATALOG, type SupplyCatalog, type SupplyProduct } from "@mark1russell7/market/supplies";
import { checkEndurance, enduranceOf, hasEnduranceError, joinEndurance, type CaseCuts, type EnduranceLayer } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import type { Person } from "./calorie.ts";
import { cookFragment } from "./cook.ts";
import { FDC_SR_LEGACY_SOURCE, FORMULA_MIX, FORMULA_WATER, WIC_INFANT_SOURCE } from "./data.ts";
import { householdFragment } from "./household.ts";
import { formulaMixCheck, formulaMixFragment, formulaMixWater } from "./mix.ts";
import { BOTTLED_WATER, FORMULA_NEED, FORMULA_POWDER, FORMULA_READY, STORED_WATER, WATER_NEED } from "./uses.ts";

const POWDER_ID = "food.infant-formula-powder-1kg";
/** The powder product of 1 kg of the reference catalog. The tests copy it to make test products. */
const powder: SupplyProduct = (() => {
  const found = SUPPLY_CATALOG.products.find((product) => product.id === POWDER_ID);
  if (found === undefined) throw new Error(`The reference catalog has no product ${POWDER_ID}.`);
  return found;
})();

/** This function gives the reference catalog with more products. */
function withPowder(...more: SupplyProduct[]): SupplyCatalog {
  return { ...SUPPLY_CATALOG, products: [...SUPPLY_CATALOG.products, ...more] };
}

/** The jug of commercially bottled water, and the container filled from the tap. Each holds 1 gal. */
const JUG = "water.jug-1gal";
const TAP = "water.container-1gal";
const GALLON = 3.785411784;

const catalog = withPowder();
/** The water of 1 kg of powder: 5240 / 630 - 1 kg, at 1 kg/L. */
const WATER = 5240 / 630 - 1;

describe("the mix rule of infant formula powder", () => {
  it("finds the powder of 1 kg in the reference catalog, with 5240 kcal and no direct draw", () => {
    expect(powder.gives).toEqual([{ resource: FORMULA_POWDER, amount: { read: true, amount: 1, unit: "kg", size: true } }]);
    expect(powder.energy).toMatchObject({ read: true, amount: 5240, unit: "kcal" });
  });

  it("cites the FDC items and the WIC guide", () => {
    expect(FORMULA_MIX).toMatchObject({ powderKcal: 524, powderWater: 2, readyKcal: 63, readyWater: 88.1 });
    expect(FORMULA_MIX.source).toBe(FDC_SR_LEGACY_SOURCE);
    expect(FORMULA_MIX.locator).toContain("173554");
    expect(FORMULA_MIX.locator).toContain("172319");
    expect(FORMULA_MIX.waterSource).toBe(WIC_INFANT_SOURCE);
    expect(FORMULA_MIX.waterLocator).toMatch(/^Page 106,/u);
    expect(checkSources([FORMULA_MIX.source, FORMULA_MIX.waterSource], { require: ["by", "terms", "sha256"], https: true, at: "2026-11-24" })).toEqual([]);
  });

  it("gives 7.3175 kg of water for each kg of powder, thus 1.39646 g for each kcal", () => {
    expect(formulaMixWater(5240)).toBeCloseTo(7.31746, 5);
    expect((formulaMixWater(5240) * 1000) / 5240).toBeCloseTo(1.39646, 5);
    // 100 g of prepared formula: 63 kcal from 100 x 63 / 524 g of powder.
    expect((100 - (100 * 63) / 524) / 63).toBeCloseTo((formulaMixWater(5240) * 1000) / 5240, 12);
  });

  it("refuses a powder energy that is not above the energy of the ready-to-feed item", () => {
    expect(() => formulaMixWater(630)).toThrow(RangeError);
    expect(() => formulaMixWater(Number.NaN)).toThrow(RangeError);
    expect(() => formulaMixWater(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("predicts the water of the ready-to-feed item with the water of the powder, 0.13% from the cited value", () => {
    const check = formulaMixCheck();
    expect(check.powder).toBeCloseTo((100 * 63) / 524, 9);
    expect(check.added).toBeCloseTo(87.977, 3);
    expect(check.predicted).toBeCloseTo(87.977 + 0.24, 2);
    expect(check.cited).toBe(88.1);
    expect(check.relative).toBeGreaterThan(0);
    expect(check.relative).toBeLessThan(0.0014);
    expect(check.relative).toBeCloseTo(0.001335, 5);
  });
});

describe("the mix fragment", () => {
  it("gives one converter: 1 kg of powder and its water give 5240 kcal of ready formula, with no fuel", () => {
    const result = formulaMixFragment({ catalog, units: { [POWDER_ID]: 3 } });
    expect(result.read).toBe(true);
    expect(result.why).toBeUndefined();
    expect(result.lines).toEqual([{ product: POWDER_ID, energy: { read: true, value: 5240, unit: "kcal/kg" }, water: { read: true, value: expect.closeTo(WATER, 9), unit: "L/kg" } }]);
    expect(result.layer.converters).toEqual([
      {
        id: `mix:${FORMULA_POWDER}`,
        takes: [
          { resource: FORMULA_POWDER, amount: 1 },
          { resource: BOTTLED_WATER, amount: expect.closeTo(WATER, 9) },
        ],
        gives: { resource: FORMULA_READY, amount: 5240 },
      },
    ]);
    expect(result.layer.resources).toEqual([
      { code: FORMULA_POWDER, unit: "kg" },
      { code: BOTTLED_WATER, unit: "L" },
      { code: FORMULA_READY, unit: "kcal" },
    ]);
    // The type gate of the copied shape: the fragment has the form of `EnduranceLayer` of stack-endurance.
    const layer: EnduranceLayer = result.layer;
    expect(layer.converters).toHaveLength(1);
    expect(formulaMixFragment({ catalog, units: { [POWDER_ID]: 1 }, prefix: "bottle" }).layer.converters[0]?.id).toBe(`bottle:${FORMULA_POWDER}`);
  });

  it("gives no converter for a buy list with no powder", () => {
    const result = formulaMixFragment({ catalog, units: { "food.rice-white-1kg": 2, [POWDER_ID]: 0 } });
    expect(result).toMatchObject({ read: true, why: undefined, lines: [] });
    expect(result.layer.converters).toEqual([]);
    expect(result.layer.resources).toEqual([]);
  });

  it("gives no converter and the reason for a powder with no read of its energy", () => {
    const blind: SupplyProduct = { ...powder, id: "test.powder-blind", energy: { read: false, why: "Test: no label." } };
    const result = formulaMixFragment({ catalog: withPowder(blind), units: { [POWDER_ID]: 1, "test.powder-blind": 1 } });
    expect(result.read).toBe(false);
    expect(result.layer.converters).toEqual([]);
    expect(result.why).toContain("test.powder-blind: The food energy of the product test.powder-blind is a no read: Test: no label.");
  });

  it("takes the most water and the least energy of two powders", () => {
    // TEST VALUES: a made-up powder of 4800 kcal/kg.
    const lean: SupplyProduct = { ...powder, id: "test.powder-lean", energy: { read: true, amount: 4800, unit: "kcal", definition: "Test data." } };
    const result = formulaMixFragment({ catalog: withPowder(lean), units: { [POWDER_ID]: 1, "test.powder-lean": 1 } });
    const converter = result.layer.converters[0];
    expect(converter?.takes[1]).toEqual({ resource: BOTTLED_WATER, amount: expect.closeTo(WATER, 9) });
    expect(converter?.gives).toEqual({ resource: FORMULA_READY, amount: 4800 });
  });

  it("gives a no read for a powder with no more energy than the ready-to-feed item", () => {
    const thin: SupplyProduct = { ...powder, id: "test.powder-thin", energy: { read: true, amount: 600, unit: "kcal", definition: "Test data." } };
    const result = formulaMixFragment({ catalog: withPowder(thin), units: { "test.powder-thin": 1 } });
    expect(result.read).toBe(false);
    expect(result.why).toContain("not more than the 630 kcal/kg");
  });

  it("takes only commercially bottled water, the rule of page 107 of the WIC guide", () => {
    expect(FORMULA_WATER.resource).toBe(BOTTLED_WATER);
    expect(FORMULA_WATER.source).toBe(WIC_INFANT_SOURCE);
    expect(FORMULA_WATER.locator).toBe("Page 107, the box Natural Disaster or Power Outage: Infant Formula Guidelines, from the CDC");
    expect(FORMULA_WATER.quote).toBe("Use bottled water to prepare powdered or liquid concentrated infant formula.");
    expect(FORMULA_WATER.otherwise).toContain("discuss options with a health care provider");
    // The cleaning water has no cited amount: a no read, not 0, and no draw.
    expect(FORMULA_WATER.cleaning).toEqual({ read: false, why: expect.stringContaining("It gives no amount of water.") });
    const takes = formulaMixFragment({ catalog, units: { [POWDER_ID]: 1, [TAP]: 4 } }).layer.converters[0]?.takes.map((take) => take.resource);
    expect(takes).toEqual([FORMULA_POWDER, BOTTLED_WATER]);
    expect(takes).not.toContain(STORED_WATER);
  });

  it("names the products of the bottled water, and tells the reason when the list has powder and only tap water", () => {
    const both = formulaMixFragment({ catalog, units: { [TAP]: 2, [POWDER_ID]: 1, [JUG]: 3 } });
    expect(both.bottled).toEqual([JUG]);
    expect(both.waterWhy).toBeUndefined();
    const tap = formulaMixFragment({ catalog, units: { [POWDER_ID]: 1, [TAP]: 10 } });
    expect(tap.bottled).toEqual([]);
    expect(tap.read).toBe(true);
    expect(tap.layer.converters).toHaveLength(1);
    expect(tap.waterWhy).toContain(`no product that gives ${BOTTLED_WATER}`);
    expect(tap.waterWhy).toContain("Page 107");
    expect(tap.waterWhy).toContain("the powder gives 0 days");
    // A list with no powder has no reason.
    expect(formulaMixFragment({ catalog, units: { [TAP]: 1 } }).waterWhy).toBeUndefined();
  });

  it("throws for a catalog with no resource of the bottled water", () => {
    const noBottled: SupplyCatalog = { ...catalog, resources: catalog.resources.filter((resource) => resource.code !== BOTTLED_WATER) };
    expect(() => formulaMixFragment({ catalog: noBottled, units: { [POWDER_ID]: 1 } })).toThrow(/water\.bottled/u);
  });

  it("throws for an unknown product, and for a catalog with no resource of the prepared formula", () => {
    expect(() => formulaMixFragment({ catalog, units: { "test.unknown": 1 } })).toThrow(RangeError);
    const noReady: SupplyCatalog = { ...catalog, resources: catalog.resources.filter((resource) => resource.code !== FORMULA_READY) };
    expect(() => formulaMixFragment({ catalog: noReady, units: { [POWDER_ID]: 1 } })).toThrow(/food\.infant-formula-ready/u);
  });

  it("is not a food to cook: the cook fragment gives it no line", () => {
    const cook = cookFragment({ catalog, units: { [POWDER_ID]: 2 }, stove: { fuel: "fuel.propane" }, batch: { value: 0.5, unit: "kg" } });
    expect(cook.lines).toEqual([]);
    expect(cook.read).toBe(true);
  });
});

describe("the days of formula from powder on the endurance query", () => {
  /** A made-up boy of 1 month on formula. The infant table gives 566 kcal/d. */
  const persons: Person[] = [
    { sex: "female", ageMonths: 30 * 12, count: 1 },
    { sex: "male", ageMonths: 1, count: 1, feeding: "formula" },
  ];
  const foodCut: CaseCuts = { case: "test.food-cut", title: "A test stop of the food shops", cuts: [{ part: "food.retail", title: "No food shops", source: "test" }] };
  const at = "2026-11-24";

  /** A fragment with a store of water, in L. The default is commercially bottled water. */
  function water(litres: number, more: Partial<EnduranceLayer> = {}, resource: string = BOTTLED_WATER): EnduranceLayer {
    return { schema: "endurance/1", levels: [], resources: [{ code: resource, unit: "L" }], stores: litres > 0 ? [{ id: "test:water", resource, amount: litres }] : [], draws: [], ...more };
  }

  /** The days of the formula draw for a count of kg of powder and the layers of more fragments. */
  function formulaDays(kg: number, ...more: EnduranceLayer[]): number {
    const units = { [POWDER_ID]: kg };
    const food = householdFragment({ persons, activity: "sedentary", catalog, units, level: "critical", levels: ["life", "critical"] });
    if (food.layer === undefined) throw new Error(food.why);
    expect(food.layer.stores).toEqual([{ id: `buy:${POWDER_ID}:${FORMULA_POWDER}`, resource: FORMULA_POWDER, amount: kg }]);
    expect(food.layer.direct.map((use) => use.resource)).not.toContain(FORMULA_POWDER);
    const join = joinEndurance([
      { from: "food", layer: food.layer },
      { from: "mix", layer: formulaMixFragment({ catalog, units }).layer },
      ...more.map((layer, index) => ({ from: `more-${String(index)}`, layer })),
    ]);
    if (!join.ok) throw new Error(JSON.stringify(join.errors));
    expect(hasEnduranceError(checkEndurance(join.layer))).toBe(false);
    const days = enduranceOf(join.layer, foodCut, { at }).needs[FORMULA_NEED]?.days;
    if (days === undefined) throw new Error("The formula draw has no result.");
    return days;
  }

  it("gives 0 days of formula from powder with no water", () => {
    expect(formulaDays(2)).toBe(0);
  });

  it("the powder limits the days when the water is more", () => {
    // 2 kg of powder give 10480 kcal, 18.5 days at 566 kcal/d. The 100 L of water hold more.
    expect(formulaDays(2, water(100))).toBeCloseTo((2 * 5240) / 566, 6);
  });

  it("the water limits the days when it is the scarcest", () => {
    // 5 L of water mix 5 / 7.3175 kg of powder, which gives 3580.5 kcal.
    expect(formulaDays(2, water(5))).toBeCloseTo(((5 / WATER) * 5240) / 566, 6);
  });

  it("gives 0 days of formula from powder with only tap water, and names the bottled water as the binding resource", () => {
    const units = { [POWDER_ID]: 2, [TAP]: 30 };
    const food = householdFragment({ persons, activity: "sedentary", catalog, units, level: "critical", levels: ["critical"] });
    if (food.layer === undefined) throw new Error(food.why);
    expect(food.layer.converters).toEqual([]);
    const mix = formulaMixFragment({ catalog, units });
    const join = joinEndurance([
      { from: "food", layer: food.layer },
      { from: "mix", layer: mix.layer },
    ]);
    if (!join.ok) throw new Error(JSON.stringify(join.errors));
    expect(hasEnduranceError(checkEndurance(join.layer))).toBe(false);
    const result = enduranceOf(join.layer, foodCut, { at }).needs[FORMULA_NEED];
    expect(result?.days).toBe(0);
    expect(result?.binding).toContain(BOTTLED_WATER);
    expect(result?.binding).not.toContain(STORED_WATER);
    expect(mix.waterWhy).toContain("the powder gives 0 days");
  });

  it("feeds the powder from the jugs of the buy list", () => {
    // 2 kg of powder need 14.635 L of water. 2 jugs give 7.571 L, so the water limits the days.
    const units = { [POWDER_ID]: 2, [JUG]: 2, [TAP]: 30 };
    const food = householdFragment({ persons, activity: "sedentary", catalog, units, level: "critical", levels: ["critical"] });
    if (food.layer === undefined) throw new Error(food.why);
    const join = joinEndurance([
      { from: "food", layer: food.layer },
      { from: "mix", layer: formulaMixFragment({ catalog, units }).layer },
    ]);
    if (!join.ok) throw new Error(JSON.stringify(join.errors));
    expect(hasEnduranceError(checkEndurance(join.layer))).toBe(false);
    const result = enduranceOf(join.layer, foodCut, { at }).needs[FORMULA_NEED];
    expect(result?.days).toBeCloseTo((((2 * GALLON) / WATER) * 5240) / 566, 6);
    expect(result?.takes[STORED_WATER]).toBeUndefined();
  });

  describe("the bottled water and the drinking water", () => {
    const both: CaseCuts = { ...foodCut, cuts: [...foodCut.cuts, { part: "water.main", title: "No water main", source: "test" }] };
    /** A drinking draw of 2 L each day at a level, with the direct use of the stored water. */
    function drink(level: string): EnduranceLayer {
      return {
        schema: "endurance/1",
        levels: [],
        resources: [{ code: STORED_WATER, unit: "L" }],
        stores: [],
        draws: [{ need: WATER_NEED, level, perDay: 2, users: 1, supply: "water.main" }],
        direct: [{ resource: STORED_WATER, need: WATER_NEED, amount: 1 }],
      };
    }
    /** The needs of the joined fragments: a buy list, a drinking draw at a level, and the draws of the household at a level. */
    function needsOf(units: Readonly<Record<string, number>>, drinkLevel: string, foodLevel: string): ReturnType<typeof enduranceOf>["needs"] {
      const food = householdFragment({ persons, activity: "sedentary", catalog, units, level: foodLevel, levels: ["life", "critical"] });
      if (food.layer === undefined) throw new Error(food.why);
      const join = joinEndurance([
        { from: "food", layer: food.layer },
        { from: "mix", layer: formulaMixFragment({ catalog, units }).layer },
        { from: "drink", layer: drink(drinkLevel) },
      ]);
      if (!join.ok) throw new Error(JSON.stringify(join.errors));
      expect(hasEnduranceError(checkEndurance(join.layer))).toBe(false);
      return enduranceOf(join.layer, both, { at }).needs;
    }

    it("lets the drinking draw use the bottled water and the tap water, with no double count", () => {
      expect(needsOf({ [JUG]: 4 }, "life", "critical")[WATER_NEED]?.days).toBeCloseTo((4 * GALLON) / 2, 6);
      expect(needsOf({ [TAP]: 3 }, "life", "critical")[WATER_NEED]?.days).toBeCloseTo((3 * GALLON) / 2, 6);
      const needs = needsOf({ [JUG]: 4, [TAP]: 3 }, "life", "critical");
      expect(needs[WATER_NEED]?.days).toBeCloseTo((7 * GALLON) / 2, 6);
      // The draw takes the tap water first, then the bottled water through the subset converter.
      expect(needs[WATER_NEED]?.takes[STORED_WATER]).toBeCloseTo(3 * GALLON, 6);
      expect(needs[WATER_NEED]?.takes[BOTTLED_WATER]).toBeCloseTo(4 * GALLON, 6);
    });

    it("lets the endurance query share the bottled water between the formula and a drinking draw of the same level", () => {
      // The draws of one level take in the order of their codes: food.infant-formula, then hydration.drink.
      // 2 kg of powder hold 18.516 days and take 14.635 L of the 15.142 L of bottled water. The drinking draw takes the rest and the tap water.
      const needs = needsOf({ [POWDER_ID]: 2, [JUG]: 4, [TAP]: 2 }, "critical", "critical");
      expect(needs[FORMULA_NEED]?.days).toBeCloseTo((2 * 5240) / 566, 6);
      expect(needs[FORMULA_NEED]?.takes[BOTTLED_WATER]).toBeCloseTo(2 * WATER, 6);
      expect(needs[WATER_NEED]?.days).toBeCloseTo((6 * GALLON - 2 * WATER) / 2, 6);
    });

    it("keeps the water for a drinking draw of a higher level first", () => {
      // The drinking draw at the level life keeps back all the water for its days, so the powder adds 0 days.
      const needs = needsOf({ [POWDER_ID]: 2, [JUG]: 4, [TAP]: 2 }, "life", "critical");
      expect(needs[WATER_NEED]?.days).toBeCloseTo((6 * GALLON) / 2, 6);
      expect(needs[FORMULA_NEED]?.days).toBeCloseTo(0, 6);
    });
  });

  it("shares the water with a drinking draw of a higher level", () => {
    // A drinking draw of 2 L each day at the level life comes first, and it keeps back all of the 18 L.
    const drink = water(
      18,
      {
        levels: ["life", "critical"],
        draws: [{ need: WATER_NEED, level: "life", perDay: 2, users: 1, supply: "water.main" }],
        direct: [{ resource: STORED_WATER, need: WATER_NEED, amount: 1 }],
      },
      STORED_WATER,
    );
    const units = { [POWDER_ID]: 2 };
    const food = householdFragment({ persons, activity: "sedentary", catalog, units, level: "critical", levels: ["life", "critical"] });
    if (food.layer === undefined) throw new Error(food.why);
    const join = joinEndurance([
      { from: "food", layer: food.layer },
      { from: "mix", layer: formulaMixFragment({ catalog, units }).layer },
      { from: "drink", layer: drink },
    ]);
    if (!join.ok) throw new Error(JSON.stringify(join.errors));
    const both: CaseCuts = { ...foodCut, cuts: [...foodCut.cuts, { part: "water.main", title: "No water main", source: "test" }] };
    const needs = enduranceOf(join.layer, both, { at }).needs;
    expect(needs[WATER_NEED]?.days).toBeCloseTo(9, 6);
    expect(needs[FORMULA_NEED]?.days).toBeCloseTo(0, 6);
  });
});
