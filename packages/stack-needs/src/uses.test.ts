import { NEEDS } from "@mark1russell7/alerts";
import { SUPPLY_CATALOG, type SupplyCatalog } from "@mark1russell7/market/supplies";
import type { Converter, DirectUse } from "@mark1russell7/stack-endurance";
import { SUPPLY_PARTS } from "@mark1russell7/stack-hazards";
import { describe, expect, it } from "vitest";
import { householdFragment, type HouseholdFragmentInput, type HouseholdFragmentRead } from "./household.ts";
import {
  BOTTLED_WATER,
  checkJoins,
  DIRECT_USES,
  FOOD_NEED,
  FORMULA_NEED,
  FORMULA_READY,
  JOIN_CODES,
  NEED_SUPPLIES,
  NO_COOK,
  RESOURCE_SUBSETS,
  STORED_WATER,
  subsetConverters,
  WATER_NEED,
  type JoinReferences,
} from "./uses.ts";

/** The real reference lists: the needs of alerts and the reference parts of stack-hazards. */
const references: JoinReferences = { needs: NEEDS, parts: SUPPLY_PARTS };

/** The type gate of the copy of the form: the direct uses are direct uses of stack-endurance. */
const typed: readonly DirectUse[] = DIRECT_USES;

/** The type gate of the supplies: the exact keys of NEED_SUPPLIES are a record of strings. */
const supplies: Readonly<Record<string, string>> = NEED_SUPPLIES;

/** The resource of the stored water of the catalog. The test resources are copies of it with a different code and unit. */
const water = SUPPLY_CATALOG.resources.find((resource) => resource.code === STORED_WATER);
if (water === undefined) throw new Error(`The catalog has no resource ${STORED_WATER}.`);

/** A copy of the catalog with test resources: water in gal, a resource in {dose}, and a test food in kcal. */
const CATALOG: SupplyCatalog = {
  ...SUPPLY_CATALOG,
  resources: [
    ...SUPPLY_CATALOG.resources,
    { ...water, code: "water.test-gal", unit: "gal" },
    { ...water, code: "test.dose", unit: "{dose}" },
    { ...water, code: "food.test-ration", unit: "kcal" },
  ],
};

/** This function gives the codes, the records and the ids of the findings of a call. */
function codesOf(...args: Parameters<typeof checkJoins>): [string, string, string][] {
  return checkJoins(...args).map((finding): [string, string, string] => [finding.code, finding.record, finding.id]);
}

describe("the reference codes", () => {
  it("gives FOOD_NEED and WATER_NEED as needs of alerts, with the units of their resources", () => {
    const unitOf = new Map(NEEDS.map((need) => [need.code, need.unit]));
    expect(unitOf.get(FOOD_NEED)).toBe("kcal");
    expect(unitOf.get(WATER_NEED)).toBe("L");
    expect(unitOf.get(FORMULA_NEED)).toBe("kcal");
    const resourceUnit = new Map(SUPPLY_CATALOG.resources.map((resource) => [resource.code, resource.unit]));
    expect(resourceUnit.get(NO_COOK)).toBe("kcal");
    expect(resourceUnit.get(STORED_WATER)).toBe("L");
    expect(resourceUnit.get(FORMULA_READY)).toBe("kcal");
  });

  it("gives a supply part of stack-hazards for each need of NEED_SUPPLIES", () => {
    const parts = new Set(SUPPLY_PARTS.map((part) => part.id));
    for (const [need, part] of Object.entries(supplies)) {
      expect(NEEDS.map((item) => item.code)).toContain(need);
      expect(parts.has(part)).toBe(true);
    }
  });

  it("gives one direct use of each need, of 1 unit for each unit", () => {
    expect(typed.map((use) => [use.resource, use.need, use.amount])).toEqual([
      [STORED_WATER, WATER_NEED, 1],
      [NO_COOK, FOOD_NEED, 1],
      [FORMULA_READY, FORMULA_NEED, 1],
    ]);
  });
});

