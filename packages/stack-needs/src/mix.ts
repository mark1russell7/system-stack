import { giftsOf, type SupplyCatalog, type SupplyProduct } from "@mark1russell7/market/supplies";
import { valueIn } from "@mark1russell7/quantity";
import { WATER_DENSITY_MAX, type CookRead } from "./cook.ts";
import { FORMULA_MIX, FORMULA_WATER, type CitedFormulaMix, type CitedFormulaWater } from "./data.ts";
import { FORMULA_POWDER, FORMULA_READY } from "./uses.ts";

// The water to mix the infant formula powder of a buy list, as a converter of an endurance layer.
// One run of the converter is 1 kg of powder: the powder and its mix water give the energy of the powder as ready formula.
// The converter needs no fuel, and it takes only commercially bottled water. Thus a powder with no bottled water gives no feed.
// The records have the form of `Converter` of stack-endurance.

/**
 * This function gives the mix water of infant formula powder, in `kg` for each `kg` of powder.
 *
 * - With `mix.label`, the rule is the label rule. The label gives the water of 100 kcal of prepared formula.
 *   1 kg of powder makes its energy into prepared formula. Its water is `label.water / 100` g for each kcal.
 *   The powder holds some of that water, so the mix water is that water minus the water of the powder.
 *   For `FORMULA_MIX`, 1.34 g/kcal × 5240 kcal = 7021.6 g, minus 20 g, gives 7.0016 kg. That is 1.33618 g for each kcal.
 * - Without `mix.label`, the rule is a mass balance. It assumes that the prepared powder has the energy in 100 g of the ready-to-feed item.
 *   Then 1 kg of powder gives `powder / ready` kg of prepared formula, and the water is that mass minus 1 kg.
 *   For the FDC items, that is 7.3175 kg, 4.5% more than the label rule.
 * - The water of the powder is the water of `mix.powderWater` for each powder product.
 *
 * `formulaMixCheck` compares the water of the prepared formula with the cited water of the ready-to-feed item.
 *
 * @param powderKcalPerKg - The energy of the powder, in `kcal/kg`, for example 5240
 * @param mix - The facts of the rule. The default is `FORMULA_MIX`.
 * @returns The mass of the mix water, in kg for each kg of powder
 * @throws RangeError when the energy of the powder is not above the energy of the ready-to-feed item, or the rule gives no positive water
 */
export function formulaMixWater(powderKcalPerKg: number, mix: CitedFormulaMix = FORMULA_MIX): number {
  const readyKcalPerKg = mix.readyKcal * 10;
  if (!(powderKcalPerKg > readyKcalPerKg) || !Number.isFinite(powderKcalPerKg)) {
    throw new RangeError(`The powder gives ${String(powderKcalPerKg)} kcal/kg. The mix rule needs a finite energy above the ${String(readyKcalPerKg)} kcal/kg of the ready-to-feed item.`);
  }
  if (mix.label === undefined) return powderKcalPerKg / readyKcalPerKg - 1;
  const water = ((mix.label.water / 100) * powderKcalPerKg - mix.powderWater * 10) / 1000;
  if (!(water > 0) || !Number.isFinite(water)) {
    throw new RangeError(`The label rule gives ${String(water)} kg of mix water for each kg of powder. The rule needs a positive finite water.`);
  }
  return water;
}

/** The check of the mix rule: the water in 100 g of prepared formula from the rule, and the cited water of the ready-to-feed item. */
export interface FormulaMixCheck {
  /** The powder in 100 g of prepared formula, in `g`. */
  readonly powder: number;
  /** The mix water in 100 g of prepared formula, in `g`. */
  readonly added: number;
  /** The water in 100 g of prepared formula, in `g`: the mix water and the water of the powder. */
  readonly predicted: number;
  /** The cited water in 100 g of the ready-to-feed item, in `g`. */
  readonly cited: number;
  /** The difference of `predicted` and `cited`, divided by `cited`. */
  readonly relative: number;
}

