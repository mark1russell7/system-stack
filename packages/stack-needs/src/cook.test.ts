import { checkSources } from "@mark1russell7/guidebook";
import { SUPPLY_CATALOG, type StoveFacts, type SupplyCatalog, type SupplyProduct } from "@mark1russell7/market/supplies";
import { checkEndurance, enduranceOf, hasEnduranceError, joinEndurance, type CaseCuts, type EnduranceLayer } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import type { Person } from "./calorie.ts";
import { BOIL_CELSIUS, cookFragment, NIST_SI_GUIDE_SOURCE, USGS_WATER_DENSITY_SOURCE, WATER_DENSITY_MAX, WATER_DENSITY_MIN, WATER_SPECIFIC_HEAT, type CookFragmentInput, type CookLine, type StoveShare } from "./cook.ts";
import { householdFragment } from "./household.ts";
import { FOOD_NEED, STORED_WATER, WATER_NEED } from "./uses.ts";

// TEST DATA: each food, stove, share, fuel energy and start temperature of this file is made up, with the license `invented`.
// Only the tests that name SUPPLY_CATALOG use the cited facts of the catalog of market.

const fact = "test.fact";
const cited = (amount: number, unit: string) => ({ read: true as const, amount, unit, fact });

/** A made-up dry grain: 3000 kcal and 2 L of cook water for each kg, and 10 to 20 min of cook time. */
const grain: SupplyProduct = {
  id: "test.grain-1kg",
  title: "A made-up dry grain of 1 kg",
  kind: "food",
  gives: [{ resource: "food.test-grain", amount: cited(1, "kg") }],
  energy: cited(3000, "kcal"),
  shelf: { read: false, why: "Test data." },
  cook: { water: { amount: 2, unit: "L", per: { amount: 1, unit: "kg" }, fact }, time: { low: 10, high: 20, unit: "min", fact } },
};

/** A made-up second grain of the same resource: more water and less energy than `grain`. */
const coarse: SupplyProduct = {
  ...grain,
  id: "test.coarse-1kg",
  title: "A made-up coarse grain of 1 kg",
  energy: cited(2800, "kcal"),
  cook: { water: { amount: 3, unit: "L", per: { amount: 1, unit: "kg" }, fact }, time: { low: 5, high: 10, unit: "min", fact } },
};

/** A made-up dry food with a cook time and no cited water. */
const noWater: SupplyProduct = { ...grain, id: "test.noodle-1kg", title: "A made-up noodle of 1 kg", gives: [{ resource: "food.test-noodle", amount: cited(1, "kg") }], cook: { time: { low: 5, high: 8, unit: "min", fact } } };

/** A made-up stove of the catalog: 10 g of the test fuel each minute. */
const stoveProduct: SupplyProduct = {
  id: "test.stove",
  title: "A made-up stove",
  kind: "heat",
  gives: [],
  basis: fact,
  shelf: { read: false, why: "Test data." },
  stove: { fuel: "fuel.test", rate: { amount: 10, unit: "g", per: { amount: 1, unit: "min" }, fact } },
};

/** A made-up catalog. The test fuel has 50000 kJ/kg at the lower heating value. `fuel.bare` has no cited energy. */
const catalog: SupplyCatalog = {
  format: "supply-catalog/1",
  sources: [{ id: "test.source", title: "Made-up test data", url: "https://example.org/test", license: "invented", checked: "2026-11-24" }],
  facts: [{ id: fact, use: "fact", text: "A made-up value for the tests.", source: "test.source" }],
  resources: [
    { code: "food.test-grain", unit: "kg", title: "Made-up dry grain", kind: "food" },
    { code: "food.test-noodle", unit: "kg", title: "Made-up dry noodle", kind: "food" },
    { code: "food.no-cook", unit: "kcal", title: "Food to eat with no water and no fuel", kind: "food" },
    { code: STORED_WATER, unit: "L", title: "Stored drinking water", kind: "water" },
    { code: "fuel.test", unit: "kg", title: "Made-up fuel", kind: "heat", fuelEnergy: { amount: 50000, unit: "kJ", per: { amount: 1, unit: "kg" }, fact, heating: "lower" } },
    { code: "fuel.bare", unit: "kg", title: "Made-up fuel with no cited energy", kind: "heat" },
  ],
  products: [grain, coarse, noWater, stoveProduct],
};

