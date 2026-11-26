# @mark1russell7/stack-endurance

The stores, the draws and the converters of a system stack. The package tells how many days each draw holds when a case cuts its supply. It also tells the shortfall of each level in one year.

It is the endurance add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). The core knows only parts and needs. This package tells what a part takes each day, and what the stores give when its supply stops.

The package names no topic. One query gives the battery days of a rack and the days of water of a building. The resources, the needs and the levels are data.

Each function is a plain function with no clock, no network and no file. The unit of time is the day.

## The records

| Record | What it tells |
| --- | --- |
| `Resource` | A resource of a store and its unit, for example `water.stored` in `L`. |
| `Store` | An amount of one resource, with an optional due date and an optional part that holds it. |
| `Draw` | A need that a load takes each day, its level, its count of users and the part that supplies it. |
| `DirectUse` | One unit of a resource gives an amount of a need. |
| `Converter` | A run takes some resources and gives an amount of a need or of a resource. Examples are a stove that cooks dry rice with water and fuel, and a generator that charges a battery from fuel. |
| `CaseCuts` | A case: the parts that it cuts, the survival curve of the duration of each cut, and factors on the rates. |
| `Prior` | The events of a case in one year at one place, and the share that reach the place. |

## The rule of endurance

- A draw takes from the stores only when the case stops its supply part.
- The draws take the resources in the order of their level, then of the codes of their needs.
- A draw takes from its direct uses first, then from its converters.
- A take of a resource uses its stock first, then the converters that make it, through each chain. Thus a direct use of the battery can use the fuel of the generator.
- The days of a draw are the largest `T` at which the stores give `T` days of its demand, after each higher draw.
- Each higher draw keeps back its own days times its demand. Thus the takes of all the draws are not more than the stores at any time.
- The take order is a rule, not the best share. The days are the days of this order. A draw with a shared device is different (refer to the limit `perDay` below). `takes` gives the amount of each resource that a draw takes.
- `jointDays` gives the best share for a set of draws. `bestEndurance` gives the best share for all the draws, level by level. Refer to the sections on the joint days and on the best endurance.
- A store gives nothing on its due date and after it. A store or a converter whose part stops gives nothing.
- A converter can have a limit `perDay`, the most runs of one device in a day, and a count `devices` (default 1). Over `T` days, the converters of one device use `devices` times `T` days of the device or less. One run uses `1 / perDay` of a day of the device. A maker and its taker on one device share these days.
- The higher draws use the days of a device first. Each higher draw keeps back its part of each day for all the days of a lower draw. This is the safe side.
- A draw can reach two converters of one device, each with a limit `perDay` more than 0. Then the draw does not use the take order. A linear program with exact rationals gives the best share of its stocks and of the device-days. The days of the draw are the largest `T` of this share. The take order gave the device-days to the first converter of the list, also when a faster converter gave more.
- `capped` names the converters whose limit stops a draw while their inputs have more. After `days`, the shortfall counts each day as a full shortfall.

With a base stack, a cut also stops each part that cannot work without the cut part. Thus a pump that needs the grid stops with the grid.

## The rule of shortfall

- For one draw in one case, the shortfall is `E[max(0, D - T)] * users`. `T` is the endurance of the draw. `D` is the duration of the stop of its supply.
- A set of cuts stops the supply when the supply cannot work without the cut parts, through the needs of the stack. A need of `any` parts stops only when enough of them are cut.
- `E[max(0, D - T)]` is the area under the survival curve from `T` on. The curve is linear between its points, so the area is exact.
- For one year, the shortfall is the sum over the cases of `perYear * reach` times the shortfall of the case. Thus it is the expected user-days of one year.
- The query adds the draws of one level. It does not add two levels.

With the option `horizon` of `h` days, the shortfall counts only the first `h` days of each cut: `E[max(0, min(D, h) - T)] * users`. A draw that holds `h` days has no shortfall. Thus a buy plan can aim at a target, for example 14 days and then 90 days.

The option `share` of `yearShortfall` sets the share of the stores in each case. The default `take` uses `enduranceOf`. With `best`, the query uses `bestEndurance`, and the horizon of the shortfall is the horizon of the share. Thus a draw at the horizon keeps back only `h` times its demand, and the lower levels get the rest.

