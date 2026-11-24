# @mark1russell7/stack-needs

The need rates of draws as reference data. Each rate has its source and its license. The first tables are the food energy that each person needs each day.

It is an add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). It makes a fragment of an endurance layer, and [`@mark1russell7/stack-endurance`](../stack-endurance/README.md) calculates with it. The data names no person and no place. The persons of a household are input data.

Each function is a plain function with no clock, no network and no file.

## The records

| Record | What it tells |
| --- | --- |
| `CalorieTable` | A table of estimated calorie needs from one source, with the place of the tables in the source. |
| `CalorieTables` | One table, or tables in order. For each person, the first table with a row for the age gives the need. |
| `CalorieRow` | A sex, a range of ages in months, and the need of each activity level, or one need for all levels. |
| `CalorieChange` | A stage (for example `pregnancy-2`), a sex, and the change of the daily need at that stage, with the condition of the source. |
| `Person` | A group of persons: a sex, an age in whole months, a count and, as options, an activity level and a stage. |
| `HouseholdFragment` | A fragment of an endurance layer: the resources, the stores, one draw and one direct use. It has the form of `EnduranceLayer`. |
| `CookFragment` | A fragment of an endurance layer: the resources and one cook converter for each dry resource with a read. It has the form of `EnduranceLayer`. |
| `CookLine` | The energy, the cook water, the heat to boil, the stove time and the fuel of one pot of one dry food, each a read or a no read. |

## The rules of the data

1. Each value comes from a table of a cited source. A value with no source is not data.
2. An age with no row in the tables gives a line with no read for that person, not an error. The total of `calorieNeed` is then a lower limit, and `read` is false.
3. The activity level is an explicit input. The package has no default level.
4. A stage of pregnancy or lactation is an input of a person record. `calorieNeed` adds the change of the stage to the need of the row. The change comes from the table of the row. A stage that this table does not have for the sex of the record is an error, not a no read. Thus the option `leave-out` cannot remove a pregnant person from a draw. One stage holds for each day of a call. For a period that crosses stages, the planner selects the stage, for example the stage with the largest change.
5. The cook converters come from the cited cook facts of the catalog, a cited stove share and cited constants. A missing fact gives a no read, not a figure. Refer to the section on the water and the fuel of a cook.

`checkCalorieTable` is the gate of a table. It gives the findings of `checkSources` of `@mark1russell7/guidebook` for the source, also for a hash that is not 64 lowercase hexadecimal digits (`bad-sha256`). The source of a table must have a publisher (`by`), a page of its terms and a hash, and HTTPS addresses (the options `require` and `https` of the gate). A missing field gives `missing-field`. For the rows, it refuses two rows of one sex with ages in common, and a need that is not above 0 in `kcal/d`. The rows of each sex have no gap between two rows (`needs-gap`). A table can start after month 0 and end at a closed row. Each change has a stage, a title, a sex of the table and a finite value in `kcal/d`. Each stage and sex has one change at most (`needs-change`).

`checkCalorieChain` is the gate of tables in order. It gives the findings of `checkCalorieTable` for each table. Two tables with the same `id` give `needs-id`.

Then, for each sex, the rows of all the tables must cover each month from 0 to an open last row (`needs-gap`, record `chain`). Before 0.6.0, `checkCalorieTable` refused a table with a closed last row.

The source of a table is the `Source` of `@mark1russell7/guidebook`, with its field `sha256`. Before 0.3.0, the package had its own type `HashedSource` and the code `needs-hash`.

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

The default tables are `CALORIE_CHAIN`: the guidelines, then the infant table. They give a row for each age. A table of the option `table` can have no row for an age. By default, a person with no row gives no layer. The result has `layer: undefined`, the persons with no row and the reason. A low rate gives too many days, and the draw has no field for a no read. A draw of 0 kcal also gives no layer: a household with no person, or each count 0.

The option `noRow: "leave-out"` leaves those persons out of the draw. The users are then the persons with a row, and `leftOut` lists the other persons. The draw then has no need of those persons.

The days are then an upper limit for the whole household.

### An infant

The infant table gives the need of an infant below 12 months (`INFANT_MONTHS`). Each person record below 12 months must have the field `feeding`. It has no default, because each way gives a different draw.

