import { buyListEnergy, giftsOf, type BuyListEnergy, type SupplyCatalog } from "@mark1russell7/market/supplies";
import { calorieChange, calorieNeed, INFANT_FEEDINGS, type ActivityLevel, type CalorieNeedTotal, type CalorieTable, type CalorieTables, type Person } from "./calorie.ts";
import { CALORIE_CHAIN } from "./data.ts";
import { DIRECT_USES, FOOD_NEED, NEED_SUPPLIES, type FragmentDirectUse } from "./uses.ts";

// The join of a household and a buy list into a fragment of an endurance layer: one draw of food energy and the stores of the list.
// The records have the form of the records of `@mark1russell7/stack-endurance`. An add-on does not import a different add-on, so the form is a copy.
// A test assigns the layer to `EnduranceLayer` of stack-endurance. That test is the type gate of the copy.
// The fragment has no converter. No cited source gives the water and the fuel to cook 1 kg of dry food, and a number with no source is not data.

/** A resource of a store, with its unit. */
export interface FragmentResource {
  readonly code: string;
  readonly unit: string;
}

/** A store of the buy list: an amount of one resource, in its unit. */
export interface FragmentStore {
  readonly id: string;
  readonly resource: string;
  readonly amount: number;
}

/** The food draw: the food energy of the persons of the draw for each day. */
export interface FragmentDraw {
  readonly need: string;
  readonly level: string;
  /** The food energy of the persons of the draw for each day, in `kcal`. It is above 0. */
  readonly perDay: number;
  /** The count of the persons of the draw. */
  readonly users: number;
  readonly supply: string;
}

/** A fragment of an endurance layer, with the form of `EnduranceLayer` of `@mark1russell7/stack-endurance`. It has no converter. */
export interface HouseholdFragment {
  /** The format of an endurance layer, `endurance/1`. */
  readonly schema: "endurance/1";
  readonly levels: readonly string[];
  readonly resources: readonly FragmentResource[];
  readonly stores: readonly FragmentStore[];
  readonly draws: readonly FragmentDraw[];
  readonly direct: readonly FragmentDirectUse[];
}

/** The age in months below which a person record must have a `feeding`: 12, the first month of the guidelines. */
export const INFANT_MONTHS = 12;

/** The action for the persons that the draw cannot serve: no row in the table, or an infant on formula. The only action is `leave-out`. */
export type NoRowAction = "leave-out";

/** The inputs of the household fragment. */
export interface HouseholdFragmentInput {
  /** The person records of the household. */
  readonly persons: readonly Person[];
  /** The activity level of each person record with no level of its own. It has no default. */
  readonly activity: ActivityLevel;
  /** The catalog of supplies of `@mark1russell7/market`. */
  readonly catalog: SupplyCatalog;
  /** The count of units of each product of the buy list, by the `id` of the product. */
  readonly units: Readonly<Record<string, number>>;
  /** The `id` of the part of the stack that supplies the food when no case stops it. The default is `NEED_SUPPLIES["food.energy"]`, `food.retail`. */
  readonly supply?: string | undefined;
  /** The direct uses. The fragment takes each use for the need `food.energy`. The default is `DIRECT_USES`. */
  readonly uses?: readonly FragmentDirectUse[] | undefined;
  /** The level of the food draw. It is one of the levels of the joined layer. */
  readonly level: string;
  /** The levels of the fragment. The default is no levels: a different fragment of the stack gives them. */
  readonly levels?: readonly string[] | undefined;
  /** The table of calorie needs, or tables in order. The default is `CALORIE_CHAIN`, which gives a row for each age. */
  readonly table?: CalorieTables | undefined;
  /** The start of the `id` of each store. The default is `buy`. */
  readonly prefix?: string | undefined;
  /**
   * The action for the persons with no row in the table, and for the infants on formula. Without it, such a person gives no layer.
   * With `leave-out`, the draw has no need of those persons, and the result lists them.
   */
  readonly noRow?: NoRowAction | undefined;
}

/** A gift of the buy list with no read. The fragment has no store for it. A no read is not 0. */
export interface GiftNoRead {
  readonly product: string;
  readonly resource: string;
  readonly why: string;
}

/** The parts of the result that do not change with the draw. */
export interface HouseholdStoresResult {
  /** The food energy of each product of the buy list. A caller gets the energy of the dry food for its converters from it. */
  readonly energy: BuyListEnergy;
  /** The gifts of the buy list with no read. */
  readonly noReads: readonly GiftNoRead[];
  /** True when each gift of the buy list has a read. When it is false, the stores are a lower limit. */
  readonly storesRead: boolean;
}