Since 0.8.15, a prior can have an `interval` of its `perYear` at a level (`RateInterval` of the core). Then `yearShortfall` gives a `range`. It is the same sum with the rate of each case at the low end of its interval, and at the high end. Each end holds only for each case alone, so the range shows the sampling error of the rates. It is not a joint interval. A case with no interval is in `range.without`, and its rate is at the two ends.

A draw that only the parts of `down` stop has no curve of its duration. The query puts it in `unread`, and its shortfall is not in the sum. A gate shows it as no read, not as a pass.

A cut can have no `duration`, as before a source gives its curve. Then each draw whose stop the cut can be part of goes in `unread`. A draw whose minimal stop sets do not have the cut keeps its curves. When the query has no minimal sets, it cannot tell, so the draw goes in `unread`. The gate gives the warning `endurance-cut-no-curve` for each such cut.

Since 0.8.4, `stopCurves`, `caseShortfall` and `yearShortfall` give a `bound`: the weakest bound of the curves that the result uses (`weakestBound` of the core). A cut with no `bound` has a law. The shortfall does not decrease when a cut lasts longer, so the bound of each curve carries to the result.

| Bounds of the curves | Bound of the result |
| --- | --- |
| Each one `law`, or no curve | `law` |
| `law` and `upper` | `upper`: each value is too high or equal |
| `law` and `lower` | `lower`: each value is too low or equal |
| Any `none`, or `upper` and `lower` | `none`: a value can be too high or too low |

A stop uses the cuts of its minimal sets, or each cut with a curve when the query has no minimal sets. A draw in `unread` does not change the bound of its case. In one year, a case with no prior or with an expected count of 0 adds 0, so it does not change the bound. The gate refuses a bound that is not in `CUT_BOUNDS` (`endurance-bound`).

The cuts of one case come from one event. `levels` takes each cut longer together with the event (`eventStop`). Then a stop with two cuts lasts as long as the longer cut. A stop through a need of `any` of two parts ends with the shorter cut. `levels` is not a limit: when the cuts are independent, the true stop can be longer or shorter.

`upper` is an upper limit for each dependence of the cuts (`upperStop`). At each time, its chance is the sum over the minimal sets of cuts of the smallest chance of the set, to 1 or less. A gate of a high level can use `upper`.

`independent` is the shortfall when the cuts are independent (`independentStop`). At each time, the supply is stopped when the cuts that are still on contain a minimal set. The query adds the chance of each such state of the cuts. A stop of two cuts in series is then `1 - (1 - s1)(1 - s2)`, and a stop through a need of `any` of two parts is `s1 * s2`. `independent` is not more than `upper`. Between two bend times the chance is not linear, so the curve has more points, each within `1e-6` of the chance.

Only the cuts of the supply, and of the parts that it needs through the stack, count. With a stack, the minimal sets come from the paths of the needs (`stopSets` of the core, with the cut parts as `among`). Thus a case with more than 12 such cuts has exact sets. When that search passes its budget, the query examines each set of 12 cuts or fewer. The option `maxSets` sets the budget: the largest count of sets in one step of the search. The default is 4096. With no minimal sets, `upper` is the sum of the curves, `independent` is `upper`, and `coarse` names the need.

Two groups of cuts that share no minimal set are independent, so the independent stop takes the product over the groups. In a group of up to 12 cuts, it adds the chance of each state of the cuts. In a larger group, it uses the Shannon expansion of `pathSetReliability` (`@mark1russell7/collections`). The expansion merges two states with the same sets left, so sets with few shared cuts give a small expansion. The expansion is exponential in the worst case. The groups share one budget, `INDEPENDENT_MAX_WORK`, and the option `maxWork` changes it. When the expansions pass the budget, `independent` is `upper`, and `independentUpper` names the need.

## The outlook of a case

`caseOutlook(layer, caseCuts, options)` gives the outlook of one event of a case, for each draw. A page of a place can show it for each case of its region.