| `feeding` | The draw of food energy |
| --- | --- |
| `food` | The draw holds the need of the infant, from the infant table. |
| `breast-milk` | Only below 6 months (`BREAST_MILK_MONTHS`). The draw does not hold the need of the infant. The milk comes from the food of the mother, so the stage of lactation of the mother holds that energy. The result lists the infant in `breastMilk`. |
| `formula` | Only below 12 months. The fragment has no draw of formula. Thus the infant gives no layer, as a person with no row. The result lists the infant in `formula`. With `noRow: "leave-out"`, the draw has no need of the infant, and `leftOut` lists the infant. |

With the default tables, the line of each infant in `need` has a read, so `need` gives the energy of the whole household.

The rules of breast milk:

- A person of the household must have a stage of lactation, or the function gives a `RangeError`.
- The change of a stage is the milk of one infant. Thus each infant on breast milk needs one person of the draw with a stage of lactation. When the infants are more, the function gives no layer, also with `leave-out`. A person that the draw leaves out does not count.
- From 6 months, the infant table gives 604 to 745 kcal/d, and the change of the stage is 400 kcal/d. Thus a part of the need is in no draw, and the function gives a `RangeError`. Give `food` from 6 months.

A stage of lactation is a change with `milk: true`: `lactation-1` and `lactation-2` of the guidelines. From 6 months, an infant eats food and drinks milk. With `feeding: "food"` and the stage `lactation-2` of the mother, the draw counts a part of that energy two times. The result is then more food than the household needs, which is on the safe side.

### The resources of the buy list and the join

The fragment has no converter. Thus, with this fragment alone, only `food.no-cook` feeds the draw. This is the worst case: no water and no fuel.

`cookFragment` gives the converters for the dry food in a different fragment, with the water and the fuel of each pot. Then `joinEndurance` joins the fragments. The dry food then adds days only while the water and the fuel last.

This fragment declares the resource codes of the buy list, for example `water.stored` in `L`. A different fragment, for example the fragment of a water tank, can declare the same resource. `joinEndurance` of `@mark1russell7/stack-endurance` joins two equal records into one. A different unit is a fault of the join.

## The water and the fuel of a cook

`cookFragment` turns the dry food of a buy list into converters of an endurance layer. One run of a converter is one pot. The run takes the dry food, the cook water and the fuel, and gives the food energy of the pot. Thus a dry food with no fuel or no water gives no meal.

```ts
import { SUPPLY_CATALOG } from "@mark1russell7/market/supplies";
import { cookFragment } from "@mark1russell7/stack-needs";

const cook = cookFragment({
  catalog: SUPPLY_CATALOG,
  units: { "food.rice-white-1kg": 4 },
  // Made-up stove and share: 227 g of propane in 90 min, and 0.5 of the higher heating value.
  stove: { fuel: "fuel.propane", rate: { amount: 227, unit: "g", per: { amount: 90, unit: "min" }, fact: "example.stove" } },
  share: { value: 0.5, heating: "higher", cite: "example.share" },
  batch: { value: 0.5, unit: "kg" },
});
// cook.layer has the converter cook:food.grain-dry. Join it with the layer of householdFragment and a store of fuel.
```

The model of one pot:

1. The cook water is `cookWater` of `@mark1russell7/market` times the dry mass. It takes `water.stored`, the resource of the drinking water.
2. The heat to boil is the mass times 4.19002 kJ/(kg.K) times the rise to the boil (100 °C). The mass is the water and the dry food. The rise starts at the start temperature. This temperature is an input with its citation. The default is 0 °C, which gives the most heat. The dry food takes the specific heat of water, which is higher than its own. This term holds the heat above the true value.
3. The boil time is the heat divided by the stove rate times the stove share. The share is the part of the stove heat that goes into the water and the food. The heat of the pot itself is in the losses. It is a cited input with its heating value. It has no default.
4. The stove time is the boil time plus the high end of the cook time. The cook time starts when the water boils.
5. The fuel is a safe upper limit: the stove burns at its full rate for all of the stove time.
6. A rate in a mass gives the fuel mass directly. A rate in an energy gives a mass only through the cited energy of the fuel (`fuelEnergy`), with the same heating value.
7. The dry mass of one pot (`batch`) is a plan of the caller. It has no default. Give the smallest pot that the cook makes. Each pot takes its own boil, so a batch above the real pot gives too little fuel.

Each value of a line is a read or a no read with its reasons. These facts give a no read:

| Missing fact | The no read |
| --- | --- |
| No cited cook water | The water, the heat and the fuel. A food with a cook time and no cited water has no fuel. |
| No cited cook time | The stove time and the fuel. |
| No cited stove rate, or a rate that is not an energy or a mass in a time | The stove time and the fuel. |
| No cited stove share | The stove time and the fuel. The water and the heat keep their reads. |
| A heating value of the share or of the rate that is not the heating value of the fuel energy | The stove time and the fuel. |
| No cited energy of the fuel, with a rate in an energy or a share on a rate in a mass | The stove time and the fuel. |
| No food energy of the product | The energy. |
| A product that gives more than one food | The energy. The catalog gives one energy for the whole product. |

A dry resource with a no read in a line has no converter. It is in `noReads`, and `read` is false. Two products of the list can give one dry resource, for example rice and oats. The converter then takes the worst case of their lines: the most water, the most fuel and the least energy.

The catalog of market gives no soak water. Thus a food that needs a soak, for example dry beans, has no soak draw. The beans of the catalog have no cited cook water, so they have no converter.

The cook water and the drinking water are one store, `water.stored`. A drinking draw at a higher level takes its water first, by the take order of `enduranceOf`. Thus the dry food gets the water only when the drink is safe to the end. With a small store of water, the dry food adds no days.

The cited constants:

| Name | Value | Source |
| --- | --- | --- |
| `WATER_SPECIFIC_HEAT` | 4.19002 kJ/(kg.K) | The NIST Guide to the SI (SP 811). Appendix B.8 gives 4.190 02 J for the calorie (mean), the mean from 0 °C to 100 °C. Footnote 10 tells that the calorie is the energy to raise 1 g of water by 1 °C. |
| `WATER_DENSITY_MAX` | 1 kg/L | The page Water Density of the USGS Water Science School. Its table gives 1.00000 g/cm3 at 4.0 °C, its largest value. Thus the water mass is an upper limit. |
| `BOIL_CELSIUS` | 100 °C | The end of the rise. Water boils at a lower temperature at a high place, so the heat is less. But the cook time is longer there, and the model does not give it. Thus at a high place the fuel is not an upper limit. |

The two sources are works of the United States federal government (the license `us-public-domain` of guidebook).

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

The calorie table comes from Appendix 2 of the Dietary Guidelines for Americans, 2020-2025, 9th Edition (USDA and HHS). Table A2-1 gives the ages of 12 through 23 months, on page 139. Table A2-2 gives the ages of 2 and more, on pages 140 and 141. The table has 68 rows: 34 for each sex. Table A2-3, on page 141, gives the changes of pregnancy and lactation. They are 0, 340 and 452 kcal/d in the three trimesters. They are 330 and 400 kcal/d in the first and the second 6 months of lactation.

The guidelines are a work of the United States federal government, in the public domain (the license `us-public-domain` of guidebook). The record of the source has the SHA-256 hash of the PDF of the check of 2026-11-22.

- A calorie of the source is a food calorie, thus 1 kcal.
- Table A2-1 gives one need for each age and sex of a toddler. The level does not change it.
- Each row of a toddler covers the months up to the next row. The table has no row below 12 months.
- The source gives each need for a reference height and weight. A person can need more or less.
- The source gives the changes of Table A2-3 for women with a healthy weight before the pregnancy. Each change has this condition in its field `condition`.

The infant table comes from the report Dietary Reference Intakes for Energy (2023) of the National Academies of Sciences, Engineering, and Medicine (DOI 10.17226/26818). Table 7-5 gives the boys of 0 to 35 months, on page 160. Table 7-6 gives the girls of 0 to 35 months, on page 161. The table has 24 rows: one row for each group of 3 months and each sex.

The report gives each need for the median length and weight of the age group in the United States.

The report is all rights reserved (the license `all-rights-reserved` of guidebook). The table cites its values as facts and copies no text, and the gate of the sources permits this use. The record of the source has the SHA-256 hash of the PDF of the check of 2026-11-24. The Infant Nutrition and Feeding guide of the WIC program of the USDA gives no table of daily needs (read on 2026-11-24).

- The rows of 12 to 35 months are also in the table. In `CALORIE_CHAIN`, the guidelines come first, so they give the need of those ages.
- A table with the report first gives the needs of the report up to 35 months.

The 2025-2030 edition of the guidelines was read on 2026-11-24. It has no table of calorie needs. It sends the reader to the DRI calculator of the USDA, and its daily servings start from a calorie level. Thus the table stays the table of the 2020-2025 edition.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-needs` | The records, the calorie tables and `CALORIE_CHAIN`, the gates, `calorieNeed`, `householdFragment`, `cookFragment` and its constants, the uses, the supply parts and `checkJoins`. |
