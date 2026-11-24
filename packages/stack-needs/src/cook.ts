import type { Source } from "@mark1russell7/guidebook";
import { fuelEnergyPerMass, giftsOf, cookWater, type CitedRate, type HeatingValue, type StoveFacts, type SupplyCatalog, type SupplyProduct } from "@mark1russell7/market/supplies";
import { valueIn, type Quantity } from "@mark1russell7/quantity";
import { FOOD_NEED, STORED_WATER } from "./uses.ts";

// The water and the fuel to cook the dry food of a buy list, as converters of an endurance layer.
// One run of a converter is one pot: the dry food, the cook water and the fuel of the pot give the food energy of the pot.
// Thus a dry food with no fuel or no water gives no meal. The records have the form of `Converter` of stack-endurance.
// Each value comes from a cited fact of the catalog, a cited input or a cited constant. A missing fact gives a no read.

/** The source of the specific heat of water: the NIST Guide to the SI (Special Publication 811). It is a work of the United States federal government. */
export const NIST_SI_GUIDE_SOURCE: Source = {
  id: "nist-sp-811",
  title: "NIST Guide to the SI (Special Publication 811), Appendix B.8 and footnotes",
  url: "https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8",
  license: "us-public-domain",
  checked: "2026-11-24",
  by: "National Institute of Standards and Technology",
  terms: "https://www.nist.gov/oism/copyrights",
  note: "The footnotes are at https://www.nist.gov/pml/special-publication-811/nist-guide-si-footnotes.",
};

/** The source of the density of water: the page Water Density of the USGS Water Science School. It is a work of the United States federal government. */
export const USGS_WATER_DENSITY_SOURCE: Source = {
  id: "usgs-water-density",
  title: "Water Density, USGS Water Science School",
  url: "https://www.usgs.gov/special-topics/water-science-school/science/water-density",
  license: "us-public-domain",
  checked: "2026-11-24",
  by: "U.S. Geological Survey",
  terms: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
};

/** A physical constant of the cook model, with its source and the place of the value in the source. */
export interface CookConstant {
  readonly value: number;
  readonly unit: string;
  readonly source: Source;
  readonly locator: string;
  /** How the value comes from the source. */
  readonly note: string;
}

/**
 * The mean specific heat of liquid water from 0 °C to 100 °C: 4.19002 kJ/(kg.K).
 * The NIST Guide to the SI gives 4.190 02 J for the calorie (mean). The common definition of that calorie is the mean over this range.
 * SP 811 does not state the range. Its footnote 10 tells that the calorie is the energy to raise 1 g of water
 * by 1 kelvin. For the default start (0 °C), the value is the mean of the rise. For a warmer start, the mean of the
 * rise can be a little higher. The model also heats the dry food with this value, above the specific heat of a dry food.
 * That term holds the heat of the pot above the true value.
 */
export const WATER_SPECIFIC_HEAT: CookConstant = {
  value: 4.19002,
  unit: "kJ/(kg.K)",
  source: NIST_SI_GUIDE_SOURCE,
  locator: "Appendix B.8, row calorie (mean): 4.190 02 E+00 J. Footnotes, footnote 10: the energy to raise 1 gram of water by 1 °C.",
  note: "The calorie (mean) in joules, for 1 g of water and 1 K. By its common definition, the mean is over the range from 0 °C to 100 °C. SP 811 does not state the range.",
};

/**
 * The largest density of liquid water: 1 kg/L. The USGS table gives 1.00000 g/cm3 at 4.0 °C, its largest value.
 * Thus 1 L of cook water is 1 kg or less.
 */
export const WATER_DENSITY_MAX: CookConstant = {
  value: 1,
  unit: "kg/L",
  source: USGS_WATER_DENSITY_SOURCE,
  locator: "Table of the density and the weight of water by temperature, row 39.2 °F/4.0 °C: 1.00000 g/cm3",
  note: "The largest density of the table, from 0 °C to 100 °C. Each other row is less.",
};

/**
 * The temperature at the end of the heat to boil, in °C.
 * Water boils at a lower temperature at a high place. Then the heat is less.
 * But the cook time is longer there, and the model does not give that time. Thus at a high place the fuel is not an upper limit.
 */
