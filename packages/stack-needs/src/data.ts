import type { CalorieChange, CalorieNeed, CalorieTable } from "./calorie.ts";
import type { Source } from "@mark1russell7/guidebook";

// The estimated calorie needs of the Dietary Guidelines for Americans, 2020-2025. Each value is from the tables of
// Appendix 2 of the PDF, read on 2026-11-22. A calorie of the source is a food calorie, thus 1 kcal. The source gives
// each need for a reference height and weight, to keep the weight of a person. A person can need more or less.
// The rows of the toddlers are at 12, 15, 18 and 21 through 23 months. Each row here covers the months up to the next row.
// The changes of pregnancy and lactation are from Table A2-3. The source gives them for women with a healthy weight before
// the pregnancy.
// The notes b and c of Table A2-3 (page 141, read on 2026-11-24, the PDF of the recorded sha256) give the two changes of lactation:
// - The 1st 6 months: 500 calories/day for the milk production, minus 170 calories/day for the weight loss after the birth. That is 330.
// - The 2nd 6 months: 400 calories/day for the milk production. The source assumes a stable weight after 6 months.
// Thus below 6 months, 170 kcal/d of the milk comes from the stores of the mother, and not from the food of the household.
// The source gives the energy of the milk production of the mother, not the energy that the infant gets from the milk.
// It gives no change for a mother of two or more infants.
// The 2025-2030 edition of the guidelines (read on 2026-11-24) has no table of calorie needs. It sends the reader to the
// DRI calculator of the USDA. Its daily servings by calorie level start at a calorie level and do not give a need. So
// this table stays the table of the 2020-2025 edition.

/** The source of the calorie table: the PDF of the Dietary Guidelines for Americans, 2020-2025, 9th Edition. It is a work of the United States federal government. */
export const DGA_SOURCE: Source = {
  id: "dga-2020-2025",
  title: "Dietary Guidelines for Americans, 2020-2025, 9th Edition",
  url: "https://www.dietaryguidelines.gov/sites/default/files/2020-12/Dietary_Guidelines_for_Americans_2020-2025.pdf",
  license: "us-public-domain",
  checked: "2026-11-22",
  by: "U.S. Department of Agriculture and U.S. Department of Health and Human Services",
  terms: "https://www.dietaryguidelines.gov/policy-and-links",
  sha256: "ceea04ce1a7c13a95a170f3548ed3926ad6dd49599bd730fb58bc9c02711d16e",
};

const day = (value: number): { readonly value: number; readonly unit: string } => ({ value, unit: "kcal/d" });
const levels = (sedentary: number, moderate: number, active: number): CalorieNeed => ({ levels: { sedentary: day(sedentary), "moderately-active": day(moderate), active: day(active) } });
const each = (value: number): CalorieNeed => ({ each: day(value) });
const HEALTHY = "For women with a healthy weight before the pregnancy. Other women ask their health care provider.";
const change = (stage: string, title: string, value: number): CalorieChange => ({ stage, title, sex: "female", change: day(value), condition: HEALTHY });
const milk = (stage: string, title: string, value: number): CalorieChange => ({ ...change(stage, title, value), milk: true });

