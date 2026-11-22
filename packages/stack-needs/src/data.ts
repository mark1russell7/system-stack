import type { CalorieNeed, CalorieTable } from "./calorie.ts";
import type { License, Source } from "./source.ts";

// The estimated calorie needs of the Dietary Guidelines for Americans, 2020-2025. Each value is from the tables of
// Appendix 2 of the PDF, read on 2026-11-22. A calorie of the source is a food calorie, thus 1 kcal. The source gives
// each need for a reference height and weight, to keep the weight of a person. A person can need more or less.
// The rows of the toddlers are at 12, 15, 18 and 21 through 23 months. Each row here covers the months up to the next row.

/** The law that puts the works of the United States federal government in the public domain (17 U.S.C. 105). */
const FEDERAL_WORK: License = { name: "Public domain (a work of the United States federal government)", url: "https://www.copyright.gov/title17/92chap1.html#105" };

/** The source of the calorie table: the PDF of the Dietary Guidelines for Americans, 2020-2025, 9th Edition. */
export const DGA_SOURCE: Source = {
  name: "Dietary Guidelines for Americans, 2020-2025, 9th Edition",
  url: "https://www.dietaryguidelines.gov/sites/default/files/2020-12/Dietary_Guidelines_for_Americans_2020-2025.pdf",
  publisher: "U.S. Department of Agriculture and U.S. Department of Health and Human Services",
  license: FEDERAL_WORK,
  read: "2026-11-22",
  sha256: "ceea04ce1a7c13a95a170f3548ed3926ad6dd49599bd730fb58bc9c02711d16e",
};

const day = (value: number): { readonly value: number; readonly unit: string } => ({ value, unit: "kcal/d" });
const levels = (sedentary: number, moderate: number, active: number): CalorieNeed => ({ levels: { sedentary: day(sedentary), "moderately-active": day(moderate), active: day(active) } });
const each = (value: number): CalorieNeed => ({ each: day(value) });

/** The table of estimated calorie needs of the Dietary Guidelines for Americans, 2020-2025: 68 rows, 34 for each sex. */
export const DGA_CALORIES: CalorieTable = {
  id: "dga.2020-2025:calorie-needs",
  title: "Dietary Guidelines for Americans, 2020-2025: Estimated Calorie Needs",
  source: DGA_SOURCE,
  locator: "Appendix 2: Table A2-1 (ages 12 through 23 months, page 139) and Table A2-2 (ages 2 and older, pages 140 and 141)",
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

/** The tables of estimated calorie needs, one record for each source. */
export const CALORIE_TABLES: readonly CalorieTable[] = [DGA_CALORIES];