/**
 * This function gives the check of the mix rule with the cited water of the ready-to-feed item. The rule does not use that water,
 * so the check is independent of it. For `FORMULA_MIX`, 100 g of prepared formula has 12.4975 g of powder and 87.5025 g of mix water.
 * The powder holds 0.2500 g of water, so the prediction is 87.7525 g. The FDC item gives 88.1 g, 0.39% more.
 *
 * @param mix - The facts of the rule. The default is `FORMULA_MIX`.
 * @returns The predicted water, the cited water and their relative difference
 * @throws RangeError for the errors of `formulaMixWater`
 */
export function formulaMixCheck(mix: CitedFormulaMix = FORMULA_MIX): FormulaMixCheck {
  const water = formulaMixWater(mix.powderKcal * 10, mix);
  const powder = 100 / (1 + water);
  const added = 100 - powder;
  const predicted = added + (powder * mix.powderWater) / 100;
  return { powder, added, predicted, cited: mix.readyWater, relative: (predicted - mix.readyWater) / mix.readyWater };
}

/** The inputs of the mix fragment. */
export interface FormulaMixInput {
  /** The catalog of supplies of `@mark1russell7/market`. */
  readonly catalog: SupplyCatalog;
  /** The count of units of each product of the buy list, by the `id` of the product. */
  readonly units: Readonly<Record<string, number>>;
  /** The facts of the mix rule. The default is `FORMULA_MIX`. */
  readonly mix?: CitedFormulaMix | undefined;
  /** The rule of the mix water. The default is `FORMULA_WATER`: only `water.bottled`. */
  readonly water?: CitedFormulaWater | undefined;
  /** The start of the `id` of the converter. The default is `mix`. */
  readonly prefix?: string | undefined;
}

/** The mix values of one product of the buy list that gives `FORMULA_POWDER`, for 1 kg of powder. */
export interface FormulaMixLine {
  readonly product: string;
  /** The energy of the powder, in `kcal/kg`. */
  readonly energy: CookRead;
  /** The mix water, in `L/kg` of powder. */
  readonly water: CookRead;
}

/** The converter of the mix fragment, with the form of `Converter` of `@mark1russell7/stack-endurance`. It gives a resource, not a need. */
export interface MixConverter {
  readonly id: string;
  readonly takes: readonly { readonly resource: string; readonly amount: number }[];
  readonly gives: { readonly resource: string; readonly amount: number };
}

/** The mix fragment of an endurance layer: the resources and one converter, or none. It has no store and no draw. */
export interface MixFragment {
  /** The format of an endurance layer, `endurance/1`. */
  readonly schema: "endurance/1";
  readonly levels: readonly string[];
  readonly resources: readonly { readonly code: string; readonly unit: string }[];
  readonly stores: readonly never[];
  readonly draws: readonly never[];
  readonly converters: readonly MixConverter[];
}

/** The mix fragment, the line of each powder product and the reason when the powder has no converter. */
export interface FormulaMixResult {
  readonly layer: MixFragment;
  /** The line of each product of the buy list that gives `FORMULA_POWDER`, in the order of the list. */
  readonly lines: readonly FormulaMixLine[];
  /** The reasons when the buy list has powder and the powder has no converter. Otherwise `undefined`. */
  readonly why: string | undefined;
  /** True when the powder of the buy list has a converter, or when the list has no powder. */
  readonly read: boolean;
  /** The products of the buy list that give the mix water of the rule, `water.bottled`, in the order of the list. */
  readonly bottled: readonly string[];
  /**
   * The reason when the buy list has powder and no product that gives the mix water. Otherwise `undefined`.
   * The converter stays: a store of bottled water from a different fragment feeds it. With no such store, the powder gives 0 days.
   */
  readonly waterWhy: string | undefined;
}

/** This function gives the value of an amount in a unit, or `undefined` when the units do not convert. */
function inUnit(value: number, from: string, to: string): number | undefined {
  try {
    const out = valueIn({ value, unit: from }, to);
    return Number.isFinite(out) ? out : undefined;
  } catch {
    return undefined;
  }
}

