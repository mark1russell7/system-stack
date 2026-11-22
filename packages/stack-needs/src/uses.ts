import type { SupplyCatalog } from "@mark1russell7/market/supplies";

// The uses and the supply parts of the needs, and the gate of their joins with the reference lists.
// An add-on does not import a different add-on. Thus the reference lists are parameters, and a test joins the real lists.

/** The code of the need of the food draw: food energy, in `kcal` for each day. */
export const FOOD_NEED = "food.energy";

/** The code of the need of drinking water, in `L` for each day. */
export const WATER_NEED = "hydration.drink";

/** The resource of the food to eat with no water and no fuel, in `kcal`. It has a direct use for the food draw. */
export const NO_COOK = "food.no-cook";

/** The resource of the stored drinking water, in `L`. It has a direct use for the water need. */
export const STORED_WATER = "water.stored";

/** The direct use of a resource for a need: 1 unit of the resource gives `amount` of the need. */
export interface FragmentDirectUse {
  readonly resource: string;
  readonly need: string;
  readonly amount: number;
}

/**
 * The default reference part that supplies each need when no case stops it, by the code of the need.
 * The parts are `id` values of `SUPPLY_PARTS` of `@mark1russell7/stack-hazards`. A household with a well gives a different part.
 */
export const NEED_SUPPLIES: Readonly<Record<string, string>> = {
  [WATER_NEED]: "water.main",
  [FOOD_NEED]: "food.retail",
};

/**
 * The direct uses of the resources of the buy list. Each use gives 1 unit of its need for each unit of its resource.
 *
 * - 1 L of stored drinking water gives 1 L of drink. This is a definition, not a read.
 * - 1 kcal of food to eat with no water and no fuel gives 1 kcal of food energy.
 *
 * These records have the form of `DirectUse` of `@mark1russell7/stack-endurance`.
 */
export const DIRECT_USES: readonly FragmentDirectUse[] = [
  { resource: STORED_WATER, need: WATER_NEED, amount: 1 },
  { resource: NO_COOK, need: FOOD_NEED, amount: 1 },
];

/**
 * These are the codes of the join gate. Each code is an error.
 *
 * - `join-use-resource`: a direct use names a resource that is not in the catalog.
 * - `join-use-need`: a direct use names a need that is not in the reference needs.
 * - `join-use-unit`: the unit of the resource of a direct use is not the unit of its need.
 * - `join-supply-need`: a supply names a need that is not in the reference needs.
 * - `join-supply-part`: a supply names a part that is not in the reference parts.
 */
export const JOIN_CODES: readonly ["join-use-resource", "join-use-need", "join-use-unit", "join-supply-need", "join-supply-part"] = [
  "join-use-resource",
  "join-use-need",
  "join-use-unit",
  "join-supply-need",
  "join-supply-part",
];

/** A code of the join gate. */
export type JoinCode = (typeof JOIN_CODES)[number];

/** A break of a join. Each break is an error. */
export interface JoinFault {
  readonly level: "error";
  readonly code: JoinCode;
  /** The resource of the use, or the need of the supply. */
  readonly at: string;
  readonly message: string;
}

/** A reference need: its code and its unit. Each record of `NEEDS` of `@mark1russell7/alerts` has this form. */
export interface ReferenceNeed {
  readonly code: string;
  readonly unit: string;
}

/** A reference part: its `id`. Each record of `SUPPLY_PARTS` of `@mark1russell7/stack-hazards` has this form. */
export interface ReferencePart {
  readonly id: string;
}

/** The reference lists of the join gate. */
export interface JoinReferences {
  /** The reference needs, for example `NEEDS` of `@mark1russell7/alerts`. */
  readonly needs: readonly ReferenceNeed[];
  /** The reference parts, for example `SUPPLY_PARTS` of `@mark1russell7/stack-hazards`. */
  readonly parts: readonly ReferencePart[];
}

/**
 * This function examines the joins of a catalog, the direct uses and the supply parts with the reference lists.
 *
 * - The resource of each direct use is a resource of the catalog, and its need is a reference need.
 * - The unit of the resource of each direct use is the unit of its need.
 * - Each supply names a reference need and a reference part.
 *
 * The faults are in the order of the uses, then in the order of the supplies. The function is pure.
 *
 * @param catalog - The catalog of supplies of `@mark1russell7/market`
 * @param uses - The direct uses, for example `DIRECT_USES`
 * @param supplies - The part that supplies each need, by the code of the need, for example `NEED_SUPPLIES`
 * @param references - The reference needs and the reference parts
 * @returns The breaks of the joins. An empty list is a pass.
 */
export function checkJoins(
  catalog: SupplyCatalog,
  uses: readonly FragmentDirectUse[],
  supplies: Readonly<Record<string, string>>,
  references: JoinReferences,
): JoinFault[] {
  const faults: JoinFault[] = [];
  const fault = (code: JoinCode, at: string, message: string): void => {
    faults.push({ level: "error", code, at, message });
  };
  const units = new Map(catalog.resources.map((resource) => [resource.code, resource.unit] as const));
  const needs = new Map(references.needs.map((need) => [need.code, need.unit] as const));
  for (const use of uses) {
    const unit = units.get(use.resource);
    const needUnit = needs.get(use.need);
    if (unit === undefined) fault("join-use-resource", use.resource, `The direct use of ${use.resource} names no resource of the catalog.`);
    if (needUnit === undefined) fault("join-use-need", use.resource, `The direct use of ${use.resource} names the need ${use.need}, which is not a reference need.`);
    if (unit !== undefined && needUnit !== undefined && unit !== needUnit) {
      fault("join-use-unit", use.resource, `The direct use of ${use.resource} for ${use.need} takes ${unit}, and the need is in ${needUnit}.`);
    }
  }
  const parts = new Set(references.parts.map((part) => part.id));
  for (const [need, part] of Object.entries(supplies)) {
    if (!needs.has(need)) fault("join-supply-need", need, `The supply of ${need} names no reference need.`);
    if (!parts.has(part)) fault("join-supply-part", need, `The supply of ${need} names the part ${part}, which is not a reference part.`);
  }
  return faults;
}