/** The household fragment with its draw. The draw is exact for its users. */
export interface HouseholdFragmentRead extends HouseholdStoresResult {
  readonly layer: HouseholdFragment;
  /**
   * The food energy of the household for one day, with a line for each person record. Its `read` covers the whole
   * household. It is false when a person is left out, or when a record with count 0 has no row. The flag of the draw
   * is `needRead`.
   */
  readonly need: CalorieNeedTotal;
  /** This field is true: the draw has a read for each of its users. */
  readonly needRead: true;
  /** The persons with no row, and the infants on formula, that the option `leave-out` left out of the draw. With no option, the list is empty. */
  readonly leftOut: readonly Person[];
  /**
   * The infants on breast milk only. Each has a line with a read in `need`, and no part of the draw.
   * The stage of lactation of a person of the draw holds that energy.
   */
  readonly breastMilk: readonly Person[];
}

/** No household fragment: the draw has no read. A low rate gives too many days, so the function gives no layer. */
export interface HouseholdFragmentNoRead extends HouseholdStoresResult {
  readonly layer: undefined;
  /** The food energy of the household for one day. It is `undefined` when the household has no person. */
  readonly need: CalorieNeedTotal | undefined;
  readonly needRead: false;
  /** The persons with no row in the table. */
  readonly noRow: readonly Person[];
  /** The infants on formula. The fragment has no draw of formula. */
  readonly formula: readonly Person[];
  /** The infants on breast milk only. */
  readonly breastMilk: readonly Person[];
  /** The reason for no layer. */
  readonly why: string;
}

/** The household fragment, or a no read of the draw. Both have the reads of the buy list. */
export type HouseholdFragmentResult = HouseholdFragmentRead | HouseholdFragmentNoRead;

/** This function gives the stores of the buy list, its resources and its gifts with no read. */
function buyListStores(
  input: HouseholdFragmentInput,
  foodUses: readonly FragmentDirectUse[],
): { stores: FragmentStore[]; resources: FragmentResource[]; parts: HouseholdStoresResult } {
  const { catalog, units } = input;
  const energy = buyListEnergy(catalog, units);
  const unitOf = new Map(catalog.resources.map((resource) => [resource.code, resource.unit]));
  for (const use of foodUses) {
    if (unitOf.get(use.resource) !== "kcal") throw new RangeError(`The catalog has no resource "${use.resource}" in kcal for the food use.`);
  }
  const prefix = input.prefix ?? "buy";
  const stores: FragmentStore[] = [];
  const noReads: GiftNoRead[] = [];
  for (const [product, count] of Object.entries(units)) {
    for (const gift of giftsOf(catalog, product, count)) {
      if (!gift.read) noReads.push({ product, resource: gift.resource, why: gift.why });
      else if (gift.amount > 0) stores.push({ id: `${prefix}:${product}:${gift.resource}`, resource: gift.resource, amount: gift.amount });
    }
  }
  const codes = [...new Set([...stores.map((store) => store.resource), ...foodUses.map((use) => use.resource)])];
  const resources = codes.map((code) => ({ code, unit: unitOf.get(code) ?? "" }));
  return { stores, resources, parts: { energy, noReads, storesRead: noReads.length === 0 } };
}

/**
 * This function joins a household and a buy list into a fragment of an endurance layer.
 *
 * - The fragment has one draw of food energy. Its rate is the need of the persons for one day, and its users are the persons.
 * - Each gift of the buy list with a read is one store, with the `id` `<prefix>:<product>:<resource>`. A gift with no read has no store.
 * - The direct uses are the food uses: each use of `uses` for the need `food.energy`. The default `DIRECT_USES` gives `food.no-cook`, 1 kcal for each kcal.
 * - The resources are the resources of the stores and of the food uses, with the units of the catalog.
 * - The supply part of the draw is `supply`. Its default is the part of `NEED_SUPPLIES` for `food.energy`.
 * - The fragment has no converter. A caller adds converters for the dry food, with the water and the fuel of each run.
 *
 * A person with no row in the tables gives no layer, because a low rate gives too many days. The default tables give a row for each age.
 * The option `noRow: "leave-out"` leaves those persons out of the draw. A draw of 0 kcal gives no layer.
 *
 * Each person record below `INFANT_MONTHS` must have a `feeding`. It has no default.
 *
 * - `food`: the need of the infant is in the draw of food energy.
 * - `breast-milk`: the infant has a line with a read, and no part of the draw. A person of the household must have a stage of lactation.
 * - `formula`: the fragment has no draw of formula, so the infant gives no layer, as a person with no row. The option `leave-out` also applies.
 *
 * The function is pure.
 *
 * @param input - The persons, the activity level, the catalog and the buy list, the supply part and the level of the draw
 * @returns The fragment or a no read of the draw, with the energy of the list and the gifts with no read
 * @throws RangeError for the errors of `calorieNeed`, `giftsOf` and `buyListEnergy`, except a household with no person
 * @throws RangeError when the catalog has no resource in `kcal` for a food use
 * @throws RangeError when a record below `INFANT_MONTHS` has no `feeding`, or when a `feeding` is not a way of `INFANT_FEEDINGS`
 * @throws RangeError when an infant drinks only breast milk and no person of the household has a stage of lactation
 */