/** The table of estimated calorie needs of the Dietary Guidelines for Americans, 2020-2025: 68 rows, 34 for each sex, and 5 changes of pregnancy and lactation. */
export const DGA_CALORIES: CalorieTable = {
  id: "dga.2020-2025:calorie-needs",
  title: "Dietary Guidelines for Americans, 2020-2025: Estimated Calorie Needs",
  source: DGA_SOURCE,
  locator: "Appendix 2: Table A2-1 (ages 12 through 23 months, page 139), Table A2-2 (ages 2 and older, pages 140 and 141) and Table A2-3 (pregnancy and lactation, page 141)",
  changes: [
    change("pregnancy-1", "Pregnancy: 1st trimester", 0),
    change("pregnancy-2", "Pregnancy: 2nd trimester", 340),
    change("pregnancy-3", "Pregnancy: 3rd trimester", 452),
    milk("lactation-1", "Lactation: 1st 6 months", 330),
    milk("lactation-2", "Lactation: 2nd 6 months", 400),
  ],
  rows: [
    { sex: "female", age: "12 months", from: 12, to: 14, need: each(800) },
    { sex: "female", age: "15 months", from: 15, to: 17, need: each(800) },
    { sex: "female", age: "18 months", from: 18, to: 20, need: each(900) },
    { sex: "female", age: "21 through 23 months", from: 21, to: 23, need: each(1000) },
    { sex: "female", age: "2", from: 24, to: 35, need: levels(1000, 1000, 1000) },
    { sex: "female", age: "3", from: 36, to: 47, need: levels(1000, 1200, 1400) },
    { sex: "female", age: "4", from: 48, to: 59, need: levels(1200, 1400, 1400) },
    { sex: "female", age: "5", from: 60, to: 71, need: levels(1200, 1400, 1600) },
    { sex: "female", age: "6", from: 72, to: 83, need: levels(1200, 1400, 1600) },
    { sex: "female", age: "7", from: 84, to: 95, need: levels(1200, 1600, 1800) },
    { sex: "female", age: "8", from: 96, to: 107, need: levels(1400, 1600, 1800) },
    { sex: "female", age: "9", from: 108, to: 119, need: levels(1400, 1600, 1800) },
    { sex: "female", age: "10", from: 120, to: 131, need: levels(1400, 1800, 2000) },
    { sex: "female", age: "11", from: 132, to: 143, need: levels(1600, 1800, 2000) },
    { sex: "female", age: "12", from: 144, to: 155, need: levels(1600, 2000, 2200) },
    { sex: "female", age: "13", from: 156, to: 167, need: levels(1600, 2000, 2200) },
    { sex: "female", age: "14", from: 168, to: 179, need: levels(1800, 2000, 2400) },
    { sex: "female", age: "15", from: 180, to: 191, need: levels(1800, 2000, 2400) },
    { sex: "female", age: "16", from: 192, to: 203, need: levels(1800, 2000, 2400) },
    { sex: "female", age: "17", from: 204, to: 215, need: levels(1800, 2000, 2400) },
    { sex: "female", age: "18", from: 216, to: 227, need: levels(1800, 2000, 2400) },
    { sex: "female", age: "19-20", from: 228, to: 251, need: levels(2000, 2200, 2400) },
    { sex: "female", age: "21-25", from: 252, to: 311, need: levels(2000, 2200, 2400) },
    { sex: "female", age: "26-30", from: 312, to: 371, need: levels(1800, 2000, 2400) },
    { sex: "female", age: "31-35", from: 372, to: 431, need: levels(1800, 2000, 2200) },
    { sex: "female", age: "36-40", from: 432, to: 491, need: levels(1800, 2000, 2200) },
    { sex: "female", age: "41-45", from: 492, to: 551, need: levels(1800, 2000, 2200) },
    { sex: "female", age: "46-50", from: 552, to: 611, need: levels(1800, 2000, 2200) },
    { sex: "female", age: "51-55", from: 612, to: 671, need: levels(1600, 1800, 2200) },
    { sex: "female", age: "56-60", from: 672, to: 731, need: levels(1600, 1800, 2200) },
    { sex: "female", age: "61-65", from: 732, to: 791, need: levels(1600, 1800, 2000) },
    { sex: "female", age: "66-70", from: 792, to: 851, need: levels(1600, 1800, 2000) },
    { sex: "female", age: "71-75", from: 852, to: 911, need: levels(1600, 1800, 2000) },
    { sex: "female", age: "76 and up", from: 912, need: levels(1600, 1800, 2000) },
    { sex: "male", age: "12 months", from: 12, to: 14, need: each(800) },
    { sex: "male", age: "15 months", from: 15, to: 17, need: each(900) },
    { sex: "male", age: "18 months", from: 18, to: 20, need: each(1000) },
    { sex: "male", age: "21 through 23 months", from: 21, to: 23, need: each(1000) },
    { sex: "male", age: "2", from: 24, to: 35, need: levels(1000, 1000, 1000) },
    { sex: "male", age: "3", from: 36, to: 47, need: levels(1000, 1400, 1400) },
    { sex: "male", age: "4", from: 48, to: 59, need: levels(1200, 1400, 1600) },
    { sex: "male", age: "5", from: 60, to: 71, need: levels(1200, 1400, 1600) },
    { sex: "male", age: "6", from: 72, to: 83, need: levels(1400, 1600, 1800) },
    { sex: "male", age: "7", from: 84, to: 95, need: levels(1400, 1600, 1800) },
    { sex: "male", age: "8", from: 96, to: 107, need: levels(1400, 1600, 2000) },
    { sex: "male", age: "9", from: 108, to: 119, need: levels(1600, 1800, 2000) },
    { sex: "male", age: "10", from: 120, to: 131, need: levels(1600, 1800, 2200) },
    { sex: "male", age: "11", from: 132, to: 143, need: levels(1800, 2000, 2200) },
    { sex: "male", age: "12", from: 144, to: 155, need: levels(1800, 2200, 2400) },
    { sex: "male", age: "13", from: 156, to: 167, need: levels(2000, 2200, 2600) },
    { sex: "male", age: "14", from: 168, to: 179, need: levels(2000, 2400, 2800) },
    { sex: "male", age: "15", from: 180, to: 191, need: levels(2200, 2600, 3000) },
    { sex: "male", age: "16", from: 192, to: 203, need: levels(2400, 2800, 3200) },
    { sex: "male", age: "17", from: 204, to: 215, need: levels(2400, 2800, 3200) },
    { sex: "male", age: "18", from: 216, to: 227, need: levels(2400, 2800, 3200) },
    { sex: "male", age: "19-20", from: 228, to: 251, need: levels(2600, 2800, 3000) },
    { sex: "male", age: "21-25", from: 252, to: 311, need: levels(2400, 2800, 3000) },
    { sex: "male", age: "26-30", from: 312, to: 371, need: levels(2400, 2600, 3000) },
    { sex: "male", age: "31-35", from: 372, to: 431, need: levels(2400, 2600, 3000) },
    { sex: "male", age: "36-40", from: 432, to: 491, need: levels(2400, 2600, 2800) },
    { sex: "male", age: "41-45", from: 492, to: 551, need: levels(2200, 2600, 2800) },
    { sex: "male", age: "46-50", from: 552, to: 611, need: levels(2200, 2400, 2800) },
    { sex: "male", age: "51-55", from: 612, to: 671, need: levels(2200, 2400, 2800) },
    { sex: "male", age: "56-60", from: 672, to: 731, need: levels(2200, 2400, 2600) },
    { sex: "male", age: "61-65", from: 732, to: 791, need: levels(2000, 2400, 2600) },
    { sex: "male", age: "66-70", from: 792, to: 851, need: levels(2000, 2200, 2600) },
    { sex: "male", age: "71-75", from: 852, to: 911, need: levels(2000, 2200, 2600) },
    { sex: "male", age: "76 and up", from: 912, need: levels(2000, 2200, 2400) },
  ],
};