const read = (value: number, unit: string): CookRead => ({ read: true, value, unit });
const noRead = (why: string): CookRead => ({ read: false, why });

/** This function gives the mix line of one product. Each missing fact gives a no read with its reason. */
function mixLine(product: SupplyProduct, perUnitKg: number | undefined, foodGifts: number, mix: CitedFormulaMix): FormulaMixLine {
  let energy: CookRead;
  if (foodGifts > 1) energy = noRead(`The product ${product.id} gives ${String(foodGifts)} foods. The catalog gives one energy for the whole product, not the energy of each food.`);
  else if (product.energy === undefined) energy = noRead(`The product ${product.id} has no food energy in the catalog.`);
  else if (!product.energy.read) energy = noRead(`The food energy of the product ${product.id} is a no read: ${product.energy.why}`);
  else {
    const kcal = inUnit(product.energy.amount, product.energy.unit, "kcal");
    if (kcal === undefined) energy = noRead(`The food energy of the product ${product.id} is in ${product.energy.unit}, which does not convert to kcal.`);
    else if (perUnitKg === undefined || !(perUnitKg > 0)) energy = noRead(`The gift of ${FORMULA_POWDER} of the product ${product.id} has no read in kg.`);
    else energy = read(kcal / perUnitKg, "kcal/kg");
  }
  let water: CookRead;
  if (!energy.read) water = noRead(`The mix water is a no read: ${energy.why}`);
  else if (!(energy.value > mix.readyKcal * 10)) {
    water = noRead(`The powder of the product ${product.id} gives ${String(energy.value)} kcal/kg, not more than the ${String(mix.readyKcal * 10)} kcal/kg of the ready-to-feed item.`);
  } else water = read(formulaMixWater(energy.value, mix) / WATER_DENSITY_MAX.value, "L/kg");
  return { product: product.id, energy, water };
}

/**
 * This function gives the converter that mixes the infant formula powder of a buy list with water, with no fuel.
 *
 * - One run of the converter is 1 kg of powder. It takes the powder and the mix water from `water.bottled` only.
 *   It gives the energy of the powder as `food.infant-formula-ready`. The direct use of that resource feeds the formula need.
 * - The mix water is `formulaMixWater`: the label water of the store-brand powder (21 CFR 107.10), minus the water of the powder.
 * - The mass of the water converts to a volume at `WATER_DENSITY_MAX`, 1 kg/L. Water above 4 °C is less dense, so the true volume is a little more.
 * - The water is `water.bottled`, commercially bottled water (`FORMULA_WATER`). The WIC guide (page 107) tells to use bottled water
 *   for powder after a disaster or in a power cut. A store of tap water (`water.stored`) does not feed the mix.
 *   Thus a buy list with powder and only tap water gives 0 days of formula from the powder, and `waterWhy` tells the reason.
 * - `RESOURCE_SUBSETS` makes bottled water also stored water. `householdFragment` gives that converter, so a drinking draw also uses bottled water.
 * - The WIC guide tells to prepare powder one bottle at a time, for one feed. Thus the mix has no waste of an opened container.
 * - The powder of each product comes from its food energy in the catalog. Two products of the list can give powder.
 *   The converter then takes the worst case of their lines: the most water and the least energy. A line with no read gives no converter.
 * - A drinking draw at a higher level takes its water first, by the take order of `enduranceOf`. It takes the tap water first, then the bottled water.
 *   Thus, when a case cuts the water supply, the powder can add 0 days.
 *
 * The function is pure.
 *
 * @param input - The catalog and the buy list, and the facts of the mix rule
 * @returns The fragment, the line of each powder product and the reasons for no converter
 * @throws RangeError when the catalog has no product of an `id` of the buy list
 * @throws RangeError when the powder has a converter and the catalog has no `food.infant-formula-powder` in a unit of mass
 * @throws RangeError when the powder has a converter and the catalog has no `food.infant-formula-ready` in a unit of energy
 * @throws RangeError when the powder has a converter and the catalog has no `water.bottled` in a unit of volume
 * @throws RangeError for the errors of `giftsOf`
 */