export function householdFragment(input: HouseholdFragmentInput): HouseholdFragmentResult {
  const foodUses = (input.uses ?? DIRECT_USES).filter((use) => use.need === FOOD_NEED);
  const { stores, resources, parts } = buyListStores(input, foodUses);
  checkFeedings(input.persons);
  if (input.persons.every((person) => person.count === 0)) {
    return { ...parts, layer: undefined, need: undefined, needRead: false, noRow: [], formula: [], breastMilk: [], why: "The household has no person, so the draw is 0 kcal." };
  }
  const tables = input.table ?? CALORIE_CHAIN;
  const need = calorieNeed(tables, input.persons, input.activity, 1);
  const noRow: Person[] = [];
  const formula: Person[] = [];
  const breastMilk: Person[] = [];
  let users = 0;
  let perDay = 0;
  for (const line of need.lines) {
    const { person } = line;
    if (person.count === 0) continue;
    if (person.feeding === "breast-milk") breastMilk.push(person);
    else if (person.feeding === "formula") formula.push(person);
    else if (!line.read) noRow.push(person);
    else {
      users += person.count;
      perDay += line.need.value;
    }
  }
  if (breastMilk.length > 0 && !input.persons.some((person) => person.count > 0 && makesMilk(tables, person))) {
    throw new RangeError(
      `The infants ${breastMilk.map(nameOf).join(", ")} drink only breast milk, but no person of the household has a stage of lactation. ` +
        "The milk comes from the food of the mother, so give the mother a stage of lactation, for example lactation-1.",
    );
  }
  const reasons = [
    ...(noRow.length > 0 ? [`The table has no row for ${String(noRow.length)} person records.`] : []),
    ...(formula.length > 0 ? [`${String(formula.length)} infant records are on formula, and the fragment has no draw of formula.`] : []),
  ];
  if (reasons.length > 0 && input.noRow !== "leave-out") {
    return { ...parts, layer: undefined, need, needRead: false, noRow, formula, breastMilk, why: `${reasons.join(" ")} The option noRow: "leave-out" leaves them out of the draw.` };
  }
  if (users === 0 || perDay <= 0) {
    return { ...parts, layer: undefined, need, needRead: false, noRow, formula, breastMilk, why: "No person of the draw has a need of food in the draw, so the draw is 0 kcal." };
  }
  const draw: FragmentDraw = { need: FOOD_NEED, level: input.level, perDay, users, supply: input.supply ?? NEED_SUPPLIES[FOOD_NEED] };
  return {
    ...parts,
    layer: {
      schema: "endurance/1",
      levels: [...(input.levels ?? [])],
      resources,
      stores,
      draws: [draw],
      direct: foodUses.map((use) => ({ ...use })),
    },
    need,
    needRead: true,
    leftOut: [...noRow, ...formula],
    breastMilk,
  };
}

/** This function gives the name of a person record in a message. */
function nameOf(person: Person): string {
  return `${String(person.sex)} of ${String(person.ageMonths)} months`;
}

/** This function examines the feeding of each record: a record below `INFANT_MONTHS` must have one, and each feeding is a way of `INFANT_FEEDINGS`. */
function checkFeedings(persons: readonly Person[]): void {
  for (const person of persons) {
    const { feeding } = person;
    if (feeding === undefined) {
      if (person.count > 0 && person.ageMonths < INFANT_MONTHS) {
        throw new RangeError(`The persons ${nameOf(person)} are below ${String(INFANT_MONTHS)} months and have no feeding. Give feeding: ${INFANT_FEEDINGS.join(", ")}.`);
      }
    } else if (!(INFANT_FEEDINGS as readonly unknown[]).includes(feeding)) {
      throw new RangeError(`The feeding ${String(feeding)} of the persons ${nameOf(person)} is not a way of ${INFANT_FEEDINGS.join(", ")}.`);
    }
  }
}

/** This function tells if the stage of a person record is a stage that makes milk, in one of the tables. */
function makesMilk(tables: CalorieTables, person: Person): boolean {
  const { stage } = person;
  if (stage === undefined) return false;
  const list: readonly CalorieTable[] = "rows" in tables ? [tables] : tables;
  return list.some((table) => calorieChange(table, person.sex, stage)?.milk === true);
}
