import { buyListEnergy, giftsOf, type BuyListEnergy, type SupplyCatalog } from "@mark1russell7/market/supplies";
import { canonicalUnit, quantity, valueIn } from "@mark1russell7/quantity";
import { calorieChange, calorieNeed, INFANT_FEEDINGS, type ActivityLevel, type CalorieNeedTotal, type CalorieTable, type CalorieTables, type Person } from "./calorie.ts";
import { CALORIE_CHAIN, FORMULA_FEEDS, MILK_LATER } from "./data.ts";
import { DIRECT_USES, FOOD_NEED, FORMULA_NEED, NEED_SUPPLIES, type FragmentDirectUse } from "./uses.ts";

// The join of a household and a buy list into a fragment of an endurance layer: a draw of food energy, a draw of infant formula and the stores of the list.
// The records have the form of the records of `@mark1russell7/stack-endurance`. An add-on does not import a different add-on, so the form is a copy.
// A test assigns the layer to `EnduranceLayer` of stack-endurance. That test is the type gate of the copy.
// The fragment has no converter. `cookFragment` gives the converters of the dry food, with the water and the fuel of each pot.

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

/** A draw: the food energy or the formula of the persons of the draw for each day. */
export interface FragmentDraw {
  readonly need: string;
  readonly level: string;
  /** The energy of the persons of the draw for each day, in `kcal`. It is above 0. */
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

/**
 * The age in months from which the food draw holds a part of the need of an infant on breast milk: 6.
 * Below this age, the infant has milk only, and the stage of lactation of the mother holds that energy.
 * From this age, the food draw holds the need of the row minus the milk energy `MILK_LATER`.
 */
export const BREAST_MILK_MONTHS = 6;

/**
 * The age in months below which an infant on formula is in the formula draw with the whole need of its row: 6.
 * Below this age, an infant has milk only, as for `BREAST_MILK_MONTHS`. From this age, no cited source gives the part of formula.
 */
export const FORMULA_DRAW_MONTHS = 6;

/** The action for the persons that no draw can serve: no row in the table, or an infant on formula from `FORMULA_DRAW_MONTHS`. The only action is `leave-out`. */
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
  /** The `id` of the part of the stack that supplies the food and the formula when no case stops it. The default is `food.retail`, from `NEED_SUPPLIES`. */
  readonly supply?: string | undefined;
  /** The direct uses. The fragment takes each use for the need of one of its draws. The default is `DIRECT_USES`. */
  readonly uses?: readonly FragmentDirectUse[] | undefined;
  /** The level of the draws. It is one of the levels of the joined layer. */
  readonly level: string;
  /** The levels of the fragment. The default is no levels: a different fragment of the stack gives them. */
  readonly levels?: readonly string[] | undefined;
  /** The table of calorie needs, or tables in order. The default is `CALORIE_CHAIN`, which gives a row for each age. */
  readonly table?: CalorieTables | undefined;
  /** The start of the `id` of each store. The default is `buy`. */
  readonly prefix?: string | undefined;
  /**
   * The action for the persons with no row in the table, and for the infants on formula from `FORMULA_DRAW_MONTHS`. Without it, such a person gives no layer.
   * With `leave-out`, the draw has no need of those persons, and the result lists them.
   */
  readonly noRow?: NoRowAction | undefined;
  /**
   * True when the household has cold storage for an opened container. The default is false: the worst case of no power.
   * Then an opened container of formula serves one feed, and the rest is waste.
   */
  readonly cold?: boolean | undefined;
  /**
   * The rule for an infant on formula from `FORMULA_DRAW_MONTHS`. Without it, the infant is a person with no row.
   * With `whole`, the formula draw holds the whole need of the row: the upper limit of formula. The food draw holds none of it.
   */
  readonly formulaLater?: "whole" | undefined;
}

