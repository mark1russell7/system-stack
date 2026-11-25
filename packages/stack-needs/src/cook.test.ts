import { checkSources } from "@mark1russell7/guidebook";
import { SUPPLY_CATALOG, type CitedRate, type StoveFacts, type SupplyCatalog, type SupplyProduct } from "@mark1russell7/market/supplies";
import { checkEndurance, enduranceOf, hasEnduranceError, joinEndurance, type CaseCuts, type EnduranceLayer } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import type { Person } from "./calorie.ts";
import { BOIL_CELSIUS, cookFragment, NIST_SI_GUIDE_SOURCE, NIST_WEBBOOK_WATER_SOURCE, USGS_WATER_DENSITY_SOURCE, WATER_DENSITY_MAX, WATER_DENSITY_MIN, WATER_SPECIFIC_HEAT, type CookFragmentInput, type CookLine, type StoveShare } from "./cook.ts";
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

    it("multiplies the boil fuel of the yield by the adverse factor, and keeps the cook part", () => {
      const fuelOf = (stove: StoveFacts): CookLine["fuel"] => lineOf(cookFragment({ ...noShare, stove }).lines, "test.grain-1kg").fuel;
      const adverse = (factor: number, bound?: string): object => ({ adverse: { factor, fact, ...(bound === undefined ? {} : { bound }) } });
      const withFactor = (more: object, factor: object): StoveFacts => ({ ...yieldStove(10, more), ...factor }) as StoveFacts;
      // A most factor gives the most boil fuel, also from a most yield. The cook part stays 20 min x 0.01 kg/min.
      for (const more of [{ bound: "most" }, { bound: "least" }, {}]) {
        const fuel = fuelOf(withFactor(more, adverse(2, "most")));
        expect(fuel.read && fuel.value).toBeCloseTo(2 * yieldBoil(10) + 20 * 0.01, 12);
      }
      // A factor with no bound is the value. It takes a yield with no bound, and not a most yield.
      const value = fuelOf(withFactor({}, adverse(2)));
      expect(value.read && value.value).toBeCloseTo(2 * yieldBoil(10) + 20 * 0.01, 12);
      const mostYield = fuelOf(withFactor({ bound: "most" }, adverse(2)));
      expect(mostYield.read).toBe(false);
      if (!mostYield.read) expect(mostYield.why).toMatch(/most yield with an adverse factor that has the bound most or a typical range/);
      // A factor with no range gives no spread.
      expect(lineOf(cookFragment({ ...noShare, stove: withFactor({}, adverse(2)) }).lines, "test.grain-1kg").fuelSpread).toBeUndefined();
      // A least factor gives too little fuel. A factor below 1 or not finite is a bad value of a catalog of a caller.
      const least = fuelOf(withFactor({}, adverse(2, "least")));
      expect(least.read).toBe(false);
      if (!least.read) expect(least.why).toMatch(/least factor gives too little fuel/);
      for (const bad of [0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const fuel = fuelOf(withFactor({}, adverse(bad, "most")));
        expect(fuel.read).toBe(false);
        if (!fuel.read) expect(fuel.why).toMatch(/finite number of 1 or more/);
      }
      // A factor of 1 gives the calm fuel.
      const one = fuelOf(withFactor({}, adverse(1, "most")));
      expect(one.read && one.value).toBeCloseTo(yieldBoil(10) + 20 * 0.01, 12);
    });

    it("takes a factor with a typical range as an estimate, also from a most yield, and gives the fuel at each end of the range", () => {
      const lineWith = (more: object, factor: object): CookLine =>
        lineOf(cookFragment({ ...noShare, stove: { ...yieldStove(10, more), ...factor } as StoveFacts }).lines, "test.grain-1kg");
      const cook = 20 * 0.01;
      for (const more of [{ bound: "most" }, {}]) {
        const line = lineWith(more, { adverse: { factor: 3, typical: { low: 2, high: 4 }, fact } });
        expect(line.fuel.read && line.fuel.value).toBeCloseTo(3 * yieldBoil(10) + cook, 12);
        expect(line.fuelSpread?.unit).toBe("kg");
        expect(line.fuelSpread?.low).toBeCloseTo(2 * yieldBoil(10) + cook, 12);
        expect(line.fuelSpread?.high).toBeCloseTo(4 * yieldBoil(10) + cook, 12);
      }
      // A bound and a range, a bad range, or a factor outside its range is a bad value of a catalog of a caller.
      const bad: [object, RegExp][] = [
        [{ factor: 4, typical: { low: 3, high: 4 }, bound: "most", fact }, /a bound and a typical range/],
        [{ factor: 4, typical: { low: 4, high: 3 }, fact }, /1 <= low <= high/],
        [{ factor: 1, typical: { low: 0.5, high: 2 }, fact }, /1 <= low <= high/],
        [{ factor: 4, typical: { low: 3, high: Number.POSITIVE_INFINITY }, fact }, /1 <= low <= high/],
        [{ factor: 4, typical: { low: 3 }, fact }, /1 <= low <= high/],
        [{ factor: 5, typical: { low: 3, high: 4 }, fact }, /outside its typical range 3 to 4/],
      ];
      for (const [adverse, why] of bad) {
        const line = lineWith({}, { adverse });
        expect(line.fuel.read).toBe(false);
        if (!line.fuel.read) expect(line.fuel.why).toMatch(why);
        expect(line.fuelSpread).toBeUndefined();
      }
    });

    it("gives the canister stove of the catalog an estimate of the fuel: its calm yield times the factor 4, the high end of its typical range of 3 to 4", () => {
      const line = cookFragment({ catalog: SUPPLY_CATALOG, units: { "food.rice-white-1kg": 1 }, stove: "heat.stove-canister-1-burner", batch: { value: 0.5, unit: "kg" } }).lines[0];
      if (line === undefined || !line.water.read || !line.fuel.read || !line.minutes.read) throw new Error("The canister line has no read.");
      // The pot of 0.5 kg starts at 0 °C. The test boils 16 L from 21 °C to 100 °C with 227 g of fuel.
      const heat = (line.water.value * 0.5 * WATER_DENSITY_MAX.value + 0.5) * WATER_SPECIFIC_HEAT.value * 100;
      const calmPerKg = (16 * WATER_DENSITY_MIN.value * WATER_SPECIFIC_HEAT.value * 79) / 0.227;
      const boil = heat / (calmPerKg / 4);
      const perMin = 0.227 / 60;
      // The rice cooks for 18 min at most after the boil, at the full rate of 227 g each hour.
      expect(line.fuel.value).toBeCloseTo(boil + 18 * perMin, 12);
      expect(line.minutes.value).toBeCloseTo(boil / perMin + 18, 9);
      expect(line.fuelSpread?.low).toBeCloseTo(heat / (calmPerKg / 3) + 18 * perMin, 12);
      expect(line.fuelSpread?.high).toBeCloseTo(line.fuel.value, 12);
    });
  });

  it("adds the soak water to the water take of a pot, with no heat and no fuel", () => {
    const withSoak = (soak: CitedRate, more: { readonly bulk?: CitedRate } = {}): CookFragmentInput => ({
      ...input,
      catalog: { ...catalog, products: catalog.products.map((product) => (product.id === grain.id ? { ...grain, cook: { ...grain.cook, soak, ...more } } : product)) },
    });
    // A made-up soak of 3 L for each kg. One pot of 0.5 kg takes 1 L of cook water and 1.5 L of soak water.
    const result = cookFragment(withSoak({ amount: 3, unit: "L", per: { amount: 1, unit: "kg" }, fact }));
    const line = lineOf(result.lines, "test.grain-1kg");
    expect(line.soak).toEqual({ read: true, value: 3, unit: "L/kg" });
    expect(line.heat.read && line.heat.value).toBeCloseTo(HEAT, 9);
    expect(line.fuel.read && line.fuel.value).toBeCloseTo(FUEL, 9);
    expect(result.layer.converters[0]?.takes.find((take) => take.resource === STORED_WATER)?.amount).toBeCloseTo(2.5, 12);
    // A soak for each volume of dry food with no bulk mass gives no L/kg, so the resource has no converter.
    const perVolume = cookFragment(withSoak({ amount: 3, unit: "L", per: { amount: 1, unit: "L" }, fact }));
    const noSoak = lineOf(perVolume.lines, "test.grain-1kg").soak;
    expect(noSoak.read).toBe(false);
    if (!noSoak.read) expect(noSoak.why).toMatch(/bulk mass/);
    expect(perVolume.layer.converters).toEqual([]);
    expect(perVolume.noReads.map((item) => item.resource)).toEqual(["food.test-grain"]);
    // With a bulk mass of 0.75 kg/L, the soak is 4 L for each kg.
    const bulk = cookFragment(withSoak({ amount: 3, unit: "L", per: { amount: 1, unit: "L" }, fact }, { bulk: { amount: 0.75, unit: "kg", per: { amount: 1, unit: "L" }, fact } }));
    expect(lineOf(bulk.lines, "test.grain-1kg").soak).toEqual({ read: true, value: 4, unit: "L/kg" });
  });

  describe("the soak methods", () => {
    /** The input with the cook facts of the made-up grain changed by `more`. */
    const grainWith = (more: object, base: CookFragmentInput = input): CookFragmentInput => ({
      ...base,
      catalog: { ...catalog, products: catalog.products.map((product) => (product.id === grain.id ? { ...grain, cook: { ...grain.cook, ...more } } : product)) },
    });
    const coldSoak: CitedRate = { amount: 3, unit: "L", per: { amount: 1, unit: "kg" }, fact };
    /** A made-up quick soak: 4 L for each kg, a boil of 2 to 3 min, and a stand of 60 min off the heat. */
    const quickSoak = { amount: 4, unit: "L", per: { amount: 1, unit: "kg" }, fact, boil: { low: 2, high: 3, unit: "min", fact }, stand: { low: 60, high: 60, unit: "min", fact } };
    // One pot of 0.5 kg takes 2 L of quick soak water. Its heat is (2 kg + 0.5 kg) x 4.19002 kJ/(kg.K) x 80 K.
    const SOAK_HEAT = 2.5 * 4.19002 * 80;
    const waterTake = (result: ReturnType<typeof cookFragment>): number | undefined => result.layer.converters[0]?.takes.find((take) => take.resource === STORED_WATER)?.amount;
    const unsoakedTime = { low: 40, high: 60, unit: "min", fact };

    it("keeps the output of the cold soak by default, with no new field", () => {
      for (const more of [{}, { soak: coldSoak }, { soak: coldSoak, quickSoak, unsoakedTime }]) {
        const before = cookFragment(grainWith(more));
        expect(JSON.stringify(cookFragment({ ...grainWith(more), soak: "cold" }))).toBe(JSON.stringify(before));
        expect(JSON.stringify(cookFragment({ ...grainWith(more), soak: undefined }))).toBe(JSON.stringify(before));
        expect(Object.keys(lineOf(before.lines, "test.grain-1kg"))).toEqual(["product", "resource", "energy", "water", "soak", "heat", "minutes", "fuel"]);
      }
      // The cold soak takes only the cold soak water, with no heat and no fuel. A quick soak fact does not change it.
      const cold = cookFragment(grainWith({ soak: coldSoak, quickSoak }));
      const line = lineOf(cold.lines, "test.grain-1kg");
      expect(line.soak).toEqual({ read: true, value: 3, unit: "L/kg" });
      expect(line.fuel.read && line.fuel.value).toBeCloseTo(FUEL, 12);
      expect(waterTake(cold)).toBeCloseTo(2.5, 12);
    });

    it("gives the quick soak water heat and fuel, and adds the water to the take", () => {
      const result = cookFragment({ ...grainWith({ soak: coldSoak, quickSoak }), soak: "quick" });
      const line = lineOf(result.lines, "test.grain-1kg");
      expect(line.soakMethod).toBe("quick");
      expect(line.soak).toEqual({ read: true, value: 4, unit: "L/kg" });
      expect(line.soakHeat?.read && line.soakHeat.value).toBeCloseTo(SOAK_HEAT, 9);
      expect(line.heat.read && line.heat.value).toBeCloseTo(HEAT, 9);
      // The soak heat goes into the pot at 250 kJ/min, and the soak water boils for 3 min at the full rate of 0.01 kg/min.
      expect(line.minutes.read && line.minutes.value).toBeCloseTo(MINUTES + SOAK_HEAT / 250 + 3, 9);
      expect(line.fuel.read && line.fuel.value).toBeCloseTo(FUEL + (SOAK_HEAT / 250) * 0.01 + 3 * 0.01, 12);
      // The take is 1 L of cook water and 2 L of quick soak water.
      expect(waterTake(result)).toBeCloseTo(3, 12);
      expect(result.layer.converters[0]?.takes[2]?.amount).toBeCloseTo(FUEL + (SOAK_HEAT / 250) * 0.01 + 0.03, 12);
      // A food with no soak facts takes no soak with the quick soak.
      const plain = lineOf(cookFragment({ ...input, soak: "quick" }).lines, "test.grain-1kg");
      expect(plain.soak).toEqual({ read: true, value: 0, unit: "L/kg" });
      expect(plain.soakHeat).toEqual({ read: true, value: 0, unit: "kJ" });
      expect(plain.fuel).toEqual(lineOf(cookFragment(input).lines, "test.grain-1kg").fuel);
      expect(plain.minutes).toEqual(lineOf(cookFragment(input).lines, "test.grain-1kg").minutes);
    });

    it("adds no fuel and no stove time for the stand time of the quick soak", () => {
      const { stand: _stand, ...noStand } = quickSoak;
      const lineWith = (soak: object): CookLine => lineOf(cookFragment({ ...grainWith({ quickSoak: soak }), soak: "quick" }).lines, "test.grain-1kg");
      const short = lineWith(noStand);
      const long = lineWith({ ...quickSoak, stand: { low: 600, high: 600, unit: "min", fact } });
      expect(short.fuel.read).toBe(true);
      expect(long.fuel).toEqual(short.fuel);
      expect(long.minutes).toEqual(short.minutes);
      expect(lineWith(quickSoak).fuel).toEqual(short.fuel);
      // The fuel takes the high end of the boil span.
      const longBoil = lineWith({ ...quickSoak, boil: { low: 2, high: 13, unit: "min", fact } });
      expect(longBoil.fuel.read && short.fuel.read && longBoil.fuel.value - short.fuel.value).toBeCloseTo(10 * 0.01, 12);
      const badBoil = lineWith({ ...quickSoak, boil: { low: 2, high: 3, unit: "kg", fact } });
      expect(badBoil.fuel.read).toBe(false);
      if (!badBoil.fuel.read) expect(badBoil.fuel.why).toMatch(/boil time of the quick soak/);
    });

    it("adds the quick soak fuel to each end of the spread of the adverse factor", () => {
      const { share: _share, ...noShare } = input;
      // A made-up yield of 10 L from 20 °C to 100 °C for 100 g of fuel, with a factor of 3 in a typical range of 2 to 4.
      const stove: StoveFacts = {
        ...massStove,
        boil: { amount: 10, unit: "L", per: { amount: 100, unit: "g" }, fact, start: { celsius: 20, fact }, end: { celsius: 100, fact } } as never,
        adverse: { factor: 3, typical: { low: 2, high: 4 }, fact } as never,
      };
      const calm = (10 * WATER_DENSITY_MIN.value * WATER_SPECIFIC_HEAT.value * 80) / 0.1;
      const line = lineOf(cookFragment({ ...grainWith({ quickSoak }, { ...noShare, stove }), soak: "quick" }).lines, "test.grain-1kg");
      const potFuel = (perKg: number): number => (HEAT + SOAK_HEAT) / perKg + 20 * 0.01 + 3 * 0.01;
      expect(line.fuel.read && line.fuel.value).toBeCloseTo(potFuel(calm / 3), 12);
      expect(line.fuelSpread?.low).toBeCloseTo(potFuel(calm / 2), 12);
      expect(line.fuelSpread?.high).toBeCloseTo(potFuel(calm / 4), 12);
    });

    it("gives a no read for the quick soak of a food with no cited quick soak", () => {
      const result = cookFragment({ ...grainWith({ soak: coldSoak }), soak: "quick" });
      const line = lineOf(result.lines, "test.grain-1kg");
      expect(line.soak.read).toBe(false);
      if (!line.soak.read) expect(line.soak.why).toMatch(/cold soak and no quick soak/);
      expect(line.soakHeat?.read).toBe(false);
      expect(line.fuel.read).toBe(false);
      expect(result.layer.converters).toEqual([]);
      expect(result.noReads.map((item) => item.resource)).toEqual(["food.test-grain"]);
      // A quick soak for each volume of dry food with no bulk mass gives no L/kg.
      const perVolume = lineOf(cookFragment({ ...grainWith({ quickSoak: { ...quickSoak, per: { amount: 1, unit: "L" } } }), soak: "quick" }).lines, "test.grain-1kg");
      expect(perVolume.soak.read).toBe(false);
      if (!perVolume.soak.read) expect(perVolume.soak.why).toMatch(/quick soak water .* bulk mass/);
    });

    it("gives a no read with no soak for a soaked food with no unsoaked cook time", () => {
      for (const more of [{ soak: coldSoak }, { quickSoak }]) {
        const result = cookFragment({ ...grainWith(more), soak: "none" });
        const line = lineOf(result.lines, "test.grain-1kg");
        expect(line.soakMethod).toBe("none");
        expect(line.soak).toEqual({ read: true, value: 0, unit: "L/kg" });
        expect(line.fuel.read).toBe(false);
        if (!line.fuel.read) expect(line.fuel.why).toMatch(/no unsoaked cook time/);
        expect(result.layer.converters).toEqual([]);
      }
    });

    it("gives a no read of the cook water with no soak for a soaked food, and keeps the time of a food with no soak facts", () => {
      // The cited cook water is for the food after its soak. The catalog cites no cook water for the food with no soak.
      const result = cookFragment({ ...grainWith({ soak: coldSoak, unsoakedTime }), soak: "none" });
      const line = lineOf(result.lines, "test.grain-1kg");
      expect(line.water.read).toBe(false);
      if (!line.water.read) expect(line.water.why).toMatch(/no cook water for the food with no soak/);
      expect(line.fuel.read).toBe(false);
      expect(line.soakHeat).toBeUndefined();
      expect(result.layer.converters).toEqual([]);
      // A food with no soak facts keeps its cook time, as with the cold soak.
      const plain = lineOf(cookFragment({ ...input, soak: "none" }).lines, "test.grain-1kg");
      const { soakMethod, ...rest } = plain;
      expect(soakMethod).toBe("none");
      expect(rest).toEqual(lineOf(cookFragment(input).lines, "test.grain-1kg"));
    });

    it("refuses an unknown soak method", () => {
      expect(() => cookFragment({ ...input, soak: "hot" as never })).toThrow(RangeError);
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

  it("check the range of the specific heat against the enthalpy table of the NIST Chemistry WebBook", () => {
    // A source with all rights reserved permits a fact with a citation.
    expect(checkSources([NIST_WEBBOOK_WATER_SOURCE], { require: ["by", "terms"], https: true, at: "2026-11-24" })).toEqual([]);
    expect(WATER_SPECIFIC_HEAT.check?.source).toBe(NIST_WEBBOOK_WATER_SOURCE);
    // The cited enthalpies of the liquid at 0.101325 MPa, in kJ/kg, and their temperatures in °C.
    const rows: readonly (readonly [number, number])[] = [
      [0.01, 0.103208],
      [90.01, 377.106],
      [99.9743, 419.058],
    ];
    for (const [celsius, enthalpy] of rows) expect(WATER_SPECIFIC_HEAT.check?.locator).toContain(`${String(enthalpy)} at ${celsius.toFixed(4)}`);
    const [boilC, boilKJ] = rows[2] ?? [0, 0];
    const share = (startC: number, startKJ: number): number => (WATER_SPECIFIC_HEAT.value * (boilC - startC)) / (boilKJ - startKJ) - 1;
    // The mean of the full range is 0.024% above the value. From 90 °C, the value gives 0.48% less heat.
    expect(share(0.01, 0.103208)).toBeCloseTo(-0.000244, 6);
    expect(share(90.01, 377.106)).toBeCloseTo(-0.0048, 5);
  });
});

describe("the cook fragment with the catalog of market", () => {
  // TEST DATA: a made-up stove that burns 227 g of propane in 90 min, and a made-up share of 0.5 at the higher heating value.
  const propane: StoveFacts = { fuel: "fuel.propane", rate: { amount: 227, unit: "g", per: { amount: 90, unit: "min" }, fact: "test.stove-rate" } };
  const catalogInput: CookFragmentInput = { catalog: SUPPLY_CATALOG, units: { "food.rice-white-1kg": 4, "food.pasta-dry-1kg": 2, "food.beans-dry-1kg": 2 }, stove: propane, batch: { value: 0.5, unit: "kg" }, share: { value: 0.5, heating: "higher", cite: "test.share" } };

  it("gives the fuel of rice, pasta and beans from their cited water and time", () => {
    const result = cookFragment(catalogInput);
    const perMin = 0.227 / 90;
    const rice = lineOf(result.lines, "food.rice-white-1kg");
    expect(rice.water.read && rice.water.value).toBeCloseTo(2.5577, 4);
    const water = (rice.water.read ? rice.water.value : 0) * 0.5;
    const heat = (water * WATER_DENSITY_MAX.value + 0.5) * WATER_SPECIFIC_HEAT.value * 100;
    const minutes = heat / (perMin * 50327.01675450612 * 0.5) + 18;
    expect(rice.fuel.read && rice.fuel.value).toBeCloseTo(minutes * perMin, 9);
    // From market 0.8.8, the catalog cites the cook water of pasta and the soak and cook water of beans.
    const pasta = lineOf(result.lines, "food.pasta-dry-1kg");
    const beans = lineOf(result.lines, "food.beans-dry-1kg");
    expect(pasta.water.read && pasta.water.value).toBeCloseTo(16.0232, 4);
    expect(beans.water.read && beans.water.value).toBeCloseTo(3.6511, 4);
    // The beans soak in 1.75 qt of water for each lb, which the cook discards. Rice and pasta cite no soak.
    expect(beans.soak.read && beans.soak.value).toBeCloseTo(3.6511, 4);
    expect(rice.soak).toEqual({ read: true, value: 0, unit: "L/kg" });
    expect(pasta.soak).toEqual({ read: true, value: 0, unit: "L/kg" });
    const legume = result.layer.converters.find((converter) => converter.id === "cook:food.legume-dry");
    const legumeWater = legume?.takes.find((take) => take.resource === "water.stored")?.amount;
    expect(legumeWater).toBeCloseTo((3.6511 + 3.6511) * 0.5, 3);
    for (const line of [pasta, beans]) {
      const pot = (line.water.read ? line.water.value : 0) * 0.5;
      expect(line.heat.read && line.heat.value).toBeCloseTo((pot * WATER_DENSITY_MAX.value + 0.5) * WATER_SPECIFIC_HEAT.value * 100, 6);
      expect(line.fuel.read && line.minutes.read && line.fuel.value).toBeCloseTo((line.minutes.read ? line.minutes.value : 0) * perMin, 9);
    }
    expect(result.layer.converters.map((converter) => converter.id)).toEqual(["cook:food.grain-dry", "cook:food.pasta-dry", "cook:food.legume-dry"]);
    expect(result.noReads).toEqual([]);
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