- `days` are the days that the stores give the draw. The option `share` sets the share, as for `yearShortfall`.
- `lasts` is the chance that the draw gets its need through the event: `P(min(D, h) <= T)`. A draw that holds to the horizon has the chance 1.
- `shortfall` is the user-days of one event, `E[max(0, min(D, h) - T)] * users`. The sum of each level is the value of `caseShortfall`.
- Each value has one number for each curve of `stopCurves`: `event`, `independent` and `upper`.
- The chance of `upper` is not more than the true chance, for each dependence of the cuts. Thus the range from `upper` to the other two shows the doubt of the dependence.
- `holds` names the draws whose supply the case does not stop. `unread` names the draws whose stop has no curve.
- `band` gives the same values with each cut at the low end of its band (`shorter`) and at the high end (`longer`). The days do not change. Each end holds only at each day, so the two values are a range of the sampling error, not a joint interval. A draw has no `band` when a cut of its stop has a curve and no band. Since 0.8.14.

## The joint days

`jointDays(layer, caseCuts, options, needs)` gives the joint days of a set of draws. These are the largest count of days `d` at which each draw of the set holds `d` days together.

- The function finds the best share of the stores and of the runs of the converters. It does not use the take order.
- It solves a linear program with exact rationals (`@mark1russell7/linear`). Only the change back to a number rounds.
- The variables are the days, the take of each direct use, the runs of each converter, and the share of each stock for each draw.
- Each draw of the set gets `d` times its demand. The takes of a resource are not more than its stock plus the gifts of its makers.
- The runs of a converter with a limit `perDay` are not more than `perDay` times `devices` times `d`. The converters of one device share the limit.
- After the largest `d`, the program takes the smallest sum of the shares of the stocks. Thus the takes have no waste.
- A third objective takes the fewest device-days of the converters. Thus the runs are not more than the plan uses.
- The draws that are not in the set are outside this plan. They take nothing.
- A draw of the set whose supply works, or whose demand is 0, holds without end. It goes in `holds`, as `enduranceOf` leaves it out.
- A need code that is not the need of a draw is an error, a `RangeError`.
- A store gives all of its amount when its due date is after the date of the query. This is the rule of `enduranceOf`.
- `binding` gives the resources with a store that the optimum uses up. `takes` gives the takes of each draw. `runs` gives the runs of each converter.
- `capped` gives the converters of the plan whose limit `perDay` stops more runs at the optimum. A maker that the plan does not use is not in the list.

An example: a tank holds 20 L of water. The drink takes 3 L each day, at the higher level. Only a cook feeds the food, 2000 kcal each day. One run of the cook takes 1 L of water, 0.5 kg of grain and 0.125 kg of fuel, and gives 2000 kcal.

```ts
import { enduranceOf, jointDays } from "@mark1russell7/stack-endurance";

const ordered = enduranceOf(layer, dry, { at: "2026-12-01" });
// ordered.needs.drink.days is 6.667, and ordered.needs.food.days is 0.
const joint = jointDays(layer, dry, { at: "2026-12-01" }, ["drink", "food"]);
// joint.days is 5, and joint.binding is ["water"].
// joint.takes is { drink: { water: 15 }, food: { water: 5, grain: 2.5, fuel: 0.625 } }.
```

The take order gives the drink 6.667 days. The drink keeps back all the water for these days, so the food gets 0 days. Together, the two draws take 4 L each day. Thus the water holds 5 days for the two.

The joint days are not more than the days of each draw alone. The take order tells the days of a rule of priority. The joint days tell the days of the best share.

## The best endurance

`bestEndurance(layer, caseCuts, options)` gives the days of each draw with the best share of the stores and of the devices. Its result has the form of `enduranceOf`, so `caseShortfall` takes it.

- The share is lexicographic by level. The draws of the first level get their best days. Then the draws of the next level get their best days, and so on.
- In one level, the share is the best for the draw with the fewest days, then for the next draw, and so on. This is the leximin share.
- Thus a draw cannot take a store that another draw of its level needs more. A higher draw does not take a store that a lower draw needs, when the higher draw has a second way.
- Each step is a linear program with exact rationals. It takes the largest common floor of the open draws.
- A draw whose floor row has a dual value that is not 0 cannot get more days. The step fixes its days. Each step fixes one draw or more.
- A fixed draw keeps its days. Its share of the stocks can change in a later step.
- A fixed draw keeps the device-days of each day that it uses, for all the days of the later draws. This is the safe side, as in `enduranceOf`.
- A draw with no end gets `Infinity` days. It takes no stock.
- The stores, the uses, the converters and the devices follow the rules of `jointDays`.
- The fewest days of the first level are the joint days of the draws of that level.