/** The waste of the opened containers of one product of the buy list with no cold storage. */
export interface OpenedWaste {
  readonly product: string;
  readonly resource: string;
  /** The count of containers in the buy list. */
  readonly containers: number;
  /** The energy of one container, in `kcal`. */
  readonly container: number;
  /** The energy of the smallest feed of the formula draw, in `kcal`. */
  readonly feed: number;
  /** The energy that the infants use from the containers, in `kcal`. It is the amount of the store. */
  readonly used: number;
  /** The energy of the containers that is waste, in `kcal`. */
  readonly waste: number;
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
  /**
   * The persons with no row, and the infants on formula from `FORMULA_DRAW_MONTHS`, that the option `leave-out` left out of the draws.
   * With no option, the list is empty.
   */
  readonly leftOut: readonly Person[];
  /**
   * The infants on formula. Each infant below `FORMULA_DRAW_MONTHS` is in the formula draw. The option `leave-out` left the other
   * infants out, so `leftOut` also lists them.
   */
  readonly formula: readonly Person[];
  /**
   * The infants on breast milk. Each infant below `BREAST_MILK_MONTHS` has a line with a read in `need`, and no part of the draw.
   * The stage of lactation of a person of the draw holds that energy. From that age, the draw holds the row minus `MILK_LATER`.
   */
  readonly breastMilk: readonly Person[];
  /** The waste of each product with opened containers, with no cold storage. With `cold: true`, the list is empty. */
  readonly waste: readonly OpenedWaste[];
}

/** No household fragment: the draw has no read. A low rate gives too many days, so the function gives no layer. */
export interface HouseholdFragmentNoRead extends HouseholdStoresResult {
  readonly layer: undefined;
  /** The food energy of the household for one day. It is `undefined` when the household has no person. */
  readonly need: CalorieNeedTotal | undefined;
  readonly needRead: false;
  /** The persons with no row in the table. */
  readonly noRow: readonly Person[];
  /** The infants on formula. */
  readonly formula: readonly Person[];
  /** The infants on breast milk. */
  readonly breastMilk: readonly Person[];
  /** The reason for no layer. */
  readonly why: string;
}

/** The household fragment, or a no read of the draw. Both have the reads of the buy list. */
export type HouseholdFragmentResult = HouseholdFragmentRead | HouseholdFragmentNoRead;

/** This function gives the stores of the buy list, its resources and its gifts with no read. */
function buyListStores(input: HouseholdFragmentInput): { stores: FragmentStore[]; parts: HouseholdStoresResult } {
  const { catalog, units } = input;
  const energy = buyListEnergy(catalog, units);
  const prefix = input.prefix ?? "buy";
  const stores: FragmentStore[] = [];
  const noReads: GiftNoRead[] = [];
  for (const [product, count] of Object.entries(units)) {
    for (const gift of giftsOf(catalog, product, count)) {
      if (!gift.read) noReads.push({ product, resource: gift.resource, why: gift.why });
      else if (gift.amount > 0) stores.push({ id: `${prefix}:${product}:${gift.resource}`, resource: gift.resource, amount: gift.amount });
    }
  }
  return { stores, parts: { energy, noReads, storesRead: noReads.length === 0 } };
}

/**
 * This function gives the resources of the stores and of the uses, with the units of the catalog.
 *
 * @throws RangeError when the resource of a use is not in the catalog in kcal
 */
function layerResources(catalog: SupplyCatalog, stores: readonly FragmentStore[], uses: readonly FragmentDirectUse[]): FragmentResource[] {
  const unitOf = new Map(catalog.resources.map((resource) => [resource.code, resource.unit]));
  for (const use of uses) {
    if (unitOf.get(use.resource) !== "kcal") throw new RangeError(`The catalog has no resource "${use.resource}" in kcal for the use of ${use.need}.`);
  }
  const codes = [...new Set([...stores.map((store) => store.resource), ...uses.map((use) => use.resource)])];
  return codes.map((code) => ({ code, unit: unitOf.get(code) ?? "" }));
}

/**
 * This function applies the rule of an opened container with no cold storage to the stores of the buy list.
 * An opened container serves one feed. A feed that is more than a container takes more containers, and the rest of the last is waste.
 * Thus each container gives `feed / ceil(feed / container)` kcal. The feed is the smallest feed of the formula draw, the worst case.
 * A product with a container of no read gives no store, and a gift with no read.
 *
 * @throws RangeError when a product with opened containers gives a resource that feeds no formula draw
 */
