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
| `HouseholdFragment` | A fragment of an endurance layer: the resources, the stores, the draws and their direct uses. It has the form of `EnduranceLayer`. |
| `OpenedWaste` | The containers of one product with no cold storage: the count, the energy of one container, the feed, the energy used and the waste. |
| `CookFragment` | A fragment of an endurance layer: the resources and one cook converter for each dry resource with a read. It has the form of `EnduranceLayer`. |
| `CookLine` | The energy, the cook water, the heat to boil, the stove time and the fuel of one pot of one dry food, each a read or a no read. |
| `ResourceSubset` | A resource and a wider resource. Each unit of the resource is also a unit of the wider resource, for example `water.bottled` in `water.stored`. |
| `CitedFormulaWater` | The rule of the mix water of infant formula powder: the resource, the quotes of the source, the cleaning water as a no read and the citation. |

## The rules of the data

1. Each value comes from a table of a cited source. A value with no source is not data.
2. An age with no row in the tables gives a line with no read for that person, not an error. The total of `calorieNeed` is then a lower limit, and `read` is false.
3. The activity level is an explicit input. The package has no default level.
4. A stage of pregnancy or lactation is an input of a person record. `calorieNeed` adds the change of the stage to the need of the row. The change comes from the table of the row. A stage that this table does not have for the sex of the record is an error, not a no read. Thus the option `leave-out` cannot remove a pregnant person from a draw. One stage holds for each day of a call. For a period that crosses stages, the planner selects the stage, for example the stage with the largest change.
5. The cook converters come from the cited cook facts of the catalog and cited constants. The boil fuel comes from a cited stove share or a cited boil yield. A missing fact gives a no read, not a figure. Refer to the section on the water and the fuel of a cook.

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

- The draw `food.energy` has the need of the persons for one day, in `kcal`. Its users are the persons.
- The draw `food.infant-formula` has the infants on formula below 6 months (`FORMULA_DRAW_MONTHS`), with the whole need of their rows.
- The fragment has each draw with one or more users. The draw `food.energy` is first.
- Each gift of the buy list (`giftsOf`) is one store. Examples are `food.no-cook` in `kcal`, the dry foods in `kg`, `water.stored` in `L` and `water.bottled` in `L`.
- The only converters of the fragment are the subsets of the resources of its stores (`subsetConverters`). The default `RESOURCE_SUBSETS` makes `water.bottled` also `water.stored`. Refer to the section on the water of infant formula powder.
- A gift with no read has no store. It is in `noReads`, and `storesRead` is false. The draw does not change.
- With no cold storage, an opened container of formula serves one feed. This is the default (`cold` is false), the worst case of no power. The next section tells the rule.
- The direct uses are each use of `uses` for the need of a draw. The default `DIRECT_USES` gives `food.no-cook` to the food draw and `food.infant-formula-ready` to the formula draw, 1 kcal for each kcal.
- The resources are the resources of the stores and of the direct uses. The resource of each direct use is in `kcal` in the catalog, or the function throws a `RangeError`.
- The supply part of each draw is `supply`. Its default is the part of `NEED_SUPPLIES` for the need of the draw: `food.retail`.
- The result also has the food energy of each product (`buyListEnergy`). A caller gets the energy of the dry food for its converters from it.

The result has two reads. `needRead` tells if the draw has a read, and `storesRead` tells if each gift of the buy list has a read.

### Opened containers with no cold storage

The WIC guide of the USDA (page 106) tells this rule: with limited access to a refrigerator, use formula immediately after a ready-to-feed container is opened. The catalog of market gives the rule as the field `opened` of a product, with the size of one container.

| Step | Value |
| --- | --- |
| Feeds in one day | 8 (`FORMULA_FEEDS`). Table 5.2 of the WIC guide (page 137) gives a feed every 3 to 4 hours. More feeds give smaller feeds, so 8 is the worst case. |
| One feed | The smallest need of an infant of the formula draw, divided by 8 |
| Energy that one container gives | `feed / ceil(feed / container)`. A feed that is more than a container takes more containers, and the rest of the last is waste. |
| Store | The count of containers times the energy that one container gives. `waste` gives the rest for each product. |

A product with a container of no read gives no store. It is in `noReads`, so the stores are a lower limit. The 1 kg formula of the catalog has no container size yet. The option `cold: true` gives the whole energy of each container. Only the formula draw has a cited size of one feed. Thus a product with opened containers that feeds no formula draw makes the function throw a `RangeError`.

### A person with no row

