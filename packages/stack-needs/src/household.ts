import { buyListEnergy, giftsOf, type BuyListEnergy, type SupplyCatalog } from "@mark1russell7/market/supplies";
import { calorieNeed, type ActivityLevel, type CalorieNeedTotal, type CalorieTable, type Person } from "./calorie.ts";
import { DGA_CALORIES } from "./data.ts";

// The join of a household and a buy list into a fragment of an endurance layer: one draw of food energy and the stores of the list.
// The records have the form of the records of `@mark1russell7/stack-endurance`. An add-on does not import a different add-on, so the form is a copy.
// A test assigns the layer to `EnduranceLayer` of stack-endurance. That test is the type gate of the copy.
// The fragment has no converter. No cited source gives the water and the fuel to cook 1 kg of dry food, and a number with no source is not data.

/** The code of the need of the food draw: food energy, in `kcal` for each day. */
export const FOOD_NEED = "food.energy";

/** The resource of the food to eat with no water and no fuel, in `kcal`. It has a direct use for the food draw. */
export const NO_COOK = "food.no-cook";

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

/** The direct use of a resource for a need: 1 unit of the resource gives `amount` of the need. */
export interface FragmentDirectUse {
  readonly resource: string;
  readonly need: string;
  readonly amount: number;
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

/** The action for the persons with no row in the table. The only action is `leave-out`. */
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
  /** The `id` of the part of the stack that supplies the food when no case stops it, for example `food.retail`. */
  readonly supply: string;
  /** The level of the food draw. It is one of the levels of the joined layer. */
  readonly level: string;
  /** The levels of the fragment. The default is no levels: a different fragment of the stack gives them. */
  readonly levels?: readonly string[] | undefined;
  /** The table of calorie needs. The default is `DGA_CALORIES`. */
  readonly table?: CalorieTable | undefined;
  /** The start of the `id` of each store. The default is `buy`. */
  readonly prefix?: string | undefined;
  /**
   * The action for the persons with no row in the table. Without it, a person with no row gives no layer.
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
  /** The persons with no row that the option `leave-out` left out of the draw. With no option, the list is empty. */
  readonly leftOut: readonly Person[];
}

/** No household fragment: the draw has no read. A low rate gives too many days, so the function gives no layer. */
export interface HouseholdFragmentNoRead extends HouseholdStoresResult {
  readonly layer: undefined;
  /** The food energy of the household for one day. It is `undefined` when the household has no person. */
  readonly need: CalorieNeedTotal | undefined;
  readonly needRead: false;
  /** The persons with no row in the table. */
  readonly noRow: readonly Person[];
  /** The reason for no layer. */
  readonly why: string;
}

/** The household fragment, or a no read of the draw. Both have the reads of the buy list. */
export type HouseholdFragmentResult = HouseholdFragmentRead | HouseholdFragmentNoRead;

/** This function gives the stores of the buy list, its resources and its gifts with no read. */
function buyListStores(input: HouseholdFragmentInput): { stores: FragmentStore[]; resources: FragmentResource[]; parts: HouseholdStoresResult } {
  const { catalog, units } = input;
  const energy = buyListEnergy(catalog, units);
  const unitOf = new Map(catalog.resources.map((resource) => [resource.code, resource.unit]));
  if (unitOf.get(NO_COOK) !== "kcal") throw new RangeError(`The catalog has no resource "${NO_COOK}" in kcal.`);
  const prefix = input.prefix ?? "buy";
  const stores: FragmentStore[] = [];
  const noReads: GiftNoRead[] = [];
  for (const [product, count] of Object.entries(units)) {
    for (const gift of giftsOf(catalog, product, count)) {
      if (!gift.read) noReads.push({ product, resource: gift.resource, why: gift.why });
      else if (gift.amount > 0) stores.push({ id: `${prefix}:${product}:${gift.resource}`, resource: gift.resource, amount: gift.amount });
    }
  }
  const codes = [...new Set([...stores.map((store) => store.resource), NO_COOK])];
  const resources = codes.map((code) => ({ code, unit: unitOf.get(code) ?? "" }));
  return { stores, resources, parts: { energy, noReads, storesRead: noReads.length === 0 } };
}

/**
 * This function joins a household and a buy list into a fragment of an endurance layer.
 *
 * - The fragment has one draw of food energy. Its rate is the need of the persons for one day, and its users are the persons.
 * - Each gift of the buy list with a read is one store, with the `id` `<prefix>:<product>:<resource>`. A gift with no read has no store.
 * - The resources are the resources of the stores and `food.no-cook`, with the units of the catalog.
 * - The direct use of `food.no-cook` gives 1 kcal of the need for each kcal.
 * - The fragment has no converter. A caller adds converters for the dry food, with the water and the fuel of each run.
 *
 * A person with no row in the table gives no layer, because a low rate gives too many days.
 * The option `noRow: "leave-out"` leaves those persons out of the draw. A draw of 0 kcal gives no layer.
 * The function is pure.
 *
 * @param input - The persons, the activity level, the catalog and the buy list, the supply part and the level of the draw
 * @returns The fragment or a no read of the draw, with the energy of the list and the gifts with no read
 * @throws RangeError for the errors of `calorieNeed`, `giftsOf` and `buyListEnergy`, except a household with no person
 * @throws RangeError when the catalog has no resource `food.no-cook` in `kcal`
 */
export function householdFragment(input: HouseholdFragmentInput): HouseholdFragmentResult {
  const { stores, resources, parts } = buyListStores(input);
  if (input.persons.every((person) => person.count === 0)) {
    return { ...parts, layer: undefined, need: undefined, needRead: false, noRow: [], why: "The household has no person, so the draw is 0 kcal." };
  }
  const need = calorieNeed(input.table ?? DGA_CALORIES, input.persons, input.activity, 1);
  const noRow: Person[] = [];
  let users = 0;
  for (const line of need.lines) {
    if (line.read) users += line.person.count;
    else if (line.person.count > 0) noRow.push(line.person);
  }
  if (noRow.length > 0 && input.noRow !== "leave-out") {
    return { ...parts, layer: undefined, need, needRead: false, noRow, why: `The table has no row for ${String(noRow.length)} person records. The option noRow: "leave-out" leaves them out of the draw.` };
  }
  if (users === 0 || need.need.value <= 0) {
    return { ...parts, layer: undefined, need, needRead: false, noRow, why: "No person of the draw has a row in the table, so the draw is 0 kcal." };
  }
  const draw: FragmentDraw = { need: FOOD_NEED, level: input.level, perDay: need.need.value, users, supply: input.supply };
  return {
    ...parts,
    layer: {
      schema: "endurance/1",
      levels: [...(input.levels ?? [])],
      resources,
      stores,
      draws: [draw],
      direct: [{ resource: NO_COOK, need: FOOD_NEED, amount: 1 }],
    },
    need,
    needRead: true,
    leftOut: noRow,
  };
}
