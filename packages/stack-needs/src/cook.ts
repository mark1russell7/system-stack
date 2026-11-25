import type { Source } from "@mark1russell7/guidebook";
import { fuelEnergyPerMass, giftsOf, cookWater, quickSoakWater, soakWater, type CitedRate, type CitedSpan, type HeatingValue, type StoveFacts, type StoveFactor, type StoveYield, type SupplyCatalog, type SupplyProduct } from "@mark1russell7/market/supplies";
import { valueIn, type Quantity } from "@mark1russell7/quantity";
import { FOOD_NEED, FORMULA_POWDER, STORED_WATER } from "./uses.ts";

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

/**
 * The source of the check of the range of the specific heat: the fluid data of water in the NIST Chemistry WebBook (Standard Reference Data 69).
 * NIST keeps the copyright of its standard reference data (15 USC 290e). Its terms do not permit a copy without prior permission, and they tell nothing about facts.
 * The model takes only facts from it, with a citation. That use rests on US law, which gives no copyright to facts. It does not rest on the terms of NIST.
 */
export const NIST_WEBBOOK_WATER_SOURCE: Source = {
  id: "nist-webbook-fluid-water",
  title: "Thermophysical Properties of Fluid Systems, NIST Chemistry WebBook (SRD 69), water, isobaric data at 0.101325 MPa",
  url: "https://webbook.nist.gov/chemistry/fluid/",
  license: "all-rights-reserved",
  checked: "2026-11-24",
  by: "National Institute of Standards and Technology",
  terms: "https://www.nist.gov/srd/public-law",
  note: "The data of water come from the IAPWS-95 formulation. The table read is water, isobaric, 0.101325 MPa, 0 °C to 99.9 °C in steps of 10 °C.",
};

/** The check of a cited constant against a second source. */
export interface CookCheck {
  readonly source: Source;
  readonly locator: string;
  /** What the second source shows about the value. */
  readonly note: string;
}

/** A physical constant of the cook model, with its source and the place of the value in the source. */
export interface CookConstant {
  readonly value: number;
  readonly unit: string;
  readonly source: Source;
  readonly locator: string;
  /** How the value comes from the source. */
  readonly note: string;
  /** The check of the value against a second source. */
  readonly check?: CookCheck;
}

/**
 * The mean specific heat of liquid water from 0 °C to 100 °C: 4.19002 kJ/(kg.K).
 * The NIST Guide to the SI gives 4.190 02 J for the calorie (mean). The common definition of that calorie is the mean over this range.
 * SP 811 does not state the range. Its footnote 10 tells that the calorie is the energy to raise 1 g of water by 1 kelvin.
 *
 * The check of the range comes from the enthalpy of liquid water at 0.101325 MPa in the NIST Chemistry WebBook.
 * The mean from 0.01 °C to the boil (99.9743 °C) is 4.19104 kJ/(kg.K), 0.024% above this value.
 * From a start of 10 °C to 30 °C, the heat of the rise is within 0.02% of the table.
 * The specific heat of water is higher near the boil. Thus from a warmer start, the value gives less heat than the table. From 90 °C, it gives 0.48% less.
 * The error of the stove share is much larger. For example, the adverse factor of a stove is a factor of 3 to 4.
 * The model also heats the dry food with this value, above the specific heat of a dry food. That term holds the heat of the pot above the true value.
 */