The default tables are `CALORIE_CHAIN`: the guidelines, then the infant table. They give a row for each age. A table of the option `table` can have no row for an age. By default, a person with no row gives no layer. The result has `layer: undefined`, the persons with no row and the reason. A low rate gives too many days, and the draw has no field for a no read. A draw of 0 kcal also gives no layer: a household with no person, or each count 0.

The option `noRow: "leave-out"` leaves those persons out of the draw. The users are then the persons with a row, and `leftOut` lists the other persons. The draw then has no need of those persons.

The days are then an upper limit for the whole household.

### An infant

The infant table gives the need of an infant below 12 months (`INFANT_MONTHS`). Each person record below 12 months must have the field `feeding`. It has no default, because each way gives a different draw.

| `feeding` | The draw of food energy |
| --- | --- |
| `food` | The draw holds the need of the infant, from the infant table. |
| `breast-milk` | Only below 12 months. Below 6 months (`BREAST_MILK_MONTHS`), the draw does not hold the need of the infant. The milk comes from the food of the mother, so the stage of lactation of the mother holds that energy. From 6 months, the infant also has food. The draw holds the need of the row minus the milk energy (`MILK_LATER`, 381 kcal/d). The result lists the infant in `breastMilk`. |
| `formula` | Only below 12 months. Below 6 months (`FORMULA_DRAW_MONTHS`), the draw `food.infant-formula` holds the whole need of the infant, because the infant has milk only. Only the formula of the buy list feeds it, so a list with no formula gives 0 days. From 6 months, no cited source gives the part of formula. Thus the infant gives no layer, as a person with no row. With `noRow: "leave-out"`, no draw has the need of the infant, and `leftOut` lists the infant. With `formulaLater: "whole"`, the formula draw holds the whole need: the upper limit of formula. With `formulaLater: "least"`, the formula draw holds the lower limit, and the food draw holds the rest. The result lists each infant on formula in `formula`. |

With the default tables, the line of each infant in `need` has a read, so `need` gives the energy of the whole household.

The limits of formula from 6 months:

- The upper limit is the whole need of the row. Formula cannot give more energy than the whole need. Give `formulaLater: "whole"` for this limit.
- Table 5.2 of the WIC guide (page 137) gives the formula of one day. It is approximately 24 to 32 ounces at 6 to 8 months.
- At 8 to 12 months, the table gives approximately 24 ounces.
- The lower limit is 24 fl oz a day (`FORMULA_LATER_LEAST`). Give `formulaLater: "least"` for this limit. When the need of the row is less, the formula draw holds the need.
- The FDC item 172319 (ready-to-feed formula) gives 63 kcal in 100 g and 30.4 g in 1 fl oz. Thus 1 fl oz gives 19.152 kcal, and 24 fl oz give 459.648 kcal.
- The two limits give the same total energy. Only the split between the formula draw and the food draw changes.

The rules of breast milk:

- A person of the household must have a stage of lactation, or the function gives a `RangeError`.
- The change of a stage is the milk of one infant. Thus each infant on breast milk needs one person of the draw with a stage of lactation. When the infants are more, the function gives no layer, also with `leave-out`. A person that the draw leaves out does not count.
- From 6 months, the food draw holds the need of the row minus 381 kcal/d of milk. The next sections give the sources.

The notes b and c of Table A2-3 of the guidelines (page 141) give the two changes of lactation:

| Stage | The note of the source | The change |
| --- | --- | --- |
| `lactation-1` | 500 calories/day for the milk production, minus 170 calories/day for the weight loss after the birth. | 330 kcal/d |
| `lactation-2` | 400 calories/day for the milk production. The source assumes a stable weight after 6 months. | 400 kcal/d |

Thus below 6 months, a part of the milk comes from the stores of the mother. The draw holds only the part from food.
The source gives the energy of the milk production, not the energy that the infant gets. It gives no change for two or more infants.

Table 5-14 of the NASEM report (2023, page 97) gives the milk of the first year. The milk energy is the milk times 0.67 kcal/g:

| Time after the birth | Milk (g/d) | Milk energy (kcal/d) | The women of the source |
| --- | --- | --- | --- |
| 0 to 2 months | 732 | 490 | Only breastfeed |
| 3 to 4 months | 779 | 522 | Only breastfeed |
| 5 months | 826 | 553 | Only breastfeed |
| 6 months | 894 | 599 | Only breastfeed |
| 7 to 12 months | 568 | 381 | Partly breastfeed |

From 6 months, the infant also has food. Thus the package takes 381 kcal/d of milk from 6 months (`MILK_LATER`). Less milk gives a larger draw, so this is the worst case.
The NASEM report gives no change for a mother of two or more infants. Thus twins on breast milk stay a no read: the function gives no layer.