/** A made-up share of 0.5 at the lower heating value. */
const share: StoveShare = { value: 0.5, heating: "lower", cite: fact };
const massStove: StoveFacts = { fuel: "fuel.test", rate: { amount: 10, unit: "g", per: { amount: 1, unit: "min" }, fact } };
/** The same heat as `massStove` as an energy rate: 0.01 kg/min times 50000 kJ/kg. */
const energyStove: StoveFacts = { fuel: "fuel.test", rate: { amount: 500, unit: "kJ", per: { amount: 1, unit: "min" }, fact }, heating: "lower" };

const input: CookFragmentInput = { catalog, units: { "test.grain-1kg": 10 }, stove: massStove, batch: { value: 0.5, unit: "kg" }, share, start: { celsius: 20, cite: fact } };

// One pot of 0.5 kg takes 1 L of water. The heat is (1 kg + 0.5 kg) x 4.19002 kJ/(kg.K) x 80 K. The pot gets 0.01 x 50000 x 0.5 = 250 kJ/min.
const HEAT = 1.5 * 4.19002 * 80;
const MINUTES = HEAT / 250 + 20;
const FUEL = MINUTES * 0.01;

function lineOf(lines: readonly CookLine[], product: string): CookLine {
  const line = lines.find((item) => item.product === product);
  if (line === undefined) throw new Error(`No line for ${product}.`);
  return line;
}