export const WATER_SPECIFIC_HEAT: CookConstant = {
  value: 4.19002,
  unit: "kJ/(kg.K)",
  source: NIST_SI_GUIDE_SOURCE,
  locator: "Appendix B.8, row calorie (mean): 4.190 02 E+00 J. Footnotes, footnote 10: the energy to raise 1 gram of water by 1 °C.",
  note: "The calorie (mean) in joules, for 1 g of water and 1 K. By its common definition, the mean is over the range from 0 °C to 100 °C. SP 811 does not state the range.",
  check: {
    source: NIST_WEBBOOK_WATER_SOURCE,
    locator: "Water, isobaric data at 0.101325 MPa, column Enthalpy (kJ/kg) of the liquid: 0.103208 at 0.0100 °C, 377.106 at 90.0100 °C, 419.058 at 99.9743 °C.",
    note: "The mean from 0.01 °C to the boil is (419.058 - 0.103208) / 99.9643 = 4.19104 kJ/(kg.K), 0.024% above the value. From 90.01 °C, the value gives 0.48% less heat than the table.",
  },
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
 * The least density of liquid water from 0 °C to 100 °C: 0.95865 kg/L. The USGS table gives 0.95865 g/cm3 at 100 °C, its least value.
 * Thus 1 L of the test water of a boil yield is 0.95865 kg or more. The least mass of the test water gives the most fuel for each kg of the pot.
 */
export const WATER_DENSITY_MIN: CookConstant = {
  value: 0.95865,
  unit: "kg/L",
  source: USGS_WATER_DENSITY_SOURCE,
  locator: "Table of the density and the weight of water by temperature, row 212 °F/100 °C: 0.95865 g/cm3",
  note: "The least density of the table, from 0 °C to 100 °C. Each other row is more.",
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

/**
 * The soak method of the dry food. Since 0.10.5.
 * - `cold`: the cold soak, `soak` of market. The soak water gets no heat and no fuel.
 * - `quick`: the quick soak, `quickSoak` of market. The soak water boils for its cited boil time, then the food stands off the heat.
 * - `none`: no soak. The cook time is `unsoakedTime` of market.
 */
export type SoakMethod = "cold" | "quick" | "none";

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
  /**
   * The stove share. It has no default. Without it, only a boil yield of the stove gives the fuel of the boil.
   * Without a share and a yield with a read, each fuel is a no read.
   */
  readonly share?: StoveShare | undefined;
  /** The start temperature of the cook water. The default is `COLD_START_CELSIUS`. */
  readonly start?: CookStart | undefined;
  /**
   * The soak method of each dry food of the buy list. The default is `cold`, which gives the same lines as before 0.10.5. Since 0.10.5.
   * A product with no cited soak, cold or quick, takes no soak with each method.
   */
  readonly soak?: SoakMethod | undefined;
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
  /**
   * The soak water, in `L/kg` of dry food. The cook discards it. The water comes from the soak method (`soakMethod`):
   * - The cold soak (the default) takes `soakWater` of market. That water gets no heat and no fuel.
   * - The quick soak takes `quickSoakWater` of market. That water gets heat and fuel (`soakHeat`). Since 0.10.5.
   * - With no soak, the line has 0. Since 0.10.5.
   *
   * A product with no cited soak, cold or quick, has 0. A cited soak that does not convert to `L/kg` is a no read.
   * A product with a cold soak and no quick soak is a no read of the quick soak.
   */
  readonly soak: CookRead;
  /**
   * The soak method of the line, `quick` or `none`. A line of the cold soak, the default, has no field. Since 0.10.5.
   */
  readonly soakMethod?: "quick" | "none" | undefined;
  /**
   * The heat to boil the quick soak water and the dry food of one pot, in `kJ`. Only a line of the quick soak has the field. Since 0.10.5.
   * A product with no cited soak has 0.
   */
  readonly soakHeat?: CookRead | undefined;
  /** The heat to boil the cook water of one pot, in `kJ`. */
  readonly heat: CookRead;
  /**
   * The time of the stove for one pot: the boil time and the high end of the cook time, in `min`.
   * With the quick soak, it also has the boil time of the soak water and the high end of its boil span. The stand time is off the stove.
   * With no soak, the cook time of a soaked food is `unsoakedTime` of market.
   */
  readonly minutes: CookRead;
  /** The fuel of one pot, in `kg`. */
  readonly fuel: CookRead;
  /**
   * The fuel of one pot at the low end and at the high end of the typical range of the adverse factor, in `kg`.
   * The value of `fuel` is an estimate in this spread. The spread makes no claim of a floor or a ceiling.
   * A line has the field only when the stove has a typical range and the fuel has a read.
   */
  readonly fuelSpread?: { readonly low: number; readonly high: number; readonly unit: "kg" } | undefined;
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

/** This function gives a cited temperature of a boil yield in °C, or `undefined` when the value is not a finite number with a fact. */
function citedCelsius(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { celsius, fact } = value as { readonly celsius?: unknown; readonly fact?: unknown };
  return typeof celsius === "number" && Number.isFinite(celsius) && typeof fact === "string" ? celsius : undefined;
}

/**
 * This function gives the heat that 1 kg of fuel puts into the test water of a boil yield, in `kJ/kg`. Else it gives the reason of a no read.
 * The test water takes `WATER_DENSITY_MIN`. Thus the heat is not more than the true heat, so the fuel is not less.
 * The rise goes from the cited start to the cited end of the test, the boil point at the place of the test.
 * A warmer start or a colder end gives less heat. Thus each one needs its citation, and a yield with no cited start or end gives a no read.
 * An end of `BOIL_CELSIUS` is not a default: at a high place the test water boils at less, and that default gives too little fuel.
 * A yield with the bound `most` is a best case, so it gives too little fuel and a no read. A yield with the bound `least` or no bound gives a read.
 *
 * The adverse factor of the stove multiplies the boil fuel: cold, snow melt and wind take more fuel than the calm test.
 * The factor is relative to the cited calm yield. Thus the heat of 1 kg of fuel is the calm heat over the factor.
 * - A factor with the bound `most` gives the boil fuel at the top of its cited range. It also takes a yield with the bound `most`.
 *   The fuel is an estimate, not a proven upper limit: a source can give a typical range, not a ceiling.
 * - A factor with a typical range (`typical`) and no bound is an estimate in that range. It also takes a yield with the bound `most`.
 *   The function also gives the heat at each end of the range (`spread`), so a line can show the fuel at each end.
 * - A factor with no bound and no range is the value. It takes a yield with the bound `least` or no bound, as the calm case does.
 * - A factor with the bound `least` gives too little fuel, so it gives a no read. So does a factor that is not a finite number of 1 or more.
 * - A factor with a bound and a range, a range that is not `1 <= low <= high`, or a factor outside its range gives a no read.
 */
function yieldHeat(
  boil: StoveYield,
  adverse: StoveFactor | undefined,
): { readonly perKg: number; readonly spread?: { readonly atLow: number; readonly atHigh: number } } | { readonly why: string } {
  const factorBound: unknown = adverse !== undefined && "bound" in adverse ? adverse.bound : undefined;
  const factor: unknown = adverse?.factor;
  if (adverse !== undefined) {
    if (typeof factor !== "number" || !Number.isFinite(factor) || !(factor >= 1))
      return { why: `The adverse factor of the stove is ${String(factor)}. It must be a finite number of 1 or more.` };
    if (factorBound !== undefined && factorBound !== "most")
      return { why: `The adverse factor of the stove has the bound ${String(factorBound)}. Only a factor with the bound most or no bound gives the boil fuel.${factorBound === "least" ? " A least factor gives too little fuel." : ""}` };
  }
  // The typical range of the factor. The check of the range stays, because a catalog of a caller can have a bad value.
  const typical: unknown = adverse !== undefined && "typical" in adverse ? adverse.typical : undefined;
  let range: { readonly low: number; readonly high: number } | undefined;
  if (typical !== undefined) {
    if (factorBound !== undefined) return { why: "The adverse factor of the stove has a bound and a typical range. A typical range is not a bound, so the factor must have only one of the two." };
    const low: unknown = typeof typical === "object" && typical !== null && "low" in typical ? typical.low : undefined;
    const high: unknown = typeof typical === "object" && typical !== null && "high" in typical ? typical.high : undefined;
    if (typeof low !== "number" || typeof high !== "number" || !Number.isFinite(low) || !Number.isFinite(high) || !(low >= 1) || !(high >= low))
      return { why: "The typical range of the adverse factor of the stove must have finite numbers with 1 <= low <= high." };
    if (typeof factor === "number" && !(factor >= low && factor <= high)) return { why: `The adverse factor of the stove is ${String(factor)}, outside its typical range ${String(low)} to ${String(high)}.` };
    range = { low, high };
  }
  const bound: unknown = "bound" in boil ? boil.bound : undefined;
  const estimate = adverse !== undefined && (factorBound === "most" || range !== undefined);
  if (bound !== undefined && bound !== "least" && !(bound === "most" && estimate))
    return { why: `The boil yield of the stove has the bound ${String(bound)}. Only a yield with the bound least or no bound gives the fuel, or a most yield with an adverse factor that has the bound most or a typical range.${bound === "most" ? " A most yield gives too little fuel for the boil." : ""}` };
  const startC = citedCelsius(boil.start);
  if (startC === undefined) return { why: "The boil yield of the stove has no cited start temperature. A colder start of the test gives too little fuel." };
  // The end of the test, the field `end` of market. The check of the value stays, because a catalog of a caller can have a bad value.
  const endC = citedCelsius(boil.end);
  if (endC === undefined)
    return { why: "The boil yield of the stove has no cited end temperature, the boil point of the test. At a high place the test water boils below 100 °C, so 100 °C gives too little fuel." };
  if (!(startC >= 0 && startC < endC && endC <= BOIL_CELSIUS))
    return { why: `The boil yield goes from ${String(startC)} °C to ${String(endC)} °C. The start must be from 0 °C, and less than the end. The end must be up to ${String(BOIL_CELSIUS)} °C.` };
  const litres = inUnit(boil.amount, boil.unit, "L");
  const fuelKg = inUnit(boil.per.amount, boil.per.unit, "kg");
  if (litres === undefined || fuelKg === undefined || !(litres > 0) || !(fuelKg > 0))
    return { why: `The boil yield of the stove is ${String(boil.amount)} ${boil.unit} for each ${String(boil.per.amount)} ${boil.per.unit}, which is not a volume above 0 for a mass above 0.` };
  const calm = (litres * WATER_DENSITY_MIN.value * WATER_SPECIFIC_HEAT.value * (endC - startC)) / fuelKg;
  const perKg = typeof factor === "number" ? calm / factor : calm;
  return range === undefined ? { perKg } : { perKg, spread: { atLow: calm / range.low, atHigh: calm / range.high } };
}

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
  readonly method: SoakMethod;
}

/**
 * This function gives the cook line of one dry food. Each missing fact gives a no read with its reason.
 * The fuel is a safe upper limit: the stove burns at its full rate for the boil time and the cook time.
 * Only a stove rate with no bound gives the fuel. A rate with a bound, for example `bound: "least"`, gives a no read.
 * At a high place the cook time is longer. The model does not give that time, so there the fuel is not an upper limit.
 * A boil fuel from an adverse factor is an estimate (`yieldHeat`), so that fuel is not a proven upper limit.
 */
function cookLine(product: SupplyProduct, resource: string, perUnitKg: number | undefined, foodGifts: number, context: StoveContext): CookLine {
  const { stove, batchKg, share, startC, fuelEnergy, method } = context;

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
  // The soak water of the soak method. A product with no cited soak has none. A soak rate that gives no L/kg is a no read, not 0.
  const facts = product.cook;
  const soaked = facts?.soak !== undefined || facts?.quickSoak !== undefined;
  const quickSoak = method === "quick" ? facts?.quickSoak : undefined;
  let soak: CookRead;
  if (method === "cold") {
    const soakLitres = facts?.soak === undefined ? undefined : soakWater(product);
    soak =
      facts?.soak === undefined
        ? read(0, "L/kg")
        : soakLitres === undefined
          ? noRead(`The soak water of the product ${product.id} does not convert to L/kg. A rate for each volume needs a bulk mass.`)
          : read(valueIn(soakLitres, "L/kg"), "L/kg");
  } else if (method === "none" || !soaked) soak = read(0, "L/kg");
  else if (quickSoak === undefined)
    soak = noRead(`The product ${product.id} cites a cold soak and no quick soak. The cold soak gives no water and no boil time for the quick soak.`);
  else {
    const quickLitres = quickSoakWater(product);
    soak = quickLitres === undefined ? noRead(`The quick soak water of the product ${product.id} does not convert to L/kg. A rate for each volume needs a bulk mass.`) : read(valueIn(quickLitres, "L/kg"), "L/kg");
  }

  // The heat to boil one pot: the mass of the water and the dry food times the specific heat of water times the rise to the boil.
  const heat = water.read ? read((water.value * WATER_DENSITY_MAX.value + 1) * batchKg * WATER_SPECIFIC_HEAT.value * (BOIL_CELSIUS - startC), "kJ") : noRead(`The heat to boil is a no read: ${water.why}`);
  // The heat to boil the quick soak water, with the same rule. The dry food is in the soak water, so the mass also has the dry food.
  let soakHeat: CookRead | undefined;
  if (method === "quick") {
    if (!soak.read) soakHeat = noRead(`The heat of the quick soak is a no read: ${soak.why}`);
    else if (quickSoak === undefined) soakHeat = read(0, "kJ");
    else soakHeat = read((soak.value * WATER_DENSITY_MAX.value + 1) * batchKg * WATER_SPECIFIC_HEAT.value * (BOIL_CELSIUS - startC), "kJ");
  }
  // The fields of the soak method. A line of the cold soak has none, so its shape stays as before 0.10.5.
  const methodFields = method === "cold" ? {} : { soakMethod: method, ...(soakHeat === undefined ? {} : { soakHeat }) };

  const why: string[] = [];
  if (!heat.read) why.push(heat.why);
  if (soakHeat !== undefined && !soakHeat.read) why.push(soakHeat.why);
  // The boil time of the quick soak: the high end of its span, as for the cook time. The stand time is off the heat, so it takes no fuel.
  let soakBoilMin = 0;
  if (quickSoak !== undefined) {
    // The check of the field stays, because a catalog of a caller can have a bad value.
    const boil = quickSoak.boil as CitedSpan | undefined;
    const boilMin = boil === undefined ? undefined : inUnit(boil.high, boil.unit, "min");
    if (boil === undefined) why.push(`The quick soak of the product ${product.id} has no cited boil time.`);
    else if (boilMin === undefined || !(boilMin >= 0)) why.push(`The boil time of the quick soak of the product ${product.id} is ${String(boil.high)} ${boil.unit}, which is not a time of 0 min or more.`);
    else soakBoilMin = boilMin;
  }
  // With no soak, a soaked food cooks for its unsoaked time. A food with no soak facts keeps its one cook time.
  const unsoaked = method === "none" && soaked;
  const time = unsoaked ? facts?.unsoakedTime : facts?.time;
  const timeName = unsoaked ? "unsoaked cook time" : "cook time";
  const cookMin = time === undefined ? undefined : inUnit(time.high, time.unit, "min");
  if (time === undefined)
    why.push(
      unsoaked
        ? `The product ${product.id} cites a soak and no unsoaked cook time. The cook time of the food with no soak has no source.`
        : `The catalog cites no cook time for the product ${product.id}.`,
    );
  else if (cookMin === undefined) why.push(`The ${timeName} of the product ${product.id} is in ${time.unit}, which does not convert to min.`);

  // Only a rate with no bound is the value. A least rate gives too little fuel for the cook time, and an unknown bound has no side.
  const bound: unknown = stove.rate !== undefined && "bound" in stove.rate ? stove.rate.bound : undefined;
  const rate = stove.rate === undefined || bound !== undefined ? undefined : stoveRate(stove.rate);
  if (stove.rate === undefined) why.push(`The stove of ${stove.fuel} has no cited fuel rate.`);
  else if (bound !== undefined)
    why.push(`The fuel rate of the stove has the bound ${String(bound)}. Only a rate with no bound is the value.${bound === "least" ? " A least rate gives too little fuel for the cook time." : ""}`);
  else if (rate === undefined) why.push(`The fuel rate of the stove is in ${stove.rate.unit} for each ${stove.rate.per.unit}, which is not an energy or a mass in a time.`);

  // The heat of the stove into the pot for each minute, in kJ/min. It needs a cited share with the same heating value as the energy rate.
  // A share or a boil yield gives the fuel of the boil. Each one that has a read gives a boil fuel, and the line takes the most.
  const boilWhy: string[] = [];
  let potPerMin: number | undefined;
  if (share === undefined) boilWhy.push("No cited stove share gives the part of the stove heat that goes into the pot.");
  else if (rate !== undefined) {
    if (rate.kind === "energy") {
      if (stove.heating !== share.heating) boilWhy.push(`The stove share is for the ${share.heating} heating value, and the stove rate is for the ${String(stove.heating ?? "unknown")} heating value.`);
      else potPerMin = rate.perMin * share.value;
    } else if (fuelEnergy === undefined) boilWhy.push(`The fuel ${stove.fuel} has no cited energy, so its mass rate gives no heat for the boil.`);
    else if (fuelEnergy.heating !== share.heating) boilWhy.push(`The stove share is for the ${share.heating} heating value, and the energy of the fuel ${stove.fuel} is the ${fuelEnergy.heating} value.`);
    else potPerMin = rate.perMin * fuelEnergy.perKg * share.value;
  }
  // The heat of 1 kg of fuel into the pot, from the boil yield of the stove. It needs no share and no energy of the fuel.
  const fromYield = stove.boil === undefined ? { why: "The stove has no cited boil yield." } : yieldHeat(stove.boil, stove.adverse);
  if ("why" in fromYield) boilWhy.push(fromYield.why);
  if (potPerMin === undefined && "why" in fromYield) why.push(`The fuel of the boil is a no read. ${boilWhy.join(" ")}`);

  // The fuel mass for each minute at the full rate, in kg/min. An energy rate converts only through the cited fuel energy of the same heating value.
  let fuelPerMin: number | undefined;
  if (rate?.kind === "mass") fuelPerMin = rate.perMin;
  else if (rate?.kind === "energy") {
    if (fuelEnergy === undefined) why.push(`The fuel ${stove.fuel} has no cited energy, so the energy rate of the stove gives no fuel mass.`);
    else if (stove.heating === undefined) why.push("The energy rate of the stove has no heating value.");
    else if (stove.heating !== fuelEnergy.heating) why.push(`The stove rate is for the ${stove.heating} heating value, and the energy of the fuel ${stove.fuel} is the ${fuelEnergy.heating} value.`);
    else fuelPerMin = rate.perMin / fuelEnergy.perKg;
  }

  if (why.length > 0 || !heat.read || cookMin === undefined || fuelPerMin === undefined || !(fuelPerMin > 0)) {
    const text = why.join(" ");
    return { product: product.id, resource, energy, water, soak, heat, minutes: noRead(text), fuel: noRead(text), ...methodFields };
  }
  // The boil fuel in kg: from the share, the boil time at the full rate; from the yield, the heat over the heat of 1 kg of fuel.
  const shareFuelsOf = (kJ: number): number[] => (potPerMin !== undefined && potPerMin > 0 ? [(kJ / potPerMin) * fuelPerMin] : []);
  const shareFuels = shareFuelsOf(heat.value);
  const boilFuels = [...shareFuels, ...("perKg" in fromYield ? [heat.value / fromYield.perKg] : [])];
  // The checks above give a share above 0 or a yield with a read. The guard keeps a line with no boil fuel from a value of -Infinity.
  if (boilFuels.length === 0) {
    const text = `The fuel of the boil is a no read. ${boilWhy.join(" ")}`;
    return { product: product.id, resource, energy, water, soak, heat, minutes: noRead(text), fuel: noRead(text), ...methodFields };
  }
  const boilFuel = Math.max(...boilFuels);
  // The fuel of the quick soak: the boil fuel of the soak heat by the same rule, and the full rate for the boil time of the soak.
  const soakKJ = quickSoak !== undefined && soakHeat?.read === true ? soakHeat.value : 0;
  const soakShareFuels = shareFuelsOf(soakKJ);
  const soakBoilFuel = quickSoak === undefined ? 0 : Math.max(...soakShareFuels, ...("perKg" in fromYield ? [soakKJ / fromYield.perKg] : []));
  const withSoak = (cook: number, soakPart: number): number => (quickSoak === undefined ? cook : cook + soakPart);
  const minutes = withSoak(boilFuel / fuelPerMin + cookMin, soakBoilFuel / fuelPerMin + soakBoilMin);
  const fuel = read(withSoak(boilFuel + cookMin * fuelPerMin, soakBoilFuel + soakBoilMin * fuelPerMin), "kg");
  // The fuel at each end of the typical range of the adverse factor. The share fuel stays in the most, as in the value.
  const spread = "spread" in fromYield ? fromYield.spread : undefined;
  if (spread === undefined) return { product: product.id, resource, energy, water, soak, heat, minutes: read(minutes, "min"), fuel, ...methodFields };
  const potFuel = (perKg: number): number =>
    withSoak(Math.max(...shareFuels, heat.value / perKg) + cookMin * fuelPerMin, Math.max(...soakShareFuels, soakKJ / perKg) + soakBoilMin * fuelPerMin);
  const fuelSpread = { low: potFuel(spread.atLow), high: potFuel(spread.atHigh), unit: "kg" as const };
  return { product: product.id, resource, energy, water, soak, heat, minutes: read(minutes, "min"), fuel, fuelSpread, ...methodFields };
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

/**
 * This function tells if a resource of the catalog is a dry food to cook: a food resource in a unit of mass.
 * `FORMULA_POWDER` is not a food to cook: `formulaMixFragment` mixes it with water, with no fuel.
 */
function isDryFood(catalog: SupplyCatalog, code: string): boolean {
  if (code === FORMULA_POWDER) return false;
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
 * - A boil yield of the stove (`boil` of market) gives the boil fuel with no share and no fuel energy.
 *   The boil fuel is the heat of the pot over the heat of 1 kg of fuel in the test.
 *   The test water takes `WATER_DENSITY_MIN`, and the rise goes from the cited start to the cited end of the test. The boil time is then the boil fuel over the mass rate.
 *   A yield with the bound `most`, or with no cited start or end, gives a no read. When the share and the yield both have a read, the line takes the most boil fuel.
 * - The adverse factor of the stove (`adverse` of market) multiplies the boil fuel of the yield, for cold, snow melt and wind. The cook part stays the rate times the cook time.
 *   A factor with the bound `most` gives the boil fuel at the top of its cited range, also from a yield with the bound `most`. That fuel is an estimate.
 *   So is the fuel from a factor with a typical range. The line then gives the fuel at each end of the range (`fuelSpread`).
 *   A factor with no bound is the value.
 *   A factor with the bound `least` gives a no read of the yield.
 * - The fuel is a safe upper limit: the stove burns at its full rate for all of that time. At a high place the cook time is longer.
 *   The model does not give that time, so there the fuel is not an upper limit. A boil fuel from an adverse factor is an estimate.
 * - Only a stove rate with no bound gives the fuel. A rate with a bound, for example `bound: "least"`, gives a no read. The fuel of the cook time is the rate times the time, so a least rate gives too little fuel.
 * - A rate in a mass gives the fuel directly. A rate in an energy gives a mass only through the cited energy of the fuel, with the same heating value.
 *
 * A dry food is a gift of a food resource in a unit of mass, except `FORMULA_POWDER`. `formulaMixFragment` gives its converter.
 * Each missing fact gives a line with no read and its reasons, not a figure.
 *
 * Two products of the list can give one dry resource, for example rice and oats. The converter then takes the worst case of their lines:
 * the most water, the most fuel and the least food energy. When a line of the resource has no read, the resource has no converter.
 * A store of the resource from a different fragment gets the converter of this list.
 *
 * The water take of a pot is the cook water and the soak water. The cook discards the soak water, so the soak adds to the water take.
 * The input `soak` gives the soak method. Since 0.10.5. A product with no cited soak, cold or quick, takes no soak water with each method.
 * - `cold`, the default: the soak water is `soakWater` of market. It adds no heat and no fuel. The lines are the same as before 0.10.5.
 * - `quick`: the soak water is `quickSoakWater` of market. Its heat to boil has the rule of the cook water, from the start temperature.
 *   The fuel adds the boil fuel of that heat. It also adds the full rate for the high end of the boil span (`quickSoak.boil`).
 *   The stand time is off the heat, so it adds no fuel.
 * - A product with a cold soak and no quick soak gives a no read of the quick soak. It does not take the cold soak.
 * - `none`: no soak water. A food with a cited soak, cold or quick, cooks for the high end of `unsoakedTime` of market.
 *   Such a food with no `unsoakedTime` gives a no read, because the cook time of the food with no soak has no source.
 *   A food with no soak facts keeps its cook time `time`. The cook water stays `cookWater` with each method.
 *
 * A soak rate that does not convert to `L/kg` gives a no read.
 * A product that gives more than one food has no energy for each food, so its energy is a no read.
 *
 * The cook water is `water.stored`, the store of the drinking water. A cook can use tap water. The subset converter of
 * `householdFragment` also gives the bottled water of the buy list as `water.stored`. A drinking draw at a higher level of the same store takes
 * its water first, by the take order of `enduranceOf`. The drinking draw keeps back its days times its demand, which is all of the store.
 * Thus, when a case cuts the water supply, the dry food adds 0 days at each amount of stored water.
 *
 * The function is pure.
 *
 * @param input - The catalog and the buy list, the stove, the dry mass of one pot, the share and the start temperature
 * @returns The fragment, the line of each dry food and the dry resources with no converter
 * @throws RangeError when the batch is not a mass above 0, or when the share is not above 0 and up to 1
 * @throws RangeError when the start is not from 0 up to less than 100 °C
 * @throws RangeError when the soak method is not `cold`, `quick` or `none`
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
  const method = input.soak ?? "cold";
  if (method !== "cold" && method !== "quick" && method !== "none") throw new RangeError(`The soak method is ${String(method)}. It must be cold, quick or none.`);
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
    method,
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
    const why = own.flatMap((line) => [line.energy, line.water, line.soak, line.fuel].flatMap((value) => (value.read ? [] : [`${line.product}: ${value.why}`])));
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
        // The cook water and the soak water of one pot. The worst line is the one with the most of the two together.
        { resource: STORED_WATER, amount: Math.max(...own.map((line) => valueOf(line.water) + valueOf(line.soak))) * batchKg * waterPerL },
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