export const BOIL_CELSIUS = 100;

/**
 * The default start temperature of the cook water, in °C: 0, the freezing point. Liquid water at the pressure of the sea is
 * not colder. Thus the default gives the most heat. A caller gives a warmer start with its citation.
 */
export const COLD_START_CELSIUS = 0;

/** The start temperature of the cook water, with the citation of the caller, for example a read of the stored water. */
export interface CookStart {
  /** The temperature in °C, from 0 up to less than `BOIL_CELSIUS`. */
  readonly celsius: number;
  /** The citation of the value: the `id` of a fact or a source of the caller. */
  readonly cite: string;
}

/**
 * The stove share is the part of the heat of the fuel that goes into the water and the food of the pot.
 * Its value is from more than 0 to 1, with its citation. The heat of the pot itself is in the losses. `heating` tells the heating value of the fuel energy that the share applies to.
 */
export interface StoveShare {
  readonly value: number;
  readonly heating: HeatingValue;
  /** The citation of the value: the `id` of a fact or a source of the caller. */
  readonly cite: string;
}

/** The inputs of the cook fragment. */
export interface CookFragmentInput {
  /** The catalog of supplies of `@mark1russell7/market`. */
  readonly catalog: SupplyCatalog;
  /** The count of units of each product of the buy list, by the `id` of the product. */
  readonly units: Readonly<Record<string, number>>;
  /** The stove: the `id` of a product of the catalog with stove facts, or the cited stove facts of the caller. */
  readonly stove: string | StoveFacts;
  /**
   * The dry mass of the food of one pot, for example `{ "value": 0.5, "unit": "kg" }`. It is a plan of the caller. It has no default.
   * Give the smallest pot that the cook makes. A batch above the real pot gives too little fuel, because each pot takes its own cook time.
   */
  readonly batch: Quantity;
  /** The stove share. Without it, the fuel of the boil is a no read, so each fuel is a no read. It has no default. */
  readonly share?: StoveShare | undefined;
  /** The start temperature of the cook water. The default is `COLD_START_CELSIUS`. */
  readonly start?: CookStart | undefined;
  /** The `id` of the stove in the stack. The converters stop when the stove stops. */
  readonly device?: string | undefined;
  /** The start of the `id` of each converter. The default is `cook`. */
  readonly prefix?: string | undefined;
}

/** A value of the cook model with a read, in its unit, or no read with the reasons. A no read is not 0. */
export type CookRead = { readonly read: true; readonly value: number; readonly unit: string } | { readonly read: false; readonly why: string };

/** The cook values of one dry food of the buy list, for one pot. */
export interface CookLine {
  readonly product: string;
  /** The dry resource of the product, for example `food.grain-dry`. */
  readonly resource: string;
  /** The food energy of the dry food, in `kcal/kg`. */
  readonly energy: CookRead;
  /** The cook water, in `L/kg` of dry food, from `cookWater` of market. */
  readonly water: CookRead;
  /** The heat to boil the cook water of one pot, in `kJ`. */
  readonly heat: CookRead;
  /** The time of the stove for one pot: the boil time and the high end of the cook time, in `min`. */
  readonly minutes: CookRead;
  /** The fuel of one pot, in `kg`. */
  readonly fuel: CookRead;
}

/** A converter of the cook fragment, with the form of `Converter` of `@mark1russell7/stack-endurance`. */
export interface FragmentConverter {
  readonly id: string;
  readonly device?: string | undefined;
  readonly takes: readonly { readonly resource: string; readonly amount: number }[];
  readonly gives: { readonly need: string; readonly amount: number };
}

/** The cook fragment of an endurance layer: the resources and one converter for each dry resource with a read. It has no store and no draw. */
export interface CookFragment {
  /** The format of an endurance layer, `endurance/1`. */
  readonly schema: "endurance/1";
  readonly levels: readonly string[];
  readonly resources: readonly { readonly code: string; readonly unit: string }[];
  readonly stores: readonly never[];
  readonly draws: readonly never[];
  readonly converters: readonly FragmentConverter[];
}