A stage of lactation is a change with `milk: true`: `lactation-1` and `lactation-2` of the guidelines. From 6 months, an infant eats food and drinks milk. With `feeding: "food"` and the stage `lactation-2` of the mother, the draw counts a part of that energy two times. The result is then more food than the household needs, which is on the safe side.

### The resources of the buy list and the join

The fragment has no converter of food. Thus, with this fragment alone, only `food.no-cook` feeds the draw. This is the worst case: no water and no fuel.

`cookFragment` gives the converters for the dry food in a different fragment, with the water and the fuel of each pot. Then `joinEndurance` joins the fragments. The dry food then adds days only while the water and the fuel last.

`formulaMixFragment` gives the converter of the infant formula powder in a different fragment, with its water. The powder then adds days of formula only while the water lasts.

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
   A boil yield of the stove (`boil` of market) also gives the boil fuel, with no share and no fuel energy. The boil fuel is then the heat of the pot over the heat that 1 kg of fuel put into the test water.
   The test water takes `WATER_DENSITY_MIN` (0.95865 kg/L at 100 °C, from the USGS table). The rise goes from the cited start to the cited end of the test.
   Each choice gives the most fuel. At a high place the test water boils below 100 °C, so the end has no default.
   The boil time is then the boil fuel over the mass rate. When the share and the yield both give a boil fuel, the line takes the most.
4. The stove time is the boil time plus the high end of the cook time. The cook time starts when the water boils.
5. The fuel is a safe upper limit: the stove burns at its full rate for all of the stove time. Only a stove rate with no bound gives the fuel. A rate with a bound, for example `bound: "least"`, gives a no read. At a high place the cook time is longer. The model does not give that time, so there the fuel is not an upper limit.
6. A rate in a mass gives the fuel mass directly. A rate in an energy gives a mass only through the cited energy of the fuel (`fuelEnergy`), with the same heating value.
7. The dry mass of one pot (`batch`) is a plan of the caller. It has no default. Give the smallest pot that the cook makes. Each pot takes its own cook time, so a batch above the real pot gives too little fuel.

Each value of a line is a read or a no read with its reasons. These facts give a no read:

| Missing fact | The no read |
| --- | --- |
| No cited cook water | The water, the heat and the fuel. A food with a cook time and no cited water has no fuel. |
| No cited cook time | The stove time and the fuel. |
| No cited stove rate, or a rate that is not an energy or a mass in a time | The stove time and the fuel. |
| A stove rate with a bound, for example `bound: "least"` of market | The stove time and the fuel. The fuel of the cook time is the rate times the time, so a least rate gives too little fuel. |
| No cited stove share, and no boil yield with a read | The stove time and the fuel. The water and the heat keep their reads. |
| A boil yield with the bound `most`, or with no cited start or end temperature | No boil fuel from the yield. A most yield, for example the calm test of a maker, gives too little fuel for the boil. |
| A heating value of the share or of the rate that is not the heating value of the fuel energy | The stove time and the fuel. |
| No cited energy of the fuel, with a rate in an energy or a share on a rate in a mass | The stove time and the fuel. |
| No food energy of the product | The energy. |
| A product that gives more than one food | The energy. The catalog gives one energy for the whole product. |

A dry resource with a no read in a line has no converter. It is in `noReads`, and `read` is false. Two products of the list can give one dry resource, for example rice and oats. The converter then takes the worst case of their lines: the most water, the most fuel and the least energy.

Market gives the soak water of a dry food with `soakWater`. This function does not take it. Thus the water of a food with a soak, for example dry beans, is a lower limit. The cook water of beans and pasta gives their converters.

The cook water and the drinking water are one store, `water.stored`. A cook can use tap water. The subset converter of `householdFragment` also gives the bottled water of the buy list as `water.stored`, so a cook takes the two. A drinking draw at a higher level takes its water first, by the take order of `enduranceOf`. The drinking draw keeps back its days times its demand, which is all of the store. Thus, when a case cuts the water supply, the dry food adds 0 days at each amount of stored water.

The cited constants:

| Name | Value | Source |
| --- | --- | --- |
| `WATER_SPECIFIC_HEAT` | 4.19002 kJ/(kg.K) | The NIST Guide to the SI (SP 811). Appendix B.8 gives 4.190 02 J for the calorie (mean). The common definition of that calorie is the mean from 0 °C to 100 °C, and SP 811 does not state the range. Footnote 10 tells that the calorie is the energy to raise 1 g of water by 1 °C. |
| `WATER_DENSITY_MAX` | 1 kg/L | The page Water Density of the USGS Water Science School. Its table gives 1.00000 g/cm3 at 4.0 °C, its largest value. Thus the water mass is an upper limit. |
| `BOIL_CELSIUS` | 100 °C | The end of the rise. Water boils at a lower temperature at a high place, so the heat is less. But the cook time is longer there, and the model does not give it. Thus at a high place the fuel is not an upper limit. |