An example: the draw `a` drinks water or juice, and the draw `b` drinks only water. Each draw takes 1 L each day, and the stores have 10 L of each. The two draws are at one level.

```ts
import { bestEndurance, enduranceOf } from "@mark1russell7/stack-endurance";

const ordered = enduranceOf(layer, dry, { at: "2026-12-01" });
// ordered.needs.a.days is 20, and ordered.needs.b.days is 0.
const best = bestEndurance(layer, dry, { at: "2026-12-01" });
// best.needs.a is { days: 10, binding: ["juice", "water"], takes: { juice: 10 } }.
// best.needs.b is { days: 10, binding: ["water"], takes: { water: 10 } }.
```

The take order gives the water to `a` first, so `b` gets 0 days. The best share gives the juice to `a` and the water to `b`.

### A horizon

With the option `horizon` of `h` days, each draw holds `h` days at most. A draw at the horizon keeps back only `h` times its demand. The rest of the stores goes to the lower levels.

- A draw at the horizon has `days: h` and `atHorizon: true`. It can hold more days.
- A draw with no end also gets `h` days.
- With no horizon, the result is the same as before the option.

An example: the stores have 10 L of water. The drink at the level `life` takes 1 L each day. The food at the level `health` is rice, cooked with 2 L of water for each pot.

```ts
const best = bestEndurance(layer, dry, { at: "2026-12-01", horizon: 5 });
// best.needs.drink is { days: 5, binding: ["water"], takes: { water: 5 }, atHorizon: true }.
// best.needs.food.days is 2.5: the other 5 L cook 2.5 pots.
```

With no horizon, the drink takes all the water for 10 days, and the food gets 0 days.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-endurance` | The records of a layer, the endurance, joint days, best endurance and shortfall queries, the gate, the join and a sample. |
| `@mark1russell7/stack-endurance/schema` | `enduranceSchema`, the zod schema of a layer, with `parseEndurance`. |
| `@mark1russell7/stack-endurance/add-on` | `enduranceAddOn`, the add-on in the form of the layer contract of the core. |

The root entry has no schema library.

## Install

```sh
npm install @mark1russell7/stack-endurance @mark1russell7/system-stack
```

## An example

```ts
import { enduranceOf, SAMPLE_ENDURANCE, yearShortfall } from "@mark1russell7/stack-endurance";

const storm = SAMPLE_ENDURANCE.cases?.find((item) => item.case === "storm");
if (storm !== undefined) {
  const held = enduranceOf(SAMPLE_ENDURANCE, storm, { at: "2026-12-01" });
  // held.needs["food.energy"] is { days: 0.889, binding: ["food.ready", "water.stored"] }.
}
const year = yearShortfall(SAMPLE_ENDURANCE, "home", { at: "2026-12-01" });
// year.levels is { life: 0.008, health: 3.766, comfort: 0.377 }, in user-days.
```

In the sample, the rice needs 2 L of water for each kg. The drinking water holds 6.667 days, and it keeps back all the water for these days. So the rice gives nothing, and the food holds 0.889 days on the cans.

## The join

`joinEndurance(pieces)` joins the endurance layers of the fragments of a stack, for example one file of stores for each owner.

- Two fragments can declare one resource code. When the two records are equal, the joined layer has one record.
- The join compares the records with canonical JSON (RFC 8785). Thus the order of the keys has no effect.
- When the unit or a different field is not equal, the join has a fault. The message names the fragments and the resource code. Each record of a fragment is on its own line, in canonical JSON, so the different field is easy to find.
- The join is `joinRecords` of the core with the options `equal` and `text`.
- One key of a store, a draw, a direct use, a converter, a case or a prior in two fragments is a fault.
- The levels are one setting. Each fragment with levels gives the same list.

## The gate

`checkEndurance(layer, stack)` gives the faults of a layer. `ENDURANCE_CODES` lists the codes. The gate finds two records with one key, and an unknown level, resource or part. It also finds a value out of range, a bad date, an empty converter and a bad survival curve. Converters that make a resource from itself are a cycle, and the gate refuses them. Two counts of devices for one device are a fault (`endurance-devices`). A device with a limited converter and a converter with no limit is a warning (`endurance-device-mix`), because the converter with no limit uses no device-days. A draw with no way to get its need is a warning, and a cut with no curve is a warning.