export function formulaMixFragment(input: FormulaMixInput): FormulaMixResult {
  const { catalog, units } = input;
  const mix = input.mix ?? FORMULA_MIX;
  const water = (input.water ?? FORMULA_WATER).resource;
  const bottled: string[] = [];
  const isFood = (code: string): boolean => catalog.resources.find((item) => item.code === code)?.kind === "food";
  const lines: FormulaMixLine[] = [];
  for (const [id, count] of Object.entries(units)) {
    if (!(count > 0)) continue;
    const product = catalog.products.find((item) => item.id === id);
    if (product === undefined) throw new RangeError(`The catalog has no product "${id}".`);
    const gifts = giftsOf(catalog, id, 1);
    const foodGifts = gifts.filter((gift) => isFood(gift.resource)).length;
    if (gifts.some((gift) => gift.resource === water)) bottled.push(id);
    for (const gift of gifts) {
      if (gift.resource !== FORMULA_POWDER) continue;
      lines.push(mixLine(product, gift.read ? inUnit(gift.amount, gift.unit, "kg") : undefined, foodGifts, mix));
    }
  }

  const empty = (why: string | undefined): FormulaMixResult => ({
    layer: { schema: "endurance/1", levels: [], resources: [], stores: [], draws: [], converters: [] },
    lines,
    why,
    read: why === undefined,
    bottled,
    waterWhy: undefined,
  });
  if (lines.length === 0) return empty(undefined);
  const why = lines.flatMap((line) => [line.energy, line.water].flatMap((value) => (value.read ? [] : [`${line.product}: ${value.why}`])));
  if (why.length > 0) return empty([...new Set(why)].join(" "));

  const unitOf = new Map(catalog.resources.map((resource) => [resource.code, resource.unit]));
  const powderPerKg = inUnit(1, "kg", unitOf.get(FORMULA_POWDER) ?? "");
  if (powderPerKg === undefined) throw new RangeError(`The catalog has no resource "${FORMULA_POWDER}" in a unit of mass for the powder.`);
  const readyPerKcal = inUnit(1, "kcal", unitOf.get(FORMULA_READY) ?? "");
  if (readyPerKcal === undefined) throw new RangeError(`The catalog has no resource "${FORMULA_READY}" in a unit of energy for the prepared formula.`);
  const waterPerL = inUnit(1, "L", unitOf.get(water) ?? "");
  if (waterPerL === undefined) throw new RangeError(`The catalog has no resource "${water}" in a unit of volume for the mix water.`);
  const values = (pick: (line: FormulaMixLine) => CookRead): number[] => lines.map((line) => {
    const value = pick(line);
    return value.read ? value.value : Number.NaN;
  });
  const converter: MixConverter = {
    id: `${input.prefix ?? "mix"}:${FORMULA_POWDER}`,
    takes: [
      { resource: FORMULA_POWDER, amount: powderPerKg },
      { resource: water, amount: Math.max(...values((line) => line.water)) * waterPerL },
    ],
    gives: { resource: FORMULA_READY, amount: Math.min(...values((line) => line.energy)) * readyPerKcal },
  };
  return {
    layer: {
      schema: "endurance/1",
      levels: [],
      resources: [FORMULA_POWDER, water, FORMULA_READY].map((code) => ({ code, unit: unitOf.get(code) ?? "" })),
      stores: [],
      draws: [],
      converters: [converter],
    },
    lines,
    why: undefined,
    read: true,
    bottled,
    waterWhy:
      bottled.length > 0
        ? undefined
        : `The buy list has no product that gives ${water}. The WIC guide (${FORMULA_WATER.locator}) tells to use bottled water for powder, so tap water does not feed the mix. With no store of ${water} from a different fragment, the powder gives 0 days.`,
  };
}