The two sources are works of the United States federal government (the license `us-public-domain` of guidebook).

## The water of infant formula powder

`formulaMixFragment` turns the infant formula powder of a buy list into one converter of an endurance layer. The converter needs no fuel. One run is 1 kg of powder. The run takes the powder and its mix water, and gives the energy of the powder as ready formula. Thus a powder with no water gives no feed.

```ts
import { SUPPLY_CATALOG } from "@mark1russell7/market/supplies";
import { formulaMixFragment } from "@mark1russell7/stack-needs";

const mix = formulaMixFragment({ catalog: SUPPLY_CATALOG, units: { "food.infant-formula-powder-1kg": 2 } });
// mix.layer has the converter mix:food.infant-formula-powder. Join it with the layer of householdFragment and a store of water.
```

The records of the converter:

| Field | Value for 1 kg of the catalog powder |
| --- | --- |
| `takes` | 1 kg of `food.infant-formula-powder`, and 7.3175 L of `water.bottled` |
| `gives` | 5240 kcal of `food.infant-formula-ready`, the resource of the ready formula |
| `id` | `mix:food.infant-formula-powder`. The option `prefix` changes the start. |

The direct use of `food.infant-formula-ready` then feeds the formula draw. The powder has a store in the household fragment, and no direct use. `cookFragment` does not cook it.

### The mix rule

The rule is a mass balance. It assumes that the prepared powder has the energy in 100 g of the ready-to-feed item of the same store brand. The reason: FoodData Central gives these two items of one brand, and no catalog record cites the mix ratio of a label. A label-cited mix ratio replaces this assumption.

1. The powder gives 524 kcal in 100 g, and the ready-to-feed item gives 63 kcal in 100 g.
2. Thus 100 g of prepared formula holds 100 × 63 / 524 = 12.023 g of powder and 87.977 g of mix water.
3. The mix water is 1.39646 g for each kcal, and 7.3175 kg for each kg of powder (`formulaMixWater`).
4. The water mass converts to a volume at `WATER_DENSITY_MAX`, 1 kg/L. Water above 4 °C is less dense, so the true volume is a little more.
5. The energy of each powder product comes from its food energy in the catalog. Two products can give powder. Then the converter takes the most water and the least energy of their lines.

`formulaMixCheck` gives an independent check of the rule. The rule does not use the water of the two items. The powder holds 2 g of water in 100 g, thus 0.240 g in 12.023 g. The predicted water of 100 g of prepared formula is 87.977 + 0.240 = 88.218 g. The FDC item 172319 gives 88.1 g, 0.13% less.

These facts give a no read, and then the powder has no converter:

| Missing fact | The no read |
| --- | --- |
| No food energy of the product, or an energy in a unit that does not convert to kcal | The energy and the water |
| A product that gives more than one food | The energy and the water |
| An energy of the powder that is not more than the 630 kcal/kg of the ready-to-feed item | The water |

### Only bottled water

The mix takes only commercially bottled water, `water.bottled` (`FORMULA_WATER`). The rule comes from the WIC guide "Infant Nutrition and Feeding" of the USDA (`WIC_INFANT_SOURCE`, `us-public-domain`). The guide gives it from the CDC.

| Locator | The words of the source |
| --- | --- |
| Page 107, the box "Natural Disaster or Power Outage: Infant Formula Guidelines" | "Use ready-to-feed formula if possible." |
| The same box | "Use bottled water to prepare powdered or liquid concentrated infant formula. If bottled water or ready-to-feed formulas are not available, discuss options with a health care provider." |
| The same box | "Clean bottles and nipples with bottled, boiled, or treated water before each use." |

- The catalog of market gives bottled water its own resource, `water.bottled`, since market 0.9.0. The jug of commercially bottled water gives it. The container filled from the tap gives `water.stored`.
- `RESOURCE_SUBSETS` makes `water.bottled` a subset of `water.stored`. `householdFragment` gives one converter for it: 1 L of `water.bottled` gives 1 L of `water.stored`, with no device and no limit.
- Thus a drinking draw and a cook take the tap water and the bottled water, and the mix takes only the bottled water. Each litre goes to one draw only.
- The endurance query decides the share. A take of `water.stored` uses the tap water first, then the bottled water through the converter.
- The draws take in the order of their level, then of their codes. A drinking draw at a higher level keeps back its water first, so the powder can add 0 days.
- A household with only tap water and powder gets 0 days of formula from the powder. `binding` of the formula draw then names `water.bottled`.
- `formulaMixFragment` gives the reason in `waterWhy` when the buy list has powder and no product that gives `water.bottled`. `bottled` names the products that give it.
- The converter stays in that case, because a different fragment can give a store of bottled water.
- The guide tells to discuss the options with a health care provider when the household has no bottled water. The model does not model that step.
- The cleaning water of the bottles and the nipples is a no read (`FORMULA_WATER.cleaning`). The source gives no amount, so the model has no draw for it.

