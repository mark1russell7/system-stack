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
- The direct uses are the food uses of `uses`: each use for the need `food.energy`. The default `DIRECT_USES` gives `food.no-cook`, 1 kcal for each kcal.
- The resources are the resources of the stores and of the food uses. The resource of each food use is in `kcal` in the catalog, or the function throws a `RangeError`.
- The supply part of the draw is `supply`. Its default is the part of `NEED_SUPPLIES` for `food.energy`: `food.retail`.
- The result also has the food energy of each product (`buyListEnergy`). A caller gets the energy of the dry food for its converters from it.

The result has two reads. `needRead` tells if the draw has a read, and `storesRead` tells if each gift of the buy list has a read.

### A person with no row

The table has no row below 12 months. By default, a person with no row gives no layer. The result has `layer: undefined`, the persons with no row and the reason. A low rate gives too many days, and the draw has no field for a no read. A draw of 0 kcal also gives no layer: a household with no person, or each count 0.

The option `noRow: "leave-out"` leaves those persons out of the draw. The users are then the persons with a row, and `leftOut` lists the other persons. The draw then has no need of those persons. For an infant, that need is breast milk or formula, not the buy list. The days are then an upper limit for the whole household.

### The resources of the buy list and the join

The fragment has no converter. Thus, with this fragment alone, only `food.no-cook` feeds the draw. This is the worst case: no water and no fuel.

A caller adds the converters for the dry food in a different fragment, with the water and the fuel of each run. Then `joinEndurance` joins the fragments. The dry food then adds days only while the water and the fuel last.

This fragment declares the resource codes of the buy list, for example `water.stored` in `L`. A different fragment, for example the fragment of a water tank, can declare the same resource. `joinEndurance` of `@mark1russell7/stack-endurance` joins two equal records into one. A different unit is a fault of the join.

## The uses, the supply parts and the join gate

The package holds one record of each use and of each default supply part. `householdFragment` takes its food use from `DIRECT_USES`.

| Name | What it has |
| --- | --- |
| `NEED_SUPPLIES` | The default reference part of each need: `hydration.drink` to `water.main`, and `food.energy` to `food.retail`. A household with a well gives a different part. |
| `DIRECT_USES` | `water.stored` gives `hydration.drink`, 1 L for each L. This is a definition, not a read. `food.no-cook` gives `food.energy`, 1 kcal for each kcal. |
| `checkJoins` | The join gate of a catalog, the direct uses and the supply parts with the reference lists. |

`checkJoins(catalog, uses, supplies, { needs, parts })` gives one finding for each break. An empty list is a pass. Each finding is an error.

A finding has the form of a finding of `@mark1russell7/guidebook`, the same form as the findings of `checkCalorieTable`. Its record is `use` or `supply`. The `id` of a `use` finding is the resource of the use. The `id` of a `supply` finding is the need.

| Code | Record | The break |
| --- | --- | --- |
| `join-use-resource` | `use` | A direct use names a resource that is not in the catalog. |
| `join-use-need` | `use` | A direct use names a need that is not a reference need. |
| `join-use-unit` | `use` | The unit of the resource of a direct use does not convert to the unit of its need. |
| `join-use-amount` | `use` | The amount of a direct use is not the factor from the unit of its resource to the unit of its need. |
| `join-supply-need` | `supply` | A supply names a need that is not a reference need. |
| `join-supply-part` | `supply` | A supply names a part that is not a reference part. |

A direct use is a definition. Thus its amount is the factor of the units, from `valueIn` of `@mark1russell7/quantity`. For example, a use in `gal` for a need in `L` gives 3.785411784 L for each gal. A different rate is a converter, and a converter has a cited source.

The reference lists are parameters. An add-on does not import a different add-on, thus the caller gives them. Give `NEEDS` of `@mark1russell7/alerts` and `SUPPLY_PARTS` of `@mark1russell7/stack-hazards`. A test of the package joins these real lists. It also checks that `food.energy` is a need of `NEEDS` in `kcal`.

```ts
import { NEEDS } from "@mark1russell7/alerts";
import { SUPPLY_CATALOG } from "@mark1russell7/market/supplies";
import { SUPPLY_PARTS } from "@mark1russell7/stack-hazards";
import { checkJoins, DIRECT_USES, NEED_SUPPLIES } from "@mark1russell7/stack-needs";

console.log(checkJoins(SUPPLY_CATALOG, DIRECT_USES, NEED_SUPPLIES, { needs: NEEDS, parts: SUPPLY_PARTS })); // []
```

The gate does not examine the FoodKeeper `id` of each product. That join goes to the gate of the catalog of `@mark1russell7/market`.

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
| `@mark1russell7/stack-needs` | The records, the calorie table, the gate, `calorieNeed`, `householdFragment`, the uses, the supply parts and `checkJoins`. |
