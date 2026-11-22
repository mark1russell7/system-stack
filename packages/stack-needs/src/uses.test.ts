import { NEEDS } from "@mark1russell7/alerts";
import { SUPPLY_CATALOG } from "@mark1russell7/market/supplies";
import type { DirectUse } from "@mark1russell7/stack-endurance";
import { SUPPLY_PARTS } from "@mark1russell7/stack-hazards";
import { describe, expect, it } from "vitest";
import { householdFragment } from "./household.ts";
import { checkJoins, DIRECT_USES, FOOD_NEED, JOIN_CODES, NEED_SUPPLIES, NO_COOK, STORED_WATER, WATER_NEED, type JoinReferences } from "./uses.ts";

/** The real reference lists: the needs of alerts and the reference parts of stack-hazards. */
const references: JoinReferences = { needs: NEEDS, parts: SUPPLY_PARTS };

/** The type gate of the copy of the form: the direct uses are direct uses of stack-endurance. */
const typed: readonly DirectUse[] = DIRECT_USES;

/** This function gives the codes and the places of the faults of a call. */
function codesOf(...args: Parameters<typeof checkJoins>): [string, string][] {
  return checkJoins(...args).map((fault): [string, string] => [fault.code, fault.at]);
}

describe("the reference codes", () => {
  it("gives FOOD_NEED and WATER_NEED as needs of alerts, with the units of their resources", () => {
    const unitOf = new Map(NEEDS.map((need) => [need.code, need.unit]));
    expect(unitOf.get(FOOD_NEED)).toBe("kcal");
    expect(unitOf.get(WATER_NEED)).toBe("L");
    const resourceUnit = new Map(SUPPLY_CATALOG.resources.map((resource) => [resource.code, resource.unit]));
    expect(resourceUnit.get(NO_COOK)).toBe("kcal");
    expect(resourceUnit.get(STORED_WATER)).toBe("L");
  });

  it("gives a supply part of stack-hazards for each need of NEED_SUPPLIES", () => {
    const parts = new Set(SUPPLY_PARTS.map((part) => part.id));
    for (const [need, part] of Object.entries(NEED_SUPPLIES)) {
      expect(NEEDS.map((item) => item.code)).toContain(need);
      expect(parts.has(part)).toBe(true);
    }
  });

  it("gives one direct use of each need, of 1 unit for each unit", () => {
    expect(typed.map((use) => [use.resource, use.need, use.amount])).toEqual([
      [STORED_WATER, WATER_NEED, 1],
      [NO_COOK, FOOD_NEED, 1],
    ]);
  });
});

describe("checkJoins", () => {
  it("passes the catalog of market, the direct uses and the supplies with the real reference lists", () => {
    expect(checkJoins(SUPPLY_CATALOG, DIRECT_USES, NEED_SUPPLIES, references)).toEqual([]);
  });

  it("finds a direct use of a resource that is not in the catalog", () => {
    expect(codesOf(SUPPLY_CATALOG, [{ resource: "water.unknown", need: WATER_NEED, amount: 1 }], {}, references)).toEqual([["join-use-resource", "water.unknown"]]);
  });

  it("finds a direct use of a need that is not a reference need", () => {
    expect(codesOf(SUPPLY_CATALOG, [{ resource: STORED_WATER, need: "need.unknown", amount: 1 }], {}, references)).toEqual([["join-use-need", STORED_WATER]]);
  });

  it("finds a direct use whose resource unit is not the unit of its need", () => {
    expect(codesOf(SUPPLY_CATALOG, [{ resource: STORED_WATER, need: FOOD_NEED, amount: 1 }], {}, references)).toEqual([["join-use-unit", STORED_WATER]]);
  });

  it("finds a supply of a need that is not a reference need", () => {
    expect(codesOf(SUPPLY_CATALOG, [], { "need.unknown": "water.main" }, references)).toEqual([["join-supply-need", "need.unknown"]]);
  });

  it("finds a supply of a part that is not a reference part", () => {
    expect(codesOf(SUPPLY_CATALOG, [], { [WATER_NEED]: "part.unknown" }, references)).toEqual([["join-supply-part", WATER_NEED]]);
  });

  it("gives each fault as an error, in the order of the uses and then the supplies", () => {
    const uses = [
      { resource: "water.unknown", need: WATER_NEED, amount: 1 },
      { resource: STORED_WATER, need: "need.unknown", amount: 1 },
      { resource: STORED_WATER, need: FOOD_NEED, amount: 1 },
    ];
    const supplies = { [WATER_NEED]: "part.unknown", "need.unknown": "water.main" };
    const faults = checkJoins(SUPPLY_CATALOG, uses, supplies, references);
    expect(faults.map((fault) => fault.code)).toEqual(["join-use-resource", "join-use-need", "join-use-unit", "join-supply-part", "join-supply-need"]);
    expect(new Set(faults.map((fault) => fault.code))).toEqual(new Set(JOIN_CODES));
    for (const fault of faults) expect(fault.level).toBe("error");
  });

  it("uses only the reference lists of the call", () => {
    expect(codesOf(SUPPLY_CATALOG, DIRECT_USES, NEED_SUPPLIES, { needs: [], parts: [] })).toEqual([
      ["join-use-need", STORED_WATER],
      ["join-use-need", NO_COOK],
      ["join-supply-need", WATER_NEED],
      ["join-supply-part", WATER_NEED],
      ["join-supply-need", FOOD_NEED],
      ["join-supply-part", FOOD_NEED],
    ]);
  });
});

describe("householdFragment", () => {
  it("gives the food use of DIRECT_USES as its direct use", () => {
    const result = householdFragment({
      persons: [{ sex: "female", ageMonths: 33 * 12, count: 1 }],
      activity: "sedentary",
      catalog: SUPPLY_CATALOG,
      units: { "food.peanut-butter-1kg": 1 },
      supply: NEED_SUPPLIES[FOOD_NEED] ?? "",
      level: "critical",
    });
    expect(result.layer?.direct).toEqual(DIRECT_USES.filter((use) => use.need === FOOD_NEED));
    expect(result.layer?.draws[0]?.supply).toBe("food.retail");
  });
});