The WIC guide tells to prepare powder one bottle at a time, for one feed. Thus the mix has no waste of an opened container. The rule of opened containers applies only to a product with the field `opened`.

The cited constant:

| Name | Value | Source |
| --- | --- | --- |
| `FORMULA_MIX` | 524 kcal and 2 g of water in 100 g of powder. 63 kcal and 88.1 g of water in 100 g of ready-to-feed formula. | FoodData Central, SR Legacy (April 2018, CC0 1.0): FDC ID 173554 (store brand, powder) and FDC ID 172319 (store brand, ready-to-feed), `food_nutrient.csv`. The water source is the WIC guide, page 106. |
| `FORMULA_WATER` | The mix water is `water.bottled` only. The cleaning water is a no read. | The WIC guide, page 107, the box "Natural Disaster or Power Outage: Infant Formula Guidelines", from the CDC. |

## The uses, the supply parts and the join gate

The package holds one record of each use and of each default supply part. `householdFragment` takes its food use from `DIRECT_USES`.

| Name | What it has |
| --- | --- |
| `NEED_SUPPLIES` | The default reference part of each need: `hydration.drink` to `water.main`, and `food.energy` and `food.infant-formula` to `food.retail`. A household with a well gives a different part. |
| `DIRECT_USES` | `water.stored` gives `hydration.drink`, 1 L for each L. This is a definition, not a read. `food.no-cook` gives `food.energy`, and `food.infant-formula-ready` gives `food.infant-formula`, 1 kcal for each kcal. |
| `RESOURCE_SUBSETS` | `water.bottled` is a subset of `water.stored`. This is a definition, not a read. |
| `subsetConverters` | The converter of each subset whose resource has a store. One run gives the same amount of the wider resource, in its unit. |
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

## The daily needs of the kit

`DAILY_NEEDS` gives the needs of the kit items: light, the watch of an alert receiver and warmth. Each need has a cited daily rate, or a no read with its reason. A no read is not 0, and the list keeps it.

| Code | Unit | Users | Daily rate |
| --- | --- | --- | --- |
| `alert.watch` | `h` | household | 24 `h/d` |
| `light.see` | `h` | household | no read |
| `warmth.shelter` | `kWh` | household | no read |

- `alert.watch` comes from two pages of the National Weather Service (read on 2026-11-24). Many receivers have a muted standby mode that turns on when a warning comes. Warnings also come at night. Thus a receiver stays on and listens at all hours, so 24 hours each day. One receiver for each home is a choice of this model, not of the pages. The pages are in the public domain (the license `us-public-domain`).
- `light.see` is a no read. The kit lists of Ready.gov give a flashlight and extra batteries, but no hours of use each day. The hours of dark are the same for all the persons of a home, so the users are the household. The count of lights of each person is a fact of the plan or the device.
- `warmth.shelter` is a no read. The heat that a home needs changes with the weather, the building and the persons. It is space heat only. The blankets and the sleeping bags of each person are gear, not this need.
- A user gives each no read as input data.
- The rate of a device is a fact of the device, not of the need. An example is the watts of a radio in standby.

`checkDailyNeeds` is the gate of the list. It gives the findings of `checkSources` of `@mark1russell7/guidebook`. Each source must have a publisher (`by`), a page of its terms and HTTPS addresses. `resultOf` of guidebook tells if the gate passes.

The gate refuses an empty code and two needs with one code (`daily-need-id`). It refuses a unit that `@mark1russell7/quantity` does not read (`daily-need-unit`). It also refuses a bad read or a no read with no reason (`daily-need-rate`). A bad read has no source. Or its amount is not a finite number of 0 or more in the unit of the need for each day.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-needs` | The records, the calorie tables and `CALORIE_CHAIN`, the gates, `calorieNeed`, `householdFragment`, `cookFragment` and its constants, `formulaMixFragment`, `FORMULA_MIX` and `FORMULA_WATER`, the uses, `RESOURCE_SUBSETS` and `subsetConverters`, the supply parts and `checkJoins`. |