// The Estimated Energy Requirements of the report Dietary Reference Intakes for Energy (2023) of the National Academies,
// for the ages of 0 to 35 months. Each value is from Table 7-5 (boys, page 160) and Table 7-6 (girls, page 161) of the
// PDF, read on 2026-11-24. The report gives each need for the median length and weight of the age group in the United
// States (NHANES 2015-2018). The age groups are 3 months wide. The report predicts each group at one age, for example
// 1 month for the group Birth-2.
// The report is all rights reserved. The values are facts with a citation, and the gate of the sources permits them.
// The Infant Nutrition and Feeding guide of the WIC program of the USDA (read on 2026-11-24) gives no table of daily needs.

/** The source of the feeds of formula: the PDF of the infant guide of the WIC program. It is a work of the United States federal government. */
export const WIC_INFANT_SOURCE: Source = {
  id: "wic-infant-guide-2019",
  title: "Infant Nutrition and Feeding: A Guide for Use in the WIC and CSF Programs",
  url: "https://wicworks.fna.usda.gov/sites/default/files/media/document/infant-feeding-guide.pdf",
  license: "us-public-domain",
  checked: "2026-11-24",
  by: "USDA Food and Nutrition Service",
  terms: "https://wicworks.fna.usda.gov/resources/infant-nutrition-and-feeding-guide",
  sha256: "d0c043cc70dedf16920673f57cc4771692974db30761df351faec4e56db45b1d",
};

