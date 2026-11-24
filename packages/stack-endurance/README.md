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
- The take order is a rule, not the best share. The days are the days of this order. `takes` gives the amount of each resource that a draw takes.
- `jointDays` gives the best share for a set of draws. Refer to the section on the joint days.
- A store gives nothing on its due date and after it. A store or a converter whose part stops gives nothing.
- A converter can have a limit `perDay`, the most runs of one device in a day, and a count `devices` (default 1). Over `T` days, the converters of one device use `devices` times `T` days of the device or less. One run uses `1 / perDay` of a day of the device. A maker and its taker on one device share these days.
- The higher draws use the days of a device first. Each higher draw keeps back its part of each day for all the days of a lower draw. This is the safe side.
- `capped` names the converters whose limit stops a draw while their inputs have more. After `days`, the shortfall counts each day as a full shortfall.

With a base stack, a cut also stops each part that cannot work without the cut part. Thus a pump that needs the grid stops with the grid.

## The rule of shortfall

- For one draw in one case, the shortfall is `E[max(0, D - T)] * users`. `T` is the endurance of the draw. `D` is the duration of the stop of its supply.
- A set of cuts stops the supply when the supply cannot work without the cut parts, through the needs of the stack. A need of `any` parts stops only when enough of them are cut.
- `E[max(0, D - T)]` is the area under the survival curve from `T` on. The curve is linear between its points, so the area is exact.
- For one year, the shortfall is the sum over the cases of `perYear * reach` times the shortfall of the case. Thus it is the expected user-days of one year.
- The query adds the draws of one level. It does not add two levels.

With the option `horizon` of `h` days, the shortfall counts only the first `h` days of each cut: `E[max(0, min(D, h) - T)] * users`. A draw that holds `h` days has no shortfall. Thus a buy plan can aim at a target, for example 14 days and then 90 days.

A draw that only the parts of `down` stop has no curve of its duration. The query puts it in `unread`, and its shortfall is not in the sum. A gate shows it as no read, not as a pass.

A cut can have no `duration`, as before a source gives its curve. Then each draw whose stop the cut can be part of goes in `unread`. A draw whose minimal stop sets do not have the cut keeps its curves. When the query has no minimal sets, it cannot tell, so the draw goes in `unread`. The gate gives the warning `endurance-cut-no-curve` for each such cut.

The cuts of one case come from one event. `levels` takes each cut longer together with the event (`eventStop`). Then a stop with two cuts lasts as long as the longer cut. A stop through a need of `any` of two parts ends with the shorter cut. `levels` is not a limit: when the cuts are independent, the true stop can be longer or shorter.

`upper` is an upper limit for each dependence of the cuts (`upperStop`). At each time, its chance is the sum over the minimal sets of cuts of the smallest chance of the set, to 1 or less. A gate of a high level can use `upper`.

`independent` is the shortfall when the cuts are independent (`independentStop`). At each time, the supply is stopped when the cuts that are still on contain a minimal set. The query adds the chance of each such state of the cuts. A stop of two cuts in series is then `1 - (1 - s1)(1 - s2)`, and a stop through a need of `any` of two parts is `s1 * s2`. `independent` is not more than `upper`. Between two bend times the chance is not linear, so the curve has more points, each within `1e-6` of the chance.

Only the cuts of the supply, and of the parts that it needs through the stack, count. With a stack, the minimal sets come from the paths of the needs (`stopSets` of the core, with the cut parts as `among`). Thus a case with more than 12 such cuts has exact sets. When that search passes its budget, the query examines each set of 12 cuts or fewer. The option `maxSets` sets the budget: the largest count of sets in one step of the search. The default is 4096. With no minimal sets, `upper` is the sum of the curves, `independent` is `upper`, and `coarse` names the need.

Two groups of cuts that share no minimal set are independent, so the independent stop takes the product over the groups. In a group of up to 12 cuts, it adds the chance of each state of the cuts. In a larger group, it uses the Shannon expansion of `pathSetReliability` (`@mark1russell7/collections`). The expansion merges two states with the same sets left, so sets with few shared cuts give a small expansion. The expansion is exponential in the worst case. The groups share one budget, `INDEPENDENT_MAX_WORK`, and the option `maxWork` changes it. When the expansions pass the budget, `independent` is `upper`, and `independentUpper` names the need.

## The joint days

`jointDays(layer, caseCuts, options, needs)` gives the joint days of a set of draws. These are the largest count of days `d` at which each draw of the set holds `d` days together.

- The function finds the best share of the stores and of the runs of the converters. It does not use the take order.
- It solves a linear program with exact rationals (`@mark1russell7/linear`). Only the change back to a number rounds.
- The variables are the days, the take of each direct use, the runs of each converter, and the share of each stock for each draw.
- Each draw of the set gets `d` times its demand. The takes of a resource are not more than its stock plus the gifts of its makers.
- The runs of a converter with a limit `perDay` are not more than `perDay` times `devices` times `d`. The converters of one device share the limit.
- After the largest `d`, the program takes the smallest sum of the shares of the stocks. Thus the takes have no waste.
- The draws that are not in the set are outside this plan. They take nothing.
- A draw of the set whose supply works, or whose demand is 0, holds without end. It goes in `holds`, as `enduranceOf` leaves it out.
- A need code that is not the need of a draw is an error, a `RangeError`.
- A store gives all of its amount when its due date is after the date of the query. This is the rule of `enduranceOf`.
- `binding` gives the resources with a store that the optimum uses up. `takes` gives the takes of each draw. `runs` gives the runs of each converter.
- `capped` gives the converters whose limit `perDay` stops more runs at the optimum.

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

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-endurance` | The records of a layer, the endurance, joint days and shortfall queries, the gate, the join and a sample. |
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

`checkEndurance(layer, stack)` gives the faults of a layer. `ENDURANCE_CODES` lists the codes. The gate finds two records with one key, and an unknown level, resource or part. It also finds a value out of range, a bad date, an empty converter and a bad survival curve. Converters that make a resource from itself are a cycle, and the gate refuses them. Two counts of devices for one device are a fault (`endurance-devices`). A draw with no way to get its need is a warning, and a cut with no curve is a warning.
