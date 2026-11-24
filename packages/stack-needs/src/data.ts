import type { CalorieChange, CalorieNeed, CalorieTable } from "./calorie.ts";
import type { Source } from "@mark1russell7/guidebook";

// The estimated calorie needs of the Dietary Guidelines for Americans, 2020-2025. Each value is from the tables of
// Appendix 2 of the PDF, read on 2026-11-22. A calorie of the source is a food calorie, thus 1 kcal. The source gives
// each need for a reference height and weight, to keep the weight of a person. A person can need more or less.
// The rows of the toddlers are at 12, 15, 18 and 21 through 23 months. Each row here covers the months up to the next row.
// The changes of pregnancy and lactation are from Table A2-3. The source gives them for women with a healthy weight before
// the pregnancy.
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