describe("the cook fragment", () => {
  it("gives one converter of one pot: the dry food, its cook water and its fuel give the food energy of the pot", () => {
    const result = cookFragment(input);
    expect(result.read).toBe(true);
    expect(result.noReads).toEqual([]);
    const line = lineOf(result.lines, "test.grain-1kg");
    expect(line.energy).toEqual({ read: true, value: 3000, unit: "kcal/kg" });
    expect(line.water).toEqual({ read: true, value: 2, unit: "L/kg" });
    expect(line.heat.read && line.heat.value).toBeCloseTo(HEAT, 9);
    expect(line.minutes.read && line.minutes.value).toBeCloseTo(MINUTES, 9);
    expect(line.fuel.read && line.fuel.value).toBeCloseTo(FUEL, 9);
    expect(result.layer.converters).toHaveLength(1);
    const converter = result.layer.converters[0];
    expect(converter?.id).toBe("cook:food.test-grain");
    expect(converter?.gives).toEqual({ need: FOOD_NEED, amount: 1500 });
    expect(converter?.takes[0]).toEqual({ resource: "food.test-grain", amount: 0.5 });
    expect(converter?.takes[1]).toEqual({ resource: STORED_WATER, amount: 1 });
    expect(converter?.takes[2]?.resource).toBe("fuel.test");
    expect(converter?.takes[2]?.amount).toBeCloseTo(FUEL, 9);
    expect(result.layer.resources).toEqual([
      { code: "food.test-grain", unit: "kg" },
      { code: STORED_WATER, unit: "L" },
      { code: "fuel.test", unit: "kg" },
    ]);
    // The type gate of the copied shape: the fragment has the form of `EnduranceLayer` of stack-endurance.
    const layer: EnduranceLayer = result.layer;
    expect(hasEnduranceError(checkEndurance(layer))).toBe(false);
  });

  it("gives the same fuel for an energy rate through the cited fuel energy of the same heating value", () => {
    const line = lineOf(cookFragment({ ...input, stove: energyStove }).lines, "test.grain-1kg");
    expect(line.fuel.read && line.fuel.value).toBeCloseTo(FUEL, 9);
  });

  it("takes the stove of a product of the catalog", () => {
    const line = lineOf(cookFragment({ ...input, stove: "test.stove" }).lines, "test.grain-1kg");
    expect(line.fuel.read && line.fuel.value).toBeCloseTo(FUEL, 9);
    expect(() => cookFragment({ ...input, stove: "test.grain-1kg" })).toThrow(RangeError);
    expect(() => cookFragment({ ...input, stove: "test.none" })).toThrow(RangeError);
  });

  it("starts the water at 0 °C by default, which gives the most heat", () => {
    const { start: _start, ...cold } = input;
    const line = lineOf(cookFragment(cold).lines, "test.grain-1kg");
    expect(line.heat.read && line.heat.value).toBeCloseTo(1.5 * WATER_SPECIFIC_HEAT.value * BOIL_CELSIUS, 9);
  });

  it("gives no fuel with no cited share, and keeps the read of the water", () => {
    const { share: _share, ...bare } = input;
    const result = cookFragment(bare);
    const line = lineOf(result.lines, "test.grain-1kg");
    expect(line.water.read).toBe(true);
    expect(line.heat.read).toBe(true);
    expect(line.fuel.read).toBe(false);
    if (!line.fuel.read) expect(line.fuel.why).toMatch(/stove share/);
    expect(result.layer.converters).toEqual([]);
    expect(result.read).toBe(false);
    expect(result.noReads.map((item) => item.resource)).toEqual(["food.test-grain"]);
  });

  it("gives no fuel for a food with a cook time and no cited water", () => {
    const result = cookFragment({ ...input, units: { "test.noodle-1kg": 2 } });
    const line = lineOf(result.lines, "test.noodle-1kg");
    expect(line.water.read).toBe(false);
    expect(line.heat.read).toBe(false);
    expect(line.fuel.read).toBe(false);
    if (!line.fuel.read) expect(line.fuel.why).toMatch(/cook water/);
    expect(result.layer.converters).toEqual([]);
  });

  it("gives no fuel when a heating value does not agree", () => {
    const higherShare = cookFragment({ ...input, share: { ...share, heating: "higher" } });
    const shareLine = lineOf(higherShare.lines, "test.grain-1kg");
    expect(shareLine.fuel.read).toBe(false);
    if (!shareLine.fuel.read) expect(shareLine.fuel.why).toMatch(/lower value/);
    const higherRate = cookFragment({ ...input, stove: { ...energyStove, heating: "higher" }, share: { ...share, heating: "higher" } });
    const rateLine = lineOf(higherRate.lines, "test.grain-1kg");
    expect(rateLine.fuel.read).toBe(false);
    if (!rateLine.fuel.read) expect(rateLine.fuel.why).toMatch(/stove rate is for the higher heating value/);
    const noHeating = cookFragment({ ...input, stove: { fuel: "fuel.test", rate: energyStove.rate } });
    expect(lineOf(noHeating.lines, "test.grain-1kg").fuel.read).toBe(false);
  });

  it("gives no fuel for a fuel with no cited energy, and no fuel for a stove with no rate", () => {
    for (const stove of [
      { ...massStove, fuel: "fuel.bare" },
      { ...energyStove, fuel: "fuel.bare" },
      { fuel: "fuel.test" },
    ]) {
      const line = lineOf(cookFragment({ ...input, stove }).lines, "test.grain-1kg");
      expect(line.water.read).toBe(true);
      expect(line.fuel.read).toBe(false);
    }
  });

  it("gives no fuel for a stove rate with a bound, because only a rate with no bound is the value", () => {
    for (const bound of ["least", "most"]) {
      const rate = { ...massStove.rate!, bound: bound as never };
      const stove: StoveFacts = { ...massStove, rate };
      const line = lineOf(cookFragment({ ...input, stove }).lines, "test.grain-1kg");
      expect(line.water.read).toBe(true);
      expect(line.fuel.read).toBe(false);
      expect(line.minutes.read).toBe(false);
      if (!line.fuel.read) expect(line.fuel.why).toContain(`the bound ${bound}`);
      // Only a least rate gives too little fuel. Another bound has no known side.
      if (!line.fuel.read) expect(line.fuel.why.includes("too little fuel")).toBe(bound === "least");
    }
    // A rate with no field bound keeps its read.
    expect(lineOf(cookFragment({ ...input, stove: massStove }).lines, "test.grain-1kg").fuel.read).toBe(true);
  });

  it("takes the worst case of two foods of one resource: the most water, the most fuel and the least energy", () => {
    const result = cookFragment({ ...input, units: { "test.grain-1kg": 1, "test.coarse-1kg": 1 } });
    const fuels = result.lines.map((line) => (line.fuel.read ? line.fuel.value : Number.NaN));
    const converter = result.layer.converters[0];
    expect(result.layer.converters).toHaveLength(1);
    expect(converter?.gives.amount).toBe(2800 * 0.5);
    expect(converter?.takes[1]?.amount).toBe(3 * 0.5);
    expect(converter?.takes[2]?.amount).toBeCloseTo(Math.max(...fuels), 12);
  });

  it("gives no energy to a product that gives two foods, because the catalog gives one energy for the whole product", () => {
    const mix: SupplyProduct = {
      ...grain,
      id: "test.mix-1kg",
      title: "A made-up mix of grain and noodle",
      gives: [
        { resource: "food.test-grain", amount: cited(0.5, "kg") },
        { resource: "food.test-noodle", amount: cited(0.5, "kg") },
      ],
    };
    const result = cookFragment({ ...input, catalog: { ...catalog, products: [...catalog.products, mix] }, units: { "test.mix-1kg": 1 } });
    expect(result.lines).toHaveLength(2);
    for (const line of result.lines) {
      expect(line.energy.read).toBe(false);
      if (!line.energy.read) expect(line.energy.why).toMatch(/gives 2 foods/);
    }
    expect(result.layer.converters).toEqual([]);
    expect(result.read).toBe(false);
  });

  it("refuses an id of the buy list that the catalog does not have", () => {
    expect(() => cookFragment({ ...input, units: { "test.absent": 1 } })).toThrow(/no product "test.absent"/);
  });

  describe("the boil fuel from a boil yield of the stove", () => {
    /** A made-up yield: the test boils `litres` of water from 20 °C to 100 °C with 100 g of fuel. */
    const yieldOf = (litres: number, more: object = {}) => ({ amount: litres, unit: "L", per: { amount: 100, unit: "g" }, fact, start: { celsius: 20, fact }, end: { celsius: 100, fact }, ...more });
    const yieldStove = (litres: number, more: object = {}): StoveFacts => ({ ...massStove, boil: yieldOf(litres, more) as never });
    const { share: _share, ...noShare } = input;
    /** The boil fuel of one pot from a yield: the heat of the pot over the heat of 1 kg of fuel in the test, with the least density of water. */
    const yieldBoil = (litres: number): number => HEAT / ((litres * WATER_DENSITY_MIN.value * WATER_SPECIFIC_HEAT.value * 80) / 0.1);

    it("gives the fuel with no share and no fuel energy, and the boil time from the mass rate", () => {
      for (const fuel of ["fuel.test", "fuel.bare"]) {
        const line = lineOf(cookFragment({ ...noShare, stove: { ...yieldStove(10), fuel } }).lines, "test.grain-1kg");
        expect(line.fuel.read && line.fuel.value).toBeCloseTo(yieldBoil(10) + 20 * 0.01, 12);
        expect(line.minutes.read && line.minutes.value).toBeCloseTo(yieldBoil(10) / 0.01 + 20, 9);
      }
      // The specific heat cancels: the boil fuel is the test fuel times the pot mass and rise over the test water mass and rise.
      expect(yieldBoil(10)).toBeCloseTo((0.1 * 1.5 * 80) / (10 * WATER_DENSITY_MIN.value * 80), 12);
    });

    it("takes the most boil fuel of the share and the yield", () => {
      // The share gives HEAT / 250 x 0.01 = 0.0201 kg. A yield of 10 L gives 0.0156 kg, and a yield of 2 L gives 0.0782 kg.
      expect(yieldBoil(10)).toBeLessThan((HEAT / 250) * 0.01);
      expect(yieldBoil(2)).toBeGreaterThan((HEAT / 250) * 0.01);
      const both = (litres: number): CookLine => lineOf(cookFragment({ ...input, stove: yieldStove(litres) }).lines, "test.grain-1kg");
      const ten = both(10);
      const two = both(2);
      expect(ten.fuel.read && ten.fuel.value).toBeCloseTo(FUEL, 12);
      expect(two.fuel.read && two.fuel.value).toBeCloseTo(yieldBoil(2) + 20 * 0.01, 12);
    });

    it("gives no boil fuel from a most yield, a yield of an unknown bound or a yield with no cited start", () => {
      const fuelOf = (stove: StoveFacts, withShare = false): CookLine["fuel"] => lineOf(cookFragment({ ...(withShare ? input : noShare), stove }).lines, "test.grain-1kg").fuel;
      const most = fuelOf(yieldStove(10, { bound: "most" }));
      expect(most.read).toBe(false);
      if (!most.read) expect(most.why).toMatch(/most yield gives too little fuel/);
      const unknown = fuelOf(yieldStove(10, { bound: "exact" }));
      expect(unknown.read).toBe(false);
      if (!unknown.read) expect(unknown.why.includes("too little fuel")).toBe(false);
      const noStart = fuelOf(yieldStove(10, { start: undefined }));
      expect(noStart.read).toBe(false);
      if (!noStart.read) expect(noStart.why).toMatch(/no cited start/);
      const badUnit = fuelOf(yieldStove(10, { unit: "kg" }));
      expect(badUnit.read).toBe(false);
      const noEnd = fuelOf(yieldStove(10, { end: undefined }));
      expect(noEnd.read).toBe(false);
      if (!noEnd.read) expect(noEnd.why).toMatch(/no cited end/);
      for (const end of [{ celsius: 20, fact }, { celsius: 101, fact }, { celsius: 95 }])
        expect(fuelOf(yieldStove(10, { end })).read).toBe(false);
      // A least yield gives the most fuel, so it has a read.
      const least = fuelOf(yieldStove(10, { bound: "least" }));
      expect(least.read && least.value).toBeCloseTo(yieldBoil(10) + 20 * 0.01, 12);
      // A share keeps its read beside a yield with no read.
      const shared = fuelOf(yieldStove(10, { bound: "most" }), true);
      expect(shared.read && shared.value).toBeCloseTo(FUEL, 12);
      // A yield does not make up for a stove rate with a bound: the cook part has no rate.
      const boundRate = fuelOf({ ...yieldStove(10), rate: { ...massStove.rate!, bound: "least" as never } });
      expect(boundRate.read).toBe(false);
    });

    it("gives more fuel for a yield tested at a high place, where the test water boils below 100 °C", () => {
      const fuelAt = (endC: number): number => {
        const line = lineOf(cookFragment({ ...noShare, stove: yieldStove(10, { end: { celsius: endC, fact } }) }).lines, "test.grain-1kg");
        return line.fuel.read ? line.fuel.value : Number.NaN;
      };
      expect(fuelAt(95)).toBeGreaterThan(fuelAt(100));
      // The boil fuel grows by the ratio of the rises: 80 K at the sea over 75 K at the high place.
      expect(fuelAt(95) - 20 * 0.01).toBeCloseTo(yieldBoil(10) * (80 / 75), 12);
    });

    it("gives no fuel for the canister stove of the catalog: its yield is the calm test of the maker", () => {
      const line = cookFragment({ catalog: SUPPLY_CATALOG, units: { "food.rice-white-1kg": 1 }, stove: "heat.stove-canister-1-burner", batch: { value: 0.5, unit: "kg" } }).lines[0];
      expect(line?.water.read).toBe(true);
      expect(line?.fuel.read).toBe(false);
      if (line !== undefined && !line.fuel.read) expect(line.fuel.why).toMatch(/bound most/);
    });
  });

  it("refuses a bad batch, share or start", () => {
    expect(() => cookFragment({ ...input, batch: { value: 0, unit: "kg" } })).toThrow(RangeError);
    expect(() => cookFragment({ ...input, batch: { value: 1, unit: "L" } })).toThrow(RangeError);
    expect(() => cookFragment({ ...input, share: { ...share, value: 1.5 } })).toThrow(RangeError);
    expect(() => cookFragment({ ...input, start: { celsius: 100, cite: fact } })).toThrow(RangeError);
    expect(() => cookFragment({ ...input, stove: { fuel: "fuel.none" } })).toThrow(RangeError);
  });
});