/** A dry resource of the buy list with no converter, and the reasons. */
export interface CookNoRead {
  readonly resource: string;
  readonly why: string;
}

/** The cook fragment, the line of each dry food and the dry resources with no converter. */
export interface CookFragmentResult {
  readonly layer: CookFragment;
  /** The line of each dry food of the buy list, in the order of the list. */
  readonly lines: readonly CookLine[];
  /** The dry resources with no converter. Their dry food gives no meal in the layer. */
  readonly noReads: readonly CookNoRead[];
  /** True when each dry resource of the buy list has a converter. When it is false, the cooked days are a lower limit. */
  readonly read: boolean;
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

/** A fuel rate of a stove, in an energy or in a mass for each minute. */
type StoveRate = { readonly kind: "energy"; readonly perMin: number } | { readonly kind: "mass"; readonly perMin: number };

/** This function gives the fuel rate of a stove in `kJ/min` or `kg/min`. It gives `undefined` for a rate that is not an energy or a mass in a time. */
function stoveRate(rate: CitedRate): StoveRate | undefined {
  const minutes = inUnit(rate.per.amount, rate.per.unit, "min");
  if (minutes === undefined || !(minutes > 0)) return undefined;
  const energy = inUnit(rate.amount, rate.unit, "kJ");
  if (energy !== undefined) return { kind: "energy", perMin: energy / minutes };
  const mass = inUnit(rate.amount, rate.unit, "kg");
  if (mass !== undefined) return { kind: "mass", perMin: mass / minutes };
  return undefined;
}

const read = (value: number, unit: string): CookRead => ({ read: true, value, unit });
const noRead = (why: string): CookRead => ({ read: false, why });

/** The inputs of one line that do not change with the product. */
interface StoveContext {
  readonly stove: StoveFacts;
  readonly batchKg: number;
  readonly share: StoveShare | undefined;
  readonly startC: number;
  /** The energy of the fuel in `kJ/kg`, and its heating value, or `undefined` when the fuel has no cited energy. */
  readonly fuelEnergy: { readonly perKg: number; readonly heating: HeatingValue } | undefined;
}

/**
 * This function gives the cook line of one dry food. Each missing fact gives a no read with its reason.
 * The fuel is a safe upper limit: the stove burns at its full rate for the boil time and the cook time.
 * Only a stove rate with no bound gives the fuel. A rate with a bound, for example `bound: "least"`, gives a no read.
 * At a high place the cook time is longer. The model does not give that time, so there the fuel is not an upper limit.
 */
function cookLine(product: SupplyProduct, resource: string, perUnitKg: number | undefined, foodGifts: number, context: StoveContext): CookLine {
  const { stove, batchKg, share, startC, fuelEnergy } = context;

  let energy: CookRead;
  if (foodGifts > 1) energy = noRead(`The product ${product.id} gives ${String(foodGifts)} foods. The catalog gives one energy for the whole product, not the energy of each food.`);
  else if (product.energy === undefined) energy = noRead(`The product ${product.id} has no food energy in the catalog.`);
  else if (!product.energy.read) energy = noRead(`The food energy of the product ${product.id} is a no read: ${product.energy.why}`);
  else {
    const kcal = inUnit(product.energy.amount, product.energy.unit, "kcal");
    if (kcal === undefined) energy = noRead(`The food energy of the product ${product.id} is in ${product.energy.unit}, which does not convert to kcal.`);
    else if (perUnitKg === undefined || !(perUnitKg > 0)) energy = noRead(`The gift of ${resource} of the product ${product.id} has no read in kg.`);
    else energy = read(kcal / perUnitKg, "kcal/kg");
  }

  const litres = cookWater(product);
  const water = litres === undefined ? noRead(`The catalog cites no cook water for the product ${product.id}, or no bulk mass for its water rate.`) : read(valueIn(litres, "L/kg"), "L/kg");

  // The heat to boil one pot: the mass of the water and the dry food times the specific heat of water times the rise to the boil.
  const heat = water.read ? read((water.value * WATER_DENSITY_MAX.value + 1) * batchKg * WATER_SPECIFIC_HEAT.value * (BOIL_CELSIUS - startC), "kJ") : noRead(`The heat to boil is a no read: ${water.why}`);

  const why: string[] = [];
  if (!heat.read) why.push(heat.why);
  const time = product.cook?.time;
  const cookMin = time === undefined ? undefined : inUnit(time.high, time.unit, "min");
  if (time === undefined) why.push(`The catalog cites no cook time for the product ${product.id}.`);
  else if (cookMin === undefined) why.push(`The cook time of the product ${product.id} is in ${time.unit}, which does not convert to min.`);

  // Only a rate with no bound is the value. A least rate gives too little fuel for the cook time, and an unknown bound has no side.
  const bound: unknown = stove.rate !== undefined && "bound" in stove.rate ? stove.rate.bound : undefined;
  const rate = stove.rate === undefined || bound !== undefined ? undefined : stoveRate(stove.rate);
  if (stove.rate === undefined) why.push(`The stove of ${stove.fuel} has no cited fuel rate.`);
  else if (bound !== undefined)
    why.push(`The fuel rate of the stove has the bound ${String(bound)}. Only a rate with no bound is the value.${bound === "least" ? " A least rate gives too little fuel for the cook time." : ""}`);
  else if (rate === undefined) why.push(`The fuel rate of the stove is in ${stove.rate.unit} for each ${stove.rate.per.unit}, which is not an energy or a mass in a time.`);

  // The heat of the stove into the pot for each minute, in kJ/min. It needs a cited share with the same heating value as the energy rate.
  let potPerMin: number | undefined;
  if (share === undefined) why.push("No cited stove share gives the part of the stove heat that goes into the pot. Thus the fuel of the boil is a no read.");
  else if (rate !== undefined) {
    if (rate.kind === "energy") {
      if (stove.heating !== share.heating) why.push(`The stove share is for the ${share.heating} heating value, and the stove rate is for the ${String(stove.heating ?? "unknown")} heating value.`);
      else potPerMin = rate.perMin * share.value;
    } else if (fuelEnergy === undefined) why.push(`The fuel ${stove.fuel} has no cited energy, so its mass rate gives no heat for the boil.`);
    else if (fuelEnergy.heating !== share.heating) why.push(`The stove share is for the ${share.heating} heating value, and the energy of the fuel ${stove.fuel} is the ${fuelEnergy.heating} value.`);
    else potPerMin = rate.perMin * fuelEnergy.perKg * share.value;
  }

  // The fuel mass for each minute at the full rate, in kg/min. An energy rate converts only through the cited fuel energy of the same heating value.
  let fuelPerMin: number | undefined;
  if (rate?.kind === "mass") fuelPerMin = rate.perMin;
  else if (rate?.kind === "energy") {
    if (fuelEnergy === undefined) why.push(`The fuel ${stove.fuel} has no cited energy, so the energy rate of the stove gives no fuel mass.`);
    else if (stove.heating === undefined) why.push("The energy rate of the stove has no heating value.");
    else if (stove.heating !== fuelEnergy.heating) why.push(`The stove rate is for the ${stove.heating} heating value, and the energy of the fuel ${stove.fuel} is the ${fuelEnergy.heating} value.`);
    else fuelPerMin = rate.perMin / fuelEnergy.perKg;
  }

  if (why.length > 0 || !heat.read || cookMin === undefined || potPerMin === undefined || fuelPerMin === undefined || !(potPerMin > 0)) {
    const text = why.join(" ");
    return { product: product.id, resource, energy, water, heat, minutes: noRead(text), fuel: noRead(text) };
  }
  const minutes = heat.value / potPerMin + cookMin;
  return { product: product.id, resource, energy, water, heat, minutes: read(minutes, "min"), fuel: read(minutes * fuelPerMin, "kg") };
}

/** This function gives the stove facts of the input: the facts of the caller, or the facts of a product of the catalog. */
function stoveOf(catalog: SupplyCatalog, stove: string | StoveFacts): StoveFacts {
  if (typeof stove !== "string") return stove;
  const product = catalog.products.find((item) => item.id === stove);
  if (product === undefined) throw new RangeError(`The catalog has no product "${stove}".`);
  if (product.stove === undefined) throw new RangeError(`The product "${stove}" has no stove facts.`);
  return product.stove;
}

/** This function tells if a resource of the catalog is a food. */
function isFood(catalog: SupplyCatalog, code: string): boolean {
  return catalog.resources.find((item) => item.code === code)?.kind === "food";
}

/** This function tells if a resource of the catalog is a dry food: a food resource in a unit of mass. */
function isDryFood(catalog: SupplyCatalog, code: string): boolean {
  const resource = catalog.resources.find((item) => item.code === code);
  return resource !== undefined && resource.kind === "food" && inUnit(1, resource.unit, "kg") !== undefined;
}

/**
 * This function gives the converters that cook the dry food of a buy list, with the water and the fuel of each pot.
 *
 * - One run of a converter is one pot of `batch`. It takes the dry food, the cook water from `water.stored` and the fuel of the stove.
 *   It gives the food energy of the pot to the need `food.energy`. Thus a dry food with no fuel or no water gives no meal.
 * - The cook water is `cookWater` of market times the dry mass. It is the resource of the drinking water.
 * - The heat to boil is the mass of the water and the dry food times `WATER_SPECIFIC_HEAT` times the rise from the start to `BOIL_CELSIUS`.
 *   The water mass takes `WATER_DENSITY_MAX`. The dry food takes the specific heat of water, which is higher than its own.
 * - The boil time is the heat divided by the stove rate times the share. The time of the stove is the boil time plus the high end of the cook time.
 * - The fuel is a safe upper limit: the stove burns at its full rate for all of that time. At a high place the cook time is longer.
 *   The model does not give that time, so there the fuel is not an upper limit.
 * - Only a stove rate with no bound gives the fuel. A rate with a bound, for example `bound: "least"`, gives a no read. The fuel of the cook time is the rate times the time, so a least rate gives too little fuel.
 * - A rate in a mass gives the fuel directly. A rate in an energy gives a mass only through the cited energy of the fuel, with the same heating value.
 *
 * A dry food is a gift of a food resource in a unit of mass. Each missing fact gives a line with no read and its reasons, not a figure.
 * Two products of the list can give one dry resource, for example rice and oats. The converter then takes the worst case of their lines:
 * the most water, the most fuel and the least food energy. When a line of the resource has no read, the resource has no converter.
 * A store of the resource from a different fragment gets the converter of this list.
 *
 * The catalog of market gives no soak water. A food that needs a soak, for example dry beans, has a second water draw that this function does not give.
 * A product that gives more than one food has no energy for each food, so its energy is a no read.
 *
 * The cook water is `water.stored`, the store of the drinking water. A drinking draw at a higher level of the same store takes
 * its water first, by the take order of `enduranceOf`. The drinking draw keeps back its days times its demand, which is all of the store.
 * Thus, when a case cuts the water supply, the dry food adds 0 days at each amount of stored water.
 *
 * The function is pure.
 *
 * @param input - The catalog and the buy list, the stove, the dry mass of one pot, the share and the start temperature
 * @returns The fragment, the line of each dry food and the dry resources with no converter
 * @throws RangeError when the batch is not a mass above 0, or when the share is not above 0 and up to 1
 * @throws RangeError when the start is not from 0 up to less than 100 °C
 * @throws RangeError when the stove is a product with no stove facts
 * @throws RangeError when the catalog has no product of an `id` of the buy list
 * @throws RangeError when the catalog has no resource of the fuel in a unit of mass
 * @throws RangeError when a converter has a read and the catalog has no resource `water.stored` in a unit of volume
 * @throws RangeError for the errors of `giftsOf`
 */
export function cookFragment(input: CookFragmentInput): CookFragmentResult {
  const { catalog, units } = input;
  const batchKg = inUnit(input.batch.value, input.batch.unit, "kg");
  if (batchKg === undefined || !(batchKg > 0)) throw new RangeError(`The batch ${String(input.batch.value)} ${input.batch.unit} is not a mass above 0.`);
  const { share } = input;
  if (share !== undefined && !(share.value > 0 && share.value <= 1)) throw new RangeError(`The stove share is ${String(share.value)}. It must be above 0 and up to 1.`);
  const startC = input.start?.celsius ?? COLD_START_CELSIUS;
  if (!(startC >= 0 && startC < BOIL_CELSIUS)) throw new RangeError(`The start temperature is ${String(startC)} °C. It must be from 0 up to less than ${String(BOIL_CELSIUS)} °C.`);
  const stove = stoveOf(catalog, input.stove);
  const fuel = catalog.resources.find((resource) => resource.code === stove.fuel);
  const fuelUnitPerKg = fuel === undefined ? undefined : inUnit(1, "kg", fuel.unit);
  if (fuel === undefined || fuelUnitPerKg === undefined) throw new RangeError(`The catalog has no resource "${stove.fuel}" in a unit of mass for the fuel of the stove.`);
  const perKg = fuelEnergyPerMass(fuel);
  const context: StoveContext = {
    stove,
    batchKg,
    share,
    startC,
    fuelEnergy: perKg === undefined || fuel.fuelEnergy === undefined ? undefined : { perKg: valueIn(perKg, "kJ/kg"), heating: fuel.fuelEnergy.heating },
  };

  const unitOf = new Map(catalog.resources.map((resource) => [resource.code, resource.unit]));
  const lines: CookLine[] = [];
  for (const [id, count] of Object.entries(units)) {
    if (!(count > 0)) continue;
    const product = catalog.products.find((item) => item.id === id);
    if (product === undefined) throw new RangeError(`The catalog has no product "${id}".`);
    if (product.kind !== "food") continue;
    const gifts = giftsOf(catalog, id, 1);
    const foodGifts = gifts.filter((gift) => isFood(catalog, gift.resource)).length;
    for (const gift of gifts) {
      if (!isDryFood(catalog, gift.resource)) continue;
      const perUnitKg = gift.read ? inUnit(gift.amount, gift.unit, "kg") : undefined;
      lines.push(cookLine(product, gift.resource, perUnitKg, foodGifts, context));
    }
  }

  const prefix = input.prefix ?? "cook";
  const converters: FragmentConverter[] = [];
  const noReads: CookNoRead[] = [];
  for (const resource of [...new Set(lines.map((line) => line.resource))]) {
    const own = lines.filter((line) => line.resource === resource);
    const why = own.flatMap((line) => [line.energy, line.water, line.fuel].flatMap((value) => (value.read ? [] : [`${line.product}: ${value.why}`])));
    if (why.length > 0) {
      noReads.push({ resource, why: [...new Set(why)].join(" ") });
      continue;
    }
    const most = (pick: (line: CookLine) => CookRead): number => Math.max(...own.map((line) => valueOf(pick(line))));
    const least = (pick: (line: CookLine) => CookRead): number => Math.min(...own.map((line) => valueOf(pick(line))));
    const dryPerKg = inUnit(1, "kg", unitOf.get(resource) ?? "") ?? 1;
    const waterPerL = inUnit(1, "L", unitOf.get(STORED_WATER) ?? "");
    if (waterPerL === undefined) throw new RangeError(`The catalog has no resource "${STORED_WATER}" in a unit of volume for the cook water.`);
    converters.push({
      id: `${prefix}:${resource}`,
      ...(input.device === undefined ? {} : { device: input.device }),
      takes: [
        { resource, amount: batchKg * dryPerKg },
        { resource: STORED_WATER, amount: most((line) => line.water) * batchKg * waterPerL },
        { resource: stove.fuel, amount: most((line) => line.fuel) * fuelUnitPerKg },
      ],
      gives: { need: FOOD_NEED, amount: least((line) => line.energy) * batchKg },
    });
  }

  const codes = [...new Set(converters.flatMap((converter) => converter.takes.map((take) => take.resource)))];
  return {
    layer: {
      schema: "endurance/1",
      levels: [],
      resources: codes.map((code) => ({ code, unit: unitOf.get(code) ?? "" })),
      stores: [],
      draws: [],
      converters,
    },
    lines,
    noReads,
    read: noReads.length === 0,
  };
}

/** This function gives the value of a read. The caller tests the read first. */
function valueOf(value: CookRead): number {
  return value.read ? value.value : Number.NaN;
}