/** A count of feeds in one day, with its source and its place in the source. */
export interface CitedFeeds {
  readonly perDay: number;
  readonly source: Source;
  readonly locator: string;
}

/**
 * The most feeds of formula in one day below 6 months: 8. Table 5.2 of the WIC guide gives 2 to 3 ounces every 3 to 4 hours.
 * 24 hours divided by 3 hours is 8. More feeds give smaller feeds and thus more waste, so this value is the most feeds.
 */
export const FORMULA_FEEDS: CitedFeeds = { perDay: 8, source: WIC_INFANT_SOURCE, locator: "Table 5.2, Guidelines for Feeding Healthy Infants, Birth to 12 Months Old, page 137" };

/** The source of the energy and the water of the infant formula items: the SR Legacy file of FoodData Central. */
export const FDC_SR_LEGACY_SOURCE: Source = {
  id: "fdc-sr-legacy-2018-04",
  title: "FoodData Central, SR Legacy (April 2018)",
  url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip",
  license: "cc0",
  checked: "2026-11-24",
  by: "USDA Agricultural Research Service",
  terms: "https://fdc.nal.usda.gov/download-datasets",
  sha256: "b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0",
};

/** The energy of the least formula of one infant for one day, from a cited volume and a cited energy of one fluid ounce. */
export interface CitedFormulaLeast {
  /** The energy, in `kcal`: `ounces` times `kcalPerOunce`. */
  readonly perDay: number;
  readonly ounces: number;
  readonly ouncesSource: Source;
  readonly ouncesLocator: string;
  readonly kcalPerOunce: number;
  readonly kcalSource: Source;
  readonly kcalLocator: string;
}

/**
 * The least formula of one infant from 6 months: 24 fl oz a day. Table 5.2 of the WIC guide gives 24 to 32 ounces at 6 to 8 months,
 * and 24 ounces at 8 to 12 months. The FDC item 172319 gives 63 kcal in 100 g and 30.4 g in 1 fl oz, thus 19.152 kcal in 1 fl oz.
 */
export const FORMULA_LATER_LEAST: CitedFormulaLeast = {
  perDay: 24 * 19.152,
  ounces: 24,
  ouncesSource: WIC_INFANT_SOURCE,
  ouncesLocator: "Table 5.2, Guidelines for Feeding Healthy Infants, Birth to 12 Months Old, page 137",
  kcalPerOunce: 19.152,
  kcalSource: FDC_SR_LEGACY_SOURCE,
  kcalLocator: "FDC ID 172319: 63 kcal in 100 g (food_nutrient.csv), and 30.4 g in 1 fl oz (food_portion.csv)",
};

/**
 * The facts of the mix rule: the energy and the water of a powder and of a ready-to-feed item of one store brand.
 * `formulaMixWater` gives the rule, and `formulaMixCheck` gives its check.
 */