describe("the cited constants", () => {
  it("cite real sources with a publisher, the page of the terms and HTTPS addresses", () => {
    expect(checkSources([NIST_SI_GUIDE_SOURCE, USGS_WATER_DENSITY_SOURCE], { require: ["by", "terms"], https: true, at: "2026-11-24" })).toEqual([]);
    expect(WATER_SPECIFIC_HEAT.source).toBe(NIST_SI_GUIDE_SOURCE);
    expect(WATER_DENSITY_MAX.source).toBe(USGS_WATER_DENSITY_SOURCE);
    expect(WATER_DENSITY_MIN.source).toBe(USGS_WATER_DENSITY_SOURCE);
    expect(WATER_DENSITY_MIN.value).toBeLessThan(WATER_DENSITY_MAX.value);
  });
});

describe("the cook fragment with the catalog of market", () => {
  // TEST DATA: a made-up stove that burns 227 g of propane in 90 min, and a made-up share of 0.5 at the higher heating value.
  const propane: StoveFacts = { fuel: "fuel.propane", rate: { amount: 227, unit: "g", per: { amount: 90, unit: "min" }, fact: "test.stove-rate" } };
  const catalogInput: CookFragmentInput = { catalog: SUPPLY_CATALOG, units: { "food.rice-white-1kg": 4, "food.pasta-dry-1kg": 2, "food.beans-dry-1kg": 2 }, stove: propane, batch: { value: 0.5, unit: "kg" }, share: { value: 0.5, heating: "higher", cite: "test.share" } };

  it("gives the fuel of rice from its cited water and time, and no fuel for pasta and beans", () => {
    const result = cookFragment(catalogInput);
    const rice = lineOf(result.lines, "food.rice-white-1kg");
    expect(rice.water.read && rice.water.value).toBeCloseTo(2.5577, 4);
    const water = (rice.water.read ? rice.water.value : 0) * 0.5;
    const heat = (water * WATER_DENSITY_MAX.value + 0.5) * WATER_SPECIFIC_HEAT.value * 100;
    const perMin = 0.227 / 90;
    const minutes = heat / (perMin * 50327.01675450612 * 0.5) + 18;
    expect(rice.fuel.read && rice.fuel.value).toBeCloseTo(minutes * perMin, 9);
    // Pasta has a cited time and no cited water. By time alone it looks cheaper than rice, so it is a no read.
    const pasta = lineOf(result.lines, "food.pasta-dry-1kg");
    expect(pasta.fuel.read).toBe(false);
    // The catalog cites a soak for beans and no amount of water. Thus no water and no fuel.
    const beans = lineOf(result.lines, "food.beans-dry-1kg");
    expect(beans.water.read).toBe(false);
    expect(beans.fuel.read).toBe(false);
    expect(result.layer.converters.map((converter) => converter.id)).toEqual(["cook:food.grain-dry"]);
    expect(result.noReads.map((item) => item.resource)).toEqual(["food.pasta-dry", "food.legume-dry"]);
  });
});