function openedStores(
  input: HouseholdFragmentInput,
  stores: readonly FragmentStore[],
  noReads: readonly GiftNoRead[],
  feed: number | undefined,
): { stores: FragmentStore[]; noReads: GiftNoRead[]; waste: OpenedWaste[] } {
  const out = { stores: [...stores], noReads: [...noReads], waste: [] as OpenedWaste[] };
  if (input.cold === true) return out;
  const prefix = input.prefix ?? "buy";
  const formulaResources = new Set((input.uses ?? DIRECT_USES).filter((use) => use.need === FORMULA_NEED).map((use) => use.resource));
  for (const [id, count] of Object.entries(input.units)) {
    const product = input.catalog.products.find((each) => each.id === id);
    const opened = product?.opened;
    if (product === undefined || opened === undefined || !(count > 0)) continue;
    for (const store of stores.filter((each) => each.id.startsWith(`${prefix}:${id}:`))) {
      if (!formulaResources.has(store.resource)) {
        throw new RangeError(`The product ${id} spoils after its container is opened, and its resource ${store.resource} feeds no formula draw. Only the formula draw has a cited size of one feed.`);
      }
      if (feed === undefined) continue;
      const { container } = opened;
      const size = product.size;
      out.stores = out.stores.filter((each) => each.id !== store.id);
      if (!container.read || size === undefined || !size.read) {
        const why = container.read ? "The size of the product is no read." : `The size of a container is no read: ${container.why}`;
        out.noReads.push({ product: id, resource: store.resource, why: `With no cold storage, an opened container serves one feed (fact ${opened.noCold}). ${why}` });
        continue;
      }
      const unit = canonicalUnit(container.unit);
      const perUnit = Math.round(valueIn(quantity(size.amount, canonicalUnit(size.unit)), unit) / valueIn(quantity(container.amount, unit), unit));
      const containers = count * perUnit;
      const each = store.amount / containers;
      // A small margin keeps a feed of exactly k containers at k containers.
      const used = containers * (feed / Math.ceil(feed / each - 1e-9));
      out.stores.push({ ...store, amount: used });
      out.waste.push({ product: id, resource: store.resource, containers, container: each, feed, used, waste: store.amount - used });
    }
  }
  return out;
}

/**
 * This function joins a household and a buy list into a fragment of an endurance layer.
 *
 * - The draw of food energy has the rate of the need of its persons for one day, and its users are the persons.
 * - The draw of formula has the infants on formula below `FORMULA_DRAW_MONTHS`, with the whole need of their rows.
 *   With `formulaLater: "whole"`, it also has the older infants on formula, with the whole need of their rows.
 * - The fragment has each draw with one or more users. The draw of food energy is first.
 * - Each gift of the buy list with a read is one store, with the `id` `<prefix>:<product>:<resource>`. A gift with no read has no store.
 * - The direct uses are each use of `uses` for the need of a draw. The default `DIRECT_USES` gives 1 kcal for each kcal.
 *   `food.no-cook` feeds the food draw, and `food.infant-formula-ready` feeds the formula draw.
 * - The resources are the resources of the stores and of the direct uses, with the units of the catalog.
 * - The supply part of each draw is `supply`. Its default is the part of `NEED_SUPPLIES` for the need of the draw.
 * - The fragment has no converter. `cookFragment` gives the converters for the dry food, with the water and the fuel of each pot.
 * - With no cold storage (the default), an opened container of formula serves one feed. The store has only the energy of the feeds,
 *   and `waste` gives the rest. The smallest feed is the smallest need of an infant of the draw, divided by `FORMULA_FEEDS`.
 *   A container of no read gives no store and a gift with no read, so the stores are a lower limit.
 *
 * A person with no row in the tables gives no layer, because a low rate gives too many days. The default tables give a row for each age.
 * The option `noRow: "leave-out"` leaves those persons out of the draw. A draw of 0 kcal gives no layer.
 *
 * Each person record below `INFANT_MONTHS` must have a `feeding`. It has no default.
 *
 * - `food`: the need of the infant is in the draw of food energy.
 * - `breast-milk`: below `BREAST_MILK_MONTHS`, the infant has a line, and no part of the draw. From that age, the food draw
 *   holds the need of the row minus the milk energy `MILK_LATER`. The feeding is only for an infant below `INFANT_MONTHS`.
 *   A person of the household must have a stage of lactation. Each infant on breast milk needs one person of the draw with a stage of lactation.
 *   When the infants are more, the function gives no layer: the change of a stage is the milk of one infant.
 * - `formula`: below `FORMULA_DRAW_MONTHS`, the whole need of the infant is in the draw of formula, because the infant has milk only.
 *   From `FORMULA_DRAW_MONTHS`, no cited source gives the part of formula, so the infant gives no layer, as a person with no row.
 *   The option `leave-out` also applies. The option `formulaLater: "whole"` puts the whole need in the formula draw: the upper limit. The feeding is only for an infant below `INFANT_MONTHS`.
 *
 * The function is pure.
 *
 * @param input - The persons, the activity level, the catalog and the buy list, the supply part and the level of the draw
 * @returns The fragment or a no read of the draw, with the energy of the list and the gifts with no read
 * @throws RangeError for the errors of `calorieNeed`, `giftsOf` and `buyListEnergy`, except a household with no person
 * @throws RangeError when the catalog has no resource in `kcal` for the direct use of a draw
 * @throws RangeError when a product with opened containers gives a resource that feeds no formula draw, with no cold storage
 * @throws RangeError when a record below `INFANT_MONTHS` has no `feeding`, or when a `feeding` is not a way of `INFANT_FEEDINGS`
 * @throws RangeError for `breast-milk` and `formula` from `INFANT_MONTHS`
 * @throws RangeError when an infant drinks only breast milk and no person of the household has a stage of lactation
 */