export interface CitedFormulaMix {
  /** The energy of the powder, in `kcal` in 100 g. */
  readonly powderKcal: number;
  /** The water of the powder, in `g` in 100 g. Only the check of the rule uses it. */
  readonly powderWater: number;
  /** The energy of the ready-to-feed item, in `kcal` in 100 g. */
  readonly readyKcal: number;
  /** The water of the ready-to-feed item, in `g` in 100 g. Only the check of the rule uses it. */
  readonly readyWater: number;
  readonly source: Source;
  readonly locator: string;
  /** The source that tells to mix the powder with safe water, one bottle at a time. */
  readonly waterSource: Source;
  readonly waterLocator: string;
}

/**
 * The facts of the mix rule: the FDC items 173554 (store brand, powder) and 172319 (store brand, ready-to-feed).
 * The powder gives 524 kcal and 2 g of water in 100 g. The ready-to-feed item gives 63 kcal and 88.1 g of water in 100 g.
 * The WIC guide tells to mix powder one bottle at a time, and to use bottled water after a disaster or in a power cut.
 */
export const FORMULA_MIX: CitedFormulaMix = {
  powderKcal: 524,
  powderWater: 2,
  readyKcal: 63,
  readyWater: 88.1,
  source: FDC_SR_LEGACY_SOURCE,
  locator: "FDC ID 173554: 524 kcal (nutrient 1008) and 2 g of water (nutrient 1051) in 100 g. FDC ID 172319: 63 kcal and 88.1 g of water in 100 g (food_nutrient.csv)",
  waterSource: WIC_INFANT_SOURCE,
  waterLocator: "Page 106, Guidelines for Using Infant Formula When Access to Common Kitchen Appliances Is Limited, and Natural Disaster or Power Outage",
};

/** The rule of the mix water of infant formula after a disaster or in a power cut, with its quotes and its citation. */
export interface CitedFormulaWater {
  /** The code of the only resource that the mix takes as its water. */
  readonly resource: string;
  /** The words of the source for the mix water. */
  readonly quote: string;
  /** The words of the source for a household with no bottled water and no ready-to-feed formula. */
  readonly otherwise: string;
  /** The water to clean the bottles and the nipples. The source gives no amount, so it is a no read. */
  readonly cleaning: { readonly read: false; readonly why: string };
  readonly source: Source;
  readonly locator: string;
}

/**
 * The rule of the mix water: only commercially bottled water, `water.bottled`. The WIC guide gives the rule from the CDC.
 * The guide also tells to use ready-to-feed formula when possible. The cleaning water has no amount, so the model has no draw for it.
 */
export const FORMULA_WATER: CitedFormulaWater = {
  resource: "water.bottled",
  quote: "Use bottled water to prepare powdered or liquid concentrated infant formula.",
  otherwise: "If bottled water or ready-to-feed formulas are not available, discuss options with a health care provider.",
  cleaning: {
    read: false,
    why: "The guide tells to clean bottles and nipples with bottled, boiled, or treated water before each use. It gives no amount of water.",
  },
  source: WIC_INFANT_SOURCE,
  locator: "Page 107, the box Natural Disaster or Power Outage: Infant Formula Guidelines, from the CDC",
};

/** The source of the infant table: the PDF of the report Dietary Reference Intakes for Energy (2023) of the National Academies. */
export const NASEM_ENERGY_SOURCE: Source = {
  id: "nasem-dri-energy-2023",
  title: "Dietary Reference Intakes for Energy (2023)",
  url: "https://nap.nationalacademies.org/26818",
  license: "all-rights-reserved",
  checked: "2026-11-24",
  by: "National Academies of Sciences, Engineering, and Medicine",
  terms: "https://nap.nationalacademies.org/26818",
  note: "DOI 10.17226/26818. The terms are on the first page of the PDF. The table cites its values as facts and copies no text.",
  sha256: "e6a7d9c9104053d4925c621b659b06de4c8dd6c64ed4534e6f5bc5cf0dd41b27",
};

/** The energy of the breast milk of one infant for one day, with its source and its place in the source. */
export interface CitedMilk {
  readonly perDay: number;
  readonly source: Source;
  readonly locator: string;
}