describe("the gate of cooked days on the endurance query", () => {
  /** One made-up man of 33 years. Sedentary, this person needs 2400 kcal each day: 1.6 pots, thus 0.8 kg of grain and 1.6 L of water each day. */
  const persons: Person[] = [{ sex: "male", ageMonths: 33 * 12, count: 1 }];
  const DAILY_POTS = 2400 / 1500;
  const foodCut: CaseCuts = { case: "test.food-cut", title: "A test stop of the food shops", cuts: [{ part: "food.retail", title: "No food shops", source: "test" }] };

  /** A fragment of the stores of the water and the fuel. */
  function stores(waterL: number, fuelKg: number): EnduranceLayer {
    return {
      schema: "endurance/1",
      levels: [],
      resources: [
        { code: STORED_WATER, unit: "L" },
        { code: "fuel.test", unit: "kg" },
      ],
      stores: [
        ...(waterL > 0 ? [{ id: "test:water", resource: STORED_WATER, amount: waterL }] : []),
        ...(fuelKg > 0 ? [{ id: "test:fuel", resource: "fuel.test", amount: fuelKg }] : []),
      ],
      draws: [],
    };
  }

  /** The cooked days of the food draw, and the used-up inputs, for a buy list of grain and the stores of water and fuel. */
  function cooked(grainKg: number, waterL: number, fuelKg: number): { days: number; binding: readonly string[] } {
    const units = { "test.grain-1kg": grainKg };
    const food = householdFragment({ persons, activity: "sedentary", catalog, units, level: "critical", levels: ["critical"] });
    if (food.layer === undefined) throw new Error(food.why);
    const cook = cookFragment({ ...input, units });
    const join = joinEndurance([
      { from: "food", layer: food.layer },
      { from: "cook", layer: cook.layer },
      { from: "stores", layer: stores(waterL, fuelKg) },
    ]);
    if (!join.ok) throw new Error(JSON.stringify(join.errors));
    expect(hasEnduranceError(checkEndurance(join.layer))).toBe(false);
    const result = enduranceOf(join.layer, foodCut, { at: "2026-11-24" }).needs[FOOD_NEED];
    if (result === undefined) throw new Error("The food draw has no result.");
    return result;
  }

  /** The used-up inputs of the cook: the list leaves out `food.no-cook`, which has no store in these tests. */
  const binding = (list: readonly string[]): string[] => list.filter((code) => code !== "food.no-cook");

  it("(a) gives 0 cooked days to a food that needs cooking when the layer has no fuel", () => {
    const none = cooked(10, 100, 0);
    expect(none.days).toBe(0);
    expect(binding(none.binding)).toContain("fuel.test");
    expect(cooked(10, 100, 10).days).toBeGreaterThan(0);
  });

  it("(b) the water limits the cooked days when it is the scarcest", () => {
    // 10 kg of grain hold 12.5 days, 10 kg of fuel hold 28 days and 8 L of water hold 5 days.
    const result = cooked(10, 8, 10);
    expect(result.days).toBeCloseTo(8 / DAILY_POTS, 4);
    expect(binding(result.binding)).toEqual([STORED_WATER]);
  });

  it("(b) the fuel limits the cooked days when it is the scarcest", () => {
    // 1 kg of fuel holds 1 / (1.6 x the fuel of a pot) days, less than the 12.5 days of the grain and the 62.5 days of the water.
    const result = cooked(10, 100, 1);
    expect(result.days).toBeCloseTo(1 / (DAILY_POTS * FUEL), 4);
    expect(binding(result.binding)).toEqual(["fuel.test"]);
  });

  it("(b) the food limits the cooked days when it is the scarcest", () => {
    // 2 kg of grain hold 2.5 days.
    const result = cooked(2, 100, 10);
    expect(result.days).toBeCloseTo(2 / (DAILY_POTS * 0.5), 4);
    expect(binding(result.binding)).toEqual(["food.test-grain"]);
  });

  it("shares the water with a drinking draw of a higher level", () => {
    // A drinking draw of 2 L each day at the level life comes first. 18 L hold it 9 days, and it keeps back all the water.
    const drink: EnduranceLayer = {
      schema: "endurance/1",
      levels: ["life", "critical"],
      resources: [{ code: STORED_WATER, unit: "L" }],
      stores: [],
      draws: [{ need: WATER_NEED, level: "life", perDay: 2, users: 1, supply: "water.main" }],
      direct: [{ resource: STORED_WATER, need: WATER_NEED, amount: 1 }],
    };
    const food = householdFragment({ persons, activity: "sedentary", catalog, units: { "test.grain-1kg": 10 }, level: "critical", levels: ["life", "critical"] });
    if (food.layer === undefined) throw new Error(food.why);
    const join = joinEndurance([
      { from: "food", layer: food.layer },
      { from: "cook", layer: cookFragment(input).layer },
      { from: "stores", layer: stores(18, 10) },
      { from: "drink", layer: drink },
    ]);
    if (!join.ok) throw new Error(JSON.stringify(join.errors));
    const both: CaseCuts = { ...foodCut, cuts: [...foodCut.cuts, { part: "water.main", title: "No water main", source: "test" }] };
    const needs = enduranceOf(join.layer, both, { at: "2026-11-24" }).needs;
    expect(needs[WATER_NEED]?.days).toBeCloseTo(9, 6);
    expect(needs[FOOD_NEED]?.days).toBeCloseTo(0, 6);
  });
});