export function householdFragment(input: HouseholdFragmentInput): HouseholdFragmentResult {
  const { stores, parts } = buyListStores(input);
  checkFeedings(input.persons);
  if (input.persons.every((person) => person.count === 0)) {
    return { ...parts, layer: undefined, need: undefined, needRead: false, noRow: [], formula: [], breastMilk: [], why: "The household has no person, so the draw is 0 kcal." };
  }
  const tables = input.table ?? CALORIE_CHAIN;
  const need = calorieNeed(tables, input.persons, input.activity, 1);
  const noRow: Person[] = [];
  const formula: Person[] = [];
  const formulaLater: Person[] = [];
  const breastMilk: Person[] = [];
  let users = 0;
  let perDay = 0;
  let formulaUsers = 0;
  let formulaPerDay = 0;
  // The smallest daily need of one infant of the formula draw, for the smallest feed.
  let formulaLeast = Number.POSITIVE_INFINITY;
  // The persons of the draw with a stage of lactation, and the infants on breast milk.
  let mothers = 0;
  let nursed = 0;
  for (const line of need.lines) {
    const { person } = line;
    if (person.count === 0) continue;
    if (person.feeding === "breast-milk") {
      breastMilk.push(person);
      nursed += person.count;
      if (person.ageMonths >= BREAST_MILK_MONTHS) {
        // The infant also has food. The food draw holds the need of the row minus the milk energy.
        if (!line.read) noRow.push(person);
        else {
          users += person.count;
          perDay += Math.max(0, line.need.value - MILK_LATER.perDay * person.count);
        }
      }
    } else if (person.feeding === "formula") {
      formula.push(person);
      if (line.read && (person.ageMonths < FORMULA_DRAW_MONTHS || input.formulaLater === "whole")) {
        formulaUsers += person.count;
        formulaPerDay += line.need.value;
        formulaLeast = Math.min(formulaLeast, line.need.value / person.count);
      } else formulaLater.push(person);
    } else if (!line.read) noRow.push(person);
    else {
      users += person.count;
      perDay += line.need.value;
      if (makesMilk(tables, person)) mothers += person.count;
    }
  }
  if (breastMilk.length > 0 && !input.persons.some((person) => person.count > 0 && makesMilk(tables, person))) {
    throw new RangeError(
      `The infants ${breastMilk.map(nameOf).join(", ")} drink breast milk, but no person of the household has a stage of lactation. ` +
        "The milk comes from the food of the mother, so give the mother a stage of lactation, for example lactation-1.",
    );
  }
  const reasons = [
    ...(nursed > mothers
      ? [`${String(nursed)} infants drink breast milk, but the draw has ${String(mothers)} persons with a stage of lactation. The change of a stage is the milk of one infant. Give feeding: food to the other infants.`]
      : []),
    ...(noRow.length > 0 ? [`The table has no row for ${String(noRow.length)} person records.`] : []),
    ...(formulaLater.length > 0
      ? [`${String(formulaLater.length)} infant records of ${String(FORMULA_DRAW_MONTHS)} months or more are on formula. No cited source gives the part of their need that formula gives.`]
      : []),
  ];
  if (nursed > mothers) {
    return { ...parts, layer: undefined, need, needRead: false, noRow, formula, breastMilk, why: reasons.join(" ") };
  }
  if (reasons.length > 0 && input.noRow !== "leave-out") {
    return { ...parts, layer: undefined, need, needRead: false, noRow, formula, breastMilk, why: `${reasons.join(" ")} The option noRow: "leave-out" leaves them out of the draw.` };
  }
  const draws: FragmentDraw[] = [];
  if (users > 0 && perDay > 0) draws.push({ need: FOOD_NEED, level: input.level, perDay, users, supply: input.supply ?? NEED_SUPPLIES[FOOD_NEED] });
  if (formulaUsers > 0 && formulaPerDay > 0) {
    draws.push({ need: FORMULA_NEED, level: input.level, perDay: formulaPerDay, users: formulaUsers, supply: input.supply ?? NEED_SUPPLIES[FORMULA_NEED] });
  }
  if (draws.length === 0) {
    return { ...parts, layer: undefined, need, needRead: false, noRow, formula, breastMilk, why: "No person of the draws has a need of food in the draws, so the draws are 0 kcal." };
  }
  const needs = new Set(draws.map((draw) => draw.need));
  const uses = (input.uses ?? DIRECT_USES).filter((use) => needs.has(use.need));
  const feed = formulaUsers > 0 && formulaPerDay > 0 ? formulaLeast / FORMULA_FEEDS.perDay : undefined;
  const opened = openedStores(input, stores, parts.noReads, feed);
  return {
    ...parts,
    noReads: opened.noReads,
    storesRead: opened.noReads.length === 0,
    layer: {
      schema: "endurance/1",
      levels: [...(input.levels ?? [])],
      resources: layerResources(input.catalog, opened.stores, uses),
      stores: opened.stores,
      draws,
      direct: uses.map((use) => ({ ...use })),
    },
    need,
    needRead: true,
    leftOut: [...noRow, ...formulaLater],
    formula,
    breastMilk,
    waste: opened.waste,
  };
}