describe("checkJoins", () => {
  it("passes the catalog of market, the direct uses and the supplies with the real reference lists", () => {
    expect(checkJoins(SUPPLY_CATALOG, DIRECT_USES, NEED_SUPPLIES, references)).toEqual([]);
  });

  it("finds a direct use of a resource that is not in the catalog", () => {
    expect(codesOf(SUPPLY_CATALOG, [{ resource: "water.unknown", need: WATER_NEED, amount: 1 }], {}, references)).toEqual([["join-use-resource", "use", "water.unknown"]]);
  });

  it("finds a direct use of a need that is not a reference need", () => {
    expect(codesOf(SUPPLY_CATALOG, [{ resource: STORED_WATER, need: "need.unknown", amount: 1 }], {}, references)).toEqual([["join-use-need", "use", STORED_WATER]]);
  });

  it("finds a direct use whose resource unit does not convert to the unit of its need", () => {
    expect(codesOf(SUPPLY_CATALOG, [{ resource: STORED_WATER, need: FOOD_NEED, amount: 1 }], {}, references)).toEqual([["join-use-unit", "use", STORED_WATER]]);
    expect(codesOf(CATALOG, [{ resource: "test.dose", need: WATER_NEED, amount: 1 }], {}, references)).toEqual([["join-use-unit", "use", "test.dose"]]);
  });

  it("finds a direct use whose amount is not the factor of the units", () => {
    expect(codesOf(SUPPLY_CATALOG, [{ resource: STORED_WATER, need: WATER_NEED, amount: 2 }], {}, references)).toEqual([["join-use-amount", "use", STORED_WATER]]);
    const [finding] = checkJoins(SUPPLY_CATALOG, [{ resource: STORED_WATER, need: WATER_NEED, amount: 2 }], {}, references);
    expect(finding?.message).toMatch(/definition/);
  });

  it("passes a direct use in gal for a need in L with the factor of the units", () => {
    expect(checkJoins(CATALOG, [{ resource: "water.test-gal", need: WATER_NEED, amount: 3.785411784 }], {}, references)).toEqual([]);
    expect(codesOf(CATALOG, [{ resource: "water.test-gal", need: WATER_NEED, amount: 1 }], {}, references)).toEqual([["join-use-amount", "use", "water.test-gal"]]);
  });

  it("finds a supply of a need that is not a reference need", () => {
    expect(codesOf(SUPPLY_CATALOG, [], { "need.unknown": "water.main" }, references)).toEqual([["join-supply-need", "supply", "need.unknown"]]);
  });

  it("finds a supply of a part that is not a reference part", () => {
    expect(codesOf(SUPPLY_CATALOG, [], { [WATER_NEED]: "part.unknown" }, references)).toEqual([["join-supply-part", "supply", WATER_NEED]]);
  });

  it("gives each finding as an error, in the order of the uses and then the supplies", () => {
    const uses = [
      { resource: "water.unknown", need: WATER_NEED, amount: 1 },
      { resource: STORED_WATER, need: "need.unknown", amount: 1 },
      { resource: STORED_WATER, need: FOOD_NEED, amount: 1 },
      { resource: STORED_WATER, need: WATER_NEED, amount: 2 },
    ];
    const supplies = { [WATER_NEED]: "part.unknown", "need.unknown": "water.main" };
    const findings = checkJoins(SUPPLY_CATALOG, uses, supplies, references);
    expect(findings.map((finding) => finding.code)).toEqual(["join-use-resource", "join-use-need", "join-use-unit", "join-use-amount", "join-supply-part", "join-supply-need"]);
    expect(new Set(findings.map((finding) => finding.code))).toEqual(new Set(JOIN_CODES));
    for (const finding of findings) expect(finding.level).toBe("error");
  });

  it("uses only the reference lists of the call", () => {
    expect(codesOf(SUPPLY_CATALOG, DIRECT_USES, NEED_SUPPLIES, { needs: [], parts: [] })).toEqual([
      ["join-use-need", "use", STORED_WATER],
      ["join-use-need", "use", NO_COOK],
      ["join-use-need", "use", FORMULA_READY],
      ["join-supply-need", "supply", WATER_NEED],
      ["join-supply-part", "supply", WATER_NEED],
      ["join-supply-need", "supply", FOOD_NEED],
      ["join-supply-part", "supply", FOOD_NEED],
      ["join-supply-need", "supply", FORMULA_NEED],
      ["join-supply-part", "supply", FORMULA_NEED],
    ]);
  });
});

