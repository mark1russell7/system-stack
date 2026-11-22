# @mark1russell7/stack-needs

The need rates of draws as reference data. Each rate has its source and its license. The first table is the food energy that each person needs each day.

It is an add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). It makes a fragment of an endurance layer, and [`@mark1russell7/stack-endurance`](../stack-endurance/README.md) calculates with it. The data names no person and no place. The persons of a household are input data.

Each function is a plain function with no clock, no network and no file.

## The records

| Record | What it tells |
| --- | --- |
| `HashedSource` | A source of `@mark1russell7/guidebook` (an id, a title, a URL, a license and the date of the check), with the SHA-256 hash of the file. |
| `CalorieTable` | A table of estimated calorie needs from one source, with the place of the tables in the source. |
| `CalorieRow` | A sex, a range of ages in months, and the need of each activity level, or one need for all levels. |
| `Person` | A group of persons: a sex, an age in whole months, a count and, as an option, an activity level. |
| `HouseholdFragment` | A fragment of an endurance layer: the resources, the stores, one draw and one direct use. It has the form of `EnduranceLayer`. |

## The rules of the data

1. Each value comes from a table of a cited source. A value with no source is not data.
2. An age with no row in the table gives a line with no read for that person, not an error. The total of `calorieNeed` is then a lower limit, and `read` is false.
3. The activity level is an explicit input. The package has no default level.
4. The package has no cooking converter. No cited source gives the water and the fuel to cook 1 kg of dry food.

`checkCalorieTable` is the gate of a table. It gives the findings of `checkSources` of `@mark1russell7/guidebook` for the source. It also refuses a hash that is not 64 lowercase hexadecimal digits. For the rows, it refuses two rows of one sex with ages in common, and a need that is not above 0 in `kcal/d`. The rows of each sex also cover each month with no gap, from the first row to an open last row (`needs-gap`).

The field `sha256` is not in the source of guidebook yet. It moves there later.

## A first look

```ts
import { SUPPLY_CATALOG } from "@mark1russell7/market/supplies";
import { enduranceOf } from "@mark1russell7/stack-endurance";
import { calorieNeed, DGA_CALORIES, householdFragment, type Person } from "@mark1russell7/stack-needs";

// Made-up persons: two adults of 33 years.
const persons: Person[] = [
  { sex: "male", ageMonths: 396, count: 1 },
  { sex: "female", ageMonths: 396, count: 1 },
];
console.log(calorieNeed(DGA_CALORIES, persons, "sedentary", 1).need); // { value: 4200, unit: "kcal" }

const food = householdFragment({
  persons,
  activity: "sedentary",
  catalog: SUPPLY_CATALOG,
  units: { "food.rice-white-1kg": 4, "food.peanut-butter-1kg": 2 },
  supply: "food.retail",
  level: "critical",
  levels: ["critical"],
});
const cut = { case: "food-cut", title: "No food shops", cuts: [{ part: "food.retail", title: "No food shops", source: "example" }] };
if (food.layer === undefined) throw new Error(food.why);
console.log(enduranceOf(food.layer, cut, { at: "2026-11-22" }).needs["food.energy"]?.days); // about 2.85: the peanut butter alone
```

## The join of a household and a buy list

`householdFragment` turns the persons and a buy list into a fragment of an endurance layer. The buy list is the count of units of each product of the catalog of supplies of `@mark1russell7/market`.

- The fragment has one draw `food.energy`. Its rate is the need of the persons for one day, in `kcal`. Its users are the persons.
- Each gift of the buy list (`giftsOf`) is one store. Examples are `food.no-cook` in `kcal`, the dry foods in `kg` and `water.stored` in `L`.
- A gift with no read has no store. It is in `noReads`, and `storesRead` is false. The draw does not change.
- The direct use of `food.no-cook` gives 1 kcal of the need for each kcal.
- The result also has the food energy of each product (`buyListEnergy`). A caller gets the energy of the dry food for its converters from it.

The result has two reads. `needRead` tells if the draw has a read, and `storesRead` tells if each gift of the buy list has a read.

### A person with no row

The table has no row below 12 months. By default, a person with no row gives no layer. The result has `layer: undefined`, the persons with no row and the reason. A low rate gives too many days, and the draw has no field for a no read. A draw of 0 kcal also gives no layer: a household with no person, or each count 0.

The option `noRow: "leave-out"` leaves those persons out of the draw. The users are then the persons with a row, and `leftOut` lists the other persons. The draw then has no need of those persons. For an infant, that need is breast milk or formula, not the buy list. The days are then an upper limit for the whole household.

### The resources of the buy list and the join

The fragment has no converter. Thus, with this fragment alone, only `food.no-cook` feeds the draw. This is the worst case: no water and no fuel.

A caller adds the converters for the dry food in a different fragment, with the water and the fuel of each run. Then `joinEndurance` joins the fragments. The dry food then adds days only while the water and the fuel last.

This fragment owns the resource codes of the buy list, for example `water.stored`. `joinEndurance` of `@mark1russell7/stack-endurance` gives a fault when two fragments have one resource code. Thus a later water draw comes into this same fragment, and not into a different fragment.

## The sources

The calorie table comes from Appendix 2 of the Dietary Guidelines for Americans, 2020-2025, 9th Edition (USDA and HHS). Table A2-1 gives the ages of 12 through 23 months, on page 139. Table A2-2 gives the ages of 2 and more, on pages 140 and 141. The table has 68 rows: 34 for each sex.

The guidelines are a work of the United States federal government, in the public domain (the license `us-public-domain` of guidebook). The record of the source has the SHA-256 hash of the PDF of the check of 2026-11-22.

- A calorie of the source is a food calorie, thus 1 kcal.
- Table A2-1 gives one need for each age and sex of a toddler. The level does not change it.
- Each row of a toddler covers the months up to the next row. The table has no row below 12 months.
- The source gives each need for a reference height and weight. A person can need more or less.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-needs` | The records, the calorie table, the gate, `calorieNeed` and `householdFragment`. |