/** This function gives the name of a person record in a message. */
function nameOf(person: Person): string {
  return `${String(person.sex)} of ${String(person.ageMonths)} months`;
}

/**
 * This function examines the feeding of each record. A record below `INFANT_MONTHS` must have one.
 * Each feeding is a way of `INFANT_FEEDINGS`, and each way holds at the age of the record.
 */
function checkFeedings(persons: readonly Person[]): void {
  for (const person of persons) {
    const { feeding } = person;
    if (feeding === undefined) {
      if (person.count > 0 && person.ageMonths < INFANT_MONTHS) {
        throw new RangeError(`The persons ${nameOf(person)} are below ${String(INFANT_MONTHS)} months and have no feeding. Give feeding: ${INFANT_FEEDINGS.join(", ")}.`);
      }
    } else if (!(INFANT_FEEDINGS as readonly unknown[]).includes(feeding)) {
      throw new RangeError(`The feeding ${String(feeding)} of the persons ${nameOf(person)} is not a way of ${INFANT_FEEDINGS.join(", ")}.`);
    } else if (feeding !== "food" && !(person.ageMonths < INFANT_MONTHS)) {
      throw new RangeError(`The persons ${nameOf(person)} have feeding: ${feeding}, which is only for an infant below ${String(INFANT_MONTHS)} months. Give feeding: food.`);
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