describe("householdFragment", () => {
  const input: HouseholdFragmentInput = {
    persons: [{ sex: "female", ageMonths: 33 * 12, count: 1 }],
    activity: "sedentary",
    catalog: SUPPLY_CATALOG,
    units: { "food.peanut-butter-1kg": 1 },
    level: "critical",
  };

  /** This function gives the fragment of a call, and fails the test when the call gives no layer. */
  function fragmentOf(of: HouseholdFragmentInput): HouseholdFragmentRead {
    const result = householdFragment(of);
    if (result.layer === undefined) throw new Error(result.why);
    return result;
  }

  it("gives the food use of DIRECT_USES as its direct use", () => {
    expect(fragmentOf(input).layer.direct).toEqual(DIRECT_USES.filter((use) => use.need === FOOD_NEED));
  });

  it("gives the part of NEED_SUPPLIES as the default supply of the draw", () => {
    expect(fragmentOf(input).layer.draws[0]?.supply).toBe(NEED_SUPPLIES[FOOD_NEED]);
    expect(fragmentOf({ ...input, supply: "food.test-shop" }).layer.draws[0]?.supply).toBe("food.test-shop");
  });

  it("declares the resource of each food use of the uses of the call", () => {
    const uses = [...DIRECT_USES, { resource: "food.test-ration", need: FOOD_NEED, amount: 1 }];
    const { layer } = fragmentOf({ ...input, catalog: CATALOG, uses });
    expect(layer.resources).toContainEqual({ code: "food.test-ration", unit: "kcal" });
    expect(layer.resources).toContainEqual({ code: NO_COOK, unit: "kcal" });
    expect(layer.direct.map((use) => use.resource)).toEqual([NO_COOK, "food.test-ration"]);
  });

  it("refuses a food use whose resource is not in the catalog in kcal", () => {
    const uses = [{ resource: STORED_WATER, need: FOOD_NEED, amount: 1 }];
    expect(() => householdFragment({ ...input, uses })).toThrow(RangeError);
  });
});

describe("subsetConverters", () => {
  /** The catalog with the resource `water.bottled` of market 0.9.0. The copy has no effect on a catalog that has it. */
  const bottledCatalog: SupplyCatalog = SUPPLY_CATALOG.resources.some((resource) => resource.code === BOTTLED_WATER)
    ? CATALOG
    : { ...CATALOG, resources: [...CATALOG.resources, { ...water, code: BOTTLED_WATER, title: "Drinking water, commercially bottled and sealed" }] };

  it("makes bottled water a subset of stored water, as a definition", () => {
    expect(RESOURCE_SUBSETS).toEqual([{ resource: BOTTLED_WATER, of: STORED_WATER }]);
  });

  it("gives a converter of 1 L of bottled water into 1 L of stored water, with no device and no limit", () => {
    const converters = subsetConverters(bottledCatalog, [BOTTLED_WATER, NO_COOK]);
    // The type gate of the copy of the form: each converter is a converter of stack-endurance.
    const typedConverters: readonly Converter[] = converters;
    expect(typedConverters).toEqual([{ id: `buy:subset:${BOTTLED_WATER}`, takes: [{ resource: BOTTLED_WATER, amount: 1 }], gives: { resource: STORED_WATER, amount: 1 } }]);
    expect(subsetConverters(bottledCatalog, [BOTTLED_WATER], RESOURCE_SUBSETS, "owner")[0]?.id).toBe(`owner:subset:${BOTTLED_WATER}`);
  });

  it("gives no converter when the stores have no resource of a subset", () => {
    expect(subsetConverters(bottledCatalog, [STORED_WATER, NO_COOK])).toEqual([]);
    expect(subsetConverters(SUPPLY_CATALOG, [])).toEqual([]);
  });

  it("converts the units of a subset with the factor of the units", () => {
    const converters = subsetConverters(bottledCatalog, ["water.test-gal"], [{ resource: "water.test-gal", of: STORED_WATER }]);
    expect(converters[0]?.gives).toEqual({ resource: STORED_WATER, amount: 3.785411784 });
  });

  it("throws for a subset of a resource that is not in the catalog, of units that do not convert, or of one resource two times", () => {
    expect(() => subsetConverters(bottledCatalog, ["water.unknown"], [{ resource: "water.unknown", of: STORED_WATER }])).toThrow(/water\.unknown/u);
    expect(() => subsetConverters(bottledCatalog, [BOTTLED_WATER], [{ resource: BOTTLED_WATER, of: "water.unknown" }])).toThrow(/water\.unknown/u);
    expect(() => subsetConverters(bottledCatalog, ["test.dose"], [{ resource: "test.dose", of: STORED_WATER }])).toThrow(/does not convert/u);
    expect(() => subsetConverters(bottledCatalog, [STORED_WATER], [{ resource: STORED_WATER, of: STORED_WATER }])).toThrow(/two times/u);
  });
});