/**
 * The energy of the breast milk of one infant from 6 months: 381 kcal/d. Table 5-14 of the NASEM report gives 568 g/d of milk
 * at 7 to 12 months for women that partly breastfeed, at 0.67 kcal/g. Its value at 6 months, 599 kcal/d, is for women that
 * only breastfeed. An infant from 6 months also has food, so the lower value gives the larger draw, the worst case.
 */
export const MILK_LATER: CitedMilk = { perDay: 381, source: NASEM_ENERGY_SOURCE, locator: "Table 5-14, Energy Cost of Milk Production in Breastfeeding Women During the First Year Postpartum, page 97" };

/**
 * The table of the Estimated Energy Requirements of the ages of 0 to 35 months, from the report Dietary Reference Intakes
 * for Energy (2023): 24 rows, 12 for each sex. Each row gives one need for each age group and sex. The last row ends at
 * 35 months, so the table is for a chain of tables, for example `CALORIE_CHAIN`.
 */
export const NASEM_INFANT_CALORIES: CalorieTable = {
  id: "nasem.2023:eer-0-35-months",
  title: "Dietary Reference Intakes for Energy (2023): Estimated Energy Requirements of the ages of 0 to 35 months",
  source: NASEM_ENERGY_SOURCE,
  locator: "Chapter 7: Table 7-5 (boys of 0 to 35 months, page 160) and Table 7-6 (girls of 0 to 35 months, page 161)",
  rows: [
    { sex: "female", age: "Birth-2", from: 0, to: 2, need: each(531) },
    { sex: "female", age: "3-5", from: 3, to: 5, need: each(546) },
    { sex: "female", age: "6-8", from: 6, to: 8, need: each(604) },
    { sex: "female", age: "9-11", from: 9, to: 11, need: each(689) },
    { sex: "female", age: "12-14", from: 12, to: 14, need: each(780) },
    { sex: "female", age: "15-17", from: 15, to: 17, need: each(817) },
    { sex: "female", age: "18-20", from: 18, to: 20, need: each(881) },
    { sex: "female", age: "21-23", from: 21, to: 23, need: each(956) },
    { sex: "female", age: "24-26", from: 24, to: 26, need: each(1011) },
    { sex: "female", age: "27-29", from: 27, to: 29, need: each(1051) },
    { sex: "female", age: "30-32", from: 30, to: 32, need: each(1122) },
    { sex: "female", age: "33-35", from: 33, to: 35, need: each(1192) },
    { sex: "male", age: "Birth-2", from: 0, to: 2, need: each(566) },
    { sex: "male", age: "3-5", from: 3, to: 5, need: each(589) },
    { sex: "male", age: "6-8", from: 6, to: 8, need: each(675) },
    { sex: "male", age: "9-11", from: 9, to: 11, need: each(745) },
    { sex: "male", age: "12-14", from: 12, to: 14, need: each(821) },
    { sex: "male", age: "15-17", from: 15, to: 17, need: each(881) },
    { sex: "male", age: "18-20", from: 18, to: 20, need: each(952) },
    { sex: "male", age: "21-23", from: 21, to: 23, need: each(1027) },
    { sex: "male", age: "24-26", from: 24, to: 26, need: each(1058) },
    { sex: "male", age: "27-29", from: 27, to: 29, need: each(1136) },
    { sex: "male", age: "30-32", from: 30, to: 32, need: each(1183) },
    { sex: "male", age: "33-35", from: 33, to: 35, need: each(1213) },
  ],
};

/** The tables of estimated calorie needs, one record for each source. */
export const CALORIE_TABLES: readonly CalorieTable[] = [DGA_CALORIES, NASEM_INFANT_CALORIES];

/**
 * The default tables of `householdFragment`, in order: the guidelines first, then the infant table. The guidelines give
 * each age from 12 months. The infant table gives the ages below 12 months. Together they give a row for each age.
 */
export const CALORIE_CHAIN: readonly CalorieTable[] = [DGA_CALORIES, NASEM_INFANT_CALORIES];
